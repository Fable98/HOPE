import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApiClient } from '../../extension/lib/api.js';
import { cleanSettings, DEFAULT_SETTINGS } from '../../extension/lib/settings.js';

describe('cleanSettings', () => {
  it('fills defaults and rejects bad values', () => {
    assert.deepEqual(cleanSettings({}), DEFAULT_SETTINGS);
    const s = cleanSettings({ serverUrl: 'javascript:alert(1)', profile: 'loud', readAloud: 'yes' });
    assert.deepEqual(s, DEFAULT_SETTINGS);
  });

  it('keeps valid values and trims the server address', () => {
    const s = cleanSettings({ serverUrl: ' https://hope.example.org/base/ ', accessCode: ' abc ', profile: 'reading', readAloud: true });
    assert.deepEqual(s, { serverUrl: 'https://hope.example.org/base', accessCode: 'abc', profile: 'reading', readAloud: true });
  });
});

describe('api client', () => {
  const settings = async () => ({ serverUrl: 'http://srv', accessCode: 'code1' });

  it('posts to the server with the access code', async () => {
    const calls = [];
    const fakeFetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ decision: { type: 'done' } }), { status: 200 });
    };
    const api = createApiClient(settings, fakeFetch);
    assert.deepEqual(await api.plan({ goal: 'x' }), { type: 'done' });
    assert.equal(calls[0].url, 'http://srv/api/plan');
    assert.equal(calls[0].init.headers['x-hope-token'], 'code1');
  });

  it('turns HTTP errors into plain messages', async () => {
    const api = createApiClient(settings, async () => new Response('{}', { status: 401 }));
    await assert.rejects(api.plan({}), (err) => err.userMessage === 'The access code in Settings is not right.');
  });

  it('explains when the server cannot be reached', async () => {
    const api = createApiClient(settings, async () => { throw new TypeError('fetch failed'); });
    await assert.rejects(api.simplify(['a']), (err) => /could not reach the Hope helper/.test(err.userMessage));
  });
});
