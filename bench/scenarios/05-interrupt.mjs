// interrupt: send `interrupt` mid-generation, then verify the session is
// still usable afterward (same connection, another user_message succeeds).
// The server doesn't ack interrupt explicitly; the CLI just stops the turn,
// which shows up as *some* result (possibly an error/aborted subtype).

import { openChat, isResultEvent, ask } from '../lib/chat.mjs';
import { sleep } from '../lib/util.mjs';

export default async function interrupt(ctx) {
  const errors = [];
  const conn = await openChat(ctx);
  try {
    conn.send({ type: 'start', cwd: ctx.cwd, model: ctx.model });
    const resultWaiter = conn.waitFor(isResultEvent, ctx.defaultTimeout);
    conn.send({ type: 'user_message', text: 'Count slowly from 1 to 200, one number per line, nothing else.' });

    // Give it a moment to actually start generating before interrupting.
    await sleep(1200);
    conn.send({ type: 'interrupt' });

    let interruptedOk = true;
    try {
      await resultWaiter;
    } catch (err) {
      // Timing out here (CLI never finalized) is the actual failure mode we
      // care about detecting, not a bench bug — but give it a bit more time
      // rather than failing on a hair trigger.
      interruptedOk = false;
      errors.push(`no result after interrupt within timeout: ${err.message}`);
    }

    if (interruptedOk) {
      const followUp = await ask(conn, {
        text: 'Reply with exactly: RESUMED',
        timeoutMs: ctx.defaultTimeout,
      }).catch((err) => ({ error: err.message }));
      if (ctx.recordLatency && followUp && followUp.event) ctx.recordLatency(followUp.event);
      if (followUp.error) {
        errors.push(`session unusable after interrupt: ${followUp.error}`);
      } else if (followUp.isError || !followUp.text || !followUp.text.includes('RESUMED')) {
        errors.push(`post-interrupt reply wrong: isError=${followUp.isError} text=${JSON.stringify(followUp.text)}`);
      }
    }

    return {
      pass: errors.length === 0,
      errors,
      detail: {},
    };
  } finally {
    conn.close();
  }
}
