// Manages a `claude --print --input-format stream-json --output-format stream-json`
// subprocess per chat session, translating between the CLI's stream-json
// protocol and the browser-facing WS protocol.
//
// Update-proofing: we never import claude's internals. We only know the shape
// of a handful of event types (system/init, control_request/can_use_tool).
// Everything else is passed through untouched as {type:"cli_event", event}.
//
// Phase 4 (detach/reattach): a chat session's child process is no longer
// 1:1 with a single WebSocket. Each session lives in server/session-registry.mjs
// keyed by attachId. A WS close no longer kills the child — the session goes
// "detached": generation keeps running, authoritative events get buffered,
// and a later `{type:"attach", attachId}` on a fresh WS replays the buffer
// and resumes live delivery. See .ai/current-task.md for the full spec.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { sendPush } from './push.mjs';
import { handleWatchConnection } from './session-watch.mjs';
import { validateClientMessage, validateFirstMessage } from './protocol-validation.mjs';
import {
  createEntry,
  getEntry,
  deleteEntry,
  armIdleTimer,
  disarmIdleTimer,
  pushToBuffer,
  drainBuffer,
  pushToPartialBuffer,
  getPartialBuffer,
  resetPartialBuffer,
  shutdownAll,
} from './session-registry.mjs';

const STDERR_LIMIT = 10 * 1024; // 10KB
const WS_BUFFER_LIMIT = 8 * 1024 * 1024; // 8MB backpressure threshold
const KILL_ESCALATE_MS = 3000;
const PROMPT_EXCERPT_LEN = 60;
const STDOUT_LINE_LIMIT = 32 * 1024 * 1024;

// Phase 3: fire-and-forget push notifications. Never let a push failure
// (or the push subsystem itself) interfere with chat processing.
function sendPushSafe(payload) {
  try {
    sendPush(payload);
  } catch (err) {
    console.error('[push] trigger failed:', err.message);
  }
}

function excerpt(text) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  return s.length > PROMPT_EXCERPT_LEN ? s.slice(0, PROMPT_EXCERPT_LEN) + '…' : s;
}

// B8: under backpressure, only partial/stream_event chunks may be dropped.
// Everything else (result/permission_request/session_started/exit/error) always sends.
function isDroppableUnderBackpressure(obj) {
  if (obj.type !== 'cli_event') return false;
  const t = obj.event && obj.event.type;
  return t === 'stream_event';
}

// Phase 4: which top-level messages are "authoritative" and worth buffering
// while detached (so a later attach can replay them). stream_event (partial
// deltas), control_response, keep_alive, etc. are never buffered — the
// client rebuilds from authoritative messages only, same as the existing
// resume-transcript design.
const AUTHORITATIVE_TOP_TYPES = new Set(['session_started', 'permission_request', 'exit', 'error']);
const AUTHORITATIVE_CLI_EVENT_TYPES = new Set(['system', 'user', 'assistant', 'result']);

function isAuthoritative(obj) {
  if (AUTHORITATIVE_TOP_TYPES.has(obj.type)) return true;
  if (obj.type === 'cli_event' && obj.event && AUTHORITATIVE_CLI_EVENT_TYPES.has(obj.event.type)) return true;
  return false;
}

function safeSendRaw(ws, obj) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  if (ws.bufferedAmount > WS_BUFFER_LIMIT && isDroppableUnderBackpressure(obj)) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    /* connection may have just closed; ignore */
  }
}

// Phase 5a: is this a partial (in-progress-turn) stream_event delta? These are
// never authoritative (see isAuthoritative below) but we still want to retain
// them — separately, in a non-destructive buffer — so a reload mid-generation
// can replay "what was typed so far" instead of just a bare spinner.
function isPartialStreamEvent(obj) {
  return obj.type === 'cli_event' && obj.event && obj.event.type === 'stream_event';
}

// Sends live if attached; otherwise buffers authoritative events for replay
// and silently drops everything else (matches pre-Phase-4 behavior of a
// closed ws simply not receiving anything). Regardless of attach state, a
// partial stream_event is always mirrored into the turn's partial buffer so
// it's ready to replay on the *next* attach, whenever that happens.
function deliver(entry, obj) {
  if (isPartialStreamEvent(obj)) pushToPartialBuffer(entry, obj);
  if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
    safeSendRaw(entry.ws, obj);
    return;
  }
  if (isAuthoritative(obj)) pushToBuffer(entry, obj);
}

