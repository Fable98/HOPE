import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { byLabel, loadPage } from './page.helpers.js';

describe('page script: snapshot', () => {
  it('lists controls with roles, labels and stable ids', () => {
    const { hope, document } = loadPage(`
      <h1>Book a visit</h1>
      <form>
        <label for="name">Your name</label><input id="name" required>
        <label>Email <input type="email" name="email" value="a@b.co"></label>
        <select aria-label="Department"><option value="">Choose</option><option value="derm">Dermatology</option></select>
        <fieldset><legend>Which day?</legend>
          <label><input type="radio" name="day" value="tue"> Tuesday</label>
          <label><input type="radio" name="day" value="wed" checked> Wednesday</label>
        </fieldset>
        <button>Book now</button>
      </form>
      <a href="/help">Help</a>
      <button type="button" disabled>Later</button>
    `);
    const snap = hope.snapshot();
    assert.equal(snap.title, 'Test page');
    assert.deepEqual(snap.headings, ['Book a visit']);

    const name = byLabel(snap, 'Your name');
    assert.equal(name.role, 'textbox');
    assert.equal(name.required, true);
    assert.equal(byLabel(snap, 'Email').value, 'a@b.co');

    const dept = byLabel(snap, 'Department');
    assert.equal(dept.role, 'select');
    assert.deepEqual(dept.options.map((o) => o.label), ['Choose', 'Dermatology']);

    const wed = byLabel(snap, 'Wednesday');
    assert.equal(wed.group, 'Which day?');
    assert.equal(wed.checked, true);

    const book = byLabel(snap, 'Book now');
    assert.equal(book.submits, true);
    assert.equal(byLabel(snap, 'Help').role, 'link');
    assert.equal(byLabel(snap, 'Later').disabled, true);

    // Ids stay the same on the next snapshot.
    assert.equal(hope.snapshot().elements.find((e) => e.label === 'Your name').id, name.id);
    assert.equal(document.getElementById('name').getAttribute('data-hope-id'), name.id);
  });

  it('skips hidden controls', () => {
    const { hope } = loadPage(`
      <button>Shown</button>
      <button hidden>Hidden attr</button>
      <div style="display:none"><button>In hidden parent</button></div>
      <div aria-hidden="true"><button>Aria hidden</button></div>
      <input type="hidden" name="csrf" value="abc">
    `);
    assert.deepEqual(hope.snapshot().elements.map((e) => e.label), ['Shown']);
  });

  it('tells a phone number field that mentions OTP apart from an OTP field', () => {
    const { hope } = loadPage(`
      <label>Mobile No. (for OTP verification) <input type="tel" value="9876543210"></label>
      <label>Enter the OTP sent to your mobile <input type="tel" value="4321"></label>
      <input name="otp" aria-label="Code" value="9999">
    `);
    assert.deepEqual(hope.snapshot().elements.map((e) => [e.sensitive, e.value]), [
      [false, '9876543210'],
      [true, '[hidden]'],
      [true, '[hidden]'],
    ]);
  });

  it('blanks sensitive values and long numbers', () => {
    const { hope } = loadPage(`
      <label>Password <input type="password" value="hunter2"></label>
      <label>Card number <input name="cardnumber" value="4111 1111 1111 1111"></label>
      <label>CVV <input name="cvv" value=""></label>
      <label>Code <input autocomplete="one-time-code" value="123456"></label>
      <label>City <input value="Pune"></label>
      <p>Your Aadhaar 1234 5678 9012 is linked. Total ₹8,420.</p>
    `);
    const snap = hope.snapshot();
    assert.deepEqual(
      snap.elements.map((e) => [e.label, e.sensitive, e.value]),
      [
        ['Password', true, '[hidden]'],
        ['Card number', true, '[hidden]'],
        ['CVV', true, ''],
        ['Code', true, '[hidden]'],
        ['City', false, 'Pune'],
      ],
    );
    assert.doesNotMatch(JSON.stringify(snap), /hunter2|4111|123456|1234 5678 9012/);
    assert.match(snap.text, /\[number hidden\] is linked\. Total ₹8,420/);
  });
});

