// Phase 5b: "session observation" — tails a session's on-disk JSONL transcript
// so a chat tab that is only *viewing* a session (no live `claude` child of
// its own, because the session is being driven elsewhere — a GUI terminal tab,
// or another chat tab) can still see new turns land, live.
//
// Deliberately independent of chat-session.mjs / session-registry.mjs: this
// module never spawns or manages a `claude` process. It only reads a file the
// CLI itself is appending to. That keeps the "who owns the child" invariant
// (session-registry: registry entry <=> live child) untouched — a watcher is
// not a session, and never becomes one.
//
// Security: the (cwd, sessionId) → path resolution is the *same* function
// history.mjs's REST transcript endpoint uses (resolveTranscriptPath) — no
// second, looser validation is introduced here.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { resolveTranscriptPath } from './history.mjs';

// Defensive cap on concurrent watchers (fs.watch handles + poll timers), not
// expected to be hit in normal use (one per passively-viewed chat tab).
const MAX_WATCHERS = 20;
// Polling fallback interval — covers filesystems/platforms where fs.watch's
// inotify-based change events are missed or unavailable (documented Node
// caveat), so a watcher is never silently dead.
const POLL_MS = 2000;
// Only these JSONL row types are ever persisted for a turn (verified against
// real ~/.claude/projects transcripts — no "result"/"system" rows are written
// to disk, only user/assistant); anything else (queue-operation, last-prompt,
// attachment, ai-title, ...) is bookkeeping the chat UI doesn't render.
const AUTHORITATIVE_JSONL_TYPES = new Set(['user', 'assistant']);
// A single appended turn is normally a few KB; this is a defensive cap so a
// pathological multi-GB single write can't be read into memory in one go.
const MAX_READ_BYTES = 8 * 1024 * 1024;

let activeWatchers = 0;

function safeSend(ws, obj) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    /* connection may have just closed; ignore */
  }
}

// Binds a fresh (just-upgraded) chat WS into "watch-only" mode: no `claude`
// child is started; the client just receives {type:"transcript_append"} as
// new authoritative JSONL rows are appended to the session's transcript file.
// Called from chat-session.mjs's routeFirstMessage on {type:"watch", sessionId, cwd}.
export function handleWatchConnection(ws, sessionId, cwd) {
  let filePath;
  try {
    filePath = resolveTranscriptPath(cwd, sessionId);
  } catch {
    safeSend(ws, { type: 'watch_denied', reason: 'invalid' });
    try {
      ws.close();
    } catch {
      /* already gone */
    }
    return;
  }

  if (activeWatchers >= MAX_WATCHERS) {
    safeSend(ws, { type: 'watch_denied', reason: 'limit' });
    try {
      ws.close();
    } catch {
      /* already gone */
    }
    return;
  }

  activeWatchers += 1;
  let stopped = false;
  let offset = 0;
  let leftover = '';
  let decoder = new StringDecoder('utf8');
  let reading = false;
  let fsWatcher = null;
  let pollTimer = null;

  async function checkForChanges() {
    if (stopped || reading) return;
    reading = true;
    try {
      let stat;
      try {
        stat = await fsp.stat(filePath);
      } catch {
        return; // file momentarily missing/unreadable; poll/next event will retry
      }
      if (stat.size < offset) {
        // Truncated or replaced (unusual for an append-only transcript, but
        // defend against it anyway): restart from the current end.
        offset = stat.size;
        leftover = '';
        decoder = new StringDecoder('utf8');
        return;
      }
      if (stat.size === offset) return;

      let toRead = stat.size - offset;
      if (toRead > MAX_READ_BYTES) {
        // Runaway growth since the last check — skip ahead rather than ever
        // buffering unbounded memory; the skipped middle is a rare/defensive
        // case, not the expected per-turn append size.
        offset = stat.size - MAX_READ_BYTES;
        leftover = '';
        decoder = new StringDecoder('utf8');
        toRead = MAX_READ_BYTES;
      }

      let fh;
      try {
        fh = await fsp.open(filePath, 'r');
        const buf = Buffer.alloc(toRead);
        const { bytesRead } = await fh.read(buf, 0, toRead, offset);
        if (bytesRead === 0) return;
        offset += bytesRead;
        const text = leftover + decoder.write(buf.subarray(0, bytesRead));
        const lines = text.split('\n');
        leftover = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let obj;
          try {
            obj = JSON.parse(line);
          } catch {
            continue; // corrupt/partial line; never throw
          }
          if (obj && AUTHORITATIVE_JSONL_TYPES.has(obj.type)) {
            safeSend(ws, { type: 'transcript_append', line: obj });
          }
        }
      } finally {
        if (fh) await fh.close();
      }
    } catch {
      /* best-effort tail; a transient error here must never crash the server */
    } finally {
      reading = false;
    }
  }

  function setupFsWatch() {
    try {
      fsWatcher = fs.watch(filePath, { persistent: false }, (eventType) => {
        checkForChanges();
        if (eventType === 'rename') {
          // Some editors/tools replace-then-rename; a few ms later the old
          // watch handle may point at nothing. Re-arm defensively — if the
          // file still exists under the same path (the normal append-only
          // case), the new watcher just resumes; if not, checkForChanges
          // above (and the poll fallback) keep no-op'ing harmlessly.
          setTimeout(() => {
            if (stopped) return;
            try {
              fsWatcher && fsWatcher.close();
            } catch {
              /* already closed */
            }
            setupFsWatch();
          }, 50);
        }
      });
      fsWatcher.on('error', () => {
        // fs.watch itself failed (e.g. exotic filesystem) — the poll
        // interval below still covers us; just drop the native watcher.
        try {
          fsWatcher && fsWatcher.close();
        } catch {
          /* ignore */
        }
        fsWatcher = null;
      });
    } catch {
      fsWatcher = null; // polling fallback alone still satisfies the contract
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (fsWatcher) {
      try {
        fsWatcher.close();
      } catch {
        /* already gone */
      }
      fsWatcher = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    activeWatchers = Math.max(0, activeWatchers - 1);
  }

  (async () => {
    // Start tailing from the file's current size — the client already has
    // everything up to "now" via the REST transcript fetch it does in
    // parallel; only rows appended from this point on need to cross the wire.
    try {
      const st = await fsp.stat(filePath);
      offset = st.size;
    } catch {
      offset = 0;
    }
    if (stopped) return;
    setupFsWatch();
    pollTimer = setInterval(checkForChanges, POLL_MS);
    safeSend(ws, { type: 'watch_started', sessionId });
  })();

  ws.on('close', stop);
  ws.on('error', stop);
  // Watch-only connections don't accept client commands (no chat/session
  // control happens on this ws) — messages are intentionally ignored rather
  // than erroring, in case a client sends a harmless {type:"stop"} on dispose.
  ws.on('message', () => {});
}

// Test/diagnostic hook only.
export function _activeWatcherCount() {
  return activeWatchers;
}
