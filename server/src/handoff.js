// Family help links: the person asks someone they trust for a hand. Hope makes
// a short-lived link with the goal, the website and what has happened so far.
// Stored in memory only; links expire after a day.

import { randomBytes } from 'node:crypto';
import { HttpError } from './http.js';

export const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_LINKS = 1000;
const MAX_LOG = 15;

function str(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

// Keep only origin and path. Query strings and fragments often hold session
// tokens or personal details.
export function safePageUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return `${url.origin}${url.pathname}`.slice(0, 300);
  } catch {
    return '';
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function cleanHandoff(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'invalid_body');
  const goal = str(body.goal, 300);
  if (!goal) throw new HttpError(400, 'missing_goal');
  const step = Number.isInteger(body.progress?.step) ? Math.min(Math.max(body.progress.step, 1), 50) : null;
  const total = Number.isInteger(body.progress?.total) ? Math.min(Math.max(body.progress.total, 1), 50) : null;
  return {
    goal,
    pageUrl: safePageUrl(body.pageUrl),
    pageTitle: str(body.pageTitle, 150),
    current: str(body.current, 300),
    note: str(body.note, 500),
    progress: step && total ? { step, total: Math.max(step, total) } : null,
    log: (Array.isArray(body.log) ? body.log : []).slice(-MAX_LOG).map((l) => str(l, 200)).filter(Boolean),
  };
}

export function createHandoffStore({ now = () => Date.now() } = {}) {
  const links = new Map();

  function prune() {
    const t = now();
    for (const [id, entry] of links) {
      if (entry.expiresAt <= t) links.delete(id);
    }
    while (links.size >= MAX_LINKS) links.delete(links.keys().next().value);
  }

  return {
    create(data) {
      prune();
      const id = randomBytes(16).toString('base64url');
      links.set(id, { ...data, createdAt: now(), expiresAt: now() + HANDOFF_TTL_MS });
      return id;
    },
    get(id) {
      const entry = links.get(id);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        links.delete(id);
        return null;
      }
      return entry;
    },
  };
}

const PAGE_STYLE = `
  body { font: 20px/1.6 system-ui, "Segoe UI", sans-serif; margin: 0; background: #f4f6fb; color: #1d1d1f; }
  main { max-width: 620px; margin: 0 auto; padding: 28px 20px; }
  h1 { font-size: 1.6em; line-height: 1.25; }
  .box { background: #fff; border: 1px solid #d6dae4; border-radius: 16px; padding: 18px 20px; margin: 16px 0; }
  .label { color: #55555c; font-size: 0.85em; margin: 0; }
  .value { margin: 2px 0 0; font-weight: 600; }
  ol { color: #55555c; padding-left: 1.3em; }
  a.button { display: inline-block; background: #1f5fd1; color: #fff; padding: 12px 20px; border-radius: 12px; text-decoration: none; font-weight: 700; }
  .muted { color: #55555c; font-size: 0.85em; }`;

export function renderHandoffPage(entry) {
  const rows = [
    ['They want to', entry.goal],
    entry.progress && ['How far they got', `Step ${entry.progress.step} of about ${entry.progress.total}`],
    entry.current && ['Where they are stuck', entry.current],
    entry.note && ['Their message', entry.note],
  ].filter(Boolean);

  const site = entry.pageUrl
    ? `<div class="box"><p class="label">The website</p><p class="value">${escapeHtml(entry.pageTitle || entry.pageUrl)}</p>
       <p><a class="button" href="${escapeHtml(entry.pageUrl)}" rel="noopener noreferrer">Open the website</a></p>
       <p class="muted">You may need to sign in or start the form again on your own device.</p></div>`
    : '';

  const log = entry.log.length
    ? `<div class="box"><p class="label">What Hope already did for them</p><ol>${entry.log.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ol></div>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Someone would like your help</title><style>${PAGE_STYLE}</style></head>
<body><main>
<h1>Someone would like your help</h1>
<p>They are using Hope, a helper for busy websites, and asked you for a hand. Please call or message them.</p>
<div class="box">${rows.map(([k, v]) => `<p class="label">${escapeHtml(k)}</p><p class="value">${escapeHtml(v)}</p>`).join('')}</div>
${site}${log}
<p class="muted">This link stops working 24 hours after it was made. Hope never puts passwords or card numbers in it.</p>
</main></body></html>`;
}

export function renderExpiredPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Link expired</title><style>${PAGE_STYLE}</style></head>
<body><main><h1>This help link has expired</h1><p>Help links work for 24 hours. Ask for a new one.</p></main></body></html>`;
}
