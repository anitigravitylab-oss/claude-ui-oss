#!/usr/bin/env node
// Entry point: HTTP (Hono) + WebSocket server, auth, static file serving.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import { getInfo, listFsEntries } from './fs-api.mjs';
import { listProjects, listSessions, getTranscript, listRecentSessions } from './history.mjs';
import { handleChatConnection, shutdownAllChatSessions } from './chat-session.mjs';
import { createPtySession } from './pty-session.mjs';
import { getPublicKey, addSubscription, removeSubscription } from './push.mjs';
import {
  SECURITY_HEADERS,
  createTokenMatcher,
  decodeWebSocketToken,
  extractBearerToken,
  isAllowedWebSocketOrigin,
  isLoopbackHost,
  parseArgs,
  validateConfiguredToken,
} from './security.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDirAbs = path.join(__dirname, '..', 'public');
// @hono/node-server's serveStatic only supports a root relative to process.cwd().
const publicDirRel = path.relative(process.cwd(), publicDirAbs) || '.';

const cli = parseArgs(process.argv.slice(2));
if (cli.help) {
  console.log('Usage: claude-ui [--host <hostname-or-ip>] [--port <1-65535>]');
  process.exit(0);
}
const { port, host } = cli;

// ---- Auth token ----
const TOKEN = validateConfiguredToken(process.env.CLAUDE_UI_TOKEN) || randomBytes(32).toString('hex');
const tokenMatches = createTokenMatcher(TOKEN);
if (!isLoopbackHost(host)) {
  console.warn(
    '[security] Listening on a non-loopback interface. Use HTTPS and restrict access with a firewall or private network.'
  );
}

function extractApiToken(c) {
  const auth = c.req.header('authorization') || c.req.header('Authorization');
  return extractBearerToken(auth);
}

// ---- Hono app ----
const app = new Hono();

app.use('*', async (c, next) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.header(name, value);
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
  await next();
});

app.use('/api/*', async (c, next) => {
  const token = extractApiToken(c);
  if (!tokenMatches(token)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

app.use(
  '/api/*',
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: 'payload too large' }, 413),
  })
);

function respondError(c, error, fallbackStatus = 500) {
  const candidate = Number(error && error.status);
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : fallbackStatus;
  if (status >= 500) {
    console.error('[http]', error && error.stack ? error.stack : error);
    return c.json({ error: 'internal server error' }, status);
  }
  return c.json({ error: (error && error.message) || 'bad request' }, status);
}

async function readJsonBody(c) {
  try {
    return await c.req.json();
  } catch {
    const error = new Error('invalid JSON body');
    error.status = 400;
    throw error;
  }
}

app.onError((error, c) => respondError(c, error));

app.get('/api/info', async (c) => {
  try {
    // Add `home` for the frontend's path display (~ substitution); rest unchanged.
    const info = await getInfo();
    return c.json({ ...info, home: os.homedir() || process.env.HOME || null });
  } catch (e) {
    return respondError(c, e);
  }
});

app.get('/api/projects', async (c) => {
  try {
    return c.json(await listProjects());
  } catch (e) {
    return respondError(c, e);
  }
});

app.get('/api/sessions', async (c) => {
  const cwd = c.req.query('cwd');
  if (!cwd) return c.json({ error: 'cwd query param required' }, 400);
  try {
    return c.json(await listSessions(cwd));
  } catch (e) {
    return respondError(c, e);
  }
});