describe('page script: act', () => {
  it('types into a field and fires input events', async () => {
    const { hope, document } = loadPage('<label>Name <input id="n"></label>');
    let inputs = 0;
    document.getElementById('n').addEventListener('input', () => inputs++);
    const id = byLabel(hope.snapshot(), 'Name').id;
    const res = await hope.act({ kind: 'type', targetId: id, value: 'Asha' });
    assert.deepEqual(res, { ok: true, verified: true, detail: 'typed' });
    assert.equal(document.getElementById('n').value, 'Asha');
    assert.equal(inputs, 1);
  });

  it('refuses to type into sensitive fields', async () => {
    const { hope } = loadPage('<label>Password <input type="password"></label>');
    const id = byLabel(hope.snapshot(), 'Password').id;
    assert.deepEqual(await hope.act({ kind: 'type', targetId: id, value: 'x' }), { ok: false, error: 'sensitive' });
  });

  it('selects an option by value or by label', async () => {
    const { hope, document } = loadPage('<select aria-label="Doctor"><option value="">-</option><option value="d1">Dr Rao</option></select>');
    const id = byLabel(hope.snapshot(), 'Doctor').id;
    assert.equal((await hope.act({ kind: 'select', targetId: id, value: 'Dr Rao' })).verified, true);
    assert.equal(document.querySelector('select').value, 'd1');
    assert.equal((await hope.act({ kind: 'select', targetId: id, value: 'nobody' })).error, 'no_such_option');
  });

  it('clicks a button and notices the page change', async () => {
    const { hope, document } = loadPage('<button id="b">Show more</button><div id="out"></div>');
    document.getElementById('b').addEventListener('click', () => {
      document.getElementById('out').textContent = 'More things';
    });
    const id = byLabel(hope.snapshot(), 'Show more').id;
    assert.deepEqual(await hope.act({ kind: 'click', targetId: id }), { ok: true, verified: true, detail: 'page changed' });
  });

  it('reports a click that changes nothing as unverified', async () => {
    const { hope } = loadPage('<button>Nothing</button>');
    const id = byLabel(hope.snapshot(), 'Nothing').id;
    const res = await hope.act({ kind: 'click', targetId: id });
    assert.equal(res.ok, true);
    assert.equal(res.verified, false);
  });

  it('ticks and unticks checkboxes', async () => {
    const { hope, document } = loadPage('<label><input type="checkbox" id="c"> Send me updates</label>');
    const id = byLabel(hope.snapshot(), 'Send me updates').id;
    assert.equal((await hope.act({ kind: 'check', targetId: id, value: true })).verified, true);
    assert.equal(document.getElementById('c').checked, true);
    await hope.act({ kind: 'check', targetId: id, value: false });
    assert.equal(document.getElementById('c').checked, false);
  });

  it('fails cleanly for unknown or disabled targets', async () => {
    const { hope } = loadPage('<button disabled>Off</button>');
    const id = byLabel(hope.snapshot(), 'Off').id;
    assert.equal((await hope.act({ kind: 'click', targetId: id })).error, 'disabled');
    assert.equal((await hope.act({ kind: 'click', targetId: 'h999' })).error, 'not_found');
    assert.equal((await hope.act({ kind: 'click', targetId: '"] , body' })).error, 'not_found');
  });

  it('highlights a field for the user', () => {
    const { hope, document } = loadPage('<label>Password <input type="password" id="p"></label>');
    const id = byLabel(hope.snapshot(), 'Password').id;
    assert.deepEqual(hope.highlight(id), { ok: true });
    assert.equal(document.getElementById('p').hasAttribute('data-hope-highlight'), true);
    assert.equal(document.activeElement.id, 'p');
    hope.clearHighlight();
    assert.equal(document.getElementById('p').hasAttribute('data-hope-highlight'), false);
  });

  it('does not redefine itself when injected twice', () => {
    const { window, hope, inject } = loadPage('<button>One</button>');
    const first = hope.snapshot().elements[0].id;
    inject();
    assert.equal(window.__hope, hope.raw);
    assert.equal(window.__hope.snapshot().elements[0].id, first);
  });
});
