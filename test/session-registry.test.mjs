import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DETACH_BUFFER_BYTE_LIMIT,
  createEntry,
  deleteEntry,
  drainBuffer,
  pushToBuffer,
} from '../server/session-registry.mjs';

test('detached authoritative replay buffer is byte bounded and resets accounting', () => {
  const entry = createEntry();
  assert.ok(entry);
  try {
    pushToBuffer(entry, { type: 'event', text: 'x'.repeat(DETACH_BUFFER_BYTE_LIMIT + 1) });
    assert.equal(entry.buffer.length, 0);
    assert.equal(entry.bufferBytes, 0);
    pushToBuffer(entry, { type: 'event', text: 'small' });
    assert.equal(drainBuffer(entry).length, 1);
    assert.equal(entry.bufferBytes, 0);
  } finally {
    deleteEntry(entry.attachId);
  }
});
