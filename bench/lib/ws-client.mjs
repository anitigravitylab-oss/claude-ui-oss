// Thin WebSocket wrapper for the bench. `waitFor(predicate)` only matches
// events that arrive AFTER it is called — it deliberately does not scan
// already-buffered history. This avoids a stale-match race where, e.g., a
// second turn's `waitFor(e => e.event.type === 'result')` would otherwise
// immediately resolve against the *first* turn's already-received result
// event. Callers must call waitFor() synchronously right after send() (i.e.
// before awaiting anything else) so no incoming message can be missed.

import WebSocket from 'ws';

export function connectWs(url, { openTimeoutMs = 10000, token } = {}) {
  return new Promise((resolve, reject) => {
    const protocol = token ? `claude-ui.auth.${Buffer.from(token).toString('base64url')}` : undefined;
    const ws = new WebSocket(url, protocol);
    const events = [];
    const waiters = [];
    let closed = false;
    let closeInfo = null;
    let opened = false;

    const openTimer = setTimeout(() => {
      if (!opened) {
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        reject(new Error('ws open timeout'));
      }
    }, openTimeoutMs);

    ws.on('message', (raw) => {
      let obj;
      try {
        obj = JSON.parse(raw.toString('utf8'));
      } catch {
        obj = { type: '__unparsed__', raw: raw.toString('utf8').slice(0, 500) };
      }
      events.push(obj);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(obj)) {
          const w = waiters[i];
          waiters.splice(i, 1);
          w.resolve(obj);
        }
      }
    });

    ws.on('close', (code, reasonBuf) => {
      closed = true;
      closeInfo = { code, reason: reasonBuf ? reasonBuf.toString() : '' };
      for (const w of waiters.splice(0)) {
        w.reject(new Error(`ws closed (code=${code}) before predicate matched`));
      }
    });

    ws.on('error', (err) => {
      if (!opened) {
        clearTimeout(openTimer);
        reject(err);
      }
      // After open, errors surface via waitFor rejections on close, or are
      // simply observable via handle.lastError() for scenarios that care.
      handle.lastErrorMsg = err && err.message;
    });

    ws.once('open', () => {
      opened = true;
      clearTimeout(openTimer);
      resolve(handle);
    });

    const handle = {
      ws,
      events,
      lastErrorMsg: null,
      send(obj) {
        ws.send(JSON.stringify(obj));
      },
      sendRaw(str) {
        ws.send(str);
      },
      // Resolves with the first NEW event (arriving after this call) that
      // satisfies predicate. Rejects on timeout or if the socket closes first.
      waitFor(predicate, timeoutMs = 60000) {
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            const idx = waiters.findIndex((w) => w.resolve === wrappedResolve);
            if (idx >= 0) waiters.splice(idx, 1);
            rej(new Error('timeout waiting for ws event'));
          }, timeoutMs);
          const wrappedResolve = (v) => {
            clearTimeout(timer);
            res(v);
          };
          const wrappedReject = (e) => {
            clearTimeout(timer);
            rej(e);
          };
          waiters.push({ predicate, resolve: wrappedResolve, reject: wrappedReject });
        });
      },
      isClosed() {
        return closed;
      },
      closeInfo() {
        return closeInfo;
      },
      // Phase 4: a plain ws close no longer kills the server-side child (it
      // detaches instead, by design). Scenarios that call close() expecting
      // "this session is done" must actually end it, or a detached-but-idle
      // child lingers until its TTL and trips leakCheck. Sending `stop`
      // mirrors what the real client's ChatTab.dispose() does when a tab is
      // closed, and keeps every pre-existing scenario's cleanup semantics.
      close() {
        try {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
        } catch {
          /* ignore */
        }
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      },
      terminate() {
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
      },
      waitClosed(timeoutMs = 5000) {
        if (closed) return Promise.resolve(closeInfo);
        return new Promise((res) => {
          const t = setTimeout(() => res(null), timeoutMs);
          ws.once('close', (code, reasonBuf) => {
            clearTimeout(t);
            res({ code, reason: reasonBuf ? reasonBuf.toString() : '' });
          });
        });
      },
    };
  });
}
