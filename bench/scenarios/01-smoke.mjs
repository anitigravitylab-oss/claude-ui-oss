// smoke: 1 turn, 1 answer. start -> session_started -> assistant -> result,
// with the exact marker text coming back. The baseline "does anything work
// at all" check that other scenarios (e.g. malformedInput) reuse afterward.

import { openChat, startAndAsk } from '../lib/chat.mjs';

export default async function smoke(ctx) {
  const errors = [];
  const conn = await openChat(ctx);
  try {
    const res = await startAndAsk(conn, {
      cwd: ctx.cwd,
      model: ctx.model,
      text: 'Reply with exactly: PONG',
      timeoutMs: ctx.defaultTimeout,
    });
    if (ctx.recordLatency) ctx.recordLatency(res.event);
    if (res.isError) errors.push(`result.is_error=true: ${JSON.stringify(res.event).slice(0, 200)}`);
    if (!res.text || !res.text.includes('PONG')) errors.push(`unexpected reply text: ${JSON.stringify(res.text)}`);
    if (!res.sessionId) errors.push('no sessionId observed (session_started missing)');
    return {
      pass: errors.length === 0,
      errors,
      detail: { sessionId: res.sessionId, replyLen: (res.text || '').length },
    };
  } finally {
    conn.close();
  }
}
