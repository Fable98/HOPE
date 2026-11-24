// Validates and trims what the extension sends to /api/plan.
// Everything is cut to a fixed size so one request cannot blow up the prompt.

import { HttpError } from './http.js';

export const LIMITS = {
  goal: 500,
  url: 500,
  title: 200,
  heading: 150,
  headings: 15,
  text: 3000,
  elements: 250,
  label: 150,
  value: 200,
  options: 30,
  history: 40,
  summary: 300,
};

function str(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function bool(value) {
  return value === true;
}

function cleanElement(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 20);
  if (!/^h\d+$/.test(id)) return null;
  const el = {
    id,
    role: str(raw.role, 20) || 'other',
    type: str(raw.type, 20),
    label: str(raw.label, LIMITS.label),
    value: str(raw.value, LIMITS.value),
    checked: bool(raw.checked),
    required: bool(raw.required),
    disabled: bool(raw.disabled),
    sensitive: bool(raw.sensitive),
    submits: bool(raw.submits),
    group: str(raw.group, 80),
  };
  if (Array.isArray(raw.options)) {
    el.options = raw.options.slice(0, LIMITS.options).map((o) => ({
      value: str(o?.value, LIMITS.value),
      label: str(o?.label, LIMITS.label),
      selected: bool(o?.selected),
    }));
  }
  return el;
}

function cleanHistoryEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    kind: str(raw.kind, 20),
    summary: str(raw.summary, LIMITS.summary),
    targetId: str(raw.targetId, 20),
    group: str(raw.group, 80),
  };
}

export function cleanPlanInput(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'invalid_body');
  const goal = str(body.goal, LIMITS.goal);
  if (!goal) throw new HttpError(400, 'missing_goal');

  const page = body.page;
  if (!page || typeof page !== 'object' || !Array.isArray(page.elements)) {
    throw new HttpError(400, 'missing_page');
  }

  return {
    goal,
    page: {
      url: str(page.url, LIMITS.url),
      title: str(page.title, LIMITS.title),
      headings: (Array.isArray(page.headings) ? page.headings : [])
        .slice(0, LIMITS.headings)
        .map((h) => str(h, LIMITS.heading))
        .filter(Boolean),
      text: str(page.text, LIMITS.text),
      elements: page.elements.slice(0, LIMITS.elements).map(cleanElement).filter(Boolean),
    },
    history: (Array.isArray(body.history) ? body.history : [])
      .slice(-LIMITS.history)
      .map(cleanHistoryEntry)
      .filter(Boolean),
  };
}
