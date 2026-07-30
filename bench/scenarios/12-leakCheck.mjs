// leakCheck: compares the spawned server's /proc snapshot now (after all
// preceding scenarios ran) against the baseline snapshot taken right after
// the server became ready. Descended-process count must return to baseline,
// RSS growth must stay under threshold, FD growth must stay under threshold.
//
// This scenario is meant to run LAST in the default scenario order so
// "after everything" actually means something; when run alone via
// --scenario leakCheck it still validates "did merely starting up leak".

import { procSnapshot } from '../lib/procstats.mjs';
import { sleep } from '../lib/util.mjs';

const DEFAULT_RSS_THRESHOLD_KB = 150 * 1024; // 150MB
const DEFAULT_FD_THRESHOLD = 60;

export default async function leakCheck(ctx) {
  if (!ctx.serverPid || !ctx.baselineSnapshot) {
    return {
      pass: true,
      errors: [],
      detail: { skipped: true, reason: 'no local server pid (running against --url)' },
    };
  }

  const baseline = ctx.baselineSnapshot;
  const rssThresholdKb = Number(ctx.rssThresholdKb) || DEFAULT_RSS_THRESHOLD_KB;
  const fdThreshold = Number(ctx.fdThreshold) || DEFAULT_FD_THRESHOLD;

  // Give recently-closed connections/children a moment to be fully reaped
  // before judging; poll rather than a single fixed sleep.
  let final = await procSnapshot(ctx.serverPid);
  const deadline = Date.now() + 5000;
  while (final.descendants.length > baseline.descendants.length && Date.now() < deadline) {
    await sleep(400);
    final = await procSnapshot(ctx.serverPid);
  }

  const descendantOk = final.descendants.length <= baseline.descendants.length;
  const rssDeltaKb = (final.rssKb ?? 0) - (baseline.rssKb ?? 0);
  const rssOk = baseline.rssKb === null || final.rssKb === null || rssDeltaKb <= rssThresholdKb;
  const fdDelta = final.fdCount - baseline.fdCount;
  const fdOk = fdDelta <= fdThreshold;

  const errors = [];
  if (!descendantOk) {
    errors.push(
      `descendant process count grew: baseline=${baseline.descendants.length} final=${final.descendants.length} (${final.descendants
        .map((d) => `${d.name}:${d.pid}`)
        .join(', ')})`
    );
  }
  if (!rssOk) errors.push(`server RSS grew by ${rssDeltaKb}kB (threshold ${rssThresholdKb}kB)`);
  if (!fdOk) errors.push(`server open FD count grew by ${fdDelta} (threshold ${fdThreshold})`);

  // Stash the full snapshot pair on ctx so the main runner can render/report
  // it as a first-class "leak" section, not just a pass/fail line.
  ctx.leakResult = { baseline, final, descendantOk, rssDeltaKb, rssThresholdKb, rssOk, fdDelta, fdThreshold, fdOk };

  return {
    pass: descendantOk && rssOk && fdOk,
    errors,
    detail: {
      descendantsBaseline: baseline.descendants.length,
      descendantsFinal: final.descendants.length,
      rssDeltaKb,
      fdDelta,
    },
  };
}
