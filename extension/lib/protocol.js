// Checks a planner decision against the page snapshot and rebuilds it with only
// known fields. Anything the planner gets wrong is caught here, before it can
// touch the page or reach the user.

import { findElement } from './safety.js';

const ACTION_KINDS = new Set(['click', 'type', 'select', 'check', 'scroll']);
const INPUT_KINDS = new Set(['text', 'email', 'tel', 'number', 'date']);
const TEXT_ROLES = new Set(['textbox', 'textarea']);

const LIMITS = { question: 200, help: 200, summary: 400, message: 500, log: 200, label: 80, value: 500, instruction: 200 };

function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function fail(error) {
  return { ok: false, error };
}

// Returns { ok: true, action } or { ok: false, error }.
export function checkActionShape(raw, snapshot) {
  if (!raw || typeof raw !== 'object') return fail('missing action');
  const kind = raw.kind;
  if (!ACTION_KINDS.has(kind)) return fail(`unknown action kind "${kind}"`);
  if (kind === 'scroll') return { ok: true, action: { kind, value: raw.value === 'up' ? 'up' : 'down' } };

  const el = findElement(snapshot, raw.targetId);
  if (!el) return fail(`target ${raw.targetId} is not on the page`);
  if (el.disabled) return fail(`target ${raw.targetId} is disabled`);

  if (kind === 'click') return { ok: true, action: { kind, targetId: el.id } };
  if (kind === 'type') {
    if (!TEXT_ROLES.has(el.role)) return fail(`cannot type into ${el.role} ${el.id}`);
    if (typeof raw.value !== 'string' && typeof raw.value !== 'number') return fail('type needs a text value');
    return { ok: true, action: { kind, targetId: el.id, value: String(raw.value).slice(0, LIMITS.value) } };
  }
  if (kind === 'select') {
    if (el.role !== 'select') return fail(`${el.id} is not a list`);
    if (typeof raw.value !== 'string' || !raw.value) return fail('select needs an option value');
    return { ok: true, action: { kind, targetId: el.id, value: raw.value.slice(0, LIMITS.value) } };
  }
  // check
  if (el.role !== 'checkbox') return fail(`${el.id} is not a tick box`);
  return { ok: true, action: { kind, targetId: el.id, value: !(raw.value === false || raw.value === 'false') } };
}

function cleanProgress(raw, fallbackStep) {
  const step = Number.isInteger(raw?.step) && raw.step > 0 ? Math.min(raw.step, 50) : fallbackStep;
  const total = Number.isInteger(raw?.total) && raw.total > 0 ? Math.min(raw.total, 50) : step + 1;
  return { step, total: Math.max(total, step) };
}

function manualFor(el, question) {
  return {
    type: 'ask',
    question: question || `Please fill in "${el.label || 'this box'}" yourself.`,
    help: '',
    manual: {
      targetId: el.id,
      instruction: 'Type it in the highlighted box on the page. Hope does not see or type private details.',
    },
  };
}

// Returns { ok: true, decision } or { ok: false, error }.
export function normalizeDecision(raw, snapshot, { fallbackStep = 1 } = {}) {
  if (!raw || typeof raw !== 'object') return fail('decision is not an object');
  const progress = cleanProgress(raw.progress, fallbackStep);
  const reason = text(raw.reason, 300);

  if (raw.type === 'done') {
    return { ok: true, decision: { type: 'done', message: text(raw.message, LIMITS.message) || 'All done.', progress, reason } };
  }

  if (raw.type === 'act' || raw.type === 'confirm') {
    const checked = checkActionShape(raw.action, snapshot);
    if (!checked.ok) return checked;
    const { action } = checked;
    const el = findElement(snapshot, action.targetId);
    // Never type private details, even if the planner asks to.
    if (action.kind === 'type' && el?.sensitive) {
      return { ok: true, decision: { ...manualFor(el), progress, reason } };
    }
    if (raw.type === 'act') {
      return { ok: true, decision: { type: 'act', action, log: text(raw.log, LIMITS.log), progress, reason } };
    }
    const summary = text(raw.summary, LIMITS.summary);
    if (!summary) return fail('confirm needs a summary');
    return { ok: true, decision: { type: 'confirm', action, summary, help: text(raw.help, LIMITS.help), progress, reason } };
  }

  if (raw.type === 'ask') {
    const question = text(raw.question, LIMITS.question);
    if (!question) return fail('ask needs a question');
    const base = { type: 'ask', question, help: text(raw.help, LIMITS.help), progress, reason };

    if (raw.manual) {
      const el = findElement(snapshot, raw.manual.targetId);
      if (!el) return fail(`manual target ${raw.manual.targetId} is not on the page`);
      return {
        ok: true,
        decision: { ...base, manual: { targetId: el.id, instruction: text(raw.manual.instruction, LIMITS.instruction) || manualFor(el).manual.instruction } },
      };
    }

    if (raw.input) {
      const el = findElement(snapshot, raw.input.targetId);
      if (!el) return fail(`input target ${raw.input.targetId} is not on the page`);
      if (!TEXT_ROLES.has(el.role)) return fail(`cannot type into ${el.role} ${el.id}`);
      if (el.sensitive) return { ok: true, decision: { ...manualFor(el, question), progress, reason } };
      const kind = INPUT_KINDS.has(raw.input.kind) ? raw.input.kind : 'text';
      return {
        ok: true,
        decision: { ...base, input: { targetId: el.id, kind, placeholder: text(raw.input.placeholder, LIMITS.label) } },
      };
    }

    if (Array.isArray(raw.options)) {
      const options = [];
      for (const o of raw.options.slice(0, 5)) {
        const label = text(o?.label, LIMITS.label);
        const checked = checkActionShape(o?.action, snapshot);
        if (!label || !checked.ok) continue;
        if (checked.action.kind === 'type' && findElement(snapshot, checked.action.targetId)?.sensitive) continue;
        options.push({ label, action: checked.action });
      }
      if (options.length === 0) return fail('ask had no usable options');
      return { ok: true, decision: { ...base, options } };
    }

    return fail('ask needs options, input or manual');
  }

  return fail(`unknown decision type "${raw.type}"`);
}
