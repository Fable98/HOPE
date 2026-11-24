// Hope page script. Injected into the page with chrome.scripting.executeScript.
// It is a classic script (no imports) and defines window.__hope:
//
//   snapshot()          -> list of controls with stable IDs, sensitive values blanked
//   act(action)         -> click / type / select / check / scroll, then check it worked
//   dismissClutter()    -> close cookie banners, hide chat widgets, close upsell popups
//   highlight(id) / clearHighlight()
//
// Nothing here talks to the network. The service worker decides what leaves the page.

(() => {
  const VERSION = 1;
  if (window.__hope && window.__hope.version === VERSION) return;

  const ID_ATTR = 'data-hope-id';
  const HIGHLIGHT_ATTR = 'data-hope-highlight';
  const MAX_ELEMENTS = 250;
  const MAX_TEXT = 3000;
  let nextId = 1;

  // ---------- helpers ----------

  const clean = (s, max = 150) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const textOf = (el) => (el ? el.innerText ?? el.textContent ?? '' : '');

  function isHiddenByStyle(el) {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden) return true;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    }
    return false;
  }

  function isVisible(el) {
    if (el.closest('[aria-hidden="true"]')) return false;
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    return !isHiddenByStyle(el);
  }

  // ---------- reading controls ----------

  const CONTROL_SELECTOR = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
    '[role="tab"]', '[role="menuitem"]', '[role="option"]', '[role="combobox"]', '[role="textbox"]',
    '[contenteditable="true"]', '[contenteditable=""]',
  ].join(',');

  const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image']);

  function roleOf(el) {
    const tag = el.tagName;
    const aria = el.getAttribute('role');
    if (tag === 'A') return 'link';
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      if (BUTTON_INPUT_TYPES.has(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    if (el.isContentEditable || aria === 'textbox') return 'textarea';
    if (aria === 'switch') return 'checkbox';
    if (aria === 'checkbox' || aria === 'radio' || aria === 'link' || aria === 'combobox') return aria;
    return 'button';
  }

  function labelOf(el) {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => textOf(document.getElementById(id))).join(' ');
      if (clean(text)) return clean(text);
    }
    const aria = el.getAttribute('aria-label');
    if (clean(aria)) return clean(aria);
    if (el.labels && el.labels.length) {
      const text = Array.from(el.labels).map(textOf).join(' ');
      if (clean(text)) return clean(text);
    }
    if (el.tagName === 'INPUT' && BUTTON_INPUT_TYPES.has(el.type) && clean(el.value)) return clean(el.value);
    const ownText = el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? '' : textOf(el);
    if (clean(ownText)) return clean(ownText);
    const img = el.querySelector?.('img[alt]');
    if (img && clean(img.alt)) return clean(img.alt);
    for (const attr of ['placeholder', 'title', 'name']) {
      if (clean(el.getAttribute(attr))) return clean(el.getAttribute(attr));
    }
    return '';
  }

  function groupOf(el) {
    if (el.type !== 'radio' && el.getAttribute('role') !== 'radio') return '';
    const legend = el.closest('fieldset')?.querySelector('legend');
    if (legend && clean(textOf(legend))) return clean(textOf(legend), 80);
    const radiogroup = el.closest('[role="radiogroup"]');
    if (radiogroup) return labelOf(radiogroup) || clean(el.name, 80);
    return clean(el.name, 80);
  }

  const SENSITIVE_AUTOCOMPLETE = /^(cc-|current-password|new-password|one-time-code)/i;
  const SENSITIVE_HINT = /pass(word|code|wd)|\bpin\b|cvv|cvc|\bcsc\b|security code|card ?(number|no\b)|cc-?(num|number)|\botp\b|one[- ]time|aadhaa?r|\bpan\b|\bssn\b|social security|account ?(number|no\b)|\biban\b|routing number|sort code/i;

  function isSensitive(el) {
    if (el.tagName === 'INPUT' && el.type === 'password') return true;
    if (SENSITIVE_AUTOCOMPLETE.test(el.getAttribute('autocomplete') || '')) return true;
    const hints = [el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), labelOf(el)].join(' ');
    return SENSITIVE_HINT.test(hints);
  }

  function isDisabled(el) {
    return el.disabled === true || el.getAttribute('aria-disabled') === 'true';
  }

  function submitsForm(el) {
    if (el.tagName === 'BUTTON') return el.type === 'submit' && !!el.form;
    if (el.tagName === 'INPUT') return (el.type === 'submit' || el.type === 'image') && !!el.form;
    return false;
  }

  function valueOf(el, role) {
    if (role === 'select') {
      const opt = el.options[el.selectedIndex];
      return opt ? clean(opt.value, 200) : '';
    }
    if (el.isContentEditable) return clean(el.textContent, 200);
    if (role === 'textbox' || role === 'textarea') return clean(el.value, 200);
    return '';
  }

  function hopeId(el) {
    let id = el.getAttribute(ID_ATTR);
    if (!id) {
      id = `h${nextId++}`;
      el.setAttribute(ID_ATTR, id);
    }
    return id;
  }

  function findById(id) {
    if (typeof id !== 'string' || !/^h\d+$/.test(id)) return null;
    return document.querySelector(`[${ID_ATTR}="${id}"]`);
  }

  // Custom radios and checkboxes often hide the real input and show a styled label.
  function isUsable(el, role) {
    if (isVisible(el)) return true;
    if ((role === 'checkbox' || role === 'radio') && el.labels) {
      return Array.from(el.labels).some(isVisible);
    }
    return false;
  }

  function describe(el) {
    const role = roleOf(el);
    const sensitive = (role === 'textbox' || role === 'textarea' || role === 'select') && isSensitive(el);
    let value = redactText(valueOf(el, role));
    if (sensitive) value = value ? '[hidden]' : '';
    const info = {
      id: hopeId(el),
      role,
      type: el.tagName === 'INPUT' ? (el.type || 'text').toLowerCase() : '',
      label: redactText(labelOf(el)),
      value,
      checked: role === 'checkbox' || role === 'radio'
        ? (el.checked === true || el.getAttribute('aria-checked') === 'true')
        : false,
      required: el.required === true || el.getAttribute('aria-required') === 'true',
      disabled: isDisabled(el),
      sensitive,
      submits: submitsForm(el),
      group: groupOf(el),
    };
    if (role === 'select' && !sensitive) {
      info.options = Array.from(el.options).slice(0, 30).map((o) => ({
        value: clean(o.value, 200),
        label: redactText(clean(o.label || o.textContent)),
        selected: o.selected,
      }));
    }
    return info;
  }

  const PRIORITY = { textbox: 0, textarea: 0, select: 0, checkbox: 0, radio: 0, combobox: 0, button: 1, link: 2 };

  function collectControls() {
    const found = [];
    document.querySelectorAll(CONTROL_SELECTOR).forEach((el, index) => {
      const role = roleOf(el);
      if (!isUsable(el, role)) return;
      found.push({ el, index, priority: PRIORITY[role] ?? 1 });
    });
    // Keep form fields and buttons when a page has too many links, then restore page order.
    found.sort((a, b) => a.priority - b.priority || a.index - b.index);
    return found.slice(0, MAX_ELEMENTS).sort((a, b) => a.index - b.index).map((f) => f.el);
  }

  // Card numbers, Aadhaar, account numbers: 12 or more digits, maybe with spaces or dashes.
  const LONG_NUMBER = /\b\d(?:[ -]?\d){11,}\b/g;

  function redactText(text) {
    return text.replace(LONG_NUMBER, '[number hidden]');
  }

  function snapshot() {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .filter(isVisible)
      .map((h) => redactText(clean(textOf(h))))
      .filter(Boolean)
      .slice(0, 15);
    const text = redactText(clean(textOf(document.body), MAX_TEXT * 2)).slice(0, MAX_TEXT);
    return {
      url: location.href,
      title: clean(document.title, 200),
      headings,
      text,
      elements: collectControls().map(describe),
    };
  }

  // ---------- acting ----------

  function pageSignature() {
    return `${location.href}|${document.querySelectorAll('*').length}|${textOf(document.body).length}`;
  }

  // Resolves true as soon as the page changes, false after `timeout` ms.
  function waitForChange(before, timeout = 1500) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (changed) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(changed);
      };
      const observer = new MutationObserver((records) => {
        // Ignore our own highlight changes.
        if (records.some((r) => r.attributeName !== HIGHLIGHT_ATTR && r.attributeName !== ID_ATTR)) finish(true);
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      const timer = setTimeout(() => finish(pageSignature() !== before), timeout);
    });
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function isChecked(el) {
    return el.checked === true || el.getAttribute('aria-checked') === 'true';
  }

  async function act(action) {
    const { kind, targetId, value } = action || {};

    if (kind === 'scroll') {
      const dir = value === 'up' ? -1 : 1;
      try { window.scrollBy({ top: dir * window.innerHeight * 0.8, behavior: 'instant' }); } catch { /* not supported */ }
      return { ok: true, verified: true, detail: 'scrolled' };
    }

    const el = findById(targetId);
    if (!el) return { ok: false, error: 'not_found' };
    if (isDisabled(el)) return { ok: false, error: 'disabled' };
    try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch { /* jsdom */ }

    if (kind === 'click') {
      const role = roleOf(el);
      const wasChecked = isChecked(el);
      // Start watching before the click: handlers often change the page synchronously.
      const watching = waitForChange(pageSignature());
      el.focus?.();
      el.click();
      if ((role === 'checkbox' || role === 'radio') && isChecked(el) !== wasChecked) {
        return { ok: true, verified: true, detail: 'selected' };
      }
      const changed = await watching;
      return { ok: true, verified: changed, detail: changed ? 'page changed' : 'no visible change' };
    }

    if (kind === 'type') {
      if (isSensitive(el)) return { ok: false, error: 'sensitive' };
      const text = String(value ?? '');
      el.focus?.();
      if (el.isContentEditable) {
        el.textContent = text;
        fire(el, 'input');
      } else {
        setNativeValue(el, text);
        fire(el, 'input');
        fire(el, 'change');
      }
      el.blur?.();
      const now = el.isContentEditable ? el.textContent : el.value;
      return { ok: true, verified: now === text, detail: now === text ? 'typed' : 'the page changed the text' };
    }

    if (kind === 'select') {
      if (el.tagName !== 'SELECT') return { ok: false, error: 'not_a_select' };
      const wanted = String(value ?? '').trim().toLowerCase();
      const options = Array.from(el.options);
      const opt = options.find((o) => o.value.toLowerCase() === wanted)
        || options.find((o) => clean(o.label || o.textContent).toLowerCase() === wanted);
      if (!opt) return { ok: false, error: 'no_such_option' };
      el.focus?.();
      el.value = opt.value;
      fire(el, 'input');
      fire(el, 'change');
      return { ok: true, verified: el.value === opt.value, detail: `chose ${clean(opt.label || opt.textContent)}` };
    }

    if (kind === 'check') {
      const want = !(value === false || value === 'false');
      if (isChecked(el) !== want) el.click();
      const ok = isChecked(el) === want;
      return { ok: true, verified: ok, detail: want ? 'ticked' : 'unticked' };
    }

    return { ok: false, error: 'unknown_action' };
  }

  // ---------- highlight for things the user fills in themselves ----------

  function ensureStyle(id, css) {
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function clearHighlight() {
    document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).forEach((el) => el.removeAttribute(HIGHLIGHT_ATTR));
  }

  function highlight(targetId) {
    clearHighlight();
    const el = findById(targetId);
    if (!el) return { ok: false, error: 'not_found' };
    ensureStyle('hope-highlight-style', `[${HIGHLIGHT_ATTR}] { outline: 4px solid #f5a623 !important; outline-offset: 3px !important; box-shadow: 0 0 0 9999px rgba(0,0,0,0.25) !important; }`);
    el.setAttribute(HIGHLIGHT_ATTR, '');
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* jsdom */ }
    el.focus?.();
    return { ok: true };
  }

  window.__hope = { version: VERSION, snapshot, act, highlight, clearHighlight, _redactText: redactText };
})();
