import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeDecision } from '../../extension/lib/protocol.js';

const snap = {
  url: 'https://clinic.example',
  elements: [
    { id: 'h1', role: 'textbox', label: 'Name' },
    { id: 'h2', role: 'textbox', type: 'password', label: 'Password', sensitive: true },
    { id: 'h3', role: 'select', label: 'Doctor', options: [{ value: 'd1', label: 'Dr Rao' }] },
    { id: 'h4', role: 'button', label: 'Next' },
    { id: 'h5', role: 'checkbox', label: 'Agree' },
    { id: 'h6', role: 'button', label: 'Old', disabled: true },
  ],
};

const ok = (raw) => {
  const res = normalizeDecision(raw, snap);
  assert.equal(res.ok, true, res.error);
  return res.decision;
};
const bad = (raw) => {
  const res = normalizeDecision(raw, snap);
  assert.equal(res.ok, false);
  return res.error;
};

describe('normalizeDecision', () => {
  it('accepts a valid act and drops unknown fields', () => {
    const d = ok({ type: 'act', action: { kind: 'click', targetId: 'h4', extra: 1 }, log: 'Pressed Next', evil: '<script>' });
    assert.deepEqual(d.action, { kind: 'click', targetId: 'h4' });
    assert.equal(d.evil, undefined);
    assert.deepEqual(d.progress, { step: 1, total: 2 });
  });

  it('rejects targets that are missing or disabled', () => {
    assert.match(bad({ type: 'act', action: { kind: 'click', targetId: 'h99' } }), /not on the page/);
    assert.match(bad({ type: 'act', action: { kind: 'click', targetId: 'h6' } }), /disabled/);
  });

  it('rejects actions that do not fit the control', () => {
    assert.match(bad({ type: 'act', action: { kind: 'type', targetId: 'h4', value: 'x' } }), /cannot type/);
    assert.match(bad({ type: 'act', action: { kind: 'select', targetId: 'h1', value: 'x' } }), /not a list/);
    assert.match(bad({ type: 'act', action: { kind: 'check', targetId: 'h1' } }), /not a tick box/);
    assert.match(bad({ type: 'act', action: { kind: 'hover', targetId: 'h1' } }), /unknown action kind/);
  });

  it('turns typing into a sensitive field into a manual card', () => {
    const d = ok({ type: 'act', action: { kind: 'type', targetId: 'h2', value: 'hunter2' } });
    assert.equal(d.type, 'ask');
    assert.equal(d.manual.targetId, 'h2');
    assert.doesNotMatch(JSON.stringify(d), /hunter2/);
  });

  it('turns an input question about a sensitive field into a manual card', () => {
    const d = ok({ type: 'ask', question: 'What is your password?', input: { targetId: 'h2', kind: 'text' } });
    assert.equal(d.manual.targetId, 'h2');
    assert.equal(d.input, undefined);
  });

  it('keeps valid options and drops broken ones', () => {
    const d = ok({
      type: 'ask',
      question: 'Which doctor?',
      options: [
        { label: 'Dr Rao', action: { kind: 'select', targetId: 'h3', value: 'd1' } },
        { label: 'Ghost', action: { kind: 'click', targetId: 'h77' } },
        { label: '', action: { kind: 'click', targetId: 'h4' } },
      ],
    });
    assert.deepEqual(d.options.map((o) => o.label), ['Dr Rao']);
  });

  it('requires a question, a summary and a body for ask', () => {
    assert.match(bad({ type: 'ask', options: [] }), /question/);
    assert.match(bad({ type: 'ask', question: 'Hm?' }), /options, input or manual/);
    assert.match(bad({ type: 'confirm', action: { kind: 'click', targetId: 'h4' } }), /summary/);
    assert.match(bad({ type: 'dance' }), /unknown decision type/);
    assert.match(bad(null), /not an object/);
  });

  it('cleans progress numbers', () => {
    assert.deepEqual(ok({ type: 'done', progress: { step: 4, total: 2 } }).progress, { step: 4, total: 4 });
    assert.deepEqual(ok({ type: 'done', progress: { step: 'x' } }).progress, { step: 1, total: 2 });
    assert.equal(ok({ type: 'done' }).message, 'All done.');
  });
});
