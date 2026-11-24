// Side panel: shows one card at a time and sends the user's answers to the
// service worker. All text from the page or the AI is inserted with
// textContent, never as HTML.

import { getSettings, saveSettings } from '../lib/settings.js';

const $ = (id) => document.getElementById(id);

const screens = { home: $('home'), task: $('task'), settings: $('settings') };
let currentView = null;
let showHomeFor = null; // task id the user moved past with "Start something new"
let settings = await getSettings();
let lastSpokenKey = '';
let port = null;

// ---------- small DOM helper ----------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// ---------- connection to the service worker ----------

function connect() {
  port = chrome.runtime.connect({ name: 'hope-panel' });
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, 500); // the service worker restarted; reconnect
  });
  port.postMessage({ type: 'hello' });
}

function send(message) {
  if (!port) connect();
  port.postMessage(message);
}

function onMessage(msg) {
  if (msg.type === 'state') {
    currentView = msg.view;
    render();
  } else if (msg.type === 'handoff') {
    showHelpLink(msg.link);
  } else if (msg.type === 'handoff-error') {
    $('help-make').disabled = false;
    $('help-error').textContent = msg.message;
    $('help-error').hidden = false;
  } else if (msg.type === 'error') {
    showScreen('home');
    const box = $('home-error');
    box.textContent = msg.message;
    box.hidden = false;
  }
}

// ---------- screens ----------

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  $('settings-button').setAttribute('aria-expanded', String(name === 'settings'));
}

function applyProfile() {
  document.body.className = `profile-${settings.profile}`;
}

function render() {
  if (!screens.settings.hidden) return; // don't pull the user out of settings
  const view = currentView;
  const finished = view && ['done', 'stopped'].includes(view.status);
  if (!view || (finished && showHomeFor === view.id)) {
    showScreen('home');
    return;
  }
  showScreen('task');
  $('home-error').hidden = true;
  $('goal-text').textContent = view.goal;
  renderProgress(view);
  renderLog(view.log || []);
  renderCard(view.card, view);
  $('stop-button').hidden = finished;
}

function renderProgress(view) {
  const { step, total } = view.progress || { step: 1, total: 2 };
  const done = view.status === 'done';
  const pct = done ? 100 : Math.min(95, Math.round(((step - 0.5) / total) * 100));
  $('progress-fill').style.width = `${pct}%`;
  $('progress-text').textContent = done ? 'All done' : `Step ${step} of about ${total}`;
}

function renderLog(log) {
  $('log-count').textContent = String(log.length);
  $('log-list').replaceChildren(...log.map((entry) => h('li', { text: entry.text })));
}

// ---------- cards ----------

function heading(text) {
  return h('h2', { tabindex: '-1', text });
}

function speakButton(text) {
  if (!('speechSynthesis' in window) || !text) return null;
  return h('button', { class: 'icon-button speak', type: 'button', 'aria-label': 'Read aloud', onclick: () => speak(text) }, '🔊');
}

const reassure = () => h('p', { class: 'reassure', text: 'Take your time. Nothing happens until you choose.' });

// The card number lets the agent ignore a click on a card that is already gone.
function answer(payload) {
  send({ type: 'answer', payload: { ...payload, seq: currentView?.card?.seq } });
}

