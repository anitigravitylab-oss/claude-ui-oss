// Small shared helpers: CLI arg parsing, sleep, timeout wrapper, id generation.

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[name] = next;
      i++;
    } else {
      out[name] = true;
    }
  }
  return out;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Races `promise` against a timeout. Never rejects: on timeout or on the
// promise itself rejecting, resolves with a {pass:false, ...} result so a
// single misbehaving scenario can never hang or crash the whole bench run.
export function withTimeout(promise, ms, label) {
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
        resolve(res);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ pass: false, errors: [String((err && err.stack) || (err && err.message) || err)], detail: {} });
      });
  });
}

export function randToken(bytes = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < bytes; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function marker(prefix = 'M') {
  return `${prefix}${randToken(6).toUpperCase()}`;
}

export function percentile(sortedNums, p) {
  if (sortedNums.length === 0) return null;
  const idx = Math.min(sortedNums.length - 1, Math.floor((p / 100) * sortedNums.length));
  return sortedNums[idx];
}
