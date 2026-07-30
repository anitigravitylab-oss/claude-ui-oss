// idleSurvival: hold a started session open with no traffic for a while,
// then confirm it still answers (no keep-alive timeout kills the child).
// Short by default (5s); --heavy stretches it to 90s.

import { openChat, startAndAsk, ask } from '../lib/chat.mjs';
import { sleep } from '../lib/util.mjs';

export default async function idleSurvival(ctx) {
  const errors = [];
  const idleMs = ctx.heavy ? 90000 : 5000;
  const conn = await openChat(ctx);
  try {
    const first = await startAndAsk(conn, {
      cwd: ctx.cwd,
      model: ctx.model,
      text: 'Reply with exactly: BEFORE_IDLE',
      timeoutMs: ctx.defaultTimeout,
    });
    if (ctx.recordLatency) ctx.recordLatency(first.event);
    if (first.isError || !first.text || !first.text.includes('BEFORE_IDLE')) {
      errors.push(`initial turn failed: isError=${first.isError} text=${JSON.stringify(first.text)}`);
    }

    await sleep(idleMs);

    if (conn.isClosed()) {
      errors.push(`connection closed unexpectedly during idle (${JSON.stringify(conn.closeInfo())})`);
    } else {
      const after = await ask(conn, {
        text: 'Reply with exactly: AFTER_IDLE',
        timeoutMs: ctx.defaultTimeout,
      }).catch((err) => ({ error: err.message }));
      if (after.error) {
        errors.push(`post-idle turn failed: ${after.error}`);
      } else {
        if (ctx.recordLatency) ctx.recordLatency(after.event);
        if (after.isError || !after.text || !after.text.includes('AFTER_IDLE')) {
          errors.push(`post-idle reply wrong: isError=${after.isError} text=${JSON.stringify(after.text)}`);
        }
      }
    }

    return { pass: errors.length === 0, errors, detail: { idleMs } };
  } finally {
    conn.close();
  }
}
