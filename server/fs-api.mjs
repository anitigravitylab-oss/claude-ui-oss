// Directory listing (cwd picker) + /api/info (claude --version, defaults).
// Everything here is best-effort: broken symlinks are skipped, not fatal.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let cachedVersion = null;
async function getClaudeVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const { stdout } = await execFileAsync('claude', ['--version']);
    cachedVersion = stdout.trim();
  } catch {
    cachedVersion = 'unknown';
  }
  return cachedVersion;
}

export async function getInfo() {
  const claudeVersion = await getClaudeVersion();
  return {
    claudeVersion,
    cwd: process.env.HOME || os.homedir() || '/',
    models: ['fable', 'opus', 'sonnet'],
    modelsNote: 'any string is accepted (passed through to --model); the list above is a shortcut, not an exhaustive set',
    permissionModes: ['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan'],
  };
}

export async function listFsEntries(pathParam) {
  const home = os.homedir() || '/';
  const target = pathParam && pathParam.length > 0 ? pathParam : home;

  if (typeof target !== 'string' || Buffer.byteLength(target) > 4096 || target.includes('\0') || !path.isAbsolute(target)) {
    const e = new Error('path must be absolute');
    e.status = 400;
    throw e;
  }

  let dirents;
  try {
    dirents = await fs.readdir(target, { withFileTypes: true });
  } catch (err) {
    // B6: map fs errors to appropriate 4xx statuses instead of a bare 500.
    const e = new Error(`cannot read directory: ${err.message}`);
    if (err.code === 'ENOENT') e.status = 404;
    else if (err.code === 'EACCES' || err.code === 'EPERM') e.status = 403;
    else if (err.code === 'ENOTDIR') e.status = 400;
    else e.status = 400;
    throw e;
  }

  const dirs = [];
  const files = [];

  for (const entry of dirents) {
    const full = path.join(target, entry.name);
    let isDir;
    if (entry.isSymbolicLink()) {
      try {
        const st = await fs.stat(full);
        isDir = st.isDirectory();
      } catch {
        // Broken symlink — skip silently rather than fail the whole listing.
        continue;
      }
    } else {
      isDir = entry.isDirectory();
    }
    if (isDir) dirs.push(entry.name);
    else files.push(entry.name);
  }

  dirs.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.localeCompare(b));

  return {
    path: target,
    parent: path.dirname(target) === target ? null : path.dirname(target),
    dirs,
    files,
  };
}
