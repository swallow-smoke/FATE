// Phase 16+ · Promise System
//
// Promises are first-class: made, then kept or broken, with the outcome pushed
// straight into the relationship (trust/respect). An open promise with a due day
// feeds the Personal Calendar; letting it lapse breaks it automatically. This
// turns "약속을 지켜야 한다"는 서사적 긴장 into real, tracked state.

"use strict";

const relationshipGraph = require("../relationship/relationshipGraph");

let seq = 0;

function add(state, { npc_ref, summary, due_day = null, direction = "player_to_npc" }, turn) {
  state.promises = state.promises || [];
  seq += 1;
  const p = { id: `promise_${String(turn || 0).padStart(4, "0")}_${seq}`, npc_ref: npc_ref || null, summary: summary || "약속", made_turn: turn, due_day, direction, status: "open" };
  state.promises.push(p);
  return p;
}

function get(state, id) { return (state.promises || []).find((p) => p.id === id) || null; }

function applyOutcome(state, p, kept, turn) {
  p.status = kept ? "kept" : "broken";
  p.resolved_turn = turn;
  // relationship consequence (player↔NPC edge), only for player-made promises.
  if (p.npc_ref && p.direction !== "npc_to_player") {
    const deltas = kept ? { trust: 0.15, respect: 0.1 } : { trust: -0.2, respect: -0.1 };
    relationshipGraph.applyPlayerDelta(state, p.npc_ref, deltas, { summary: `${kept ? "약속을 지킴" : "약속을 어김"}: ${p.summary}` });
  }
  return p;
}

function keep(state, id, turn) { const p = get(state, id); return p && p.status === "open" ? applyOutcome(state, p, true, turn) : p; }
function breakPromise(state, id, turn) { const p = get(state, id); return p && p.status === "open" ? applyOutcome(state, p, false, turn) : p; }

// Overdue open promises (due day passed) break on their own. Returns broken ones.
function tick(state) {
  const today = state.in_world_day || 1;
  const broken = [];
  for (const p of state.promises || []) {
    if (p.status === "open" && p.due_day != null && today > p.due_day) { applyOutcome(state, p, false, state.turn_number); broken.push({ id: p.id, npc_ref: p.npc_ref, summary: p.summary }); }
  }
  return { broken };
}

// Apply narrative-detected changes: { made:[{npc_ref,summary,due_day}], kept:[id|{npc_ref,summary}], broken:[...] }.
function applyExtraction(state, changes, turn) {
  const out = { made: [], kept: [], broken: [] };
  if (!changes) return out;
  for (const m of changes.made || []) out.made.push(add(state, m, turn).id);
  const resolveBy = (ref) => (state.promises || []).find((p) => p.status === "open" && (p.id === ref || p.npc_ref === (ref && ref.npc_ref) || p.id === (ref && ref.id)));
  for (const k of changes.kept || []) { const p = resolveBy(k); if (p) { keep(state, p.id, turn); out.kept.push(p.id); } }
  for (const b of changes.broken || []) { const p = resolveBy(b); if (p) { breakPromise(state, p.id, turn); out.broken.push(p.id); } }
  return out;
}

function playerVisible(state, canonDb) {
  return (state.promises || []).map((p) => ({
    id: p.id, summary: p.summary, status: p.status, due_day: p.due_day, direction: p.direction,
    npc_name: p.npc_ref && canonDb ? ((canonDb.get(p.npc_ref) || {}).data || {}).birth_name || p.npc_ref : null,
  }));
}

// Directive: remind the GM of open promises involving a present NPC.
function directive(state, participants) {
  const open = (state.promises || []).filter((p) => p.status === "open" && p.npc_ref && (participants || []).includes(p.npc_ref));
  if (!open.length) return null;
  return `미이행 약속: ${open.map((p) => `"${p.summary}"`).join(", ")} — 관련 인물이 이 장면에 있다. 약속이 아직 유효함을 서사가 은근히 의식하게 하라.`;
}

module.exports = { add, keep, breakPromise, tick, applyExtraction, playerVisible, directive, get };
