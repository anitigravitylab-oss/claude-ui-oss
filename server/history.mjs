// Reads ~/.claude/projects/<encoded-cwd>/*.jsonl for the history/resume UI.
// Strictly best-effort: any parse failure is swallowed, never thrown, so a
// single corrupt line/file never turns into a 500.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validAbsolutePath } from './protocol-validation.mjs';

const PROJECTS_ROOT = path.join(os.homedir() || '/root', '.claude', 'projects');
const CHUNK = 64 * 1024; // 64KB

function cwdToDirName(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function splitLines(text) {
  return text.split('\n').filter((l) => l.trim().length > 0);
}

function tryParseLines(text) {
  const out = [];
  for (const line of splitLines(text)) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip corrupt line
    }
  }
  return out;
}

async function readAtMost(fh, length, position) {
  const buffer = Buffer.alloc(length);
  let total = 0;
  while (total < length) {
    const { bytesRead } = await fh.read(buffer, total, length - total, position + total);
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return buffer.subarray(0, total);
}

// Reads up to `head` bytes from the start and up to `tail` bytes from the
// end of a file, without loading the whole thing into memory.
async function readHeadAndTail(filePath, head = CHUNK, tail = CHUNK) {
  let fh;
  try {
    fh = await fs.open(filePath, 'r');
    const stat = await fh.stat();
    const size = stat.size;

    if (size <= head + tail) {
      const buf = await readAtMost(fh, size, 0);
      return buf.toString('utf8');
    }

    const headBuf = await readAtMost(fh, head, 0);
    const tailBuf = await readAtMost(fh, tail, size - tail);
    return headBuf.toString('utf8') + '\n' + tailBuf.toString('utf8');
  } finally {
    if (fh) await fh.close();
  }
}

// Bounded-concurrency map: the per-file work below (stat + a small read) is I/O
// bound, so running it fully sequentially serialized every single await and made
// projects with hundreds of session files (observed: ~950 files in one real
// project on this machine, ~2.5s) noticeably slow to open in the sidebar. A
// worker-pool of concurrent reads keeps memory/fd use bounded while no longer
// serializing file-by-file.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function findCwdForProjectDir(dirAbsPath) {
  let entries;
  try {
    entries = await fs.readdir(dirAbsPath);
  } catch {
    return null;
  }
  const jsonlFiles = entries.filter((f) => f.endsWith('.jsonl'));
  for (const f of jsonlFiles) {
    try {
      const text = await readHeadAndTail(path.join(dirAbsPath, f), CHUNK, 0);
      for (const obj of tryParseLines(text)) {
        if (validAbsolutePath(obj.cwd)) return obj.cwd;
      }
    } catch {
      // ignore this file, try next
    }
  }
  return null;
}

async function scanProjectDir(entry) {
  const dirAbsPath = path.join(PROJECTS_ROOT, entry.name);
  let jsonlFiles = [];
  let lastActivity = null;
  try {
    const files = await fs.readdir(dirAbsPath);
    jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
    const mtimes = await mapWithConcurrency(jsonlFiles, 32, async (f) => {
      try {
        const st = await fs.stat(path.join(dirAbsPath, f));
        return st.mtimeMs;
      } catch {
        return null;
      }
    });
    for (const m of mtimes) {
      if (m != null && (!lastActivity || m > lastActivity)) lastActivity = m;
    }
  } catch {
    /* ignore, keep defaults */
  }

  const cwd = await findCwdForProjectDir(dirAbsPath);
  return { dir: entry.name, cwd, sessionCount: jsonlFiles.length, lastActivity };
}

