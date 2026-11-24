import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../../server/src/config.js';
import { extractJson } from '../../server/src/llm.js';
import { mockPlan } from '../../server/src/mockPlanner.js';
import { cleanPlanInput } from '../../server/src/planInput.js';
import { buildPlannerPrompt } from '../../server/src/prompts.js';
import { samplePage } from './helpers.js';

describe('config', () => {
  it('falls back to the mock provider without keys', () => {
    assert.equal(loadConfig({}).provider, 'mock');
  });
  it('picks anthropic when its key is set', () => {
    const c = loadConfig({ ANTHROPIC_API_KEY: 'k' });
    assert.equal(c.provider, 'anthropic');
    assert.equal(c.simplifyModel, 'claude-haiku-5-5');
  });
  it('refuses a provider without its key', () => {
    assert.throws(() => loadConfig({ HOPE_LLM_PROVIDER: 'openai' }), /OPENAI_API_KEY/);
    assert.throws(() => loadConfig({ HOPE_LLM_PROVIDER: 'nope' }), /must be one of/);
  });
});

describe('cleanPlanInput', () => {
  it('drops elements with bad ids and trims long strings', () => {
    const input = cleanPlanInput({
      goal: '  pay   bill ',
      page: samplePage([
        { id: 'h1', role: 'button', label: 'x'.repeat(500) },
        { id: 'not-an-id', role: 'button', label: 'skip me' },
        null,
      ]),
      history: [{ kind: 'action', summary: 'Pressed Next' }],
    });
    assert.equal(input.goal, 'pay bill');
    assert.equal(input.page.elements.length, 1);
    assert.equal(input.page.elements[0].label.length, 150);
    assert.equal(input.history[0].summary, 'Pressed Next');
  });
});

describe('buildPlannerPrompt', () => {
  it('hides sensitive values and lists options', () => {
    const prompt = buildPlannerPrompt(cleanPlanInput({
      goal: 'Pay my bill',
      page: samplePage([
        { id: 'h1', role: 'textbox', type: 'password', label: 'Password', value: '[hidden]', sensitive: true },
        { id: 'h2', role: 'select', label: 'Plan', options: [{ value: 'a', label: 'Basic', selected: true }] },
        { id: 'h3', role: 'button', label: 'Pay ₹500', submits: true },
      ]),
    }));
    assert.match(prompt, /\[h1\] textbox \(password\) "Password" \[sensitive\]/);
    assert.doesNotMatch(prompt, /\[hidden\]/);
    assert.match(prompt, /options: \*"Basic"="a"/);
    assert.match(prompt, /\[h3\] button "Pay ₹500" submits-form/);
    assert.match(prompt, /this is the first step/);
  });
});

describe('extractJson', () => {
  it('reads JSON inside prose or fences', () => {
    assert.deepEqual(extractJson('Here:\n```json\n{"a":1}\n```'), { a: 1 });
  });
  it('throws when there is no JSON', () => {
    assert.throws(() => extractJson('no json here'));
  });
});

describe('mockPlan', () => {
  const plan = (elements, extra = {}) =>
    mockPlan({ goal: 'Appointment with a skin doctor', page: { ...samplePage(elements), ...extra.page }, history: extra.history || [] });

  it('picks the option the goal names without asking', () => {
    const d = plan([{ id: 'h1', role: 'select', label: 'Department', options: [{ value: '', label: 'Choose' }, { value: 'derm', label: 'Dermatology' }] }]);
    assert.equal(d.type, 'act');
    assert.deepEqual(d.action, { kind: 'select', targetId: 'h1', value: 'derm' });
  });

  it('asks for radio choices the goal does not settle', () => {
    const d = plan([
      { id: 'h1', role: 'radio', label: 'Tuesday', group: 'day' },
      { id: 'h2', role: 'radio', label: 'Wednesday', group: 'day' },
    ]);
    assert.equal(d.type, 'ask');
    assert.deepEqual(d.options.map((o) => o.label), ['Tuesday', 'Wednesday']);
  });

  it('uses a manual card for sensitive fields', () => {
    const d = plan([{ id: 'h1', role: 'textbox', type: 'password', label: 'Password', value: '', sensitive: true }]);
    assert.equal(d.type, 'ask');
    assert.equal(d.manual.targetId, 'h1');
  });

  it('confirms the final submit button', () => {
    const d = plan([{ id: 'h1', role: 'button', label: 'Book appointment', submits: true }]);
    assert.equal(d.type, 'confirm');
  });

  it('asks about a required tick box', () => {
    const d = plan([{ id: 'h1', role: 'checkbox', label: 'I agree to the Terms', required: true }]);
    assert.equal(d.type, 'ask');
    assert.deepEqual(d.options[0].action, { kind: 'check', targetId: 'h1', value: true });
  });

  it('puts the amount from the page in the confirm summary', () => {
    const d = plan([{ id: 'h1', role: 'button', label: 'Confirm & Book', submits: true }], {
      page: { text: 'Asha: Dr. Meera Kulkarni on Tue, 14 Jan. Total payable: ₹800. Fee is paid at the hospital.' },
    });
    assert.equal(d.summary, 'You are about to press "Confirm & Book". Total payable: ₹800.');
  });

  it('finishes when the page shows success', () => {
    const d = plan([], { page: { text: 'Thank you! Your appointment is booked.' } });
    assert.equal(d.type, 'done');
  });

  it('does not ask twice about a field already answered', () => {
    const d = plan(
      [{ id: 'h1', role: 'textbox', label: 'Name', value: '' }, { id: 'h2', role: 'button', label: 'Next' }],
      { history: [{ kind: 'answer', targetId: 'h1', summary: 'answered' }] },
    );
    assert.equal(d.type, 'act');
    assert.equal(d.action.targetId, 'h2');
  });
});
