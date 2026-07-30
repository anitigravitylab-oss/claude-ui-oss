// Phase 4: in-memory registry of chat sessions keyed by attachId, so a chat's
// underlying `claude` child process can outlive any single WebSocket
// connection ("detach"/"attach"). Deliberately generic: this module knows
// nothing about the stream-json protocol — chat-session.mjs owns that. This
// module only owns: attachId issuance, the entry lifecycle map, and the
// detach-idle TTL timer.
//
// Invariant: an entry exists in the registry <=> its child process is (as far
// as we know) still alive. chat-session.mjs is responsible for deleting the
// entry the moment the child actually exits (any reason: normal, killed,
// crashed) — see its `child.on('exit', ...)` handler. This keeps `attach`
// simple: found-in-registry always means "there is a live child to join."

import { randomUUID } from 'node:crypto';

// Cap on how many buffered (detach-time) authoritative events we retain per
// session. A single turn is normally a handful of events; this is a generous
// defensive bound against a pathological long-running detached tool loop
// eating unbounded memory, not an expected-to-be-hit limit.
export const DETACH_BUFFER_LIMIT = 5000;
export const DETACH_BUFFER_BYTE_LIMIT = 16 * 1024 * 1024;

// Phase 5a: bound on the *in-progress-turn* partial (stream_event) buffer —
// separate from DETACH_BUFFER_LIMIT above, which only ever holds authoritative
// events. This one holds the raw partial deltas of whichever turn is currently
// generating, so a reload mid-generation can replay "what was typed so far"
// instead of showing a bare spinner. Reset at turn start, discarded at turn
// end (see resetPartialBuffer call sites in chat-session.mjs) — this cap is
// only a defensive backstop against a pathologically long single turn.
export const PARTIAL_BUFFER_LIMIT = 2000;
export const PARTIAL_BUFFER_BYTE_LIMIT = 2 * 1024 * 1024; // 2MB
export const MAX_ACTIVE_SESSIONS = 64;

// Default 30 minutes; override for testing via env.
export const DETACH_TTL_MS = Number(process.env.CLAUDE_UI_DETACH_TTL_MS) > 0
  ? Number(process.env.CLAUDE_UI_DETACH_TTL_MS)
  : 30 * 60 * 1000;

const registry = new Map(); // attachId -> entry

export function createEntry() {
  if (registry.size >= MAX_ACTIVE_SESSIONS) return null;
  const entry = {
    attachId: randomUUID(),
    ws: null, // currently-attached live WebSocket, or null when detached
    state: 'detached', // 'attached' | 'detached' — flipped by chat-session.mjs's bindWs/close
    buffer: [], // authoritative events queued while detached, replayed on attach
    bufferBytes: 0,
    generating: false, // true from user_message write until result/error/exit
    idleTimer: null,
    // Phase 5a: current in-progress turn's stream_event deltas — see the
    // PARTIAL_BUFFER_* constants above. Non-destructively replayed (unlike
    // `buffer`, which is drained) so a turn spanning several attach/detach
    // cycles always replays from its true start.
    partialBuffer: [],
    partialBufferBytes: 0,
  };
  registry.set(entry.attachId, entry);
  return entry;
}

export function getEntry(attachId) {
  return registry.get(attachId) || null;
}

export function deleteEntry(attachId) {
  const entry = registry.get(attachId);
  if (entry) disarmIdleTimer(entry);
  registry.delete(attachId);
}

export function listEntries() {
  return Array.from(registry.values());
}

export function armIdleTimer(entry, onFire) {
  disarmIdleTimer(entry);
  const t = setTimeout(() => {
    entry.idleTimer = null;
    onFire(entry);
  }, DETACH_TTL_MS);
  if (typeof t.unref === 'function') t.unref();
  entry.idleTimer = t;
}

export function disarmIdleTimer(entry) {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}

export function pushToBuffer(entry, obj) {
  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(obj));
  } catch {
    /* non-serializable objects are not expected and count as zero */
  }
  entry.buffer.push(obj);
  entry.bufferBytes += size;
  while (
    entry.buffer.length > 0 &&
    (entry.buffer.length > DETACH_BUFFER_LIMIT || entry.bufferBytes > DETACH_BUFFER_BYTE_LIMIT)
  ) {
    const removed = entry.buffer.shift();
    try {
      entry.bufferBytes -= Buffer.byteLength(JSON.stringify(removed));
    } catch {
      /* best-effort accounting */
    }
  }
}

export function drainBuffer(entry) {
  const buf = entry.buffer;
  entry.buffer = [];
  entry.bufferBytes = 0;
  return buf;
}

// Phase 5a: append a partial (stream_event) delta for the currently-generating
// turn. FIFO-evicts on overflow, mirroring pushToBuffer's defensive style —
// a single turn should never realistically hit this, so eviction only ever
// trims a pathological outlier, not normal usage.
export function pushToPartialBuffer(entry, obj) {
  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(obj));
  } catch {
    size = 0;
  }
  entry.partialBuffer.push(obj);
  entry.partialBufferBytes += size;
  while (
    entry.partialBuffer.length > 0 &&
    (entry.partialBuffer.length > PARTIAL_BUFFER_LIMIT || entry.partialBufferBytes > PARTIAL_BUFFER_BYTE_LIMIT)
  ) {
    const removed = entry.partialBuffer.shift();
    try {
      entry.partialBufferBytes -= Buffer.byteLength(JSON.stringify(removed));
    } catch {
      /* best effort accounting */
    }
  }
}

// Non-destructive: attach may need to be replayed against multiple
// (sequential) connections while a single turn is still in flight.
export function getPartialBuffer(entry) {
  return entry.partialBuffer;
}

// Called at turn start (new user_message) and turn end (result) — see
// chat-session.mjs. Turn end discards the buffer entirely (spec: "ターン
// 完了時は破棄") so memory is never held for a finished turn.
export function resetPartialBuffer(entry) {
  entry.partialBuffer = [];
  entry.partialBufferBytes = 0;
}

// Best-effort, bounded-time shutdown of every registered child. `killFn(entry)`
// should send SIGTERM (or stronger); this function waits (bounded) for actual
// process exit before invoking `cb`, then always calls `cb` regardless.
export function shutdownAll(killFn, cb, graceMs = 2000) {
  const entries = listEntries();
  if (entries.length === 0) {
    cb();
    return;
  }
  let remaining = entries.length;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(hardDeadline);
    cb();
  };
  const done = () => {
    remaining -= 1;
    if (remaining <= 0) finish();
  };
  const hardDeadline = setTimeout(() => {
    for (const entry of entries) {
      const child = entry.child;
      if (child && child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
    finish();
  }, graceMs);
  if (typeof hardDeadline.unref === 'function') hardDeadline.unref();

  for (const entry of entries) {
    const child = entry.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      done();
      continue;
    }
    child.once('exit', done);
    try {
      killFn(entry);
    } catch {
      /* best effort */
    }
  }
}
