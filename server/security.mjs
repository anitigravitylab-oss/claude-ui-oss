// Shared validation and HTTP/WebSocket security helpers.
import { timingSafeEqual } from 'node:crypto';

const MAX_TOKEN_BYTES = 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function fail(message) {
  const error = new Error(message);
  error.code = 'ERR_INVALID_ARGUMENT';
  return error;
}

export function parseArgs(argv) {
  const out = { port: 7681, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' || arg === '--host') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw fail(`${arg} requires a value`);
      out[arg.slice(2)] = value;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else {
      throw fail(`unknown option: ${arg}`);
    }
  }

  const port = Number(out.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw fail('--port must be an integer between 1 and 65535');
  }
  if (typeof out.host !== 'string' || out.host.length > 255 || /[\0\r\n]/.test(out.host)) {
    throw fail('--host must be a valid hostname or IP address');
  }
  out.port = port;
  return out;
}

export function validateConfiguredToken(token) {
  if (token == null || token === '') return null;
  if (typeof token !== 'string') throw fail('CLAUDE_UI_TOKEN must be a string');
  const size = Buffer.byteLength(token);
  if (size < 16) throw fail('CLAUDE_UI_TOKEN must be at least 16 bytes');
  if (
    size > MAX_TOKEN_BYTES ||
    /\s|[\u0000-\u001f\u007f]/u.test(token) ||
    token.startsWith('change-me-')
  ) {
    throw fail(
      `CLAUDE_UI_TOKEN must be at most ${MAX_TOKEN_BYTES} bytes, contain no whitespace, and not use the example value`
    );
  }
  return token;
}

export function createTokenMatcher(secret) {
  const expected = Buffer.from(secret);
  return (candidate) => {
    if (typeof candidate !== 'string' || Buffer.byteLength(candidate) > MAX_TOKEN_BYTES) return false;
    const actual = Buffer.from(candidate);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
}

export function extractBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(headerValue);
  return match ? match[1] : null;
}

export function decodeWebSocketToken(protocolHeader) {
  if (typeof protocolHeader !== 'string') return null;
  for (const item of protocolHeader.split(',')) {
    const protocol = item.trim();
    const prefix = 'claude-ui.auth.';
    if (!protocol.startsWith(prefix)) continue;
    const encoded = protocol.slice(prefix.length);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    try {
      const token = Buffer.from(encoded, 'base64url').toString('utf8');
      if (Buffer.from(token).toString('base64url') !== encoded) return null;
      return token;
    } catch {
      return null;
    }
  }
  return null;
}

export function isAllowedWebSocketOrigin(origin, hostHeader, allowedOrigins = '') {
  // Non-browser clients commonly omit Origin. They still need the bearer-equivalent
  // WebSocket token, so accepting an absent Origin does not weaken authentication.
  if (!origin) return true;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const configured = allowedOrigins.split(',').flatMap((value) => {
    try {
      return [new URL(value.trim()).origin];
    } catch {
      return [];
    }
  });
  if (configured.includes(parsed.origin)) return true;
  if (typeof hostHeader !== 'string') return false;
  try {
    return parsed.host === new URL(`http://${hostHeader}`).host;
  } catch {
    return false;
  }
}

export function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host).toLowerCase());
}

export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "script-src 'self'",
    // The terminal/UI positions and sizes elements through CSSOM. Script is
    // still strict; inline style permission is required for that dynamic UI.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});