// Phase 5b: cross-project "recent sessions" for the sidebar top section.
// Read-only, same /api/* token middleware, same on-disk validation as every
// other history.mjs entry point.
app.get('/api/sessions/recent', async (c) => {
  const limitParam = Number(c.req.query('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 8;
  try {
    return c.json(await listRecentSessions(limit));
  } catch (e) {
    return respondError(c, e);
  }
});

app.get('/api/sessions/:id/transcript', async (c) => {
  const id = c.req.param('id');
  const cwd = c.req.query('cwd');
  if (!cwd) return c.json({ error: 'cwd query param required' }, 400);
  try {
    return c.json(await getTranscript(cwd, id));
  } catch (e) {
    return respondError(c, e);
  }
});

app.get('/api/fs', async (c) => {
  try {
    return c.json(await listFsEntries(c.req.query('path')));
  } catch (e) {
    return respondError(c, e);
  }
});

// Web Push (Phase 3). All under /api/* so the existing token middleware above
// already guards these — no separate auth code needed here.
app.get('/api/push/public-key', async (c) => {
  try {
    return c.json({ publicKey: getPublicKey() });
  } catch (e) {
    return respondError(c, e);
  }
});

app.post('/api/push/subscribe', async (c) => {
  try {
    const body = await readJsonBody(c);
    addSubscription(body);
    return c.json({ ok: true });
  } catch (e) {
    return respondError(c, e);
  }
});

app.post('/api/push/unsubscribe', async (c) => {
  try {
    const body = await readJsonBody(c);
    removeSubscription(body && body.endpoint);
    return c.json({ ok: true });
  } catch (e) {
    return respondError(c, e);
  }
});

// Static files (no auth required — HTML/JS assets are not secret, only API/WS are guarded).
app.use(
  '/*',
  serveStatic({
    root: publicDirRel,
  })
);

// ---- HTTP server ----
const server = serve({ fetch: app.fetch, port, hostname: host }, () => {
  // URL fragments are not sent in HTTP requests or Referer headers, keeping
  // the bootstrap token out of access logs. The client consumes and removes it.
  const url = `http://${host}:${port}/#token=${encodeURIComponent(TOKEN)}`;
  console.log(`claude-ui listening: ${url}`);
});

// ---- WebSocket upgrade handling ----
const websocketOptions = { noServer: true, maxPayload: 1024 * 1024 };
const wssChat = new WebSocketServer(websocketOptions);
const wssTerminal = new WebSocketServer(websocketOptions);

server.on('upgrade', (req, socket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    socket.destroy();
    return;
  }

  if (pathname !== '/ws/chat' && pathname !== '/ws/terminal') {
    socket.destroy();
    return;
  }

  if (wssChat.clients.size + wssTerminal.clients.size >= 100) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const originAllowed = isAllowedWebSocketOrigin(
    req.headers.origin,
    req.headers.host,
    process.env.CLAUDE_UI_ALLOWED_ORIGINS
  );
  const wsToken = decodeWebSocketToken(req.headers['sec-websocket-protocol']);
  if (!originAllowed || !tokenMatches(wsToken)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const wss = pathname === '/ws/chat' ? wssChat : wssTerminal;
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wssChat.on('connection', (ws) => {
  // B1: an unhandled 'error' on a ws crashes the process; swallow + log.
  ws.on('error', (err) => console.error('[ws/chat] error:', err.message));
  handleChatConnection(ws);
});

wssTerminal.on('connection', (ws, req) => {
  ws.on('error', (err) => console.error('[ws/terminal] error:', err.message));
  const url = new URL(req.url, 'http://localhost');
  const cwd = url.searchParams.get('cwd') || process.env.HOME || '/';
  const cols = Math.trunc(Math.min(Math.max(Number(url.searchParams.get('cols')) || 80, 10), 500));
  const rows = Math.trunc(Math.min(Math.max(Number(url.searchParams.get('rows')) || 24, 2), 200));
  const resume = url.searchParams.get('resume') || undefined;
  createPtySession(ws, { cwd, cols, rows, resume });
});

let shuttingDown = false;

// An uncaught failure can leave process state inconsistent. Reap child
// processes and exit non-zero instead of continuing in an unknown state.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
  shutdown(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
  shutdown(1);
});

// Phase 4: detached chat sessions keep their `claude` child alive past a WS
// close, so shutdown must explicitly reap every still-registered child
// (bounded-time) before the process exits — otherwise a detached session
// would orphan its child when the server itself goes down.
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  const hardDeadline = setTimeout(() => process.exit(exitCode), 5000);
  if (typeof hardDeadline.unref === 'function') hardDeadline.unref();

  for (const wss of [wssChat, wssTerminal]) {
    for (const ws of wss.clients) {
      try {
        ws.close(1001, 'server shutting down');
      } catch {
        /* already closed */
      }
    }
  }
  const socketDeadline = setTimeout(() => {
    for (const wss of [wssChat, wssTerminal]) {
      for (const ws of wss.clients) {
        try {
          ws.terminate();
        } catch {
          /* already closed */
        }
      }
    }
  }, 1000);
  if (typeof socketDeadline.unref === 'function') socketDeadline.unref();
  shutdownAllChatSessions(() => {
    server.close(() => {
      clearTimeout(hardDeadline);
      clearTimeout(socketDeadline);
      process.exit(exitCode);
    });
  });
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
