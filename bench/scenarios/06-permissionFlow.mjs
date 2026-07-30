// permissionFlow: with permissionMode "manual", a write command (touch) must
// trigger a permission_request; allow -> file created, deny -> file NOT
// created. Read-only commands (echo etc.) are auto-approved by the CLI's own
// built-in rules and would never surface a permission_request — this is a
// documented gotcha (see .ai/lessons.md), hence "touch" specifically.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openChat, startAndAsk, ask, isPermissionRequest, isResultEvent } from '../lib/chat.mjs';
import { randToken } from '../lib/util.mjs';

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export default async function permissionFlow(ctx) {
  const errors = [];
  const allowPath = path.join(os.tmpdir(), `bench-allow-${randToken(8)}`);
  const denyPath = path.join(os.tmpdir(), `bench-deny-${randToken(8)}`);
  const conn = await openChat(ctx);
  try {
    // --- allow branch ---
    conn.send({ type: 'start', cwd: ctx.cwd, model: ctx.model, permissionMode: 'manual' });
    const permReqWaiter1 = conn.waitFor(isPermissionRequest, ctx.defaultTimeout);
    conn.send({ type: 'user_message', text: `Run this exact shell command: touch ${allowPath}` });
    let req1;
    try {
      req1 = await permReqWaiter1;
    } catch (err) {
      errors.push(`no permission_request for allow branch: ${err.message}`);
    }
    if (req1) {
      const resultWaiter1 = conn.waitFor(isResultEvent, ctx.defaultTimeout);
      conn.send({ type: 'permission_response', requestId: req1.requestId, behavior: 'allow' });
      const r1 = await resultWaiter1.catch((err) => ({ error: err.message }));
      if (r1.error) errors.push(`allow branch never reached result: ${r1.error}`);
      else if (ctx.recordLatency) ctx.recordLatency(r1.event);
    }
    await new Promise((r) => setTimeout(r, 300)); // let the fs write land
    const allowCreated = await fileExists(allowPath);
    if (!allowCreated) errors.push(`allow: expected ${allowPath} to exist, it does not`);

    // --- deny branch (same connection, fresh turn) ---
    const permReqWaiter2 = conn.waitFor(isPermissionRequest, ctx.defaultTimeout);
    conn.send({ type: 'user_message', text: `Run this exact shell command: touch ${denyPath}` });
    let req2;
    try {
      req2 = await permReqWaiter2;
    } catch (err) {
      errors.push(`no permission_request for deny branch: ${err.message}`);
    }
    if (req2) {
      const resultWaiter2 = conn.waitFor(isResultEvent, ctx.defaultTimeout);
      conn.send({ type: 'permission_response', requestId: req2.requestId, behavior: 'deny', message: 'bench denies this' });
      const r2 = await resultWaiter2.catch((err) => ({ error: err.message }));
      if (r2.error) errors.push(`deny branch never reached result: ${r2.error}`);
      else if (ctx.recordLatency) ctx.recordLatency(r2.event);
    }
    await new Promise((r) => setTimeout(r, 300));
    const denyCreated = await fileExists(denyPath);
    if (denyCreated) errors.push(`deny: expected ${denyPath} to NOT exist, but it was created`);

    return {
      pass: errors.length === 0,
      errors,
      detail: { allowCreated, denyCreated },
    };
  } finally {
    conn.close();
    await fs.rm(allowPath, { force: true }).catch(() => {});
    await fs.rm(denyPath, { force: true }).catch(() => {});
  }
}
