// terminalStability: connect /ws/terminal, confirm the pty starts (ANSI
// output), input→output round-trips, resize doesn't drop the connection, and
// the terminal is still responsive after a resize — then disconnect and
// confirm the pty child (and any node-pty helper) is reaped promptly.
//
// Timing note: earlier this scenario used a fixed 5s wait for output right
// after "resize + one Enter", which was flaky under load — claude's startup
// trust dialog + resize can jitter well past a hard 5s window even though the
// pty is perfectly healthy (a 20s probe showed output resuming ~80ms later and
// streaming continuously). We now use *generative* windows: we wait for the
// next output event within a generous bound and only FAIL if the terminal goes
// COMPLETELY silent past that bound — which still catches a genuine stall/hang.

import { connectWs } from '../lib/ws-client.mjs';
import { descendantPids } from '../lib/procstats.mjs';
import { sleep } from '../lib/util.mjs';

const isOutput = (e) => e.type === 'output';

function hasAnsi(events) {
  return events.some((e) => e.type === 'output' && typeof e.data === 'string' && e.data.includes('\x1b['));
}

// Waits for the NEXT output event to arrive after this call. Resolves true if
// one arrives within `windowMs`, false if the terminal stays silent (which is
// how a real stall shows up). waitFor only matches future events, so this is a
// true "did the terminal produce anything new" probe.
async function sawOutputWithin(conn, windowMs) {
  try {
    await conn.waitFor(isOutput, windowMs);
    return true;
  } catch {
    return false;
  }
}

export default async function terminalStability(ctx) {
  const errors = [];
  const beforeDesc = ctx.serverPid ? await descendantPids(ctx.serverPid) : null;

  const url = ctx.wsTerminalUrl({ cwd: ctx.cwd, cols: 80, rows: 24 });
  const conn = await connectWs(url, { token: ctx.token });

  let roundTrip = false;
  let postResizeAlive = false;
  try {
    // 1) startup: ANSI output must appear within a generative window.
    const started = await sawOutputWithin(conn, 10000);
    if (!started) errors.push('no terminal output within 10s of connecting (pty failed to start?)');
    // Nudge past the startup trust dialog into the main UI, mirroring a real
    // user pressing Enter; measurement continues from the live UI.
    conn.send({ type: 'input', data: '\r' });
    await sleep(300);
    if (!hasAnsi(conn.events)) errors.push('no ANSI escape sequences observed in terminal output');

    // 2) input -> output round-trip within a generative window (>=1 time).
    const rtWaiter = conn.waitFor(isOutput, 12000);
    conn.send({ type: 'input', data: 'a' });
    try {
      await rtWaiter;
      roundTrip = true;
    } catch {
      errors.push('no output within 12s after a keystroke (input round-trip failed)');
    }

    // 3) resize must not drop the connection.
    conn.send({ type: 'resize', cols: 100, rows: 30 });
    await sleep(500);
    if (conn.isClosed()) {
      errors.push(`terminal ws closed after resize (${JSON.stringify(conn.closeInfo())})`);
    }

    // 4) responsiveness after resize: the terminal must not go completely
    // silent. We prod it with an Enter and require *some* new output within a
    // generous 15s window; only total silence past that is a real stall.
    if (!conn.isClosed()) {
      const postWaiter = conn.waitFor(isOutput, 15000);
      conn.send({ type: 'input', data: '\r' });
      try {
        await postWaiter;
        postResizeAlive = true;
      } catch {
        errors.push('terminal produced NO output within 15s after resize (genuine stall)');
      }
    }
  } catch (err) {
    errors.push(`terminalStability threw: ${err.message}`);
  } finally {
    conn.close();
  }

  // 5) pty reaping after disconnect (unchanged).
  let descLeakOk = true;
  let afterDesc = null;
  if (ctx.serverPid) {
    const deadline = Date.now() + 5000;
    const beforeCount = beforeDesc.length;
    do {
      await sleep(300);
      afterDesc = await descendantPids(ctx.serverPid);
    } while (afterDesc.length > beforeCount && Date.now() < deadline);
    descLeakOk = afterDesc.length <= beforeCount;
    if (!descLeakOk) {
      errors.push(
        `pty process not reaped after disconnect: before=${beforeCount} after=${afterDesc.length} (${afterDesc
          .map((d) => d.name)
          .join(',')})`
      );
    }
  }

  return {
    pass: errors.length === 0,
    errors,
    detail: { roundTrip, postResizeAlive, descLeakOk, leakCheckSkipped: !ctx.serverPid },
  };
}
