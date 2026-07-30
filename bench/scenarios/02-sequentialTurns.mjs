// sequentialTurns: N user_message turns over one connection/child process,
// verifying no errors along the way AND that context is actually retained
// (the CLI process is not respawned between turns — only `start` does that).

import { openChat, startAndAsk, ask } from '../lib/chat.mjs';

export default async function sequentialTurns(ctx) {
  const errors = [];
  const secret = `SEQ-${Math.floor(Math.random() * 100000)}`;
  const conn = await openChat(ctx);
  try {
    const turns = [];

    const t1 = await startAndAsk(conn, {
      cwd: ctx.cwd,
      model: ctx.model,
      text: `Remember this codeword: ${secret}. Reply with exactly: OK1`,
      timeoutMs: ctx.defaultTimeout,
    });
    turns.push(t1);
    if (ctx.recordLatency) ctx.recordLatency(t1.event);
    if (t1.isError || !t1.text || !t1.text.includes('OK1')) {
      errors.push(`turn1 failed: isError=${t1.isError} text=${JSON.stringify(t1.text)}`);
    }

    const t2 = await ask(conn, {
      text: 'What codeword did I just tell you? Reply with exactly that codeword and nothing else.',
      timeoutMs: ctx.defaultTimeout,
    });
    turns.push(t2);
    if (ctx.recordLatency) ctx.recordLatency(t2.event);
    if (t2.isError || !t2.text || !t2.text.includes(secret)) {
      errors.push(`turn2 lost context: isError=${t2.isError} text=${JSON.stringify(t2.text)}`);
    }

    const t3 = await ask(conn, {
      text: 'Reply with exactly: OK3',
      timeoutMs: ctx.defaultTimeout,
    });
    turns.push(t3);
    if (ctx.recordLatency) ctx.recordLatency(t3.event);
    if (t3.isError || !t3.text || !t3.text.includes('OK3')) {
      errors.push(`turn3 failed: isError=${t3.isError} text=${JSON.stringify(t3.text)}`);
    }

    return {
      pass: errors.length === 0,
      errors,
      detail: { turns: turns.length, secret },
    };
  } finally {
    conn.close();
  }
}
