import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SECURITY_HEADERS,
  createTokenMatcher,
  decodeWebSocketToken,
  extractBearerToken,
  isAllowedWebSocketOrigin,
  parseArgs,
  validateConfiguredToken,
} from '../server/security.mjs';

test('parseArgs accepts valid values and rejects ambiguous input', () => {
  assert.deepEqual(parseArgs(['--host', '0.0.0.0', '--port', '8080']), {
    host: '0.0.0.0',
    port: 8080,
  });
  assert.throws(() => parseArgs(['--port', '0']), /between 1 and 65535/);
  assert.throws(() => parseArgs(['--port']), /requires a value/);
  assert.throws(() => parseArgs(['--unknown']), /unknown option/);
});

test('tokens are bounded, strong, and compared without coercion', () => {
  assert.throws(() => validateConfiguredToken('short'), /at least 16 bytes/);
  assert.throws(() => validateConfiguredToken('change-me-to-a-long-random-string'), /example value/);
  assert.throws(() => validateConfiguredToken('0123456789abcde f'), /whitespace/);
  assert.equal(validateConfiguredToken('0123456789abcdef'), '0123456789abcdef');
  const matches = createTokenMatcher('0123456789abcdef');
  assert.equal(matches('0123456789abcdef'), true);
  assert.equal(matches('0123456789abcdeg'), false);
  assert.equal(matches(null), false);
});

test('bearer parsing is strict and case-insensitive', () => {
  assert.equal(extractBearerToken('bearer abc'), 'abc');
  assert.equal(extractBearerToken('Bearer   abc '), 'abc');
  assert.equal(extractBearerToken('Basic abc'), null);
  assert.equal(extractBearerToken('Bearer a b'), null);
});

test('WebSocket subprotocol token round-trips UTF-8 and rejects malformed encoding', () => {
  const token = '十分に長い-token-0123456789';
  const encoded = Buffer.from(token).toString('base64url');
  assert.equal(decodeWebSocketToken(`claude-ui.auth.${encoded}`), token);
  assert.equal(decodeWebSocketToken('claude-ui.auth.%%%'), null);
  assert.equal(decodeWebSocketToken('unrelated'), null);
});

test('browser WebSockets require same-host or explicitly allowed origins', () => {
  assert.equal(isAllowedWebSocketOrigin(undefined, 'localhost:7681'), true);
  assert.equal(isAllowedWebSocketOrigin('http://localhost:7681', 'localhost:7681'), true);
  assert.equal(isAllowedWebSocketOrigin('https://evil.example', 'localhost:7681'), false);
  assert.equal(
    isAllowedWebSocketOrigin('https://ui.example', 'localhost:7681', 'https://ui.example/'),
    true
  );
  assert.equal(isAllowedWebSocketOrigin('null', 'localhost:7681'), false);
});

test('baseline security headers prevent script injection and framing', () => {
  assert.match(SECURITY_HEADERS['Content-Security-Policy'], /script-src 'self'/);
  assert.match(SECURITY_HEADERS['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.equal(SECURITY_HEADERS['X-Frame-Options'], 'DENY');
});
