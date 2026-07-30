// reconnect (Phase 4: detach/reattach): drop the WS abruptly mid-generation,
// let the server complete the turn while nobody is connected (detached),
// then reconnect with `{type:"attach", attachId}` and confirm the buffered
// result replays. Also checks the attach_failed -> fallback path with a
// bogus attachId. The scenario explicitly ends the session itself (`stop`)
// before returning, so no detached-but-idle child lingers for leakCheck to
// trip on (per .ai/current-task.md).

import { randomUUID } from 'node:crypto';
import { openChat, isResultEvent, isSessionStarted } from '../lib/chat.mjs';
import { isAttached, isAttachFailed, isAttachComplete } from '../lib/chat.mjs';
import { sleep } from '../lib/util.mjs';

export default async function reconnect(ctx) {
  const errors = [];
  const detail = {};

  const conn1 = await openChat(ctx);
  let attachId = null;
  let sessionId = null;
  try {
    conn1.send({ type: 'start', cwd: ctx.cwd, model: ctx.model });
    const attachedWaiter = conn1.waitFor(isAttached, ctx.defaultTimeout);
    const startedWaiter = conn1.waitFor(isSessionStarted, ctx.defaultTimeout);
    conn1.send({ type: 'user_message', text: 'Reply with exactly: DETACHED_TURN_OK (nothing else).' });
    try {
      attachId = (await attachedWaiter).attachId;
    } catch (err) {
      errors.push(`never observed 'attached' before dropping: ${err.message}`);
    }
    try {
      sessionId = (await startedWaiter).sessionId;
    } catch (err) {
      errors.push(`never observed session_started before dropping: ${err.message}`);
    }

    await sleep(500); // let generation actually get underway before an abrupt drop
    conn1.terminate(); // abrupt drop, not a graceful close() — simulates a lost WS
  } finally {
    /* conn1 is terminated; nothing else to clean up on it */
  }
  detail.attachId = attachId;
  detail.sessionId = sessionId;

  // Give the server time to finish the turn with nobody attached.
  await sleep(3000);

  let serverAlive = false;
  try {
    const res = await fetch(`${ctx.baseUrl}/api/info`, { headers: { Authorization: `Bearer ${ctx.token}` } });
    serverAlive = res.ok;
  } catch (err) {
    errors.push(`server unreachable after drop: ${err.message}`);
  }
  if (!serverAlive) errors.push('server did not survive the abrupt disconnect');

  let attachReplayOk = false;
  let conn2 = null;
  if (serverAlive && attachId) {
    conn2 = await openChat(ctx);
    try {
      conn2.send({ type: 'attach', attachId });
      const [resultEvt] = await Promise.all([
        conn2.waitFor(isResultEvent, ctx.defaultTimeout),
        conn2.waitFor(isAttachComplete, ctx.defaultTimeout).catch(() => null),
      ]);
      const text = resultEvt.event.result;
      attachReplayOk = !resultEvt.event.is_error && !!text && text.includes('DETACHED_TURN_OK');
      if (!attachReplayOk) errors.push(`attach replay result unexpected: isError=${resultEvt.event.is_error} text=${JSON.stringify(text)}`);
      if (ctx.recordLatency) ctx.recordLatency(resultEvt.event);
    } catch (err) {
      errors.push(`attach did not replay a result: ${err.message}`);
    }
  } else if (serverAlive) {
    errors.push('no attachId captured — cannot exercise the attach/replay path');
  }

  // attach_failed path: a bogus attachId must be rejected, never silently
  // accepted (R2/R4 — no guessable/loose acceptance).
  let attachFailedOk = false;
  if (serverAlive) {
    const conn3 = await openChat(ctx);
    try {
      conn3.send({ type: 'attach', attachId: randomUUID() });
      const failed = await conn3.waitFor(isAttachFailed, ctx.defaultTimeout);
      attachFailedOk = !!failed;
    } catch (err) {
      errors.push(`bogus attachId did not produce attach_failed: ${err.message}`);
    } finally {
      conn3.close();
    }
  }

  // Explicitly end the reattached session now (rather than relying on the
  // detach TTL) so leakCheck — which runs later in the same server process
  // — never sees this scenario's child as a lingering descendant.
  if (conn2) {
    try {
      conn2.send({ type: 'stop' });
      await sleep(300);
    } catch {
      /* best effort */
    } finally {
      conn2.close();
    }
  }

  detail.attachReplayOk = attachReplayOk;
  detail.attachFailedOk = attachFailedOk;

  return {
    pass: errors.length === 0 && serverAlive && attachReplayOk && attachFailedOk,
    errors,
    detail,
  };
}
