// Manages a node-pty session running the plain `claude` TUI, for full
// feature parity regardless of CLI version (the terminal is always a
// working fallback since we never parse its output — we just relay bytes).

import pty from 'node-pty';
import { validAbsolutePath, validSessionId } from './protocol-validation.mjs';

export function createPtySession(ws, { cwd, cols, rows, resume }) {
  if (!validAbsolutePath(cwd) || (resume != null && !validSessionId(resume))) {
    try {
      ws.send(JSON.stringify({ type: 'exit', code: -1, message: 'invalid terminal options' }));
      ws.close(1008, 'invalid terminal options');
    } catch {
      /* already closed */
    }
    return;
  }
  const args = [];
  if (resume) args.push('--resume', String(resume));

  let term;
  try {
    term = pty.spawn('claude', args, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: cwd || process.env.HOME || '/',
      env: { ...process.env, TERM: 'xterm-256color' },
    });
  } catch (err) {
    try {
      ws.send(JSON.stringify({ type: 'exit', code: -1, message: `failed to start pty: ${err.message}` }));
    } catch {
      /* ignore */
    }
    ws.close();
    return;
  }

  let closed = false;

  term.onData((data) => {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: 'output', data }));
    } catch {
      /* ignore */
    }
  });

  term.onExit(({ exitCode }) => {
    closed = true;
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      } catch {
        /* ignore */
      }
    }
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      return; // ignore malformed frames rather than crashing the pty session
    }
    if (msg.type === 'input' && typeof msg.data === 'string' && Buffer.byteLength(msg.data) <= 512 * 1024) {
      try {
        term.write(msg.data);
      } catch {
        /* pty may have already exited */
      }
    } else if (msg.type === 'resize') {
      const c = Number(msg.cols);
      const r = Number(msg.rows);
      if (Number.isInteger(c) && Number.isInteger(r) && c >= 10 && c <= 500 && r >= 2 && r <= 200) {
        try {
          term.resize(c, r);
        } catch {
          /* ignore resize errors (e.g. pty already dead) */
        }
      }
    }
  });

  ws.on('close', () => {
    if (!closed) {
      try {
        term.kill();
      } catch {
        /* already dead */
      }
      // B4: escalate to SIGKILL if the pty is still alive after a grace period.
      const t = setTimeout(() => {
        if (!closed) {
          try {
            term.kill('SIGKILL');
          } catch {
            /* already dead */
          }
        }
      }, 3000);
      if (typeof t.unref === 'function') t.unref();
    }
  });
}
