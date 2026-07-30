import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import test from 'node:test';
import WebSocket from 'ws';

const TOKEN = 'test-token-test-token-test-token-01';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForOutput(stream, pattern, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${pattern}`)), timeoutMs);
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      output += chunk;
      if (pattern.test(output)) {
        clearTimeout(timer);
        resolve(output);
      }
    });
  });
}

function connect(url, protocol, origin) {
  return new Promise((resolve, reject) => {
    const options = origin ? { headers: { Origin: origin } } : undefined;
    const ws = new WebSocket(url, protocol, options);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

test('server enforces HTTP and WebSocket security boundaries', async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.mjs', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, CLAUDE_UI_TOKEN: TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });

  const startup = await waitForOutput(child.stdout, /claude-ui listening:/);
  assert.match(startup, new RegExp(`#token=${TOKEN}`));
  assert.doesNotMatch(startup, /\?token=/);

  const base = `http://127.0.0.1:${port}`;
  const unauthorized = await fetch(`${base}/api/info?token=${TOKEN}`);
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('cache-control'), 'no-store');

  const authorized = await fetch(`${base}/api/info`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(authorized.status, 200);
  assert.match(authorized.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.equal(authorized.headers.get('x-frame-options'), 'DENY');
  assert.equal(authorized.headers.get('x-content-type-options'), 'nosniff');

  const oversized = await fetch(`${base}/api/push/subscribe`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ padding: 'x'.repeat(70 * 1024) }),
  });
  assert.equal(oversized.status, 413);

  const invalidJson = await fetch(`${base}/api/push/subscribe`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: '{not-json',
  });
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(await invalidJson.json(), { error: 'invalid JSON body' });

  const invalidSubscription = await fetch(`${base}/api/push/subscribe`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(invalidSubscription.status, 400);
  assert.match((await invalidSubscription.json()).error, /endpoint required/);

  const missing = await fetch(`${base}/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('x-frame-options'), 'DENY');

  const wsUrl = `ws://127.0.0.1:${port}/ws/chat`;
  await assert.rejects(connect(wsUrl), /401/);
  const protocol = `claude-ui.auth.${Buffer.from(TOKEN).toString('base64url')}`;
  await assert.rejects(connect(wsUrl, protocol, 'https://evil.example'), /401/);

  const ws = await connect(wsUrl, protocol, `http://127.0.0.1:${port}`);
  const response = new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(data.toString()))));
  ws.send('{}');
  assert.deepEqual(await response, { type: 'error', message: 'invalid first message' });
  await new Promise((resolve) => ws.once('close', resolve));

  child.kill('SIGTERM');
  const [code] = await new Promise((resolve) => child.once('exit', (...args) => resolve(args)));
  assert.equal(code, 0);
});