const CARD_RENDERERS = {
  working: (card) => h('div', { class: 'working', role: 'status' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', { text: card.text || 'Working on it…' })),

  choice: (card) => [
    speakButton(card.question),
    heading(card.question),
    card.help && h('p', { class: 'help', text: card.help }),
    h('div', { class: 'stack' },
      card.options.map((opt, i) => h('button', { class: 'secondary', type: 'button', onclick: () => answer({ choice: i }) }, opt.label)),
      h('button', { class: 'quiet', type: 'button', onclick: () => answer({ noneOfThese: true }) }, 'None of these'),
    ),
    reassure(),
  ],

  input: (card) => {
    const input = h('input', { type: card.inputKind || 'text', placeholder: card.placeholder || '', 'aria-label': card.question, autocomplete: 'on' });
    const form = h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        if (input.value.trim()) answer({ text: input.value });
        else input.focus();
      },
    }, input, h('div', { class: 'stack' }, h('button', { class: 'primary', type: 'submit' }, 'Next')));
    return [speakButton(card.question), heading(card.question), card.help && h('p', { class: 'help', text: card.help }), form, reassure()];
  },

  manual: (card) => [
    speakButton(`${card.question} ${card.instruction}`),
    heading(card.question),
    h('p', { text: card.instruction }),
    h('div', { class: 'stack' }, h('button', { class: 'primary', type: 'button', onclick: () => answer({ manualDone: true }) }, "I've done it")),
    reassure(),
  ],

  confirm: (card) => [
    speakButton(card.summary),
    heading('Please check before I go on'),
    h('p', { class: 'summary', text: card.summary }),
    card.help && h('p', { class: 'help', text: card.help }),
    h('div', { class: 'stack' },
      h('button', { class: 'confirm-yes', type: 'button', onclick: () => answer({ confirm: true }) }, 'Yes, do it'),
      h('button', { class: 'secondary', type: 'button', onclick: () => answer({ confirm: false }) }, 'No, stop'),
    ),
    reassure(),
  ],

  done: (card) => [
    h('div', { class: 'done-mark', 'aria-hidden': 'true' }, '✓'),
    heading('Finished'),
    h('p', { text: card.message }),
    h('div', { class: 'stack' }, h('button', { class: 'primary', type: 'button', onclick: startOver }, 'Start something new')),
  ],

  stuck: (card) => [
    heading('I need a hand'),
    h('p', { text: card.message }),
    h('div', { class: 'stack' },
      h('button', { class: 'primary', type: 'button', onclick: () => answer({ retry: true }) }, 'Try again'),
      h('button', { class: 'secondary', type: 'button', onclick: () => send({ type: 'stop' }) }, 'Stop'),
    ),
  ],

  declined: (card) => [
    heading(card.message),
    h('p', { text: 'What would you like to do now?' }),
    h('div', { class: 'stack' },
      h('button', { class: 'primary', type: 'button', onclick: () => answer({ retry: true }) }, 'Try another way'),
      h('button', { class: 'secondary', type: 'button', onclick: () => send({ type: 'stop' }) }, 'Stop here'),
    ),
  ],

  paused: (card) => [
    heading('Welcome back'),
    h('p', { text: card.message }),
    h('div', { class: 'stack' },
      h('button', { class: 'primary', type: 'button', onclick: () => answer({ retry: true }) }, 'Carry on'),
      h('button', { class: 'secondary', type: 'button', onclick: () => send({ type: 'stop' }) }, 'No, stop'),
    ),
  ],

  stopped: (card) => [
    heading('Stopped'),
    h('p', { text: card.message }),
    h('div', { class: 'stack' }, h('button', { class: 'primary', type: 'button', onclick: startOver }, 'Start something new')),
  ],
};

function cardKey(card) {
  return `${card.type}|${card.seq ?? ''}`;
}

function renderCard(card, view) {
  const box = $('card');
  if (!card) {
    box.replaceChildren();
    return;
  }
  const renderer = CARD_RENDERERS[card.type] || CARD_RENDERERS.working;
  const key = `${view.id}|${cardKey(card)}`;
  const same = box.dataset.key === key;
  if (same && card.type !== 'working') return; // keep focus and typed text
  box.dataset.key = key;
  box.setAttribute('aria-busy', String(card.type === 'working'));
  box.replaceChildren(...[renderer(card)].flat().filter(Boolean));

  if (card.type !== 'working') {
    box.querySelector('h2')?.focus();
    const spoken = card.summary || (card.question ? `${card.question} ${card.instruction || ''}` : card.message);
    if (settings.readAloud && key !== lastSpokenKey) speak(spoken);
    lastSpokenKey = key;
  }
}

function startOver() {
  showHomeFor = currentView?.id || null;
  window.speechSynthesis?.cancel();
  showScreen('home');
  $('help-box').hidden = true;
  $('help-result').hidden = true;
  $('help-note').value = '';
  $('goal').value = '';
  $('goal').focus();
}

// ---------- read aloud ----------

function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = settings.profile === 'calm' ? 0.9 : 0.95;
  window.speechSynthesis.speak(utterance);
}

// ---------- goal form and voice ----------

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

$('goal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const goal = $('goal').value.trim();
  if (!goal) {
    $('goal').focus();
    return;
  }
  $('home-error').hidden = true;
  showHomeFor = null;
  send({ type: 'start', goal, tabId: await activeTabId() });
});

$('goal').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('goal-form').requestSubmit();
  }
});

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function micNote(text) {
  $('mic-note').textContent = text;
  $('mic-note').hidden = !text;
}

