// Rewrites short texts (questions, option labels, field labels) in plain
// language with the cheaper model. Falls back to a small jargon list on any
// problem, because a slightly stiff label is better than a failed card.

import { extractJson } from './llm.js';
import { SIMPLIFY_SYSTEM } from './prompts.js';

export const MAX_TEXTS = 20;
export const MAX_TEXT_LENGTH = 300;
const CACHE_SIZE = 1000;

// Used by the mock provider and as a cheap first pass: common form jargon.
const JARGON = [
  [/\bas per KYC records\b/gi, 'as on your ID'],
  [/\bKYC\b/g, 'ID check'],
  [/\bOTP\b/g, 'one-time code'],
  [/\bDOB\b/g, 'date of birth'],
  [/\bmandatory\b/gi, 'needed'],
  [/\bkindly\b/gi, 'please'],
  [/\bproceed\b/gi, 'continue'],
  [/\bnominee\b/gi, 'person who gets the money'],
];

export function replaceJargon(text) {
  return JARGON.reduce((t, [pattern, plain]) => t.replace(pattern, plain), text);
}

export function cleanTexts(body) {
  if (!body || !Array.isArray(body.texts)) return null;
  if (body.texts.length === 0 || body.texts.length > MAX_TEXTS) return null;
  if (!body.texts.every((t) => typeof t === 'string')) return null;
  return body.texts.map((t) => t.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH));
}

export function createSimplifier({ llm, model }) {
  const cache = new Map();

  function remember(key, value) {
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value);
    cache.set(key, value);
  }

  return async function simplify(texts) {
    const result = texts.slice();
    const todo = [];
    texts.forEach((t, i) => {
      if (cache.has(t)) result[i] = cache.get(t);
      else if (t.length < 4) result[i] = t;
      else todo.push(i);
    });
    if (todo.length === 0) return result;

    // The jargon list is the answer for the mock provider and the fallback otherwise.
    for (const i of todo) result[i] = replaceJargon(texts[i]);
    if (!llm) return result;

    try {
      const reply = await llm.complete({
        model,
        system: SIMPLIFY_SYSTEM,
        prompt: JSON.stringify({ texts: todo.map((i) => texts[i]) }),
        maxTokens: 1500,
      });
      const out = extractJson(reply).texts;
      if (!Array.isArray(out) || out.length !== todo.length) return result;
      todo.forEach((i, k) => {
        const plain = typeof out[k] === 'string' && out[k].trim() ? out[k].trim().slice(0, MAX_TEXT_LENGTH) : result[i];
        result[i] = plain;
        remember(texts[i], plain);
      });
    } catch {
      // keep the jargon-list version
    }
    return result;
  };
}
