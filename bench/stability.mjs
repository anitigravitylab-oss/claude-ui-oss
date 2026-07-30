#!/usr/bin/env node
// claude-ui stability bench — see bench/README.md for full docs.
//
// Spawns a dedicated claude-ui server (random port + random token, IS_SANDBOX=1)
// and drives it through 12 scenarios covering the happy path, concurrency,
// abnormal input, permission flow, disconnect/resume, terminal, and a
// before/after leak comparison. Observation-only: never touches server/ or
// public/, never touches the production instance on 7681.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { parseArgs } from './lib/util.mjs';
import { findFreePort, spawnServer, waitForReady, killServerTree } from './lib/server.mjs';
import { procSnapshot, descendantPids, killPidTree } from './lib/procstats.mjs';
import { renderConsole, writeJsonReport, writeHtmlReport, computeLatencyStats } from './lib/report.mjs';

import smoke from './scenarios/01-smoke.mjs';
import sequentialTurns from './scenarios/02-sequentialTurns.mjs';
import concurrentSessions from './scenarios/03-concurrentSessions.mjs';
import longOutput from './scenarios/04-longOutput.mjs';
import interrupt from './scenarios/05-interrupt.mjs';
import permissionFlow from './scenarios/06-permissionFlow.mjs';
import reconnect from './scenarios/07-reconnect.mjs';
import malformedInput from './scenarios/08-malformedInput.mjs';
import rapidFire from './scenarios/09-rapidFire.mjs';
import idleSurvival from './scenarios/10-idleSurvival.mjs';
import terminalStability from './scenarios/11-terminalStability.mjs';
import leakCheck from './scenarios/12-leakCheck.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCENARIOS = [
  { name: 'smoke', fn: smoke },
  { name: 'sequentialTurns', fn: sequentialTurns },
  { name: 'concurrentSessions', fn: concurrentSessions },
  { name: 'longOutput', fn: longOutput },
  { name: 'interrupt', fn: interrupt },
  { name: 'permissionFlow', fn: permissionFlow },
  { name: 'reconnect', fn: reconnect },
  { name: 'malformedInput', fn: malformedInput },
  { name: 'rapidFire', fn: rapidFire },
  { name: 'idleSurvival', fn: idleSurvival },
  { name: 'terminalStability', fn: terminalStability },
  { name: 'leakCheck', fn: leakCheck },
];

function withTimeoutSafe(promise, ms, label) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ pass: false, errors: [`timeout after ${ms}ms in ${label}`], detail: {} });
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
    Promise.resolve(promise)
      .then((res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res && typeof res === 'object' ? res : { pass: false, errors: [`scenario ${label} returned non-object result`], detail: {} });
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ pass: false, errors: [String((err && err.stack) || (err && err.message) || err)], detail: {} });
      });
  });
}

