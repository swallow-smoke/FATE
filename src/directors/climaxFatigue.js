// PATCH_INDIVIDUAL_WORKS_ANALYSIS · Climax Resolution-Pattern Fatigue
//
// Individual-work analysis kept turning up the same rot: a story that resolves
// every climax the *same way* — always a heroic last-second reversal, always a
// tearful reconciliation, always the same beat shape — goes stale even when each
// instance is fine in isolation. This director fingerprints how the last several
// high-intensity resolutions (catharsis / ending / big payoff scenes) were
// shaped, and when the pattern repeats too often it nudges the GM to resolve the
// NEXT climax differently (a quiet win instead of a loud one, a cost instead of a
// clean victory, an ambiguous beat instead of a bow).
//
// Reads scene_history; records a small fingerprint log. Mock-safe, numbers hidden.

"use strict";

const WINDOW = 5;        // look at the last N climaxes
const REPEAT_LIMIT = 3;  // this many same-shaped in a row = fatigue

// Fingerprint a resolved climax from its scene record. Coarse on purpose: the
// dominant scene function + mood + whether it leaned on a check reversal.
function fingerprint(sceneRec) {
  const types = (sceneRec.scene_type || []).slice().sort().join("+");
  return `${types}|${sceneRec.mood || "-"}`;
}

function isClimax(sceneRec) {
  const t = new Set(sceneRec.scene_type || []);
  return t.has("catharsis") || t.has("ending") || (t.has("conflict") && (sceneRec.intensity || 0) >= 4);
}

// Record this turn's scene if it was a climax. Returns the updated fingerprint log.
function record(state, sceneSpec) {
  if (!isClimax(sceneSpec)) return null;
  state.climax_log = [...(state.climax_log || []), { turn: state.turn_number, fp: fingerprint(sceneSpec) }].slice(-WINDOW * 2);
  return state.climax_log;
}

// Are the most recent climaxes monotonous? Returns { fatigued, pattern, streak }.
function assess(state) {
  const log = (state.climax_log || []).slice(-WINDOW);
  if (log.length < REPEAT_LIMIT) return { fatigued: false, pattern: null, streak: log.length };
  const lastFp = log[log.length - 1].fp;
  let streak = 0;
  for (let i = log.length - 1; i >= 0; i--) { if (log[i].fp === lastFp) streak++; else break; }
  return { fatigued: streak >= REPEAT_LIMIT, pattern: lastFp, streak };
}

// Soft directive, computed BEFORE the narrative from PAST climaxes, nudging the
// next resolution to break the pattern. null unless fatigued.
function directive(state) {
  const a = assess(state);
  if (!a.fatigued) return null;
  return "해소 패턴 참고: 최근 절정들이 비슷한 방식으로 매듭지어졌다. 이번에 큰 해소가 온다면 지난번들과 다른 결로 풀어라 — 요란한 승리 대신 조용한 대가, 완결된 화해 대신 여지가 남는 매듭, 혹은 이긴 자리에 남는 상실처럼. 같은 카타르시스를 반복하지 마라.";
}

module.exports = { fingerprint, isClimax, record, assess, directive, WINDOW, REPEAT_LIMIT };
