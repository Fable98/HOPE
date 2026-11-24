// The agent loop. It runs in the service worker and talks to the page, the
// backend and storage only through the functions passed in, so it can be
// tested without Chrome.
//
//   page:  snapshot(tabId), act(tabId, action), highlight(tabId, id),
//          clearHighlight(tabId), dismissClutter(tabId)
//   api:   plan({ goal, page, history }), simplify(texts)
//   store: load(), save(task)
//   emit:  called with the public view after every change

import { normalizeDecision } from './protocol.js';
import { applySafety, findElement } from './safety.js';

export const MAX_STEPS_PER_RUN = 25;
const MAX_FAILURES_IN_A_ROW = 3;
const MAX_INVALID_PLANS = 2;
const MAX_LOG = 100;
const MAX_HISTORY = 60;

// Card types the panel knows how to draw.
export const CARD = {
  working: 'working',
  choice: 'choice',
  input: 'input',
  manual: 'manual',
  confirm: 'confirm',
  done: 'done',
  stuck: 'stuck',
  declined: 'declined',
  paused: 'paused',
  stopped: 'stopped',
};

function quote(label) {
  return label ? `"${label}"` : 'it';
}

export function describeAction(action, el) {
  const label = el?.label || '';
  switch (action.kind) {
    case 'click':
      return `Pressed ${quote(label)}`;
    case 'type':
      return `Filled in ${quote(label)}`;
    case 'select': {
      const opt = el?.options?.find((o) => o.value === action.value || o.label === action.value);
      return `Chose "${opt?.label || action.value}" for ${quote(label)}`;
    }
    case 'check':
      return `${action.value ? 'Ticked' : 'Unticked'} ${quote(label)}`;
    case 'scroll':
      return `Scrolled ${action.value === 'up' ? 'up' : 'down'}`;
    default:
      return 'Did a step';
  }
}

function actionKey(action) {
  return `${action.kind}|${action.targetId || ''}|${action.value ?? ''}`;
}