function killChild(entry, signal = 'SIGTERM') {
  const target = entry.child;
  if (!target || target.killed) return;
  try {
    target.kill(signal);
  } catch {
    /* already dead */
  }
  // B4: escalate to SIGKILL if the process is still alive after a grace period.
  if (signal !== 'SIGKILL') {
    const t = setTimeout(() => {
      if (target.exitCode === null && target.signalCode === null) {
        try {
          target.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }
    }, KILL_ESCALATE_MS);
    if (typeof t.unref === 'function') t.unref();
  }
}

function cleanupChild(entry) {
  if (entry.rl) {
    entry.rl.close();
    entry.rl = null;
  }
  entry.child = null;
  entry.pendingPermissionInputs.clear();
}

function onTtlFire(entry) {
  // Idle-too-long while detached: kill the child. Registry removal happens
  // uniformly in the child's 'exit' handler below, not here.
  killChild(entry, 'SIGTERM');
}

function createSessionEntry() {
  const entry = createEntry();
  if (!entry) return null;
  entry.child = null;
  entry.rl = null;
  entry.stderrBuf = '';
  entry.stderrTruncated = false;
  entry.stdoutLineBytes = 0;
  entry.stdoutOversized = false;
  entry.pendingPermissionInputs = new Map();
  entry.firstPromptExcerpt = '';
  entry.sawResult = false;
  entry.disconnectPushSent = false;
  return entry;
}

function startSession(entry, msg) {
  resetPartialBuffer(entry); // Phase 5a: any prior turn's partial state never applies to a new process
  // A new 'start' while a session is active replaces it (only reachable on a
  // freshly-created entry today, but keep the guard for safety/future reuse).
  if (entry.child) {
    killChild(entry);
    cleanupChild(entry);
  }

  const args = [
    '--print',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompt-tool',
    'stdio',
  ];

  if (msg.model) args.push('--model', String(msg.model));
  if (msg.permissionMode) args.push('--permission-mode', String(msg.permissionMode));
  if (msg.effort) args.push('--effort', String(msg.effort));
  if (msg.resume) args.push('--resume', String(msg.resume));
  if (msg.forkSession) args.push('--fork-session');
  if (Array.isArray(msg.addDir)) {
    for (const d of msg.addDir) args.push('--add-dir', String(d));
  }

  const cwd = msg.cwd || process.env.HOME || '/';

  let thisChild;
  try {
    thisChild = spawn('claude', args, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    deliver(entry, { type: 'error', message: `failed to start claude: ${err.message}` });
    deleteEntry(entry.attachId);
    try {
      entry.ws && entry.ws.close();
    } catch {
      /* already closed */
    }
    return;
  }
  entry.child = thisChild;

  entry.stderrBuf = '';
  entry.stderrTruncated = false;
  entry.stdoutLineBytes = 0;
  entry.stdoutOversized = false;
  entry.firstPromptExcerpt = '';
  entry.sawResult = false;
  entry.disconnectPushSent = false;
  entry.generating = false;

  // Phase 4: hand the client its attachId right away, over this (definitely
  // live — we're still handling the 'start' message that arrived on it) ws.
  deliver(entry, { type: 'attached', attachId: entry.attachId });

  // B1: a write to a dead child's stdin emits an async 'error' (EPIPE) on the
  // stream; without a listener it would crash the whole process.
  thisChild.stdin.on('error', () => {
    /* pipe closed; writes are already guarded, nothing to do */
  });

  thisChild.stdout.on('data', (chunk) => {
    if (entry.child !== thisChild || entry.stdoutOversized) return;
    let cursor = 0;
    for (;;) {
      const newline = chunk.indexOf(0x0a, cursor);
      if (newline === -1) {
        entry.stdoutLineBytes += chunk.length - cursor;
        break;
      }
      entry.stdoutLineBytes += newline - cursor;
      if (entry.stdoutLineBytes > STDOUT_LINE_LIMIT) break;
      entry.stdoutLineBytes = 0;
      cursor = newline + 1;
    }
    if (entry.stdoutLineBytes > STDOUT_LINE_LIMIT) {
      entry.stdoutOversized = true;
      deliver(entry, { type: 'error', message: 'claude emitted an oversized output event' });
      killChild(entry);
    }
  });

  entry.rl = readline.createInterface({ input: thisChild.stdout, crlfDelay: Infinity });
  entry.rl.on('line', (line) => handleStdoutLine(entry, line));

  thisChild.stderr.on('data', (chunk) => {
    if (entry.child !== thisChild) return; // stale child from a previous session
    if (entry.stderrBuf.length >= STDERR_LIMIT) {
      entry.stderrTruncated = true;
      return;
    }
    entry.stderrBuf += chunk.toString('utf8');
    if (entry.stderrBuf.length > STDERR_LIMIT) {
      entry.stderrBuf = entry.stderrBuf.slice(0, STDERR_LIMIT);
      entry.stderrTruncated = true;
    }
  });

  thisChild.on('error', (err) => {
    if (entry.child !== thisChild) return; // stale child
    deliver(entry, { type: 'error', message: `claude process error: ${err.message}` });
    if (!entry.disconnectPushSent) {
      entry.disconnectPushSent = true;
      sendPushSafe({ title: 'Claude UI', body: 'セッションでエラーが発生しました', tag: 'exit' });
    }
    entry.generating = false;
    cleanupChild(entry);
    deleteEntry(entry.attachId);
    try {
      entry.ws && entry.ws.close();
    } catch {
      /* already closed */
    }
  });

  thisChild.on('exit', (code) => {
    // B2: only react if this is still the active child. A delayed exit from a
    // replaced (restarted) session must not tear down the new one.
    if (entry.child !== thisChild) return;
    if (entry.stderrBuf.trim().length > 0) {
      deliver(entry, {
        type: 'error',
        message: entry.stderrTruncated ? entry.stderrBuf + '\n...[truncated]' : entry.stderrBuf,
      });
    }
    deliver(entry, { type: 'exit', code });
    // Phase 3: a `result` event always precedes a normal exit in --print mode.
    // Exiting without one having been seen means the process died mid-turn.
    if (!entry.sawResult && !entry.disconnectPushSent) {
      entry.disconnectPushSent = true;
      sendPushSafe({ title: 'Claude UI', body: `セッションが異常終了しました (code ${code})`, tag: 'exit' });
    }
    entry.generating = false;
    cleanupChild(entry);
    // Phase 4: once the child is actually gone, the entry can never serve an
    // attach again — remove it. This is the single place registry entries
    // are deleted, keeping the invariant "in registry == child alive".
    deleteEntry(entry.attachId);
  });
}

function handleStdoutLine(entry, line) {
  if (!line.trim()) return;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    // Never throw on unparseable output — surface it raw so the UI can
    // still show something and nothing crashes.
    deliver(entry, { type: 'cli_event', event: { type: 'raw_stdout', text: line } });
    return;
  }

  if (parsed.type === 'control_request' && parsed.request && parsed.request.subtype === 'can_use_tool') {
    const requestId = parsed.request_id;
    const req = parsed.request;
    if (requestId) entry.pendingPermissionInputs.set(requestId, req.input);
    deliver(entry, {
      type: 'permission_request',
      requestId,
      toolName: req.tool_name,
      input: req.input,
      suggestions: req.permission_suggestions,
      description: req.description,
    });
    sendPushSafe({
      title: '権限確認',
      body: `${req.tool_name || 'ツール'} の実行許可を確認しています`,
      tag: 'permission',
    });
    return;
  }

  if (parsed.type === 'system' && parsed.subtype === 'init') {
    const sessionId = parsed.session_id;
    if (sessionId) deliver(entry, { type: 'session_started', sessionId });
    deliver(entry, { type: 'cli_event', event: parsed });
    return;
  }

  if (parsed.type === 'result') {
    entry.sawResult = true;
    entry.generating = false;
    // A turn just completed. If nobody's watching, arm the idle-TTL clock now
    // (rather than only at ws-close time) — see .ai/current-task.md's "ターン
    // 完了後...30分経過" rule.
    if (entry.state === 'detached') armIdleTimer(entry, onTtlFire);
    const suffix = entry.firstPromptExcerpt ? `「${entry.firstPromptExcerpt}」への応答が完了しました` : '応答が完了しました';
    sendPushSafe({ title: 'Claude UI', body: suffix, tag: 'result' });
    deliver(entry, { type: 'cli_event', event: parsed });
    // Phase 5a: the turn is fully done and its authoritative `assistant`
    // event is already in (or headed to) the replay buffer — the partial
    // buffer's job is finished, discard it so memory isn't held for a
    // completed turn (spec: "ターン完了時は破棄").
    resetPartialBuffer(entry);
    return;
  }

  // Passthrough principle: every other known or unknown type/subtype goes
  // straight to the client untouched.
  deliver(entry, { type: 'cli_event', event: parsed });
}

function writeToChild(entry, obj) {
  if (!entry.child || !entry.child.stdin.writable) return;
  try {
    entry.child.stdin.write(JSON.stringify(obj) + '\n');
  } catch {
    /* pipe may have closed concurrently */
  }
}

function handlePermissionResponse(entry, msg) {
  const { requestId, behavior } = msg;
  if (!requestId || !behavior) return;
  // B7: only respond once per requestId. If it's not in the pending set the
  // response is a duplicate (or unknown) — don't write it to the child stdin.
  if (!entry.pendingPermissionInputs.has(requestId)) return;
  if (behavior === 'allow') {
    const updatedInput = msg.updatedInput ?? entry.pendingPermissionInputs.get(requestId) ?? {};
    const response = { behavior: 'allow', updatedInput };
    if (msg.updatedPermissions) response.updatedPermissions = msg.updatedPermissions;
    writeToChild(entry, {
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response },
    });
  } else {
    writeToChild(entry, {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: { behavior: 'deny', message: msg.message || 'User denied' },
      },
    });
  }
  entry.pendingPermissionInputs.delete(requestId);
}

