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

async function call(tabId, name, args = []) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [PAGE_SCRIPT] });
  const [frame] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (fn, fnArgs) => window.__hope[fn](...fnArgs),
    args: [name, args],
  });
  return frame?.result;
}

export function createChromePage() {
  return {
    snapshot: (tabId) => call(tabId, 'snapshot'),

    async act(tabId, action) {
      const before = await tabUrl(tabId);
      let result;
      try {
        result = await call(tabId, 'act', [action]);
      } catch (err) {
        // A click that navigates destroys the page while the call runs.
        await waitForSettle(tabId);
        if ((await tabUrl(tabId)) !== before) return { ok: true, verified: true, detail: 'opened a new page' };
        throw err;
      }
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
