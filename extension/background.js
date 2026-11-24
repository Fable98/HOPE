// Service worker: owns the agent and talks to the side panel over a port.

import { createAgent } from './lib/agent.js';
import { createApiClient } from './lib/api.js';
import { createChromePage } from './lib/chromePage.js';
import { getSettings } from './lib/settings.js';

const TASK_KEY = 'hope.task';
const MAX_GOAL = 500;
const ports = new Set();

const store = {
  load: async () => (await chrome.storage.local.get(TASK_KEY))[TASK_KEY] || null,
  save: async (task) => chrome.storage.local.set({ [TASK_KEY]: task }),
};

function broadcast(message) {
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }
}

const api = createApiClient(getSettings);
const agent = createAgent({
  page: createChromePage(),
  api,
  store,
  emit: (view) => broadcast({ type: 'state', view }),
});
const ready = agent.init();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function startTask(msg, port) {
  const goal = typeof msg.goal === 'string' ? msg.goal.replace(/\s+/g, ' ').trim().slice(0, MAX_GOAL) : '';
  if (!goal) return port.postMessage({ type: 'error', message: 'Please tell me what you want to do.' });
  if (!Number.isInteger(msg.tabId)) return port.postMessage({ type: 'error', message: 'Open a website first.' });
  let tab;
  try {
    tab = await chrome.tabs.get(msg.tabId);
  } catch {
    return port.postMessage({ type: 'error', message: 'Open a website first.' });
  }
  if (!/^https?:/.test(tab.url || '')) {
    return port.postMessage({ type: 'error', message: 'Hope works on normal websites. Open the website you need, then try again.' });
  }
  await agent.start(msg.tabId, goal);
}

// Makes a family help link. Only the goal, progress, the current question,
// the log and the page address without its query string are sent.
async function makeHandoff(msg, port) {
  const view = agent.view();
  if (!view) return port.postMessage({ type: 'handoff-error', message: 'Start a task first.' });
  const task = await store.load();
  let tab = null;
  try {
    tab = await chrome.tabs.get(task.tabId);
  } catch {
    /* tab closed: send the link without the website */
  }
  const card = view.card || {};
  try {
    const { link } = await api.handoff({
      goal: view.goal,
      pageUrl: tab?.url || '',
      pageTitle: tab?.title || '',
      current: card.question || card.summary || card.message || '',
      note: typeof msg.note === 'string' ? msg.note.slice(0, 500) : '',
      progress: view.progress,
      log: (view.log || []).map((l) => l.text),
    });
    port.postMessage({ type: 'handoff', link });
  } catch (err) {
    port.postMessage({ type: 'handoff-error', message: err.userMessage || 'I could not make a help link.' });
  }
}

async function handle(msg, port) {
  await ready;
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'hello':
      port.postMessage({ type: 'state', view: agent.view() });
      break;
    case 'start':
      await startTask(msg, port);
      break;
    case 'answer':
      await agent.answer(msg.payload && typeof msg.payload === 'object' ? msg.payload : {});
      break;
    case 'stop':
      await agent.stop();
      break;
    case 'handoff':
      await makeHandoff(msg, port);
      break;
    default:
      break;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'hope-panel' || port.sender?.id !== chrome.runtime.id) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener((msg) => {
    handle(msg, port).catch((err) => {
      console.error('[hope]', err);
      port.postMessage({ type: 'error', message: 'Something went wrong. Please try again.' });
    });
  });
});