function handleClientMessage(entry, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString('utf8'));
  } catch {
    safeSendRaw(entry.ws, { type: 'error', message: 'invalid JSON from client' });
    return;
  }
  const validationError = validateClientMessage(msg);
  if (validationError) {
    safeSendRaw(entry.ws, { type: 'error', message: validationError });
    return;
  }

  switch (msg.type) {
    case 'start':
      startSession(entry, msg);
      break;
    case 'user_message':
      if (!entry.firstPromptExcerpt) entry.firstPromptExcerpt = excerpt(msg.text);
      entry.generating = true;
      resetPartialBuffer(entry); // Phase 5a: a fresh turn starts a fresh partial buffer
      writeToChild(entry, {
        type: 'user',
        message: { role: 'user', content: msg.text },
        parent_tool_use_id: null,
      });
      break;
    case 'permission_response':
      handlePermissionResponse(entry, msg);
      break;
    case 'interrupt':
      writeToChild(entry, {
        type: 'control_request',
        request_id: randomUUID(),
        request: { subtype: 'interrupt' },
      });
      break;
    case 'set_permission_mode':
      writeToChild(entry, {
        type: 'control_request',
        request_id: randomUUID(),
        request: { subtype: 'set_permission_mode', mode: msg.mode },
      });
      break;
    case 'set_model':
      writeToChild(entry, {
        type: 'control_request',
        request_id: randomUUID(),
        request: { subtype: 'set_model', model: msg.model },
      });
      break;
    case 'control': {
      // Generic control-request relay (Phase 1 quick actions): the client picks the
      // subtype (set_model, set_permission_mode, apply_flag_settings, get_context_usage,
      // get_settings, ...) and an optional payload. We never hardcode/allowlist subtypes
      // here — anything the CLI's control_request protocol supports passes straight
      // through. The corresponding control_response comes back to the client via the
      // existing passthrough in handleStdoutLine (as a cli_event), keyed by request_id.
      if (!msg.subtype || typeof msg.subtype !== 'string') break;
      const requestId = (typeof msg.requestId === 'string' && msg.requestId) ? msg.requestId : randomUUID();
      const payload = (msg.payload && typeof msg.payload === 'object') ? msg.payload : {};
      writeToChild(entry, {
        type: 'control_request',
        request_id: requestId,
        request: Object.assign({}, payload, { subtype: msg.subtype }),
      });
      break;
    }
    case 'stop':
      killChild(entry);
      break;
    default:
      // Unknown client message type — ignore rather than crash the session.
      break;
  }
}

