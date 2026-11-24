import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applySafety, checkAction, isPaymentPage } from '../../extension/lib/safety.js';

const page = (elements, extra = {}) => ({ url: 'https://shop.example/cart', title: 'Cart', elements, ...extra });
const click = (targetId) => ({ kind: 'click', targetId });

describe('checkAction', () => {
  const cases = [
    // [role, label, extra, expected]
    ['button', 'Pay ₹8,420', {}, true],
    ['button', 'Place order', {}, true],
    ['button', 'Book appointment', {}, true],
    ['button', 'Delete account', {}, true],
    ['button', 'Submit', {}, true],
    ['button', 'Save changes', { submits: true }, true],
    ['button', 'Show more', {}, false],
    ['button', 'Next', { submits: true }, false],
    ['button', 'Search', { submits: true }, false],
    ['button', 'Sign in', { submits: true }, false],
    ['button', 'Continue ›', {}, false],
    ['link', 'Book an appointment', {}, false],
    ['link', 'Pay now', {}, true],
    ['link', 'Cancel my subscription', {}, true],
    ['checkbox', 'Send me offers', {}, false],
    ['radio', 'Pay later', {}, false],
  ];
  for (const [role, label, extra, expected] of cases) {
    it(`${role} "${label}"${extra.submits ? ' (submits)' : ''} -> ${expected ? 'confirm' : 'silent'}`, () => {
      const snap = page([{ id: 'h1', role, label, ...extra }]);
      assert.equal(checkAction(click('h1'), snap).irreversible, expected);
    });
  }

  it('treats Continue as irreversible on a payment page', () => {
    const snap = page(
      [{ id: 'h1', role: 'button', label: 'Continue' }, { id: 'h2', role: 'textbox', label: 'Card number', sensitive: true }],
      { url: 'https://shop.example/step3' },
    );
    assert.equal(isPaymentPage(snap), true);
    assert.equal(checkAction(click('h1'), snap).irreversible, true);
  });

  it('never flags typing, selecting or scrolling', () => {
    const snap = page([{ id: 'h1', role: 'textbox', label: 'Pay amount' }]);
    assert.equal(checkAction({ kind: 'type', targetId: 'h1', value: '5' }, snap).irreversible, false);
    assert.equal(checkAction({ kind: 'scroll' }, snap).irreversible, false);
  });
});

describe('applySafety', () => {
  const snap = page([
    { id: 'h1', role: 'button', label: 'Pay ₹8,420', submits: true },
    { id: 'h2', role: 'button', label: 'Back' },
  ], { url: 'https://www.hdfcergo.example/pay' });

  it('turns a silent irreversible click into a confirmation', () => {
    const out = applySafety({ type: 'act', action: click('h1'), log: 'Paid', progress: { step: 5, total: 6 } }, snap);
    assert.equal(out.type, 'confirm');
    assert.equal(out.raisedBySafety, true);
    assert.equal(out.summary, 'You are about to press "Pay ₹8,420" on hdfcergo.example. This may not be undoable.');
    assert.deepEqual(out.progress, { step: 5, total: 6 });
  });

  it('leaves safe clicks alone', () => {
    const d = { type: 'act', action: click('h2'), log: 'Went back' };
    assert.equal(applySafety(d, snap), d);
  });

  it('keeps a planner confirmation and its summary', () => {
    const out = applySafety({ type: 'confirm', action: click('h1'), summary: 'You are paying ₹8,420 to HDFC Ergo.' }, snap);
    assert.equal(out.type, 'confirm');
    assert.equal(out.summary, 'You are paying ₹8,420 to HDFC Ergo.');
  });

  it('marks ask options that lead to irreversible clicks', () => {
    const out = applySafety({ type: 'ask', question: 'Ready?', options: [{ label: 'Pay', action: click('h1') }, { label: 'Back', action: click('h2') }] }, snap);
    assert.equal(out.options[0].needsConfirm, true);
    assert.equal(out.options[1].needsConfirm, undefined);
  });
});
