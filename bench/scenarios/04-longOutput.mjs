// longOutput: a reply long enough to require multiple stream chunks,
// verifying streaming doesn't truncate and the turn still reaches `result`.

import { openChat, startAndAsk, isResultEvent } from '../lib/chat.mjs';

function countTextDeltas(events) {
  let n = 0;
  for (const e of events) {
    if (e.type === 'cli_event' && e.event && e.event.type === 'stream_event') {
      const d = e.event.event && e.event.event.delta;
      if (d && d.type === 'text_delta') n++;
    }
  }
  return n;
}

export default async function longOutput(ctx) {
  const errors = [];
  const conn = await openChat(ctx);
  try {
    const n = ctx.heavy ? 200 : 50;
    const res = await startAndAsk(conn, {
      cwd: ctx.cwd,
      model: ctx.model,
      text: `Write the integers from 1 to ${n} separated by commas, all on one line, nothing else.`,
      timeoutMs: ctx.defaultTimeout,
    });
    if (ctx.recordLatency) ctx.recordLatency(res.event);
    const deltaCount = countTextDeltas(conn.events);
    if (res.isError) errors.push(`result.is_error=true`);
    if (!res.text || res.text.length < 20) errors.push(`reply too short: ${JSON.stringify((res.text || '').slice(0, 80))}`);
    if (deltaCount < 3) errors.push(`expected streaming in multiple chunks, got ${deltaCount} text_delta events`);
    if (!conn.events.some(isResultEvent)) errors.push('no result event observed');
    return {
      pass: errors.length === 0,
      errors,
      detail: { replyLen: (res.text || '').length, textDeltaEvents: deltaCount },
    };
  } finally {
    conn.close();
  }
}
