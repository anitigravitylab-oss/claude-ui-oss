import path from 'node:path';

export const MAX_CHAT_MESSAGE_BYTES = 512 * 1024;
const MAX_PATH_BYTES = 4096;
const MAX_OPTION_BYTES = 256;
const SESSION_ID_RE = /^[A-Za-z0-9-]{1,128}$/;
const ATTACH_ID_RE = /^[A-Fa-f0-9-]{1,64}$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validText(value, maxBytes, { allowEmpty = false, optionValue = false } = {}) {
  if (typeof value !== 'string') return false;
  if (!allowEmpty && value.length === 0) return false;
  if (Buffer.byteLength(value) > maxBytes || /[\0\r\n]/.test(value)) return false;
  return !optionValue || !value.startsWith('-');
}

export function validAbsolutePath(value) {
  return validText(value, MAX_PATH_BYTES) && path.isAbsolute(value);
}

export function validSessionId(value) {
  return typeof value === 'string' && SESSION_ID_RE.test(value);
}

export function validateFirstMessage(msg) {
  if (!isRecord(msg) || typeof msg.type !== 'string') return 'invalid first message';
  if (msg.type === 'attach') return ATTACH_ID_RE.test(msg.attachId || '') ? null : 'invalid attachId';
  if (msg.type === 'watch') {
    return validSessionId(msg.sessionId) && validAbsolutePath(msg.cwd) ? null : 'invalid watch request';
  }
  if (msg.type !== 'start') return 'first message must be start, attach, or watch';
  return validateClientMessage(msg);
}

export function validateClientMessage(msg) {
  if (!isRecord(msg) || typeof msg.type !== 'string') return 'invalid message';

  switch (msg.type) {
    case 'start': {
      if (msg.cwd != null && !validAbsolutePath(msg.cwd)) return 'invalid cwd';
      for (const key of ['model', 'permissionMode', 'effort']) {
        if (msg[key] != null && !validText(msg[key], MAX_OPTION_BYTES, { optionValue: true })) {
          return `invalid ${key}`;
        }
      }
      if (msg.resume != null && !validSessionId(msg.resume)) return 'invalid resume id';
      if (msg.forkSession != null && typeof msg.forkSession !== 'boolean') return 'invalid forkSession';
      if (msg.addDir != null) {
        if (!Array.isArray(msg.addDir) || msg.addDir.length > 32 || !msg.addDir.every(validAbsolutePath)) {
          return 'invalid addDir';
        }
      }
      return null;
    }
    case 'user_message':
      return typeof msg.text === 'string' && Buffer.byteLength(msg.text) <= MAX_CHAT_MESSAGE_BYTES
        ? null
        : 'invalid or oversized user message';
    case 'permission_response':
      if (!validText(msg.requestId, 256) || !['allow', 'deny'].includes(msg.behavior)) {
        return 'invalid permission response';
      }
      return null;
    case 'interrupt':
    case 'stop':
      return null;
    case 'set_permission_mode':
      return validText(msg.mode, MAX_OPTION_BYTES, { optionValue: true }) ? null : 'invalid permission mode';
    case 'set_model':
      return validText(msg.model, MAX_OPTION_BYTES, { optionValue: true }) ? null : 'invalid model';
    case 'control':
      return validText(msg.subtype, 128, { optionValue: true }) && (msg.payload == null || isRecord(msg.payload))
        ? null
        : 'invalid control request';
    default:
      return 'unsupported message type';
  }
}
