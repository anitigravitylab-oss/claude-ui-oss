// concurrentSessions: C parallel /ws/chat connections, each with a unique
// marker. Verifies each session's reply contains ONLY its own marker (no
// cross-talk between concurrently-running claude child processes).

import { openChat, startAndAsk } from '../lib/chat.mjs';
import { marker as makeMarker } from '../lib/util.mjs';

export default async function concurrentSessions(ctx) {
  const errors = [];
  const n = Math.max(2, Number(ctx.concurrency) || 3);
  const markers = Array.from({ length: n }, () => makeMarker('CC'));

  const conns = await Promise.all(markers.map(() => openChat(ctx)));
  try {
    const results = await Promise.all(
      markers.map((m, i) =>
        startAndAsk(conns[i], {
          cwd: ctx.cwd,
          model: ctx.model,
          text: `Reply with exactly: ${m}`,
          timeoutMs: ctx.defaultTimeout,
        }).catch((err) => ({ error: err.message }))
      )
    );

    results.forEach((res, i) => {
      const own = markers[i];
      const others = markers.filter((_, j) => j !== i);
      if (res.error) {
        errors.push(`session ${i} (${own}) failed: ${res.error}`);
        return;
      }
      if (ctx.recordLatency) ctx.recordLatency(res.event);
      if (res.isError) errors.push(`session ${i} (${own}) result.is_error=true`);
      if (!res.text || !res.text.includes(own)) {
        errors.push(`session ${i} (${own}) missing own marker: ${JSON.stringify(res.text)}`);
      }
      for (const other of others) {
        if (res.text && res.text.includes(other)) {
          errors.push(`session ${i} (${own}) leaked another session's marker ${other}: ${JSON.stringify(res.text)}`);
        }
      }
    });

    return {
      pass: errors.length === 0,
      errors,
      detail: { sessions: n },
    };
  } finally {
    for (const c of conns) c.close();
  }
}
