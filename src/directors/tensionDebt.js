// PATCH_WEBNOVEL_TECHNIQUES · Tension Debt (고구마-사이다 리듬)
//
// Web-novel pacing runs on a debt cycle: oppressive / frustrating beats (고구마 —
// the hero is thwarted, wronged, misunderstood) accumulate *tension debt*, and a
// satisfying payoff (사이다 — the comeback, the vindication, the reversal) pays
// it down. Too much unpaid debt and readers bail; payoffs that come too cheaply
// and the release feels unearned. This director tracks the debt and hands the
// GM a soft rhythm cue — never forcing a beat, only signalling when the story is
// running a fever (payoff overdue) or has just discharged (don't immediately
// pile on more).
//
// Sits alongside rhythmDirector; reads the composed scene + this turn's check.
// Mock-safe, numbers never shown to the player. calm_mode damps the whole loop
// (a calm campaign isn't playing the 고구마-사이다 game).

"use strict";

const HIGH = 3.0;      // payoff is overdue at/above this
const RELIEF_COOLDOWN = 3; // turns after a payoff where we ask for breathing room
const MAX_LEVEL = 6;

function ensure(state) {
  if (!state.tension_debt || typeof state.tension_debt !== "object") {
    state.tension_debt = { level: 0, last_payoff_turn: null, peak: 0, history: [] };
  }
  return state.tension_debt;
}

// Soft directive computed BEFORE the narrative, from the CURRENT debt. Returns a
// rhythm cue or null. calm_mode → always null.
function directive(state) {
  if (state.settings && state.settings.calm_mode) return null;
  const td = ensure(state);
  const turn = state.turn_number;
  if (td.last_payoff_turn != null && turn - td.last_payoff_turn < RELIEF_COOLDOWN) {
    return "리듬 참고: 방금 큰 해소(사이다)가 있었다. 곧바로 새 억압·굴욕을 쌓지 말고, 여운과 숨 고르기를 한 박자 허용하라. 해소의 온기가 관계에 남게 하라.";
  }
  if (td.level >= HIGH) {
    return "리듬 참고: 답답함(고구마)이 오래 쌓였다. 억지 반전이 아니라, 지금까지 참아온 것이 정당하게 보상받는 해소의 순간(사이다)이 자연스럽게 올 수 있는지 살펴라 — 인물의 통쾌함보다 '드디어'라는 정당함을 우선하라.";
  }
  return null;
}

// Update the debt AFTER the scene resolves. Frustration raises it; payoff pays
// it down. Returns { level, delta, payoff:boolean }.
function update(state, { sceneSpec, check, difficulty }) {
  const td = ensure(state);
  const calm = !!(state.settings && state.settings.calm_mode);
  const turn = state.turn_number;
  const types = new Set((sceneSpec && sceneSpec.scene_type) || []);
  const intensity = (sceneSpec && sceneSpec.intensity) || 0;
  let delta = 0;
  let payoff = false;

  // 고구마 — thwarted / oppressive beats accumulate debt.
  if (types.has("conflict")) delta += 0.6 + Math.max(0, intensity - 2) * 0.2;
  if (check && check.outcome === "fail") delta += 0.6;
  if (difficulty && /연패|losing/.test(String(difficulty.hint || difficulty.streak_kind || ""))) delta += 0.4;

  // 사이다 — genuine release pays debt down (and records a payoff moment).
  if (types.has("catharsis")) { delta -= 2.2; payoff = true; }
  if (types.has("bond") && intensity >= 2) delta -= 0.6;
  if (check && check.outcome === "success" && check.crit) { delta -= 0.8; payoff = true; }

  if (calm) delta *= 0.3; // calm campaigns barely play the game

  td.level = Math.max(0, Math.min(MAX_LEVEL, td.level + delta));
  td.peak = Math.max(td.peak || 0, td.level);
  if (payoff && delta < 0) td.last_payoff_turn = turn;
  td.history = [...(td.history || []), { turn, level: Number(td.level.toFixed(2)), delta: Number(delta.toFixed(2)), payoff }].slice(-40);
  return { level: td.level, delta, payoff };
}

module.exports = { ensure, directive, update, HIGH, MAX_LEVEL };