if (!Recognition) {
  $('mic-button').hidden = true;
} else {
  $('mic-button').addEventListener('click', () => {
    if (recognition) {
      recognition.stop();
      return;
    }
    recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.onstart = () => {
      $('mic-button').setAttribute('aria-pressed', 'true');
      $('mic-button').textContent = '■ Stop listening';
      micNote('Listening…');
    };
    recognition.onresult = (event) => {
      $('goal').value = Array.from(event.results).map((r) => r[0].transcript).join(' ');
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        micNote('Hope needs your permission to use the microphone.');
        $('mic-permission').hidden = false;
      } else if (event.error === 'no-speech') {
        micNote("I didn't hear anything. Try again, or type instead.");
      } else {
        micNote('Voice input is not working right now. You can type instead.');
      }
    };
    recognition.onend = () => {
      recognition = null;
      $('mic-button').setAttribute('aria-pressed', 'false');
      $('mic-button').textContent = '🎤 Speak';
      if ($('mic-note').textContent === 'Listening…') micNote('');
    };
    recognition.start();
  });
}

// Side panels cannot show the microphone prompt, so ask from a normal tab.
$('mic-permission').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('permission/mic.html') });
  $('mic-permission').hidden = true;
  micNote('After you allow it in the new tab, press Speak again.');
});

// ---------- task controls ----------

$('stop-button').addEventListener('click', () => send({ type: 'stop' }));

// ---------- ask someone for help ----------

function helpMessage(link) {
  return `Could you help me with something on a website? ${link}`;
}

function showHelpLink(link) {
  $('help-make').disabled = false;
  $('help-error').hidden = true;
  $('help-link').value = link;
  $('help-result').hidden = false;
  $('help-status').textContent = '';
  $('help-copy').focus();
}

$('help-button').addEventListener('click', () => {
  const box = $('help-box');
  box.hidden = !box.hidden;
  $('help-button').setAttribute('aria-expanded', String(!box.hidden));
  if (!box.hidden) $('help-title').focus();
});

$('help-make').addEventListener('click', () => {
  $('help-make').disabled = true;
  $('help-error').hidden = true;
  send({ type: 'handoff', note: $('help-note').value.trim() });
});

$('help-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('help-link').value);
    $('help-status').textContent = 'Copied. Paste it into a message.';
  } catch {
    $('help-link').select();
    $('help-status').textContent = 'Press Ctrl+C (or ⌘+C) to copy the selected link.';
  }
});

$('help-whatsapp').addEventListener('click', () => {
  const text = encodeURIComponent(helpMessage($('help-link').value));
  chrome.tabs.create({ url: `https://wa.me/?text=${text}` });
});

$('help-email').addEventListener('click', () => {
  const subject = encodeURIComponent('Could you help me?');
  const bodyText = encodeURIComponent(helpMessage($('help-link').value));
  chrome.tabs.create({ url: `mailto:?subject=${subject}&body=${bodyText}` });
});

// ---------- settings ----------

function openSettings() {
  const form = $('settings-form');
  form.querySelectorAll('input[name="profile"]').forEach((r) => { r.checked = r.value === settings.profile; });
  $('read-aloud').checked = settings.readAloud;
  $('server-url').value = settings.serverUrl;
  $('access-code').value = settings.accessCode;
  $('settings-saved').hidden = true;
  showScreen('settings');
  $('settings-title').setAttribute('tabindex', '-1');
  $('settings-title').focus();
}

function closeSettings() {
  applyProfile(); // undo a profile preview that was not saved
  showScreen('home');
  render();
}

$('settings-button').addEventListener('click', () => (screens.settings.hidden ? openSettings() : closeSettings()));
$('settings-cancel').addEventListener('click', closeSettings);

$('settings-form').addEventListener('change', (e) => {
  if (e.target.name === 'profile') {
    document.body.className = `profile-${e.target.value}`;
    if (e.target.value === 'reading') $('read-aloud').checked = true;
  }
});

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const profile = $('settings-form').querySelector('input[name="profile"]:checked')?.value || settings.profile;
  settings = await saveSettings({
    profile,
    readAloud: $('read-aloud').checked,
    serverUrl: $('server-url').value,
    accessCode: $('access-code').value,
  });
  applyProfile();
  $('settings-saved').hidden = false;
  setTimeout(closeSettings, 600);
});

// ---------- start ----------

applyProfile();
connect();
