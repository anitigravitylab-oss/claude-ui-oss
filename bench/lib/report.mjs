import fs from 'node:fs/promises';
import path from 'node:path';
import { percentile } from './util.mjs';

function fmtMs(ms) {
  if (ms === null || ms === undefined) return '-';
  return `${ms}ms`;
}

function pad(str, len) {
  str = String(str);
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

export function computeLatencyStats(latencies) {
  const totals = latencies.map((l) => l.totalMs).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  const ttfbs = latencies.map((l) => l.ttfbMs).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  return {
    count: latencies.length,
    total: {
      p50: percentile(totals, 50),
      p95: percentile(totals, 95),
      max: totals.length ? totals[totals.length - 1] : null,
    },
    ttfb: {
      p50: percentile(ttfbs, 50),
      p95: percentile(ttfbs, 95),
      max: ttfbs.length ? ttfbs[ttfbs.length - 1] : null,
    },
  };
}

export function renderConsole({ results, latencyStats, leak, meta }) {
  const lines = [];
  lines.push('');
  lines.push('=== claude-ui stability bench ===');
  if (meta) {
    lines.push(`server: ${meta.baseUrl}${meta.external ? ' (external, --url)' : ' (spawned)'}  model: ${meta.model}${meta.heavy ? '  [heavy]' : ''}`);
  }
  lines.push('');
  lines.push(pad('SCENARIO', 22) + pad('RESULT', 8) + pad('MS', 8) + 'NOTES');
  lines.push('-'.repeat(70));
  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    const note = r.pass ? Object.keys(r.detail || {}).length ? summarizeDetail(r.detail) : '' : (r.errors[0] || '');
    lines.push(pad(r.name, 22) + pad(status, 8) + pad(r.ms, 8) + truncate(note, 60));
    if (!r.pass && r.errors.length > 1) {
      for (const e of r.errors.slice(1, 4)) lines.push(pad('', 30) + truncate(e, 60));
    }
  }
  lines.push('-'.repeat(70));
  const passCount = results.filter((r) => r.pass).length;
  const rate = results.length ? ((passCount / results.length) * 100).toFixed(1) : '0.0';
  lines.push(`Success rate: ${passCount}/${results.length} (${rate}%)`);
  lines.push('');
  if (leak) {
    lines.push('--- Leak check ---');
    lines.push(`  descendant procs: baseline=${leak.baseline.descendantCount} final=${leak.final.descendantCount} (${leak.descendantOk ? 'OK' : 'LEAK'})`);
    lines.push(`  RSS: baseline=${leak.baseline.rssKb}kB final=${leak.final.rssKb}kB delta=${leak.rssDeltaKb}kB (threshold ${leak.rssThresholdKb}kB) (${leak.rssOk ? 'OK' : 'LEAK'})`);
    lines.push(`  open FDs: baseline=${leak.baseline.fdCount} final=${leak.final.fdCount} delta=${leak.fdDelta} (threshold ${leak.fdThreshold}) (${leak.fdOk ? 'OK' : 'LEAK'})`);
    if (!leak.descendantOk && leak.final.descendants.length) {
      lines.push(`  leftover procs: ${leak.final.descendants.map((d) => `${d.name}(${d.pid})`).join(', ')}`);
    }
    lines.push('');
  }
  if (latencyStats && latencyStats.count) {
    lines.push('--- Latency (LLM turns) ---');
    lines.push(`  n=${latencyStats.count}  total: p50=${fmtMs(latencyStats.total.p50)} p95=${fmtMs(latencyStats.total.p95)} max=${fmtMs(latencyStats.total.max)}`);
    lines.push(`               ttfb:  p50=${fmtMs(latencyStats.ttfb.p50)} p95=${fmtMs(latencyStats.ttfb.p95)} max=${fmtMs(latencyStats.ttfb.max)}`);
    lines.push('');
  }
  const text = lines.join('\n');
  console.log(text);
  return text;
}

function summarizeDetail(detail) {
  const parts = [];
  for (const [k, v] of Object.entries(detail)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') continue;
    parts.push(`${k}=${v}`);
  }
  return parts.join(' ');
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export async function writeJsonReport(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {});
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

export async function writeHtmlReport(filePath, payload) {
  const { results, latencyStats, leak, meta } = payload;
  const rows = results
    .map((r) => {
      const cls = r.pass ? 'pass' : 'fail';
      const note = r.pass ? summarizeDetail(r.detail) : (r.errors[0] || '');
      return `<tr class="${cls}"><td>${esc(r.name)}</td><td class="status">${r.pass ? 'PASS' : 'FAIL'}</td><td>${r.ms}ms</td><td>${esc(truncate(note, 200))}</td></tr>`;
    })
    .join('\n');
  const passCount = results.filter((r) => r.pass).length;
  const rate = results.length ? ((passCount / results.length) * 100).toFixed(1) : '0.0';
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>claude-ui stability bench</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; background: #fff; color: #111; }
  @media (prefers-color-scheme: dark) { body { background: #1b1b1a; color: #eee; } }
  h1 { font-size: 1.3rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  td, th { padding: 0.4rem 0.6rem; border-bottom: 1px solid #8884; text-align: left; font-size: 0.9rem; }
  tr.pass .status { color: #2a8f4a; font-weight: 600; }
  tr.fail .status { color: #c9432c; font-weight: 600; }
  .summary { margin-top: 1rem; font-size: 0.95rem; }
  .box { border: 1px solid #8884; border-radius: 4px; padding: 0.8rem 1rem; margin-top: 1rem; }
  code { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<h1>claude-ui stability bench</h1>
<div class="summary">server: <code>${esc(meta.baseUrl)}</code>${meta.external ? ' (external)' : ' (spawned)'} &middot; model: <code>${esc(meta.model)}</code>${meta.heavy ? ' &middot; heavy' : ''}<br>
Success rate: <b>${passCount}/${results.length} (${rate}%)</b> &middot; generated ${esc(new Date().toISOString())}</div>
<table>
<thead><tr><th>Scenario</th><th>Result</th><th>ms</th><th>Notes</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${leak ? `<div class="box"><b>Leak check</b><br>
descendant procs: ${leak.baseline.descendantCount} &rarr; ${leak.final.descendantCount} (${leak.descendantOk ? 'OK' : 'LEAK'})<br>
RSS: ${leak.baseline.rssKb}kB &rarr; ${leak.final.rssKb}kB, delta ${leak.rssDeltaKb}kB / threshold ${leak.rssThresholdKb}kB (${leak.rssOk ? 'OK' : 'LEAK'})<br>
open FDs: ${leak.baseline.fdCount} &rarr; ${leak.final.fdCount}, delta ${leak.fdDelta} / threshold ${leak.fdThreshold} (${leak.fdOk ? 'OK' : 'LEAK'})
</div>` : ''}
${latencyStats && latencyStats.count ? `<div class="box"><b>Latency (n=${latencyStats.count})</b><br>
total: p50=${fmtMs(latencyStats.total.p50)} p95=${fmtMs(latencyStats.total.p95)} max=${fmtMs(latencyStats.total.max)}<br>
ttfb: p50=${fmtMs(latencyStats.ttfb.p50)} p95=${fmtMs(latencyStats.ttfb.p95)} max=${fmtMs(latencyStats.ttfb.max)}
</div>` : ''}
</body>
</html>
`;
  await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {});
  await fs.writeFile(filePath, html, 'utf8');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
