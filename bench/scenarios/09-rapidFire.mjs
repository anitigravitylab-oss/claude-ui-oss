// rapidFire: burst several user_message/interrupt frames back-to-back
// without waiting for individual turns to complete. Pass criterion is the
// same as malformedInput: the server must not crash or deadlock, verified by
// a fresh smoke() immediately afterward.

import { openChat } from '../lib/chat.mjs';
import { sleep } from '../lib/util.mjs';
import smoke from './01-smoke.mjs';

export default async function rapidFire(ctx) {
  const errors = [];
  const conn = await openChat(ctx);

  try {
    conn.send({ type: 'start', cwd: ctx.cwd, model: ctx.model });
    for (let i = 0; i < 5; i++) {
      conn.send({ type: 'user_message', text: `Reply with exactly: BURST${i}` });
    }
    for (let i = 0; i < 3; i++) {
      conn.send({ type: 'interrupt' });
    }
    conn.send({ type: 'user_message', text: 'Reply with exactly: TAIL' });

    // Bounded observation window: we don't require every burst message to
    // get a matching result (the CLI may coalesce/serialize them), only that
    // the connection doesn't hang or error out wholesale within it.
    await sleep(ctx.heavy ? 20000 : 8000);
  } catch (err) {
    errors.push(`error during rapid-fire burst: ${err.message}`);
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
    errors.push(`server did not survive rapid-fire burst: fresh smoke failed (${freshSmoke.errors.join('; ')})`);
  }

  return {
    pass: errors.length === 0,
    errors,
    detail: { freshSmokePass: freshSmoke.pass },
  };
}
