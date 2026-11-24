import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startServer } from './helpers.js';

describe('demo site route', () => {
  let srv;
  before(async () => {
    srv = await startServer();
  });
  after(() => srv.close());

  it('serves the practice pages', async () => {
    const res = await fetch(`${srv.baseUrl}/demo/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /CityCare/);
    const js = await fetch(`${srv.baseUrl}/demo/book.js`);
    assert.match(js.headers.get('content-type'), /javascript/);
  });

  it('redirects /demo to /demo/', async () => {
    const res = await fetch(`${srv.baseUrl}/demo`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/demo/');
  });

  it('does not serve files outside the demo folder', async () => {
    for (const p of ['/demo/..%2Fpackage.json', '/demo/%2e%2e/server/src/config.js', '/demo/..%5C.env.example', '/demo/%E0%A4%A']) {
      const res = await fetch(`${srv.baseUrl}${p}`);
      assert.equal(res.status, 404, p);
    }
  });

  it('can be turned off', async () => {
    const off = await startServer({ HOPE_SERVE_DEMO: 'false' });
    try {
      assert.equal((await fetch(`${off.baseUrl}/demo/`)).status, 404);
    } finally {
      await off.close();
    }
  });
});
