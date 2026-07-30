import assert from 'node:assert/strict';
import test from 'node:test';

import { listSessions, resolveTranscriptPath } from '../server/history.mjs';

test('history paths require absolute cwd and traversal-safe session ids', async () => {
  await assert.rejects(listSessions('../relative'), (error) => error.status === 400);
  assert.throws(() => resolveTranscriptPath('../relative', 'safe-session'), (error) => error.status === 400);
  assert.throws(() => resolveTranscriptPath('/tmp/project', '../../etc/passwd'), (error) => error.status === 400);
  assert.match(resolveTranscriptPath('/tmp/project', 'safe-session'), /safe-session\.jsonl$/);
});
