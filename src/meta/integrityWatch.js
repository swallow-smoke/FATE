// Phase 14 Part W — narrative integrity monitoring.
//
// W1 (AI Watchdog): the extraction call now also reports integrity_issues
// (canon contradiction / character-voice drift / world-rule break). A HIGH
// severity issue triggers exactly one silent regeneration of this turn's
// narrative before it reaches the player; low/medium are logged only (avoids
// runaway API cost — Phase 12/13 token discipline).
//
// W2 (Hallucination Checker): proper nouns in the narrative are checked against
// Canon. An unknown-but-recurring name becomes a canon.register CANDIDATE (not
// auto-registered — surfaced for review). A character Canon records as "dead"
// reappearing with no explanation is a HIGH integrity issue (feeds W1).
//
// Also hosts the Phase 13 V6 consecutive-parse-failure counter, since that is
// the same "is extraction healthy?" concern.

"use strict";

function appendLog(state, entry) {
  state.integrity_log = [
    ...(state.integrity_log || []),
    { turn: state.turn_number, ...entry },
  ].slice(-80);
}

// Decide whether this turn needs a watchdog regeneration, and collect W2 signals.
// Pure: does not mutate state. Returns
//   { regenerate, reason, issues, dead_reappearances, register_candidates, parse_failure }
function evaluate(state, canonDb, { narrative, extraction }) {
  const issues = Array.isArray(extraction.integrity_issues) ? extraction.integrity_issues.slice() : [];
  const parse_failure = !!extraction._parse_error;

  // W2 — dead characters reappearing.
  const dead_reappearances = [];
  const text = String(narrative || "");
  for (const e of (canonDb.all ? canonDb.all() : [])) {
    if (e.type !== "Character") continue;
    if (!(e.data && e.data.current_status === "dead")) continue;
    const name = (e.data && e.data.birth_name) || e.canon_id;
    if (name && text.includes(name)) {
      dead_reappearances.push({ canon_id: e.canon_id, name });
      issues.push({ type: "dead_character_reappearance", description: `죽은 것으로 기록된 "${name}"이(가) 설명 없이 다시 등장`, severity: "high" });
    }
  }

  // W2 — unknown-but-recurring proper nouns → register candidates.
  const known = new Set((canonDb.all ? canonDb.all() : []).flatMap((e) => [e.canon_id, e.data && e.data.birth_name].filter(Boolean)));
  const register_candidates = (extraction.proper_nouns || [])
    .filter((n) => n && n.name && n.is_recurring && !known.has(n.name))
    .map((n) => ({ name: n.name, kind: n.kind || "character", suggested_turn: state.turn_number }));

  const high = issues.find((i) => i && i.severity === "high");
  return {
    regenerate: !!high,
    reason: high ? `${high.type}: ${high.description}` : null,
    issues,
    dead_reappearances,
    register_candidates,
    parse_failure,
  };
}

// Persist the results of a turn's integrity check (after any regeneration).
// Updates the V6 parse-failure streak and logs issues / hallucination candidates.
function commit(state, watch) {
  // V6 — consecutive parse-failure counter.
  if (watch.parse_failure) {
    state.extraction_failure_streak = (state.extraction_failure_streak || 0) + 1;
    if (state.extraction_failure_streak >= 3) {
      appendLog(state, { severity: "high", source: "validator", message: `추출 JSON 파싱 ${state.extraction_failure_streak}회 연속 실패 — 추출 프롬프트 점검 필요` });
    }
  } else {
    state.extraction_failure_streak = 0;
  }

  for (const issue of watch.issues || []) {
    appendLog(state, { severity: issue.severity || "low", source: "watchdog", message: `[${issue.type}] ${issue.description}` });
  }

  if ((watch.register_candidates || []).length) {
    const existing = new Set((state.hallucination_candidates || []).map((c) => c.name));
    state.hallucination_candidates = [
      ...(state.hallucination_candidates || []),
      ...watch.register_candidates.filter((c) => !existing.has(c.name)),
    ].slice(-40);
  }
  return {
    parse_failure_streak: state.extraction_failure_streak || 0,
    logged_issues: (watch.issues || []).length,
    register_candidates: (watch.register_candidates || []).length,
  };
}

module.exports = { evaluate, commit, appendLog };
