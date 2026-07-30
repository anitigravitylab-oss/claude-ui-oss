// malformedInput: fire a battery of abnormal client->server frames at a
// throwaway connection, then require a completely fresh smoke() to still
// pass on the SAME spawned server. The pass criterion is entirely "did the
// server survive", not any particular response to the bad input.

import { openChat, isTopLevelError } from '../lib/chat.mjs';
import { sleep } from '../lib/util.mjs';
import smoke from './01-smoke.mjs';

export default async function malformedInput(ctx) {
  const errors = [];
  const notes = {};
  const conn = await openChat(ctx);

  try {
    // 1) invalid JSON line
    const errWaiter = conn.waitFor(isTopLevelError, 5000);
    conn.sendRaw('{this is not valid json');
    try {
      await errWaiter;
      notes.invalidJsonAcked = true;
    } catch {
      notes.invalidJsonAcked = false; // not fatal by itself; checked via final smoke
    }

    // 2) unknown message type
    conn.send({ type: '__unknown_type__', foo: 1, bar: [1, 2, 3] });
    await sleep(200);

    // 3) user_message before any `start` (child is null server-side; must no-op)
    conn.send({ type: 'user_message', text: 'hello before start' });
    await sleep(200);

    // 4) double start in quick succession — first session should be killed
    // and cleaned up without leaking a spurious exit into the second.
    conn.send({ type: 'start', cwd: ctx.cwd, model: ctx.model });
    conn.send({ type: 'user_message', text: 'Reply with exactly: FIRST' });
    await sleep(150);
    conn.send({ type: 'start', cwd: ctx.cwd, model: ctx.model });
    conn.send({ type: 'user_message', text: 'Reply with exactly: SECOND' });

    // 5) oversized message on the (second) active session — several hundred KB.
    const big = 'x'.repeat(400 * 1024);
    conn.send({ type: 'user_message', text: big });
    await sleep(1500);

    // Give the CLI a bounded window to settle after all that abuse; we don't
    // require any particular reply here, only that the process is alive.
    await sleep(2000);
  } catch (err) {
    errors.push(`error while injecting malformed input: ${err.message}`);
  } finally {
    conn.close();
  }

  await sleep(300);

  let freshSmoke;
  try {
    freshSmoke = await smoke(ctx);
  } catch (err) {
    freshSmoke = { pass: false, errors: [err.message], detail: {} };
  }
  if (!freshSmoke.pass) {
    errors.push(`server did not survive malformed input: fresh smoke failed (${freshSmoke.errors.join('; ')})`);
  }

  return {
    pass: errors.length === 0,
    errors,
    detail: { ...notes, freshSmokePass: freshSmoke.pass },
  };
}
