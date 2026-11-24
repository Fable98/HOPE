// A rule-based stand-in for the planner model. It lets you try the whole
// extension without an API key, and it keeps the tests deterministic.
// It is deliberately simple: fill empty fields by asking, pick from lists by
// asking (or silently when the goal names an option), ask about required tick
// boxes, then press the next button.

const TEXT_ROLES = new Set(['textbox', 'textarea']);
const DONE_TEXT = /\b(thank you|is confirmed|successfully|booking reference|appointment is booked|order number)\b/i;
const NEXT_LABEL = /^(next|continue|proceed|search)\b/i;
const FINAL_LABEL = /\b(book|confirm|submit|pay|place order|finish|buy|send)\b/i;

function words(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 3);
}

// Tiny synonym list so the demo goal "skin doctor" finds "Dermatology".
const SYNONYMS = { skin: ['dermatolog'], teeth: ['dent'], tooth: ['dent'], heart: ['cardio'], eyes: ['ophthalm', 'eye'], child: ['paediatr', 'pediatr'] };

function goalMatches(goal, label) {
  const l = label.toLowerCase();
  return words(goal).some((w) => l.includes(w) || (SYNONYMS[w] || []).some((s) => l.includes(s)));
}

function progressFor(history) {
  const step = history.filter((h) => h.kind === 'action' || h.kind === 'answer').length + 1;
  return { step, total: Math.max(step + 2, 5) };
}

// The first sentence on the page that mentions money, so the confirm card shows it.
function amountSentence(text) {
  const match = (text || '').match(/[^.!?]*(₹|\$|€|£|\bRs\.?)\s?\d[\d,]*(\.\d+)?[^.!?]*[.!?]?/);
  return match ? ` ${match[0].trim()}` : '';
}

function inputKind(el) {
  return ['email', 'tel', 'number', 'date'].includes(el.type) ? el.type : 'text';
}

export function mockPlan({ goal, page, history }) {
  const progress = progressFor(history);
  const handled = new Set();
  for (const h of history) {
    if (h.targetId) handled.add(h.targetId);
    if (h.group) handled.add(`group:${h.group}`);
  }
  const usable = page.elements.filter((e) => !e.disabled);

  if (DONE_TEXT.test(page.text)) {
    return { type: 'done', reason: 'success text on page', message: 'It looks like this is finished. The page says it went through.', progress };
  }

  for (const el of usable) {
    if (!TEXT_ROLES.has(el.role) || el.value || handled.has(el.id)) continue;
    if (el.sensitive) {
      return {
        type: 'ask', reason: 'sensitive field', progress,
        question: `Please fill in "${el.label || 'this box'}" yourself.`,
        manual: { targetId: el.id, instruction: 'Type it in the highlighted box on the page. Hope does not see or type private details.' },
      };
    }
    return {
      type: 'ask', reason: 'empty field', progress,
      question: `What should I put for "${el.label || 'this box'}"?`,
      input: { targetId: el.id, kind: inputKind(el) },
    };
  }

  for (const el of usable) {
    if (el.role !== 'select' || handled.has(el.id)) continue;
    const selected = el.options?.find((o) => o.selected);
    if (selected && selected.value) continue;
    const choices = (el.options || []).filter((o) => o.value);
    if (choices.length === 0) continue;
    const match = choices.find((o) => goalMatches(goal, o.label));
    if (match) {
      return {
        type: 'act', reason: 'goal names an option', progress,
        action: { kind: 'select', targetId: el.id, value: match.value },
        log: `Chose "${match.label}" because it matches what you asked for`,
      };
    }
    return {
      type: 'ask', reason: 'choose from list', progress,
      question: `Which one do you want for "${el.label || 'this'}"?`,
      options: choices.slice(0, 5).map((o) => ({ label: o.label, action: { kind: 'select', targetId: el.id, value: o.value } })),
    };
  }

  const groups = new Map();
  for (const el of usable) {
    if (el.role !== 'radio' || !el.group) continue;
    if (!groups.has(el.group)) groups.set(el.group, []);
    groups.get(el.group).push(el);
  }
  for (const [group, radios] of groups) {
    if (radios.some((r) => r.checked) || handled.has(`group:${group}`)) continue;
    const question = `Which one do you want for "${group}"?`;
    const match = radios.find((r) => goalMatches(goal, r.label));
    if (match) {
      return {
        type: 'act', reason: 'goal names an option', progress,
        action: { kind: 'click', targetId: match.id },
        log: `Chose "${match.label}" because it matches what you asked for`,
      };
    }
    return {
      type: 'ask', reason: 'choose radio', progress,
      question,
      options: radios.slice(0, 5).map((r) => ({ label: r.label, action: { kind: 'click', targetId: r.id } })),
    };
  }

  for (const el of usable) {
    if (el.role !== 'checkbox' || !el.required || el.checked || handled.has(el.id)) continue;
    return {
      type: 'ask', reason: 'required tick box', progress,
      question: 'Do you agree to this?',
      help: el.label,
      options: [{ label: 'Yes, I agree', action: { kind: 'check', targetId: el.id, value: true } }],
    };
  }

  const last = [...history].reverse().find((h) => h.kind === 'action');
  const buttons = usable.filter((e) => (e.role === 'button' || e.role === 'link') && e.id !== last?.targetId);
  const next = buttons.find((b) => NEXT_LABEL.test(b.label) && !FINAL_LABEL.test(b.label));
  if (next) {
    return { type: 'act', reason: 'next button', progress, action: { kind: 'click', targetId: next.id }, log: `Pressed "${next.label}"` };
  }
  const confirmClick = (b) => ({
    type: 'confirm', reason: 'final button', progress,
    action: { kind: 'click', targetId: b.id },
    summary: `You are about to press "${b.label}".${amountSentence(page.text)}`,
  });
  const submitFinal = buttons.find((b) => b.submits && FINAL_LABEL.test(b.label));
  if (submitFinal) return confirmClick(submitFinal);
  const related = buttons.find((b) => !b.submits && goalMatches(goal, b.label));
  if (related) {
    return { type: 'act', reason: 'matches goal', progress, action: { kind: 'click', targetId: related.id }, log: `Opened "${related.label}"` };
  }
  const final = buttons.find((b) => FINAL_LABEL.test(b.label));
  if (final) return confirmClick(final);

  return { type: 'done', reason: 'nothing left', message: 'I could not find anything else to do on this page.', progress };
}