export function createAgent({ page, api, store, emit = () => {}, now = () => Date.now() }) {
  let task = null;
  let generation = 0;

  // ---------- state ----------

  function publicView() {
    if (!task) return null;
    return {
      id: task.id,
      goal: task.goal,
      status: task.status,
      card: task.card,
      progress: task.progress,
      log: task.log,
      startedAt: task.startedAt,
    };
  }

  async function commit() {
    await store.save(task);
    emit(publicView());
  }

  function show(card, status = card.type) {
    task.card = card;
    task.status = status;
  }

  function addLog(text) {
    if (!text) return;
    task.log.push({ time: now(), text });
    if (task.log.length > MAX_LOG) task.log.splice(0, task.log.length - MAX_LOG);
  }

  function addHistory(entry) {
    task.history.push(entry);
    if (task.history.length > MAX_HISTORY) task.history.splice(0, task.history.length - MAX_HISTORY);
  }

  function setProgress(progress) {
    if (!progress) return;
    task.progress = { step: progress.step, total: Math.max(progress.total, progress.step) };
  }

  async function stuck(message) {
    show({ type: CARD.stuck, message });
    task.pending = null;
    await commit();
  }

  // ---------- page helpers ----------

  async function tidyPage() {
    if (!page.dismissClutter) return;
    let items = [];
    try {
      items = (await page.dismissClutter(task.tabId)) || [];
    } catch {
      return; // clutter handling is best effort
    }
    for (const item of items) {
      addLog(item.text);
      addHistory({ kind: 'clutter', summary: `Hope automatically: ${item.text}` });
    }
  }

  async function execute(action, snap) {
    const el = action.targetId ? findElement(snap, action.targetId) : null;
    let result;
    try {
      result = await page.act(task.tabId, action);
    } catch (err) {
      result = { ok: false, error: err?.message || 'failed' };
    }
    result = result || { ok: false, error: 'no result' };
    task.failures = result.ok ? 0 : (task.failures || 0) + 1;
    if (result.ok) {
      task.recent = [...(task.recent || []), actionKey(action)].slice(-3);
      task.actions = (task.actions || 0) + 1;
    }
    return { result, what: describeAction(action, el), el };
  }

  function resultNote(result) {
    if (!result.ok) return `it failed (${result.error})`;
    return result.verified ? 'it worked' : 'no visible change on the page';
  }

  // ---------- cards ----------

  async function plainTexts(texts) {
    const wanted = texts.filter(Boolean);
    if (!wanted.length || !api.simplify) return texts;
    try {
      const out = await api.simplify(wanted);
      if (!Array.isArray(out) || out.length !== wanted.length) return texts;
      let k = 0;
      return texts.map((t) => (t ? out[k++] : t));
    } catch {
      return texts;
    }
  }

  async function askCard(decision) {
    const labels = decision.options ? decision.options.map((o) => o.label) : [];
    const [question, help, ...plainLabels] = await plainTexts([decision.question, decision.help, ...labels]);
    if (decision.options) {
      return { type: CARD.choice, question, help, options: plainLabels.map((label) => ({ label })) };
    }
    if (decision.input) {
      return { type: CARD.input, question, help, inputKind: decision.input.kind, placeholder: decision.input.placeholder };
    }
    return { type: CARD.manual, question, help, instruction: decision.manual.instruction };
  }

  function confirmCard(summary, help) {
    // The summary is not rewritten: amounts, names and dates must stay exact.
    return { type: CARD.confirm, summary, help: help || '' };
  }

  // ---------- the loop ----------

  async function run() {
    const gen = ++generation;
    const alive = () => gen === generation && task && task.status === 'working';

    for (let i = 0; i < MAX_STEPS_PER_RUN; i++) {
      if (!alive()) return;
      show({ type: CARD.working, text: 'Looking at the page…' }, 'working');
      await commit();

      await tidyPage();
      let snap;
      try {
        snap = await page.snapshot(task.tabId);
      } catch {
        if (alive()) await stuck("I can't read this page. If it is a browser settings page, open a normal website and try again.");
        return;
      }
      if (!alive()) return;

      let decision = null;
      for (let attempt = 0; attempt <= MAX_INVALID_PLANS && !decision; attempt++) {
        let raw;
        try {
          raw = await api.plan({ goal: task.goal, page: snap, history: task.history });
        } catch (err) {
          if (alive()) await stuck(err?.userMessage || 'I could not reach the Hope helper service. Check your internet and try again.');
          return;
        }
        if (!alive()) return;
        const checked = normalizeDecision(raw, snap, { fallbackStep: (task.actions || 0) + 1 });
        if (checked.ok) decision = applySafety(checked.decision, snap);
        else addHistory({ kind: 'error', summary: `Your last reply could not be used: ${checked.error}. Use only ids from the control list.` });
      }
      if (!decision) {
        await stuck('I got confused on this page.');
        return;
      }
      setProgress(decision.progress);

      if (decision.type === 'done') {
        show({ type: CARD.done, message: decision.message }, 'done');
        task.pending = null;
        addLog('Finished');
        await clearHighlight();
        await commit();
        return;
      }

      if (decision.type === 'ask') {
        task.pending = { kind: 'ask', decision, snap: slimSnapshot(snap) };
        const card = await askCard(decision);
        if (!alive()) return;
        if (decision.manual) await highlight(decision.manual.targetId);
        show(card, 'asking');
        await commit();
        return;
      }

      if (decision.type === 'confirm') {
        task.pending = { kind: 'confirm', action: decision.action, summary: decision.summary, snap: slimSnapshot(snap) };
        show(confirmCard(decision.summary, decision.help), 'confirming');
        await commit();
        return;
      }

      // act
      const key = actionKey(decision.action);
      if ((task.recent || []).length === 3 && task.recent.every((k) => k === key)) {
        await stuck('I keep doing the same thing and nothing happens. Maybe the page needs something I cannot see.');
        return;
      }
      show({ type: CARD.working, text: decision.log || describeAction(decision.action, findElement(snap, decision.action.targetId)) }, 'working');
      await commit();
      const { result, what } = await execute(decision.action, snap);
      if (!alive()) return;
      if (result.ok) addLog(decision.log || what);
      addHistory({ kind: 'action', summary: `Hope did: ${what}. Result: ${resultNote(result)}.`, targetId: decision.action.targetId });
      if (task.failures >= MAX_FAILURES_IN_A_ROW) {
        await stuck('Some steps did not work on this page.');
        return;
      }
    }

    if (alive()) {
      show({ type: CARD.stuck, message: 'This is taking a lot of steps. Shall I keep going?' });
      await commit();
    }
  }

  // Keeps what answers need (labels and options), not the whole page.
  function slimSnapshot(snap) {
    return { url: snap.url, elements: snap.elements.map(({ id, role, label, group, options }) => ({ id, role, label, group, options })) };
  }

  async function highlight(id) {
    try {
      await page.highlight?.(task.tabId, id);
    } catch {
      /* best effort */
    }
  }

  async function clearHighlight() {
    try {
      await page.clearHighlight?.(task.tabId);
    } catch {
      /* best effort */
    }
  }

  async function doThenContinue(action, snap, historySummary, logText) {
    show({ type: CARD.working, text: 'Doing that now…' }, 'working');
    await commit();
    const { result, what } = await execute(action, snap);
    if (result.ok) addLog(logText || what);
    addHistory({ kind: 'action', summary: `${historySummary} Hope did: ${what}. Result: ${resultNote(result)}.`, targetId: action.targetId });
    await commit();
    run();
  }

  // ---------- public API ----------

  return {
    view: publicView,

    async init() {
      task = (await store.load()) || null;
      if (task && task.status === 'working') {
        // The service worker stopped mid-task. Ask before going on.
        show({ type: CARD.paused, message: `You were in the middle of: "${task.goal}". Shall I carry on?` }, 'paused');
        await store.save(task);
      }
      return publicView();
    },

    async start(tabId, goal) {
      generation++;
      task = {
        id: `t${now().toString(36)}`,
        tabId,
        goal,
        status: 'working',
        card: null,
        pending: null,
        progress: { step: 1, total: 2 },
        log: [],
        history: [],
        actions: 0,
        failures: 0,
        recent: [],
        startedAt: now(),
      };
      await commit();
      run();
      return publicView();
    },

    async stop() {
      generation++;
      if (!task) return null;
      show({ type: CARD.stopped, message: 'Stopped. I will not do anything else.' }, 'stopped');
      task.pending = null;
      addLog('Stopped when you asked');
      await clearHighlight();
      await commit();
      return publicView();
    },

    // payload: { choice } | { text } | { manualDone } | { confirm } | { noneOfThese } | { retry }
    async answer(payload = {}) {
      if (!task) return null;
      const pending = task.pending;

      if (payload.retry) {
        if (!['stuck', 'declined', 'paused'].includes(task.status)) return publicView();
        task.pending = null;
        task.failures = 0;
        task.recent = [];
        task.status = 'working';
        run();
        return publicView();
      }

      if (task.status === 'asking' && pending?.kind === 'ask') {
        const { decision, snap } = pending;
        const q = decision.question;

        if (payload.noneOfThese) {
          task.pending = null;
          const first = decision.options?.[0]?.action;
          const el = first?.targetId ? findElement(snap, first.targetId) : null;
          addHistory({ kind: 'answer', summary: `Hope asked "${q}". None of the offered options fit for the person. Find another way or ask differently.`, targetId: first?.targetId, group: el?.group });
          task.status = 'working';
          run();
          return publicView();
        }

        if (decision.options && Number.isInteger(payload.choice) && decision.options[payload.choice]) {
          const option = decision.options[payload.choice];
          const el = option.action.targetId ? findElement(snap, option.action.targetId) : null;
          const summary = `Hope asked "${q}". The person chose "${option.label}".`;
          if (option.needsConfirm) {
            addHistory({ kind: 'answer', summary, targetId: option.action.targetId, group: el?.group });
            task.pending = { kind: 'confirm', action: option.action, summary: option.summary, snap };
            show(confirmCard(option.summary, option.reason), 'confirming');
            await commit();
            return publicView();
          }
          task.pending = null;
          task.status = 'working';
          doThenContinue(option.action, snap, summary, `${describeAction(option.action, el)} (you chose "${option.label}")`);
          return publicView();
        }

        if (decision.input && typeof payload.text === 'string' && payload.text.trim()) {
          const action = { kind: 'type', targetId: decision.input.targetId, value: payload.text.trim().slice(0, 500) };
          task.pending = null;
          task.status = 'working';
          doThenContinue(action, snap, `Hope asked "${q}" and typed the person's answer into ${action.targetId}.`, null);
          return publicView();
        }

        if (decision.manual && payload.manualDone) {
          const el = findElement(snap, decision.manual.targetId);
          task.pending = null;
          await clearHighlight();
          addHistory({ kind: 'manual', summary: `The person filled in ${quote(el?.label)} themselves.`, targetId: decision.manual.targetId });
          addLog(`You filled in ${quote(el?.label)} yourself`);
          task.status = 'working';
          run();
          return publicView();
        }
        return publicView();
      }

      if (task.status === 'confirming' && pending?.kind === 'confirm' && typeof payload.confirm === 'boolean') {
        task.pending = null;
        if (payload.confirm) {
          task.status = 'working';
          doThenContinue(pending.action, pending.snap, `The person said yes to: ${pending.summary}`, `${describeAction(pending.action, findElement(pending.snap, pending.action.targetId))} after you said yes`);
        } else {
          addHistory({ kind: 'declined', summary: `The person said NO to: ${pending.summary} Do not do it again unless they ask.` });
          addLog('Did not go ahead, because you said no');
          show({ type: CARD.declined, message: "OK, I didn't do that." }, 'declined');
          await commit();
        }
        return publicView();
      }

      return publicView();
    },
  };
}
