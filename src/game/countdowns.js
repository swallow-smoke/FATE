// Phase 10 Part O — event countdowns. ONLY events the player already knows about
// appear (revealed_to_player === true on the scheduled_action / foreshadow).
// Unknown future events must never surface — that would be a spoiler.

"use strict";

function build(state) {
  const turn = state.turn_number;
  const out = [];
  for (const a of state.scheduled_actions || []) {
    if (a.revealed_to_player && a.status === "pending" && a.trigger_turn > turn) {
      out.push({ kind: a.type, label: a.type === "letter_delivery" ? `편지 도착 (→ ${a.payload && a.payload.recipient})` : (a.payload && a.payload.summary) || a.type, turns_left: a.trigger_turn - turn });
    }
  }
  for (const f of state.foreshadow_pool || []) {
    if (f.revealed_to_player && !f.resolved && f.deadline_turn > turn) {
      out.push({ kind: "foreshadow", label: f.label || "예고된 사건", turns_left: f.deadline_turn - turn });
    }
  }
  return out.sort((a, b) => a.turns_left - b.turns_left);
}

module.exports = { build };
