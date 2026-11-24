import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadPage } from './page.helpers.js';

const clutter = (env) => JSON.parse(JSON.stringify(env.hope.raw.dismissClutter()));

function clicks(document, ids) {
  const seen = [];
  for (const id of ids) document.getElementById(id)?.addEventListener('click', () => seen.push(id));
  return seen;
}

describe('page script: clutter', () => {
  it('turns down optional cookies instead of accepting', () => {
    const env = loadPage(`
      <div id="cookie-banner">We use cookies to improve your experience.
        <button id="accept">Accept all</button>
        <button id="reject">Reject all</button>
      </div>`);
    const seen = clicks(env.document, ['accept', 'reject']);
    assert.deepEqual(clutter(env), [{ kind: 'cookie', text: 'Turned down optional cookies on the cookie banner' }]);
    assert.deepEqual(seen, ['reject']);
    assert.deepEqual(clutter(env), [], 'handled banners are not touched again');
  });

  it('picks "necessary only" style buttons', () => {
    const env = loadPage(`
      <div class="consent-modal" role="dialog">This site uses cookies.
        <button id="all">Allow all cookies</button>
        <button id="nec">Use necessary cookies only</button>
      </div>`);
    const seen = clicks(env.document, ['all', 'nec']);
    clutter(env);
    assert.deepEqual(seen, ['nec']);
  });

  it('closes or hides a banner that only offers Accept', () => {
    const closeable = loadPage('<div id="cookies">Cookies help us. <button id="ok">Accept</button><button id="x" aria-label="Close">×</button></div>');
    const seen = clicks(closeable.document, ['ok', 'x']);
    assert.equal(clutter(closeable)[0].text, 'Closed the cookie banner');
    assert.deepEqual(seen, ['x']);

    const acceptOnly = loadPage('<div id="cookies">Cookies help us. <button id="ok">Accept</button></div>');
    const seen2 = clicks(acceptOnly.document, ['ok']);
    assert.equal(clutter(acceptOnly)[0].text, 'Hid the cookie banner (I did not accept anything)');
    assert.deepEqual(seen2, []);
    assert.equal(acceptOnly.document.getElementById('cookies').style.display, 'none');
  });

  it('hides known chat widgets once and reports it once', () => {
    const env = loadPage('<div id="intercom-container"><button>Chat with us</button></div><button>Book</button>');
    assert.deepEqual(clutter(env), [{ kind: 'chat', text: 'Hid a chat pop-up' }]);
    assert.ok(env.document.getElementById('hope-clutter-style'));
    assert.deepEqual(clutter(env), []);
  });

  it('closes upsell popups with their own dismiss button', () => {
    const env = loadPage(`
      <div role="dialog" id="promo">Get 20% off! Subscribe to our newsletter.
        <input type="email" placeholder="Email"><button id="sub">Subscribe</button><button id="no">No thanks</button>
      </div>`);
    const seen = clicks(env.document, ['sub', 'no']);
    assert.deepEqual(clutter(env), [{ kind: 'popup', text: 'Closed a pop-up offer' }]);
    assert.deepEqual(seen, ['no']);
  });

  it('leaves task dialogs alone', () => {
    const env = loadPage(`
      <div role="dialog" id="slots">Choose a time <button id="t1">10:30</button><button id="close">Close</button></div>
      <div role="dialog" id="login">Sign up for an account <input type="password"><button id="c2">Close</button></div>`);
    const seen = clicks(env.document, ['t1', 'close', 'c2']);
    assert.deepEqual(clutter(env), []);
    assert.deepEqual(seen, []);
  });
});
