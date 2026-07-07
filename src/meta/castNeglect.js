// PATCH_INDIVIDUAL_WORKS_ANALYSIS · Supporting-Cast Neglect Detection
//
// A common failure in long stories: an NPC gets built up — a bond, a private
// arc, unfinished business — and then quietly vanishes for dozens of turns
// because the spotlight drifted elsewhere. This detector notices *invested* NPCs
// (a live npc_arc, or a strong player bond, or an unresolved promise/secret) who
// haven't appeared in a long while, and hands the GM a gentle nudge to bring
// them back on their own terms — not a forced entrance.
//
// Reads PATCH_WEBNOVEL_TECHNIQUES npc_arcs + relationships + scene_history. Pure-
// ish (only touches a small neglect_log for cooldowns). calm_mode still surfaces
// neglect (re-including a loved character is relational, not disruptive).

"use strict";

const NEGLECT_TURNS = 30;   // not seen in this many turns = neglected
const BOND = 0.4;           // "invested" bond threshold
const NUDGE_COOLDOWN = 20;  // don't nudge about the same NPC too often

function lastSeen(state, ref) {
  let last = -Infinity;
  for (const h of state.scene_history || []) if ((h.participants || []).includes(ref)) last = Math.max(last, h.turn);
  return last;
}

function bondOf(state, ref) {
  const n = (state.npcs || []).find((x) => x.canon_ref === ref);
  const rel = (n && n.relationship_to_player) || {};
  return Math.max(...["affection", "trust", "respect", "dependency", "obligation"].map((d) => Number(rel[d]) || 0), 0);
}

// Return the list of neglected-but-invested NPCs, most-invested first.
function detect(state, canonDb) {
  const turn = state.turn_number;
  const seen = new Set();
  const candidates = [];

  // 1. NPCs with a live personal arc (built-up but unresolved).
  for (const a of state.npc_arcs || []) {
    if (a.stage !== "resolved") candidates.push({ ref: a.npc_ref, reason: "arc", weight: 3, arc_stage: a.stage });
  }
  // 2. Strongly-bonded NPCs.
  for (const n of state.npcs || []) {
    if (bondOf(state, n.canon_ref) >= BOND) candidates.push({ ref: n.canon_ref, reason: "bond", weight: 2 });
  }
  // 3. NPCs owed an open promise or holding a tellable secret.
  for (const p of state.promises || []) {
    if (p.status === "open" || p.status === "active") candidates.push({ ref: p.npc_ref, reason: "promise", weight: 2 });
  }

  const out = [];
  for (const c of candidates) {
    if (!c.ref || seen.has(c.ref)) continue;
    const ent = canonDb && canonDb.get(c.ref);
    if (!ent || ent.type !== "Character") continue;
    if (ent.data && (ent.data.current_status === "dead" || ent.data.archived || ent.data.echo_state)) continue;
    const ls = lastSeen(state, c.ref);
    const gap = ls === -Infinity ? turn - (ent.registered_at_turn || 0) : turn - ls;
    if (gap < NEGLECT_TURNS) continue;
    seen.add(c.ref);
    out.push({ ref: c.ref, name: (ent.data && ent.data.birth_name) || c.ref, turns_absent: gap, reason: c.reason, weight: c.weight });
  }
  out.sort((a, b) => (b.weight - a.weight) || (b.turns_absent - a.turns_absent));
  return out;
}

// Soft directive naming the single most-neglected invested NPC (cooldown-gated).
function directive(state, canonDb) {
  const neglected = detect(state, canonDb);
  if (!neglected.length) return null;
  const turn = state.turn_number;
  state.neglect_log = state.neglect_log || {};
  for (const n of neglected) {
    const last = state.neglect_log[n.ref];
    if (last != null && turn - last < NUDGE_COOLDOWN) continue;
    state.neglect_log[n.ref] = turn;
    return `조연 환기: ${n.name}은(는) 한동안(${n.turns_absent}턴) 이야기에서 멀어져 있었지만 아직 매듭짓지 못한 사연이 남아 있다. 억지로 끌어들이지 말고, 자연스러운 계기(소문·편지·우연·다른 인물의 언급)로 이 인물의 존재를 다시 이야기 안으로 들여올 수 있는지 살펴라.`;
  }
  return null;
}

module.exports = { detect, directive, NEGLECT_TURNS, BOND };
