import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAgent } from '../../extension/lib/agent.js';

const PAGE = {
  url: 'https://clinic.example/book',
  title: 'Book',
  headings: [],
  text: '',
  elements: [
    { id: 'h1', role: 'select', label: 'Department', options: [{ value: 'derm', label: 'Dermatology' }] },
    { id: 'h2', role: 'radio', label: 'Tuesday', group: 'Day' },
    { id: 'h3', role: 'radio', label: 'Wednesday', group: 'Day' },
    { id: 'h4', role: 'textbox', label: 'Your name' },
    { id: 'h5', role: 'textbox', type: 'password', label: 'Password', sensitive: true },
    { id: 'h6', role: 'button', label: 'Book appointment', submits: true },
    { id: 'h7', role: 'button', label: 'Next' },
  ],
};

// Builds an agent with fake page, api and store. `decisions` are returned by
// plan() in order; a function entry is called with the request.
function setup(decisions, { simplify, stored = null, act, clutter = [] } = {}) {
  const calls = { act: [], plan: [], highlight: [], clear: 0, simplify: [] };
  const saved = { task: stored };
  const page = {
    snapshot: async () => structuredClone(PAGE),
    act: async (tabId, action) => {
      calls.act.push(action);
      return act ? act(action) : { ok: true, verified: true };
    },
    highlight: async (tabId, id) => calls.highlight.push(id),
    clearHighlight: async () => calls.clear++,
    dismissClutter: async () => clutter.splice(0),
  };
  const api = {
    plan: async (req) => {
      calls.plan.push(structuredClone(req));
      const next = decisions.shift();
      if (next === undefined) return { type: 'done', message: 'Nothing left.' };
      if (typeof next === 'function') return next(req);
      return next;
    },
    simplify: simplify || (async (texts) => {
      calls.simplify.push(texts);
      return texts;
    }),
  };
  const store = { load: async () => saved.task, save: async (t) => { saved.task = structuredClone(t); } };
  const agent = createAgent({ page, api, store, now: () => 1_700_000_000_000 });
  return { agent, calls, saved };
}

async function settle(agent, statuses = ['asking', 'confirming', 'done', 'stuck', 'declined', 'stopped', 'paused']) {
  for (let i = 0; i < 500; i++) {
    await new Promise((r) => setImmediate(r));
    const v = agent.view();
    if (v && statuses.includes(v.status)) return v;
  }
  throw new Error(`agent did not settle, status ${agent.view()?.status}`);
}

const click = (targetId) => ({ kind: 'click', targetId });

