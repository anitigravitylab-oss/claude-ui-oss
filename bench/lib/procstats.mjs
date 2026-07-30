// Linux-only /proc introspection used for leak detection: RSS, open FD count,
// and the set of descendant PIDs (claude / node-pty helper / shell) rooted at
// the bench's own spawned server process. Scoping by descendant tree (rather
// than matching process names system-wide) matters because the production
// claude-ui instance on this box may be running its own `claude` children at
// the same time — we must never count or touch those.

import fs from 'node:fs/promises';

async function readProcTable() {
  let entries;
  try {
    entries = await fs.readdir('/proc');
  } catch {
    return new Map();
  }
  const pids = entries.filter((p) => /^\d+$/.test(p));
  const map = new Map(); // pid -> { ppid, name }
  await Promise.all(
    pids.map(async (pidStr) => {
      try {
        const stat = await fs.readFile(`/proc/${pidStr}/stat`, 'utf8');
        // Format: pid (comm) state ppid ... — comm can contain spaces/parens,
        // so match from the last ')' rather than a naive split.
        const closeParen = stat.lastIndexOf(')');
        const name = stat.slice(stat.indexOf('(') + 1, closeParen);
        const rest = stat.slice(closeParen + 2).split(' ');
        const ppid = Number(rest[1]);
        map.set(Number(pidStr), { ppid, name });
      } catch {
        /* process exited between readdir and read; skip */
      }
    })
  );
  return map;
}

export async function descendantPids(rootPid) {
  const table = await readProcTable();
  const childrenOf = new Map();
  for (const [pid, info] of table) {
    if (!childrenOf.has(info.ppid)) childrenOf.set(info.ppid, []);
    childrenOf.get(info.ppid).push(pid);
  }
  const result = [];
  const queue = [rootPid];
  const seen = new Set([rootPid]);
  while (queue.length) {
    const p = queue.shift();
    for (const c of childrenOf.get(p) || []) {
      if (seen.has(c)) continue;
      seen.add(c);
      const info = table.get(c);
      result.push({ pid: c, name: info ? info.name : '?' });
      queue.push(c);
    }
  }
  return result;
}

export async function procSnapshot(rootPid) {
  const [statusText, fdList, descendants] = await Promise.all([
    fs.readFile(`/proc/${rootPid}/status`, 'utf8').catch(() => ''),
    fs.readdir(`/proc/${rootPid}/fd`).catch(() => []),
    descendantPids(rootPid),
  ]);
  const m = statusText.match(/VmRSS:\s+(\d+)\s*kB/);
  return {
    rssKb: m ? Number(m[1]) : null,
    fdCount: fdList.length,
    descendants,
  };
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function killPidTree(pids, { graceMs = 2000 } = {}) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!pids.some(isAlive)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const pid of pids) {
    if (isAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}
