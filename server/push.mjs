// Web Push (self-hosted VAPID, no external push-service account needed).
//
// Storage: ~/.claude-ui/push.json (VAPID keypair + subscriptions), created on
// first use with restrictive permissions (dir 0700, file 0600). Never lives
// in the repo.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import webpush from 'web-push';

const DIR = path.join(os.homedir(), '.claude-ui');
const FILE = path.join(DIR, 'push.json');

let store = null; // in-memory mirror of the on-disk store
let vapidConfigured = false;
const MAX_SUBSCRIPTIONS = 50;
const MAX_ENDPOINT_LENGTH = 4096;
const KEY_RE = /^[A-Za-z0-9_-]{8,512}$/;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function persist() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(DIR, 0o700);
  const tmp = `${FILE}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, FILE);
    fs.chmodSync(FILE, 0o600);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* rename succeeded or cleanup is best-effort */
    }
  }
}

function loadStore() {
  if (store) return store;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.vapid || !parsed.vapid.publicKey || !parsed.vapid.privateKey) {
      throw new Error('malformed push.json');
    }
    const subscriptions = [];
    for (const candidate of Array.isArray(parsed.subscriptions) ? parsed.subscriptions : []) {
      try {
        subscriptions.push({ ...validateSubscription(candidate), addedAt: candidate.addedAt || Date.now() });
      } catch {
        // Drop corrupt legacy entries rather than passing them to web-push.
      }
      if (subscriptions.length >= MAX_SUBSCRIPTIONS) break;
    }
    store = { vapid: parsed.vapid, subscriptions };
  } catch {
    // Missing, unreadable, or malformed: (re)generate a fresh VAPID keypair.
    // Any existing subscriptions are necessarily invalid if the keypair is lost.
    store = { vapid: webpush.generateVAPIDKeys(), subscriptions: [] };
    persist();
  }
  if (!vapidConfigured) {
    webpush.setVapidDetails('mailto:claude-ui@localhost', store.vapid.publicKey, store.vapid.privateKey);
    vapidConfigured = true;
  }
  return store;
}

export function getPublicKey() {
  return loadStore().vapid.publicKey;
}

export function validateSubscription(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > MAX_ENDPOINT_LENGTH) {
    throw badRequest('invalid subscription: endpoint required');
  }
  let endpoint;
  try {
    endpoint = new URL(sub.endpoint);
  } catch {
    throw badRequest('invalid subscription: malformed endpoint');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw badRequest('invalid subscription: HTTPS endpoint required');
  }
  if (!sub.keys || !KEY_RE.test(sub.keys.p256dh || '') || !KEY_RE.test(sub.keys.auth || '')) {
    throw badRequest('invalid subscription: valid p256dh and auth keys required');
  }
  return {
    endpoint: endpoint.href,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  };
}

export function addSubscription(sub) {
  const normalized = validateSubscription(sub);
  const s = loadStore();
  s.subscriptions = s.subscriptions.filter((x) => x.endpoint !== normalized.endpoint);
  if (s.subscriptions.length >= MAX_SUBSCRIPTIONS) throw badRequest('subscription limit reached');
  s.subscriptions.push({ ...normalized, addedAt: Date.now() });
  persist();
}

export function removeSubscription(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > MAX_ENDPOINT_LENGTH) {
    throw badRequest('invalid subscription: endpoint required');
  }
  const s = loadStore();
  const before = s.subscriptions.length;
  s.subscriptions = s.subscriptions.filter((x) => x.endpoint !== endpoint);
  if (s.subscriptions.length !== before) persist();
}

// Fire-and-forget: never throws, never awaited by callers, never blocks chat
// processing. 404/410 responses mean the push service considers the
// subscription gone — drop it from the store.
export function sendPush(payload) {
  let s;
  try {
    s = loadStore();
  } catch (err) {
    console.error('[push] store load failed:', err.message);
    return;
  }
  if (!s.subscriptions.length) return;

  const body = JSON.stringify(payload);
  for (const sub of s.subscriptions.slice()) {
    webpush
      .sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body)
      .catch((err) => {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) removeSubscription(sub.endpoint);
        console.error('[push] send failed:', code || '(no status)', (err && err.message) || err);
      });
  }
}
