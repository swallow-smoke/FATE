// Phase 13 V3 — Token Budget Manager.
//
// Until now each context block was capped by item count ("top 5~8"), never by a
// token total. This assigns an explicit per-block budget and trims the lowest-
// priority items until a block fits. The estimate is deliberately cheap and
// model-agnostic (no tokenizer dependency): ~1 token per 2 chars for CJK-heavy
// text, which is close enough for budgeting. The exact figure lands in the
// Advanced panel (Phase 7 D) via state.prompt_profile.last_token_budget.

"use strict";

const DEFAULT_TURN_BUDGET = 8000;
const DEFAULT_ALLOCATION = {
  canon_context: 2000,
  memory_context: 2500,
  recent_dialogue: 2000,
  directives: 1500,
};

// Cheap heuristic token estimate. Korean/CJK averages well under 2 chars/token
// on Gemini; we use 2.2 as a conservative-ish divisor so we under-trim rather
// than blow the budget.
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 2.2);
}

// Trim an array of {text, priority} items to fit `budget` tokens, dropping the
// lowest priority first. Returns { kept, dropped, tokens }.
function trimToBudget(items, budget) {
  const est = items.map((it) => ({ ...it, tokens: estimateTokens(it.text) }));
  let total = est.reduce((s, it) => s + it.tokens, 0);
  const dropped = [];
  if (total <= budget) return { kept: est, dropped, tokens: total };
  // sort a shallow copy by ascending priority (drop least important first)
  const order = est.map((it, i) => ({ it, i })).sort((a, b) => (a.it.priority || 0) - (b.it.priority || 0));
  const removed = new Set();
  for (const { it, i } of order) {
    if (total <= budget) break;
    removed.add(i);
    total -= it.tokens;
    dropped.push(it);
  }
  const kept = est.filter((_, i) => !removed.has(i));
  return { kept, dropped, tokens: total };
}

// Record the composed budget breakdown onto the state for the Advanced panel.
function record(state, breakdown) {
  state.prompt_profile = state.prompt_profile || {};
  state.prompt_profile.last_token_budget = {
    turn: state.turn_number,
    total_budget: breakdown.total_budget,
    used: breakdown.used,
    by_block: breakdown.by_block,
    trimmed: breakdown.trimmed,
  };
}

module.exports = { DEFAULT_TURN_BUDGET, DEFAULT_ALLOCATION, estimateTokens, trimToBudget, record };
