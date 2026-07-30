// Spawns/kills a dedicated claude-ui server instance for the bench to hit.
// Never touches the production instance (default port 7681) — always a
// random free port unless --port is given explicitly by the caller.

import { spawn } from 'node:child_process';
import net from 'node:net';

export function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export function spawnServer({ entry, port, host, token }) {
  const child = spawn(
    process.execPath,
    [entry, '--port', String(port), '--host', host],
    {
      env: { ...process.env, CLAUDE_UI_TOKEN: token, IS_SANDBOX: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  // Keep a small ring buffer of recent server stderr for diagnostics on
  // failure-to-start; not otherwise surfaced (bench is observation-only).
  child._stderrTail = '';
  child.stderr.on('data', (chunk) => {
    child._stderrTail = (child._stderrTail + chunk).slice(-4000);
  });
  return child;
}

export async function waitForReady(baseUrl, token, { timeoutMs = 20000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) return true;
      lastErr = new Error(`/api/info returned ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not become ready in time: ${lastErr && lastErr.message}`);
}

export async function killServerTree(child, { graceMs = 3000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }
  const exited = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), graceMs);
    child.once('exit', () => {
      clearTimeout(t);
      resolve(true);
    });
  });
  if (!exited) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}