export async function listProjects() {
  let dirents;
  try {
    dirents = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs = dirents.filter((entry) => entry.isDirectory());
  const results = await mapWithConcurrency(dirs, 8, scanProjectDir);

  results.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  return results;
}

const PROMPT_MAX_LEN = 120;

// Cleans a raw user-message text for display in the session list.
// - <local-command-caveat>/<local-command-stdout>/<system-reminder>: tag AND
//   content removed (tolerates a missing close tag at a chunk boundary)
// - <command-name>/<command-message>/<command-args>: tags removed, content kept
// Returns null if nothing displayable remains.
function cleanPromptText(text) {
  if (typeof text !== 'string') return null;
  let out = text;
  for (const tag of ['local-command-caveat', 'local-command-stdout', 'system-reminder']) {
    out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?(?:</${tag}>|$)`, 'g'), '');
  }
  for (const tag of ['command-name', 'command-message', 'command-args']) {
    out = out.replace(new RegExp(`</?${tag}>`, 'g'), ' ');
  }
  out = out.replace(/\s+/g, ' ').trim();
  if (!out) return null;
  return out.length > PROMPT_MAX_LEN ? out.slice(0, PROMPT_MAX_LEN) : out;
}

function extractUserText(message) {
  if (!message) return null;
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && block.type === 'text' && typeof block.text === 'string') return block.text;
    }
  }
  return null;
}

async function readOneSession(dirAbsPath, f) {
  const sessionId = f.slice(0, -'.jsonl'.length);
  const filePath = path.join(dirAbsPath, f);
  let mtime = null;
  try {
    const st = await fs.stat(filePath);
    mtime = st.mtimeMs;
  } catch {
    return null; // file vanished, skip
  }

  let firstPrompt = null;
  let messageCount = 0;
  try {
    const text = await readHeadAndTail(filePath);
    const objs = tryParseLines(text);
    let lastPromptFallback = null;
    let userLinesTried = 0;
    const MAX_USER_LINES_TRIED = 10;
    for (const obj of objs) {
      if (obj.type === 'user' || obj.type === 'assistant') messageCount++;
      if (
        firstPrompt === null &&
        obj.type === 'user' &&
        obj.isMeta !== true &&
        obj.message &&
        obj.message.role === 'user' &&
        userLinesTried < MAX_USER_LINES_TRIED
      ) {
        userLinesTried++;
        const t = cleanPromptText(extractUserText(obj.message));
        if (t) firstPrompt = t;
      }
      if (lastPromptFallback === null && obj.type === 'last-prompt' && typeof obj.lastPrompt === 'string') {
        lastPromptFallback = cleanPromptText(obj.lastPrompt);
      }
    }
    if (firstPrompt === null) firstPrompt = lastPromptFallback;
  } catch {
    // leave defaults (null / 0) — a corrupt file shouldn't drop the session
  }

  return { sessionId, mtime, firstPrompt, messageCount };
}

export async function listSessions(cwd) {
  if (!validAbsolutePath(cwd)) {
    const error = new Error('cwd must be an absolute path');
    error.status = 400;
    throw error;
  }
  const dirName = cwdToDirName(cwd);
  const dirAbsPath = path.join(PROJECTS_ROOT, dirName);

  let files;
  try {
    files = (await fs.readdir(dirAbsPath)).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const results = await mapWithConcurrency(files, 32, (f) => readOneSession(dirAbsPath, f));
  const sessions = results.filter((s) => s !== null);

  sessions.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return sessions;
}

// Phase 5b: cross-project "recent sessions" for the sidebar. Reuses
// listProjects (already sorted by lastActivity desc, one JSONL-mtime scan
// per project) + listSessions (per-project session scan) — both already
// bounded-concurrency — rather than inventing a third read path.
//
// Correctness note: a project's `lastActivity` is exactly the max mtime among
// its own session files, so once we've gathered `limit` sessions from the
// most-recently-active projects, no later (lower-lastActivity) project can
// contain anything newer. We still cap how many projects we're willing to
// open session-by-session (`slice`) purely as a defensive bound against a
// pathological number of project dirs — a generous multiple of `limit`.
export async function listRecentSessions(limit = 8) {
  const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 50) : 8;
  const projects = await listProjects();
  const candidates = projects.filter((p) => validAbsolutePath(p.cwd)).slice(0, Math.max(n * 3, 24));

  const perProject = await mapWithConcurrency(candidates, 8, async (p) => {
    const sessions = await listSessions(p.cwd);
    return sessions.map((s) => ({ ...s, cwd: p.cwd }));
  });

  const all = perProject.flat().filter((s) => s.sessionId);
  all.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return all.slice(0, n);
}

function summarizeEvent(obj) {
  // `uuid` is the CLI's per-event id, present both on JSONL rows and on the
  // corresponding live stream-json events (verified against a live spawn).
  // The client uses it to dedup an attach-replay against an already-rendered
  // REST transcript (Phase 4 reload restore).
  if (obj.type === 'user') {
    const text = extractUserText(obj.message);
    return { type: 'user', timestamp: obj.timestamp, uuid: obj.uuid, text };
  }
  if (obj.type === 'assistant') {
    const content = obj.message && obj.message.content;
    let text = null;
    const toolUses = [];
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          text = (text || '') + block.text;
        } else if (block.type === 'tool_use') {
          toolUses.push({ name: block.name, input: block.input });
        }
      }
    }
    return { type: 'assistant', timestamp: obj.timestamp, uuid: obj.uuid, text, toolUses };
  }
  return null;
}

// B3: sessionId is the traversal vector (`../../etc/passwd`). Allow only
// session-id characters, then verify the resolved path stays under the
// projects root as defence in depth. Shared by getTranscript (REST) and
// session-watch.mjs (JSONL tail) so the *same* validation always gates any
// on-disk path derived from client-supplied (cwd, sessionId) — Phase 5b must
// not grow a second, looser copy of this check for the watch feature.
export function resolveTranscriptPath(cwd, sessionId) {
  if (!validAbsolutePath(cwd)) {
    const e = new Error('cwd must be an absolute path');
    e.status = 400;
    throw e;
  }
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9-]+$/.test(sessionId)) {
    const e = new Error('invalid sessionId');
    e.status = 400;
    throw e;
  }
  const dirName = cwdToDirName(cwd);
  const filePath = path.join(PROJECTS_ROOT, dirName, `${sessionId}.jsonl`);
  const resolved = path.resolve(filePath);
  if (resolved !== PROJECTS_ROOT && !resolved.startsWith(PROJECTS_ROOT + path.sep)) {
    const e = new Error('resolved path outside projects root');
    e.status = 400;
    throw e;
  }
  return resolved;
}

export async function getTranscript(cwd, sessionId) {
  const filePath = resolveTranscriptPath(cwd, sessionId);

  let text;
  try {
    const stat = await fs.stat(filePath);
    // Defensive cap: don't read arbitrarily huge files into memory.
    const MAX = 20 * 1024 * 1024;
    if (stat.size > MAX) {
      text = await readHeadAndTail(filePath, MAX, 0);
    } else {
      text = await fs.readFile(filePath, 'utf8');
    }
  } catch {
    return [];
  }

  const events = [];
  for (const obj of tryParseLines(text)) {
    const summarized = summarizeEvent(obj);
    if (summarized) events.push(summarized);
  }
  return events;
}
