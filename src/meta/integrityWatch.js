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

// PATCH_WEBNOVEL_TECHNIQUES · narrative-trick exceptions.
// The Watchdog exists to catch *accidental* setting collapse. But some
// "contradictions" are deliberate craft — an unreliable narrator, a planted
// reversal, a concealed identity, a faked death. Those must NOT be auto-
// "corrected" into oblivion. Rule (project skip-list, non-negotiable): ONLY
// pre-registered tricks are exempt — a trick registered at/BEFORE the offending
// turn. A reversal invented this turn cannot retroactively excuse an issue.
const TRICK_KINDS = new Set(["unreliable_narrator", "planted_reversal", "concealed_identity", "faked_death", "misdirection"]);

function registerTrick(state, { kind, description, canon_refs }) {
  if (!TRICK_KINDS.has(kind)) return { ok: false, reason: `unknown trick kind "${kind}"` };
  state.narrative_tricks = state.narrative_tricks || [];
  const trick = {
    trick_id: "trick_" + String(state.narrative_tricks.length + 1).padStart(3, "0"),
    kind,
    description: String(description || "").slice(0, 300),
    canon_refs: Array.isArray(canon_refs) ? canon_refs.slice(0, 8) : [],
    registered_turn: state.turn_number,
    active: true,
  };
  state.narrative_tricks.push(trick);
  return { ok: true, trick };
}

// Which active, already-registered trick (if any) covers this integrity issue?
function coveringTrick(state, issue) {
  const tricks = (state.narrative_tricks || []).filter((t) => t.active && t.registered_turn <= state.turn_number);
  if (!tricks.length) return null;
  const desc = String(issue.description || "");
  for (const t of tricks) {
    // A trick referencing a named canon entity excuses issues mentioning it.
    if ((t.canon_refs || []).some((r) => desc.includes(r))) return t;
    // Campaign-wide craft tricks excuse the matching issue class.
    if (t.kind === "unreliable_narrator" && (issue.type === "character_voice" || issue.type === "canon_contradiction")) return t;
    if (t.kind === "faked_death" && issue.type === "dead_character_reappearance") return t;
    if ((t.kind === "planted_reversal" || t.kind === "concealed_identity" || t.kind === "misdirection") && issue.type === "canon_contradiction") return t;
  }
  return null;
}

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

  // PATCH_IP_EXTENSIONS_PROJECT_MIO — Canon Level: a contradiction against a
  // "core" (IP-bible) canon entity is escalated to high severity (core facts must
  // not drift). Campaign/speculative canon keeps whatever severity was reported.
  const coreNames = (canonDb.all ? canonDb.all() : [])
    .filter((e) => (e.canon_level || "campaign") === "core")
    .flatMap((e) => [e.canon_id, e.data && e.data.birth_name].filter(Boolean));
  if (coreNames.length) {
    for (const issue of issues) {
      if (issue.type === "canon_contradiction" && issue.severity !== "high" && coreNames.some((n) => String(issue.description || "").includes(n))) {
        issue.severity = "high";
        issue._core_escalated = true;
      }
    }
  }

  // PATCH_WEBNOVEL_TECHNIQUES — tag issues covered by a pre-registered narrative
  // trick as intentional; they are logged but never trigger a regeneration.
  const exempted = [];
  for (const issue of issues) {
    const trick = coveringTrick(state, issue);
    if (trick) { issue._exempt_trick = trick.trick_id; exempted.push(issue); }
  }
  const high = issues.find((i) => i && i.severity === "high" && !i._exempt_trick);
  return {
    regenerate: !!high,
    reason: high ? `${high.type}: ${high.description}` : null,
    issues,
    exempted,
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
    appendLog(state, {
      severity: issue._exempt_trick ? "info" : (issue.severity || "low"),
      source: issue._exempt_trick ? "watchdog(trick-exempt)" : "watchdog",
      message: issue._exempt_trick ? `[의도된 서술트릭:${issue._exempt_trick}] ${issue.type}: ${issue.description}` : `[${issue.type}] ${issue.description}`,
    });
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

module.exports = { evaluate, commit, appendLog, registerTrick, coveringTrick, TRICK_KINDS };
