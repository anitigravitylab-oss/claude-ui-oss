// Convenience wrappers around ws-client for the /ws/chat protocol.
// Protocol reference (server/chat-session.mjs):
//   client -> server: start, user_message, permission_response, interrupt, stop
//   server -> client: session_started, cli_event (wraps every claude
//     stream-json line untouched: system/init, assistant, stream_event,
//     result, control_request/can_use_tool mapped to permission_request), exit, error
// The final plain-text answer for a turn is `event.result` on the top-level
// `result` cli_event (confirmed via a live recon spawn, not assumed).

import { connectWs } from './ws-client.mjs';

export function isResultEvent(e) {
  return e && e.type === 'cli_event' && e.event && e.event.type === 'result';
}

export function isPermissionRequest(e) {
  return e && e.type === 'permission_request';
}

export function isSessionStarted(e) {
  return e && e.type === 'session_started';
}

export function isTopLevelError(e) {
  return e && e.type === 'error';
}

export function isTopLevelExit(e) {
  return e && e.type === 'exit';
}

// Phase 4 (detach/reattach) top-level message predicates.
export function isAttached(e) {
  return e && e.type === 'attached';
}

export function isAttachFailed(e) {
  return e && e.type === 'attach_failed';
}

export function isAttachComplete(e) {
  return e && e.type === 'attach_complete';
}

export async function openChat(ctx) {
  return connectWs(ctx.wsChatUrl, { token: ctx.token });
}

// Sends `start` then `user_message` and waits for the turn's `result` event.
// Use for the first turn on a fresh connection.
export async function startAndAsk(conn, { cwd, model, permissionMode, resume, forkSession, addDir, text, timeoutMs = 60000 }) {
  conn.send({ type: 'start', cwd, model, permissionMode, resume, forkSession, addDir });
  conn.send({ type: 'user_message', text });
  const result = await conn.waitFor(isResultEvent, timeoutMs);
  const startedEvt = conn.events.find(isSessionStarted);
  return {
    event: result.event,
    text: result.event.result,
    isError: !!result.event.is_error,
    sessionId: (startedEvt && startedEvt.sessionId) || result.event.session_id,
  };
}

// Sends a further `user_message` on an already-started connection and waits
// for the next `result`. Relies on waitFor's "only future events" semantics
// to avoid matching a previous turn's result.
export async function ask(conn, { text, timeoutMs = 60000 }) {
  conn.send({ type: 'user_message', text });
  const result = await conn.waitFor(isResultEvent, timeoutMs);
  return {
    event: result.event,
    text: result.event.result,
    isError: !!result.event.is_error,
  };
}