describe('agent loop', () => {
  it('acts silently, asks, confirms and finishes', async () => {
    const { agent, calls } = setup([
      { type: 'act', action: { kind: 'select', targetId: 'h1', value: 'derm' }, log: 'Chose Dermatology because you asked for a skin doctor', progress: { step: 1, total: 4 } },
      { type: 'ask', question: 'Which day works for you?', options: [{ label: 'Tuesday', action: click('h2') }, { label: 'Wednesday', action: click('h3') }], progress: { step: 2, total: 4 } },
      { type: 'confirm', action: click('h6'), summary: 'You are booking Dr Rao on Tuesday at 10:30.', progress: { step: 3, total: 4 } },
      { type: 'done', message: 'Booked for Tuesday.', progress: { step: 4, total: 4 } },
    ]);

    await agent.start(7, 'Appointment with a skin doctor');
    let view = await settle(agent);
    assert.equal(view.status, 'asking');
    assert.equal(view.card.type, 'choice');
    assert.equal(view.card.question, 'Which day works for you?');
    assert.deepEqual(view.card.options, [{ label: 'Tuesday' }, { label: 'Wednesday' }]);
    assert.deepEqual(view.progress, { step: 2, total: 4 });
    assert.deepEqual(calls.act, [{ kind: 'select', targetId: 'h1', value: 'derm' }]);

    await agent.answer({ choice: 1 });
    view = await settle(agent);
    assert.equal(view.status, 'confirming');
    assert.equal(view.card.summary, 'You are booking Dr Rao on Tuesday at 10:30.');
    assert.deepEqual(calls.act.at(-1), click('h3'));
    assert.match(calls.plan.at(-1).history.map((h) => h.summary).join('\n'), /The person chose "Wednesday"/);

    await agent.answer({ confirm: true });
    view = await settle(agent);
    assert.equal(view.status, 'done');
    assert.equal(view.card.message, 'Booked for Tuesday.');
    assert.deepEqual(calls.act.at(-1), click('h6'));
    assert.deepEqual(view.log.map((l) => l.text), [
      'Chose Dermatology because you asked for a skin doctor',
      'Pressed "Wednesday" (you chose "Wednesday")',
      'Pressed "Book appointment" after you said yes',
      'Finished',
    ]);
  });

  it('turns a silent payment click into a confirmation and respects "no"', async () => {
    const { agent, calls } = setup([{ type: 'act', action: click('h6'), log: 'Booked' }]);
    await agent.start(1, 'book');
    let view = await settle(agent);
    assert.equal(view.status, 'confirming');
    assert.match(view.card.summary, /You are about to press "Book appointment" on clinic\.example/);
    assert.equal(calls.act.length, 0, 'nothing irreversible happens before the user says yes');

    await agent.answer({ confirm: false });
    view = await settle(agent);
    assert.equal(view.status, 'declined');
    assert.equal(calls.act.length, 0);
  });

  it('ignores an answer meant for an older card', async () => {
    const { agent, calls } = setup([
      { type: 'ask', question: 'Which one?', options: [{ label: 'Tuesday', action: click('h2') }] },
    ]);
    await agent.start(1, 'x');
    const view = await settle(agent);
    await agent.answer({ choice: 0, seq: view.card.seq - 1 });
    assert.equal(agent.view().status, 'asking');
    assert.equal(calls.act.length, 0);
    await agent.answer({ choice: 0, seq: view.card.seq });
    await settle(agent, ['done']);
    assert.deepEqual(calls.act, [click('h2')]);
  });

  it('asks again before an option that leads to an irreversible click', async () => {
    const { agent, calls } = setup([
      { type: 'ask', question: 'Ready?', options: [{ label: 'Yes, book it', action: click('h6') }, { label: 'Not yet', action: click('h7') }] },
    ]);
    await agent.start(1, 'book');
    await settle(agent);
    await agent.answer({ choice: 0 });
    const view = await settle(agent);
    assert.equal(view.status, 'confirming');
    assert.equal(calls.act.length, 0);
  });

  it('types the answer from an input card', async () => {
    const { agent, calls } = setup([{ type: 'ask', question: 'What is your name?', input: { targetId: 'h4', kind: 'text' } }]);
    await agent.start(1, 'book');
    const view = await settle(agent);
    assert.equal(view.card.type, 'input');
    await agent.answer({ text: '  Asha Rao ' });
    await settle(agent, ['done']);
    assert.deepEqual(calls.act, [{ kind: 'type', targetId: 'h4', value: 'Asha Rao' }]);
    assert.doesNotMatch(JSON.stringify(calls.plan.at(-1).history), /Asha/);
  });

  it('never types into a password field and asks the user to do it', async () => {
    const { agent, calls } = setup([{ type: 'act', action: { kind: 'type', targetId: 'h5', value: 'hunter2' } }]);
    await agent.start(1, 'log in');
    let view = await settle(agent);
    assert.equal(view.card.type, 'manual');
    assert.deepEqual(calls.highlight, ['h5']);
    assert.equal(calls.act.length, 0);

    await agent.answer({ manualDone: true });
    view = await settle(agent, ['done']);
    assert.match(calls.plan.at(-1).history.at(-1).summary, /filled in "Password" themselves/);
    assert.ok(view.log.some((l) => l.text === 'You filled in "Password" yourself'));
  });

  it('retries after an invalid decision, then gives up', async () => {
    const { agent, calls } = setup([
      { type: 'act', action: click('h99') },
      { type: 'act', action: click('h7'), log: 'Pressed Next' },
    ]);
    await agent.start(1, 'x');
    await settle(agent, ['done']);
    assert.match(calls.plan[1].history[0].summary, /could not be used: target h99/);
    assert.deepEqual(calls.act, [click('h7')]);

    const bad = setup([{ type: 'nope' }, { type: 'nope' }, { type: 'nope' }]);
    await bad.agent.start(1, 'x');
    const view = await settle(bad.agent);
    assert.equal(view.status, 'stuck');
    assert.equal(bad.calls.plan.length, 3);
  });

  it('stops when the same action keeps repeating', async () => {
    const same = () => ({ type: 'act', action: click('h7') });
    const { agent, calls } = setup([same, same, same, same, same]);
    await agent.start(1, 'x');
    const view = await settle(agent);
    assert.equal(view.status, 'stuck');
    assert.equal(calls.act.length, 3);
  });

  it('gets stuck with a clear message when the backend is down', async () => {
    const { agent } = setup([() => { throw new Error('fetch failed'); }]);
    await agent.start(1, 'x');
    const view = await settle(agent);
    assert.equal(view.status, 'stuck');
    assert.match(view.card.message, /could not reach the Hope helper/);
  });

  it('stops acting after stop()', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { agent, calls } = setup([
      async () => { await gate; return { type: 'act', action: click('h7') }; },
    ]);
    await agent.start(1, 'x');
    await agent.stop();
    release();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(agent.view().status, 'stopped');
    assert.equal(calls.act.length, 0);
  });

  it('rewrites question text in plain language', async () => {
    const simplify = async (texts) => texts.map((t) => (t === 'Nominee details as per KYC records?' ? 'Who should get the money if something happens to you?' : t));
    const { agent } = setup([{ type: 'ask', question: 'Nominee details as per KYC records?', input: { targetId: 'h4' } }], { simplify });
    await agent.start(1, 'x');
    const view = await settle(agent);
    assert.equal(view.card.question, 'Who should get the money if something happens to you?');
  });

  it('keeps original text when simplify fails', async () => {
    const simplify = async () => { throw new Error('down'); };
    const { agent } = setup([{ type: 'ask', question: 'Pick one?', options: [{ label: 'Tuesday', action: click('h2') }] }], { simplify });
    await agent.start(1, 'x');
    const view = await settle(agent);
    assert.equal(view.card.question, 'Pick one?');
    assert.deepEqual(view.card.options, [{ label: 'Tuesday' }]);
  });

  it('offers to carry on after the service worker restarts mid-task', async () => {
    const stored = { id: 't1', tabId: 3, goal: 'Pay my bill', status: 'working', card: null, pending: null, progress: { step: 2, total: 5 }, log: [], history: [], startedAt: 1 };
    const { agent, calls } = setup([{ type: 'done', message: 'Paid.' }], { stored });
    const view = await agent.init();
    assert.equal(view.status, 'paused');
    assert.match(view.card.message, /Pay my bill/);
    assert.equal(calls.plan.length, 0);
    await agent.answer({ retry: true });
    assert.equal((await settle(agent, ['done'])).card.message, 'Paid.');
  });

  it('looks again when a popup appears while planning', async () => {
    const clutter = [];
    const { agent, calls } = setup([
      () => {
        clutter.push({ kind: 'popup', text: 'Closed a pop-up offer' }); // popup shows up late
        return { type: 'ask', question: 'Your email for our newsletter?', input: { targetId: 'h4' } };
      },
      { type: 'ask', question: 'Which day works for you?', options: [{ label: 'Tuesday', action: click('h2') }] },
    ], { clutter });
    await agent.start(1, 'x');
    const view = await settle(agent);
    assert.equal(view.card.question, 'Which day works for you?');
    assert.equal(calls.plan.length, 2);
    assert.ok(view.log.some((l) => l.text === 'Closed a pop-up offer'));
  });

  it('logs clutter it handled and tells the planner', async () => {
    const { agent, calls } = setup([{ type: 'done', message: 'ok' }], { clutter: [{ kind: 'cookie', text: 'Turned down optional cookies' }] });
    await agent.start(1, 'x');
    const view = await settle(agent, ['done']);
    assert.equal(view.log[0].text, 'Turned down optional cookies');
    assert.match(calls.plan[0].history[0].summary, /Turned down optional cookies/);
  });
});