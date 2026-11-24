import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../../server/src/app.js';
import { loadConfig } from '../../server/src/config.js';
import { HANDOFF_TTL_MS, safePageUrl } from '../../server/src/handoff.js';
import { postJson } from './helpers.js';

describe('family help links', () => {
  let baseUrl;
  let server;
  let clock = 1_000_000;

  before(async () => {
    const config = loadConfig({ HOPE_LLM_PROVIDER: 'mock', HOPE_PUBLIC_URL: 'https://hope.example.org/' });
    server = createApp(config, { log: { warn() {}, error() {} }, now: () => clock });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => server.close(r)));

  const body = {
    goal: 'Appointment with a skin doctor',
    pageUrl: 'https://clinic.example/book?session=SECRET123#step3',
    pageTitle: 'Book <b>now</b>',
    current: 'Which day works for you?',
    note: 'Can you call me? <script>alert(1)</script>',
    progress: { step: 3, total: 6 },
    log: ['Turned down optional cookies', 'Chose Dermatology'],
  };

  async function create() {
    const res = await postJson(baseUrl, '/api/handoff', body);
    assert.equal(res.status, 201);
    return res.json();
  }

  it('creates a link on the public URL', async () => {
    const { id, link } = await create();
    assert.match(id, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(link, `https://hope.example.org/h/${id}`);
  });

  it('shows a page without query strings and with everything escaped', async () => {
    const { id } = await create();
    const res = await fetch(`${baseUrl}/h/${id}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    const html = await res.text();
    assert.match(html, /Appointment with a skin doctor/);
    assert.match(html, /Step 3 of about 6/);
    assert.match(html, /href="https:\/\/clinic\.example\/book"/);
    assert.doesNotMatch(html, /SECRET123|step3/);
    assert.doesNotMatch(html, /<script>|<b>now/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /Chose Dermatology/);
  });

  it('expires after a day', async () => {
    const { id } = await create();
    clock += HANDOFF_TTL_MS + 1;
    const res = await fetch(`${baseUrl}/h/${id}`);
    assert.equal(res.status, 404);
    assert.match(await res.text(), /expired/);
  });

  it('returns the expired page for unknown ids', async () => {
    assert.equal((await fetch(`${baseUrl}/h/AAAAAAAAAAAAAAAAAAAAAA`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/h/../../etc`)).status, 404);
  });

  it('needs a goal and rejects web page origins', async () => {
    assert.equal((await postJson(baseUrl, '/api/handoff', { note: 'hi' })).status, 400);
    assert.equal((await postJson(baseUrl, '/api/handoff', body, { origin: 'https://evil.example' })).status, 403);
  });
});

describe('safePageUrl', () => {
  it('keeps only origin and path of http(s) URLs', () => {
    assert.equal(safePageUrl('https://a.example/x/y?q=1#h'), 'https://a.example/x/y');
    assert.equal(safePageUrl('javascript:alert(1)'), '');
    assert.equal(safePageUrl('not a url'), '');
  });
});
