// Phase 7 Part A4 — Mystery/단서 추적
//
// A Mystery is a puzzle the player actively solves (distinct from Foreshadow,
// which is authorial). Discovery-type scenes surface the next hidden clue; once
// enough clues are revealed the mystery becomes resolvable. Numbers stay
// internal — the player sees revealed clues, not counts/thresholds.

"use strict";

let seq = 0;

function create(state, { question, clues = [], required = 3 }) {
  state.mysteries = state.mysteries || [];
  seq += 1;
  const m = {
    mystery_id: `myst_${String(seq).padStart(4, "0")}`,
    question,
    clues: clues.map((c, i) => ({
      clue_id: `clue_${String(i + 1).padStart(2, "0")}`,
      revealed: false, revealed_turn: null,
      content_summary: typeof c === "string" ? c : c.content_summary,
    })),
    required_clues: required,
    resolvable: false,
    resolved: false,
  };
  state.mysteries.push(m);
  return m;
}

function activeMystery(state) {
  return (state.mysteries || []).find((m) => !m.resolved) || null;
}

// The hint injected into a Discovery scene: names the next hidden clue so the
// scene can weave its discovery in (does NOT reveal it yet — the turn does).
function discoveryHint(state) {
  const m = activeMystery(state);
  if (!m) return null;
  const next = m.clues.find((c) => !c.revealed);
  if (!next) return null;
  return { mystery_id: m.mystery_id, clue_id: next.clue_id, question: m.question, content_summary: next.content_summary };
}

// Called at turn end when the composed scene was a Discovery scene: reveal the
// next clue and re-evaluate resolvability.
function revealOnDiscovery(state, sceneSpec) {
  if (!sceneSpec || !(sceneSpec.scene_type || []).includes("discovery")) return null;
  const m = activeMystery(state);
  if (!m) return null;
  const next = m.clues.find((c) => !c.revealed);
  if (!next) return null;
  next.revealed = true;
  next.revealed_turn = state.turn_number;
  const revealedCount = m.clues.filter((c) => c.revealed).length;
  m.resolvable = revealedCount >= m.required_clues;
  return { mystery_id: m.mystery_id, clue_id: next.clue_id, resolvable: m.resolvable };
}

module.exports = { create, activeMystery, discoveryHint, revealOnDiscovery };
