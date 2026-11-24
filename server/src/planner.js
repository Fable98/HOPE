// Turns { goal, page, history } into one decision, using the model or the mock.
// The extension checks the decision again; this only rejects replies that are
// clearly not a decision at all.

import { extractJson, LlmError } from './llm.js';
import { mockPlan } from './mockPlanner.js';
import { buildPlannerPrompt, PLANNER_SYSTEM } from './prompts.js';

const TYPES = new Set(['act', 'ask', 'confirm', 'done']);

export function createPlanner({ llm, model }) {
  return async function plan(input) {
    if (!llm) return mockPlan(input);
    const text = await llm.complete({
      model,
      system: PLANNER_SYSTEM,
      prompt: buildPlannerPrompt(input),
      maxTokens: 4000,
    });
    const decision = extractJson(text);
    if (!decision || typeof decision !== 'object' || !TYPES.has(decision.type)) {
      throw new LlmError('planner reply had no valid type');
    }
    return decision;
  };
}
