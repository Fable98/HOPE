// Connects the agent to a real tab through chrome.scripting.
// The page script is injected before every call; it skips itself if already there.

const PAGE_SCRIPT = 'content/hope-page.js';
const SETTLE_TIMEOUT_MS = 15_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tabUrl(tabId) {
  try {
    return (await chrome.tabs.get(tabId)).url || '';
  } catch {
    return '';
  }
}

// Waits for the tab to finish loading after a click that may navigate.
export async function waitForSettle(tabId) {
  await sleep(400);
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return; // tab closed; the next snapshot will fail clearly
    }
    if (tab.status === 'complete') break;
    await sleep(250);
  }
  await sleep(300);
}

const CALL_TIMEOUT_MS = 20_000;

async function callOnce(tabId, name, args) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [PAGE_SCRIPT] });
  const [frame] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (fn, fnArgs) => window.__hope[fn](...fnArgs),
    args: [name, args],
  });
  return frame?.result;
}

function call(tabId, name, args = []) {
  return Promise.race([
    callOnce(tabId, name, args),
    sleep(CALL_TIMEOUT_MS).then(() => {
      throw new Error('the page did not answer');
    }),
  ]);
}

// Resolves when the tab starts loading a new document. A click that navigates
// unloads the page script, and its executeScript call may then never settle.
function watchNavigation(tabId) {
  let listener;
  const started = new Promise((resolve) => {
    listener = (id, info) => {
      if (id === tabId && info.status === 'loading') resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  return { started, stop: () => chrome.tabs.onUpdated.removeListener(listener) };
}

const NAVIGATED = Symbol('navigated');
const TIMED_OUT = Symbol('timed out');
const ACT_TIMEOUT_MS = 10_000;

export function createChromePage() {
  return {
    snapshot: (tabId) => call(tabId, 'snapshot'),

    async act(tabId, action) {
      const before = await tabUrl(tabId);
      const nav = watchNavigation(tabId);
      const running = call(tabId, 'act', [action]);
      running.catch(() => {}); // may reject after we stopped waiting
      let result;
      try {
        result = await Promise.race([
          running,
          nav.started.then(() => NAVIGATED),
          sleep(ACT_TIMEOUT_MS).then(() => TIMED_OUT),
        ]);
      } catch (err) {
        // The page went away while the call ran.
        await waitForSettle(tabId);
        if ((await tabUrl(tabId)) !== before) return { ok: true, verified: true, detail: 'opened a new page' };
        throw err;
      } finally {
        nav.stop();
      }
      if (result === NAVIGATED) {
        await waitForSettle(tabId);
        return { ok: true, verified: true, detail: 'opened a new page' };
      }
      if (result === TIMED_OUT) return { ok: false, error: 'the page did not respond' };
      if (action.kind === 'click') await waitForSettle(tabId);
      if (!result) {
        const moved = (await tabUrl(tabId)) !== before;
        return { ok: true, verified: moved, detail: moved ? 'opened a new page' : 'no answer from the page' };
      }
      return result;
    },

    async dismissClutter(tabId) {
      const items = (await call(tabId, 'dismissClutter')) || [];
      if (items.length) await sleep(400); // let banners animate away before the snapshot
      return items;
    },

    highlight: (tabId, id) => call(tabId, 'highlight', [id]),
    clearHighlight: (tabId) => call(tabId, 'clearHighlight'),
  };
}