function printUsage() {
  console.log(`Usage: node bench/stability.mjs [options]

  --port <n>            fixed port for the spawned server (default: random free port)
  --host <host>          host to bind (default: 127.0.0.1)
  --token <str>          fixed auth token (default: random)
  --url <baseUrl>        use an already-running server instead of spawning one
                         (leak/proc metrics are skipped in this mode)
  --model <name>         model for all LLM turns (default: haiku)
  --concurrency <n>      sessions for concurrentSessions (default: 3)
  --iterations <n>       repeat the whole scenario suite N times (default: 1)
  --scenario <a,b,c>     only run these scenario names (comma-separated)
  --timeout <ms>         per-scenario watchdog timeout (default: 60000, 180000 with --heavy)
  --heavy                run heavier variants (longer idle/output, higher iteration counts)
  --json <path>          write machine-readable JSON report
  --html <path>          write a self-contained HTML report
  --help                 show this message
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return 0;
  }

  const heavy = !!args.heavy;
  const model = args.model || 'haiku';
  const concurrency = Number(args.concurrency) || 3;
  const iterations = Math.max(1, Number(args.iterations) || 1);
  const defaultTimeout = Number(args.timeout) || (heavy ? 180000 : 60000);
  const scenarioFilter = args.scenario
    ? String(args.scenario).split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  const benchCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-bench-'));

  let serverChild = null;
  let serverPid = null;
  let baseUrl;
  let token;
  const external = !!args.url;

  if (external) {
    baseUrl = String(args.url).replace(/\/$/, '');
    token = args.token || process.env.CLAUDE_UI_TOKEN || '';
    console.log(`[bench] using external server at ${baseUrl} (leak/proc metrics disabled)`);
  } else {
    const port = args.port ? Number(args.port) : await findFreePort();
    const host = args.host || '127.0.0.1';
    token = args.token || randomBytes(12).toString('hex');
    const entry = path.join(__dirname, '..', 'server', 'index.mjs');
    serverChild = spawnServer({ entry, port, host, token });
    serverPid = serverChild.pid;
    baseUrl = `http://${host}:${port}`;
    console.log(`[bench] spawned server pid=${serverPid} on ${baseUrl}`);
    try {
      await waitForReady(baseUrl, token, { timeoutMs: 20000 });
    } catch (err) {
      console.error(`[bench] server never became ready: ${err.message}`);
      if (serverChild._stderrTail) console.error(`[bench] server stderr tail:\n${serverChild._stderrTail}`);
      await killServerTree(serverChild);
      await fs.rm(benchCwd, { recursive: true, force: true }).catch(() => {});
      return 1;
    }
  }

  const u = new URL(baseUrl);
  const wsScheme = u.protocol === 'https:' ? 'wss' : 'ws';
  const wsChatUrl = `${wsScheme}://${u.host}/ws/chat`;
  const wsTerminalUrl = (opts = {}) => {
    const p = new URLSearchParams({
      cwd: opts.cwd || benchCwd,
      cols: String(opts.cols || 80),
      rows: String(opts.rows || 24),
    });
    if (opts.resume) p.set('resume', opts.resume);
    return `${wsScheme}://${u.host}/ws/terminal?${p.toString()}`;
  };

  const latencies = [];
  const ctx = {
    baseUrl,
    token,
    wsChatUrl,
    wsTerminalUrl,
    model,
    heavy,
    concurrency,
    iterations,
    cwd: benchCwd,
    serverPid,
    defaultTimeout,
    latencies,
    recordLatency(resultEvent) {
      if (!resultEvent) return;
      const ttfbMs = typeof resultEvent.ttft_ms === 'number' ? resultEvent.ttft_ms : null;
      const totalMs = typeof resultEvent.duration_ms === 'number' ? resultEvent.duration_ms : null;
      if (ttfbMs !== null || totalMs !== null) latencies.push({ ttfbMs, totalMs });
    },
  };

  if (serverPid) {
    try {
      ctx.baselineSnapshot = await procSnapshot(serverPid);
    } catch {
      ctx.baselineSnapshot = null;
    }
  }

  const toRun = scenarioFilter ? SCENARIOS.filter((s) => scenarioFilter.includes(s.name)) : SCENARIOS;
  if (toRun.length === 0) {
    console.error(`[bench] --scenario filter matched nothing (known: ${SCENARIOS.map((s) => s.name).join(', ')})`);
  }

  const results = [];
  for (let iter = 1; iter <= iterations; iter++) {
    for (const s of toRun) {
      const label = iterations > 1 ? `${s.name}#${iter}` : s.name;
      process.stdout.write(`[bench] running ${label}...\n`);
      const t0 = Date.now();
      const outcome = await withTimeoutSafe(s.fn(ctx), defaultTimeout, label);
      const ms = Date.now() - t0;
      results.push({ name: label, baseName: s.name, pass: !!outcome.pass, ms, errors: outcome.errors || [], detail: outcome.detail || {} });
    }
  }

  // --- teardown: capture descendants BEFORE killing the server, since a
  // killed parent's still-alive children get reparented (losing the ppid
  // link we use to find them) — kill them explicitly as a safety net so the
  // bench itself can never be the thing that leaks.
  let strayDescendants = [];
  if (serverPid) {
    strayDescendants = await descendantPids(serverPid).catch(() => []);
  }
  if (serverChild) await killServerTree(serverChild);
  if (strayDescendants.length) await killPidTree(strayDescendants.map((d) => d.pid));
  await fs.rm(benchCwd, { recursive: true, force: true }).catch(() => {});

  // Normalize the leak snapshot pair for the report, which expects a scalar
  // `descendantCount` alongside the raw `descendants` array from procSnapshot.
  let leak = null;
  if (ctx.leakResult) {
    const lr = ctx.leakResult;
    leak = {
      ...lr,
      baseline: { ...lr.baseline, descendantCount: (lr.baseline.descendants || []).length },
      final: { ...lr.final, descendantCount: (lr.final.descendants || []).length },
    };
  }
  const latencyStats = computeLatencyStats(latencies);
  const meta = { baseUrl, external, model, heavy };

  renderConsole({ results, latencyStats, leak, meta });

  const payload = { meta, results, latencyStats, leak, generatedAt: new Date().toISOString() };
  if (args.json) await writeJsonReport(String(args.json), payload);
  if (args.html) await writeHtmlReport(String(args.html), payload);

  const allPass = results.every((r) => r.pass);
  return allPass ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[bench] fatal error:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
