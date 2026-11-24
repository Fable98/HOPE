// Fixed rules, not the AI, decide what counts as irreversible.
// These rules can only make a decision stricter: a silent click becomes a
// confirmation card. They never turn a confirmation into a silent action.

// Words that mean money moves, something is sent, or something is removed.
const DANGER_BUTTON = /\b(pay|payment|checkout|check out|place (your |my )?order|order now|buy|purchase|book|reserve|submit|send|transfer|delete|remove|cancel|unsubscribe|sign|e-?sign|authori[sz]e|donate|subscribe|confirm|finish|complete|apply|deactivate|close (my |your )?account|renew|upgrade|withdraw|redeem|claim|accept offer)\b/i;

// Links usually only navigate, so only the strongest words count for them.
const DANGER_LINK = /\b(pay|pay now|buy now|purchase|place (your |my )?order|delete|transfer|donate|unsubscribe|cancel (my |your )?(subscription|order|booking|account|plan)|deactivate)\b/i;

// Labels that are safe even when the control submits a form.
const SAFE_LABEL = /^(search|go|find|next|continue|proceed|back|previous|prev|ok|okay|close|show( more)?|view( more)?|more|load more|filter|apply filters?|sort|refresh|sign ?in|log ?in|sign in with .+|menu|skip|later|not now|no,? thanks)$/i;

const PROCEED_LABEL = /^(continue|proceed|next|confirm|ok|okay)\b/i;
const PAYMENT_PAGE = /\b(checkout|payment|pay|billing|card details)\b/i;
const CARD_HINT = /card|cvv|cvc|expir|cc-/i;

function normalize(label) {
  return String(label || '').replace(/\s+/g, ' ').trim().replace(/[›»→>.!]+$/, '').trim();
}

export function isPaymentPage(snapshot) {
  if (PAYMENT_PAGE.test(snapshot.url || '') || PAYMENT_PAGE.test(snapshot.title || '')) return true;
  return (snapshot.elements || []).some((e) => e.sensitive && CARD_HINT.test(`${e.label} ${e.type}`));
}

export function findElement(snapshot, targetId) {
  return (snapshot.elements || []).find((e) => e.id === targetId) || null;
}

// Returns { irreversible: boolean, reason: string }.
export function checkAction(action, snapshot) {
  if (!action || action.kind !== 'click') return { irreversible: false, reason: '' };
  const el = findElement(snapshot, action.targetId);
  if (!el) return { irreversible: false, reason: '' };
  const label = normalize(el.label);

  if (el.role === 'checkbox' || el.role === 'radio' || el.role === 'select') {
    return { irreversible: false, reason: '' };
  }

  if (SAFE_LABEL.test(label)) {
    if (PROCEED_LABEL.test(label) && isPaymentPage(snapshot)) {
      return { irreversible: true, reason: 'This is a payment page, so this button may pay.' };
    }
    return { irreversible: false, reason: '' };
  }

  if (el.role === 'link') {
    return DANGER_LINK.test(label)
      ? { irreversible: true, reason: `The link says "${label}".` }
      : { irreversible: false, reason: '' };
  }

  if (DANGER_BUTTON.test(label)) {
    return { irreversible: true, reason: `The button says "${label}".` };
  }
  if (el.submits) {
    return { irreversible: true, reason: 'This button sends a form.' };
  }
  if (PROCEED_LABEL.test(label) && isPaymentPage(snapshot)) {
    return { irreversible: true, reason: 'This is a payment page, so this button may pay.' };
  }
  return { irreversible: false, reason: '' };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'this website';
  }
}

export function fallbackSummary(action, snapshot) {
  const el = findElement(snapshot, action.targetId);
  const label = normalize(el?.label) || 'this button';
  return `You are about to press "${label}" on ${hostOf(snapshot.url)}. This may not be undoable.`;
}

// Applies the rules to a checked decision (see protocol.js).
export function applySafety(decision, snapshot) {
  if (decision.type === 'act') {
    const check = checkAction(decision.action, snapshot);
    if (check.irreversible) {
      return {
        type: 'confirm',
        action: decision.action,
        summary: fallbackSummary(decision.action, snapshot),
        help: check.reason,
        progress: decision.progress,
        raisedBySafety: true,
      };
    }
    return decision;
  }

  if (decision.type === 'confirm') {
    return { ...decision, help: decision.help || checkAction(decision.action, snapshot).reason || '' };
  }

  if (decision.type === 'ask' && decision.options) {
    return {
      ...decision,
      options: decision.options.map((o) => {
        const check = checkAction(o.action, snapshot);
        return check.irreversible
          ? { ...o, needsConfirm: true, summary: fallbackSummary(o.action, snapshot), reason: check.reason }
          : o;
      }),
    };
  }

  return decision;
}
