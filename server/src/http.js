// Small HTTP helpers: JSON bodies with a size limit, JSON and HTML responses,
// CORS for the extension, and a per-IP rate limit.

export const MAX_BODY_BYTES = 256 * 1024;

export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function readJson(req, limit = MAX_BODY_BYTES) {
  const type = req.headers['content-type'] || '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'expected_json');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'body_too_large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

// Pages we render contain no scripts, so lock them down completely.
export function sendHtml(res, status, html) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(html);
}

// Allowed when the origin is on the configured list, or, with no list,
// when it is any Chrome extension. Requests without an Origin header
// (curl, server-to-server) are allowed through; the client token guards those.
export function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins.length > 0) return allowedOrigins.includes(origin);
  return origin.startsWith('chrome-extension://');
}

export function corsHeaders(origin) {
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-hope-token',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

// Fixed one-minute windows per key. Good enough for a single small server.
export function createRateLimiter(limitPerMinute, now = () => Date.now()) {
  const windows = new Map();
  return function allow(key) {
    const t = now();
    const current = windows.get(key);
    if (!current || t - current.start >= 60_000) {
      windows.set(key, { start: t, count: 1 });
      if (windows.size > 10_000) {
        for (const [k, w] of windows) {
          if (t - w.start >= 60_000) windows.delete(k);
        }
      }
      return true;
    }
    current.count += 1;
    return current.count <= limitPerMinute;
  };
}
