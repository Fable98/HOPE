import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const PAGE_SCRIPT = readFileSync(new URL('../../extension/content/hope-page.js', import.meta.url), 'utf8');

// Loads HTML into jsdom and injects the page script, like executeScript does.
export function loadPage(html, url = 'https://shop.example/checkout') {
  const dom = new JSDOM(`<!doctype html><html><head><title>Test page</title></head><body>${html}</body></html>`, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const inject = () => dom.window.eval(PAGE_SCRIPT);
  inject();
  // executeScript hands results back as plain JSON, so do the same here.
  // That also makes assert.deepEqual work across the jsdom realm.
  const raw = dom.window.__hope;
  const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const hope = {
    raw,
    snapshot: () => plain(raw.snapshot()),
    act: async (a) => plain(await raw.act(a)),
    highlight: (id) => plain(raw.highlight(id)),
    clearHighlight: () => raw.clearHighlight(),
  };
  return { window: dom.window, document: dom.window.document, hope, inject };
}

export function byLabel(snap, label) {
  const el = snap.elements.find((e) => e.label === label);
  if (!el) throw new Error(`no element labelled ${label}: ${snap.elements.map((e) => e.label).join(', ')}`);
  return el;
}
