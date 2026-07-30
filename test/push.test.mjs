import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSubscription } from '../server/push.mjs';

const valid = {
  endpoint: 'https://push.example.test/subscription/123',
  keys: {
    p256dh: 'test_public_key_test_public_key',
    auth: 'test_auth_key_test',
  },
};

test('push subscriptions require HTTPS and bounded base64url keys', () => {
  assert.deepEqual(validateSubscription(valid), valid);
  assert.throws(() => validateSubscription({ ...valid, endpoint: 'http://push.example.test/a' }), /HTTPS/);
  assert.throws(() => validateSubscription({ ...valid, endpoint: 'not a url' }), /malformed/);
  assert.throws(() => validateSubscription({ ...valid, keys: { p256dh: 'bad!', auth: 'short' } }), /keys/);
  try {
    validateSubscription({});
    assert.fail('expected invalid subscription');
  } catch (error) {
    assert.equal(error.status, 400);
  }
});
