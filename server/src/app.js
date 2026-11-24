// HTTP routes for the Hope backend.

import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { corsHeaders, createRateLimiter, HttpError, isOriginAllowed, readJson, sendJson } from './http.js';
import { createLlm, LlmError } from './llm.js';
import { cleanPlanInput } from './planInput.js';
import { createPlanner } from './planner.js';
import { cleanTexts, createSimplifier } from './simplify.js';

function tokenMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp(config, { fetchImpl = fetch, log = console } = {}) {
  const llm = createLlm(config, fetchImpl);
  const plan = createPlanner({ llm, model: config.plannerModel });
  const simplify = createSimplifier({ llm, model: config.simplifyModel });
  const allow = createRateLimiter(config.rateLimitPerMinute);

  function requireClient(req) {
    if (config.clientToken && !tokenMatches(req.headers['x-hope-token'], config.clientToken)) {
      throw new HttpError(401, 'bad_token');
    }
  }

  const routes = {
    'GET /health': async () => ({ status: 200, body: { ok: true, provider: config.provider } }),

    'POST /api/plan': async (req) => {
      requireClient(req);
      const input = cleanPlanInput(await readJson(req));
      const decision = await plan(input);
      return { status: 200, body: { decision } };
    },

    'POST /api/simplify': async (req) => {
      requireClient(req);
      const texts = cleanTexts(await readJson(req));
      if (!texts) throw new HttpError(400, 'invalid_texts');
      return { status: 200, body: { texts: await simplify(texts) } };
    },
  };

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url, 'http://localhost');
    const cors = isOriginAllowed(origin, config.allowedOrigins) ? corsHeaders(origin) : null;

    try {
      if (!cors) throw new HttpError(403, 'origin_not_allowed');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      if (url.pathname.startsWith('/api/') && !allow(req.socket.remoteAddress || 'unknown')) {
        throw new HttpError(429, 'rate_limited');
      }
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) throw new HttpError(404, 'not_found');
      const result = await handler(req, url);
      sendJson(res, result.status, result.body, cors);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.code }, cors || {});
      } else if (err instanceof LlmError) {
        log.warn(`[hope] model error on ${url.pathname}: ${err.message}`);
        sendJson(res, 502, { error: 'model_failed' }, cors || {});
      } else {
        log.error(`[hope] unexpected error on ${url.pathname}:`, err);
        sendJson(res, 500, { error: 'internal' }, cors || {});
      }
    }
  });
}
