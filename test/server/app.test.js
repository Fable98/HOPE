import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { EXTENSION_ORIGIN, postJson, samplePage, startServer } from './helpers.js';

describe('backend routes', () => {
  let srv;
  before(async () => {
    srv = await startServer();
  });
  after(() => srv.close());

  it('reports health and provider', async () => {
    const res = await fetch(`${srv.baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, provider: 'mock' });
  });

  it('returns a decision from /api/plan', async () => {
    const res = await postJson(srv.baseUrl, '/api/plan', {
      goal: 'Book a dentist',
      page: samplePage([{ id: 'h1', role: 'textbox', label: 'Your name', value: '' }]),
      history: [],
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), EXTENSION_ORIGIN);
    const { decision } = await res.json();
    assert.equal(decision.type, 'ask');
    assert.equal(decision.input.targetId, 'h1');
  });

  it('rejects a plan request without a goal', async () => {
    const res = await postJson(srv.baseUrl, '/api/plan', { page: samplePage([]) });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'missing_goal' });
  });

  it('rejects invalid JSON and non-JSON bodies', async () => {
    assert.equal((await postJson(srv.baseUrl, '/api/plan', '{nope')).status, 400);
    const res = await fetch(`${srv.baseUrl}/api/plan`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' });
    assert.equal(res.status, 415);
  });

  it('rejects bodies over the size limit', async () => {
    const res = await postJson(srv.baseUrl, '/api/plan', { goal: 'x', pad: 'a'.repeat(300 * 1024) });
    assert.equal(res.status, 413);
  });

  it('rejects web page origins', async () => {
    const res = await postJson(srv.baseUrl, '/api/plan', {}, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('answers CORS preflight for the extension', async () => {
    const res = await fetch(`${srv.baseUrl}/api/plan`, { method: 'OPTIONS', headers: { origin: EXTENSION_ORIGIN } });
    assert.equal(res.status, 204);
    assert.match(res.headers.get('access-control-allow-headers'), /x-hope-token/);
  });

  it('simplifies texts with the jargon list in mock mode', async () => {
    const res = await postJson(srv.baseUrl, '/api/simplify', { texts: ['Nominee details as per KYC records', 'Kindly enter OTP', 'OK'] });
    assert.equal(res.status, 200);
    const { texts } = await res.json();
    assert.equal(texts.length, 3);
    assert.equal(texts[0], 'person who gets the money details as on your ID');
    assert.equal(texts[1], 'please enter one-time code');
    assert.equal(texts[2], 'OK');
  });

  it('rejects bad simplify input', async () => {
    assert.equal((await postJson(srv.baseUrl, '/api/simplify', { texts: [] })).status, 400);
    assert.equal((await postJson(srv.baseUrl, '/api/simplify', { texts: [1] })).status, 400);
  });

  it('returns 404 for unknown routes', async () => {
    assert.equal((await fetch(`${srv.baseUrl}/nope`)).status, 404);
  });
});

describe('client token', () => {
  let srv;
  before(async () => {
    srv = await startServer({ HOPE_CLIENT_TOKEN: 'secret-code' });
  });
  after(() => srv.close());

  const body = { goal: 'x', page: samplePage([]) };

  it('rejects requests without the token', async () => {
    assert.equal((await postJson(srv.baseUrl, '/api/plan', body)).status, 401);
    assert.equal((await postJson(srv.baseUrl, '/api/plan', body, { 'x-hope-token': 'wrong' })).status, 401);
  });

  it('accepts requests with the token', async () => {
    assert.equal((await postJson(srv.baseUrl, '/api/plan', body, { 'x-hope-token': 'secret-code' })).status, 200);
  });
});

describe('rate limit', () => {
  let srv;
  before(async () => {
    srv = await startServer({ HOPE_RATE_LIMIT_PER_MINUTE: '2' });
  });
  after(() => srv.close());

  it('returns 429 after the limit', async () => {
    const body = { texts: ['hello there'] };
    assert.equal((await postJson(srv.baseUrl, '/api/simplify', body)).status, 200);
    assert.equal((await postJson(srv.baseUrl, '/api/simplify', body)).status, 200);
    assert.equal((await postJson(srv.baseUrl, '/api/simplify', body)).status, 429);
  });
});

describe('model provider', () => {
  let srv;
  let calls;
  before(async () => {
    calls = [];
    const fakeFetch = async (url, init) => {
      const req = JSON.parse(init.body);
      calls.push({ url, req, headers: init.headers });
      const isPlanner = req.system.startsWith('You are Hope');
      const text = isPlanner
        ? 'Sure! ```json\n{"type":"done","message":"All finished."}\n```'
        : JSON.stringify({ texts: JSON.parse(req.messages[0].content).texts.map((t) => `plain: ${t}`) });
      return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
    };
    srv = await startServer({ HOPE_LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key' }, { fetchImpl: fakeFetch });
  });
  after(() => srv.close());

  it('calls Anthropic with the planner model and parses fenced JSON', async () => {
    const res = await postJson(srv.baseUrl, '/api/plan', { goal: 'x', page: samplePage([]) });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).decision, { type: 'done', message: 'All finished.' });
    const call = calls.at(-1);
    assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(call.req.model, 'claude-sonnet-5-5');
    assert.equal(call.headers['x-api-key'], 'test-key');
    assert.match(call.req.messages[0].content, /untrusted website content/);
  });

  it('uses the cheaper model for simplify and caches results', async () => {
    const first = await (await postJson(srv.baseUrl, '/api/simplify', { texts: ['Proceed to checkout'] })).json();
    assert.deepEqual(first.texts, ['plain: Proceed to checkout']);
    assert.equal(calls.at(-1).req.model, 'claude-haiku-5-5');
    const count = calls.length;
    await postJson(srv.baseUrl, '/api/simplify', { texts: ['Proceed to checkout'] });
    assert.equal(calls.length, count, 'second call should come from the cache');
  });
});

describe('Amazon Bedrock provider', () => {
  let srv;
  let calls;
  before(async () => {
    calls = [];
    const fakeFetch = async (url, init) => {
      calls.push({ url, req: JSON.parse(init.body), headers: init.headers });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"type":"done","message":"ok"}' }] }), { status: 200 });
    };
    srv = await startServer({ HOPE_LLM_PROVIDER: '', AWS_BEARER_TOKEN_BEDROCK: 'bedrock-token', AWS_REGION: 'ap-south-1' }, { fetchImpl: fakeFetch });
  });
  after(() => srv.close());

  it('calls the bedrock-mantle Messages API with the token and prefixed model', async () => {
    assert.equal((await (await fetch(`${srv.baseUrl}/health`)).json()).provider, 'bedrock');
    const res = await postJson(srv.baseUrl, '/api/plan', { goal: 'x', page: samplePage([]) });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).decision, { type: 'done', message: 'ok' });
    const call = calls.at(-1);
    assert.equal(call.url, 'https://bedrock-mantle.ap-south-1.api.aws/anthropic/v1/messages');
    assert.equal(call.headers['x-api-key'], 'bedrock-token');
    assert.equal(call.req.model, 'anthropic.claude-sonnet-5-5');
  });
});

describe('model failures', () => {
  let srv;
  before(async () => {
    const failingFetch = async () => new Response('{"error":"overloaded"}', { status: 529 });
    srv = await startServer({ HOPE_LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }, { fetchImpl: failingFetch });
  });
  after(() => srv.close());

  it('returns 502 when the planner model fails', async () => {
    const res = await postJson(srv.baseUrl, '/api/plan', { goal: 'x', page: samplePage([]) });
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'model_failed' });
  });

  it('falls back to the jargon list when the simplify model fails', async () => {
    const res = await postJson(srv.baseUrl, '/api/simplify', { texts: ['Enter OTP'] });
    assert.deepEqual((await res.json()).texts, ['Enter one-time code']);
  });
});