// Binds a live ws to a session entry — used both for a brand-new session
// (right after 'start' arrives) and for a successful 'attach'. Replays any
// buffered authoritative events accumulated while detached, then (attach
// only) tells the client whether generation is still in flight so it can
// restore the spinner/status line.
function bindWs(entry, ws, { isAttach } = {}) {
  if (entry.ws && entry.ws !== ws) {
    // Phase 4 R2: "二重接続時は新しい WS が勝つ" — the old socket is now
    // superseded; close it server-side rather than leaving it dangling.
    try {
      entry.ws.close();
    } catch {
      /* already gone */
    }
  }
  entry.ws = ws;
  entry.state = 'attached';
  disarmIdleTimer(entry);

  ws.on('message', (raw) => handleClientMessage(entry, raw));
  ws.on('close', () => {
    if (entry.ws !== ws) return; // stale ws already superseded by a newer attach
    entry.ws = null;
    entry.state = 'detached';
    // Only start the idle clock now if nothing is generating; if a turn is
    // in flight, the `result` handler above arms it once that turn ends.
    if (!entry.generating) armIdleTimer(entry, onTtlFire);
  });

  const buffered = drainBuffer(entry);
  for (const obj of buffered) safeSendRaw(ws, obj);

  // Phase 5a: replay the in-progress turn's partial deltas *after* the
  // authoritative replay above — if a turn already completed while detached,
  // its full `assistant`/`result` are already in `buffered` and this is a
  // no-op (partialBuffer was discarded at 'result'); if a turn is still
  // running, this reconstructs the client's streamState (message_start →
  // content_block_start/delta) exactly as if it had been watching live, via
  // the same handleCliEvent/handleStreamEvent path — no new client draw path.
  for (const obj of getPartialBuffer(entry)) safeSendRaw(ws, obj);

  if (isAttach) {
    safeSendRaw(ws, { type: 'attach_complete', generating: entry.generating });
  }
}

function routeFirstMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString('utf8'));
  } catch {
    msg = null;
  }
  const validationError = validateFirstMessage(msg);
  if (validationError) {
    safeSendRaw(ws, { type: 'error', message: validationError });
    try {
      ws.close(1008, 'invalid request');
    } catch {
      /* already gone */
    }
    return;
  }

  if (msg.type === 'attach') {
    const entry = getEntry(msg.attachId);
    if (entry) {
      bindWs(entry, ws, { isAttach: true });
      return;
    }
    safeSendRaw(ws, { type: 'attach_failed' });
    try {
      ws.close();
    } catch {
      /* already gone */
    }
    return;
  }

  // Phase 5b: a chat tab that is only *viewing* a session (no child of its
  // own — the session is being driven by a GUI terminal tab, or another chat
  // tab) asks to passively tail the on-disk transcript instead of starting a
  // second `claude --resume` process against the same session. This never
  // touches session-registry.mjs — a watcher is not a session.
  if (msg.type === 'watch') {
    handleWatchConnection(ws, msg.sessionId, msg.cwd);
    return;
  }

  // Anything else (normally 'start') begins a brand-new session on a fresh entry.
  const entry = createSessionEntry();
  if (!entry) {
    safeSendRaw(ws, { type: 'error', message: 'too many active sessions' });
    try {
      ws.close(1013, 'server busy');
    } catch {
      /* already gone */
    }
    return;
  }
  bindWs(entry, ws);
  handleClientMessage(entry, raw);
}

// Per-connection entry point, called from server/index.mjs's wssChat
// 'connection' handler. The first client message decides the fate of the
// connection: {type:"attach", attachId} rejoins an existing session,
// anything else (normally {type:"start", ...}) begins a new one.
export function handleChatConnection(ws) {
  const timeout = setTimeout(() => {
    try {
      ws.close(1008, 'first message timeout');
    } catch {
      /* already gone */
    }
  }, 10_000);
  if (typeof timeout.unref === 'function') timeout.unref();
  ws.once('message', (raw) => {
    clearTimeout(timeout);
    routeFirstMessage(ws, raw);
  });
  ws.once('close', () => clearTimeout(timeout));
}

// Called on SIGTERM/SIGINT so no `claude` child is ever orphaned by a server
// shutdown, detached or not. Bounded-time: always calls `cb` within ~2s.
export function shutdownAllChatSessions(cb) {
  shutdownAll((entry) => killChild(entry, 'SIGTERM'), cb);
}
