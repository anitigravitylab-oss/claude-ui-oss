import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_CHAT_MESSAGE_BYTES,
  validAbsolutePath,
  validSessionId,
  validateClientMessage,
  validateFirstMessage,
} from '../server/protocol-validation.mjs';

test('start messages accept normal CLI options and reject option injection', () => {
  assert.equal(
    validateFirstMessage({
      type: 'start',
      cwd: '/tmp/project',
      model: 'sonnet',
      permissionMode: 'plan',
      addDir: ['/tmp/shared'],
    }),
    null
  );
  assert.match(validateFirstMessage({ type: 'start', cwd: 'relative' }), /cwd/);
  assert.match(validateFirstMessage({ type: 'start', cwd: '/tmp', model: '--help' }), /model/);
  assert.match(validateFirstMessage({ type: 'start', cwd: '/tmp', addDir: new Array(33).fill('/tmp') }), /addDir/);
});

test('first message only permits lifecycle operations', () => {
  assert.match(validateFirstMessage({ type: 'user_message', text: 'hello' }), /first message/);
  assert.equal(validateFirstMessage({ type: 'attach', attachId: '123e4567-e89b-12d3-a456-426614174000' }), null);
  assert.match(validateFirstMessage({ type: 'attach', attachId: '../entry' }), /attachId/);
});

test('chat messages are type checked and size bounded', () => {
  assert.equal(validateClientMessage({ type: 'user_message', text: 'hello' }), null);
  assert.match(
    validateClientMessage({ type: 'user_message', text: 'x'.repeat(MAX_CHAT_MESSAGE_BYTES + 1) }),
    /oversized/
  );
  assert.match(validateClientMessage({ type: 'permission_response', requestId: 'x', behavior: 'yes' }), /permission/);
  assert.match(validateClientMessage({ type: 'control', subtype: '--bad' }), /control/);
  assert.match(validateClientMessage({ type: 'unknown' }), /unsupported/);
});

test('path and session identifiers reject traversal and control characters', () => {
  assert.equal(validAbsolutePath('/tmp/project'), true);
  assert.equal(validAbsolutePath('../tmp'), false);
  assert.equal(validAbsolutePath('/tmp/a\0b'), false);
  assert.equal(validSessionId('123e4567-e89b-12d3-a456-426614174000'), true);
  assert.equal(validSessionId('../../etc/passwd'), false);
});
