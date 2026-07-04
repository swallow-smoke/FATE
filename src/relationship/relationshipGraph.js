// Phase 3 · Wave 1 · System 3 — Relationship Graph (NPC-NPC)
//
// Extends StateSchema §5 RelationshipEdge from player-NPC to NPC-NPC. Edges
// live in state.relationship_graph.edges. NPC-NPC relationships do NOT drift
// every turn — they change only when a World Simulation event triggers them
// (Wave 1 §3), keeping the world stable between events.

const clamp = (v) => Math.max(-1, Math.min(1, v));

function findEdge(state, from, to) {
  return (state.relationship_graph.edges || []).find((e) => e.from === from && e.to === to) || null;
}

// Upsert an edge (used by Kernel relationship.update and system triggers).
function upsert(state, patch) {
  let edge = findEdge(state, patch.from, patch.to);
  if (!edge) {
    edge = { from: patch.from, to: patch.to, trust: 0, affection: 0, fear: 0, respect: 0, obligation: 0, type: patch.type || "acquaintance" };
    state.relationship_graph.edges.push(edge);
  }
  for (const k of ["trust", "affection", "fear", "respect", "obligation"]) {
    if (patch[k] !== undefined) edge[k] = clamp(patch[k]);
    if (patch["delta_" + k] !== undefined) edge[k] = clamp((edge[k] || 0) + patch["delta_" + k]);
  }
  if (patch.type) edge.type = patch.type;
  edge.last_changed_turn = state.turn_number;
  return edge;
}

// When a world event fires, NPCs who share an affected faction lose trust in
// one another (Wave 1 §3 example: 흉작 -> 관련 세력 소속 NPC간 trust 하락).
function applyWorldEvent(state, event, canonDb) {
  if (!event || !event.affected_factions || !event.affected_factions.length) return [];
  const affected = new Set(event.affected_factions);
  const npcsHere = canonDb
    .all()
    .filter((e) => e.type === "Character" && (e.data.affiliations || []).some((a) => affected.has(a)))
    .map((e) => e.canon_id);

  const changes = [];
  for (let i = 0; i < npcsHere.length; i++) {
    for (let j = i + 1; j < npcsHere.length; j++) {
      upsert(state, { from: npcsHere[i], to: npcsHere[j], delta_trust: -0.1 });
      upsert(state, { from: npcsHere[j], to: npcsHere[i], delta_trust: -0.1 });
      changes.push([npcsHere[i], npcsHere[j]]);
    }
  }
  return changes;
}

// --- player↔NPC edges (stored on state.npcs[].relationship_to_player) --------
// Distinct from the NPC-NPC graph above: the relations tab and NPCBrain read the
// player edge off state.npcs, so player-facing relationship changes are applied
// here. Returns the edge (created neutral if the NPC is met but had none yet).
function playerEdge(state, npcRef) {
  const n = (state.npcs || []).find((x) => x.canon_ref === npcRef);
  return (n && n.relationship_to_player) || null;
}
function ensurePlayerEdge(state, npcRef) {
  state.npcs = state.npcs || [];
  let n = state.npcs.find((x) => x.canon_ref === npcRef);
  if (!n) { n = { canon_ref: npcRef, relationship_to_player: null }; state.npcs.push(n); }
  if (!n.relationship_to_player) {
    n.relationship_to_player = { from: npcRef, to: "player_main", trust: 0, affection: 0, fear: 0, respect: 0, obligation: 0, type: "acquaintance", last_changed_turn: state.turn_number || 0, change_history: [] };
  }
  return n.relationship_to_player;
}
// Apply signed deltas from the narrative extraction to a player edge. Each
// dimension is clamped to -1..1. Records a compact change-history entry.
function applyPlayerDelta(state, npcRef, deltas, meta) {
  const edge = ensurePlayerEdge(state, npcRef);
  const DIMS = ["trust", "affection", "fear", "respect", "obligation", "hatred", "guilt", "obsession", "jealousy", "dependency"];
  for (const k of DIMS) {
    if (deltas[k] === undefined) continue;
    edge[k] = clamp((edge[k] || 0) + Number(deltas[k] || 0));
  }
  edge.last_changed_turn = state.turn_number;
  edge.change_history = [...(edge.change_history || []), { turn: state.turn_number, deltas, summary: (meta && meta.summary) || "" }].slice(-20);
  return edge;
}

// Self-heal: ensure every DISCOVERED (met) NPC has a player relationship edge.
// The wizard seeds edges for starting NPCs, but characters the story introduces
// mid-play — and campaigns created before player edges existed — otherwise never
// get one, leaving state.npcs empty. With no edges the relations tab, milestone
// detection, and NPC proactive contact all have nothing to work with. Met NPCs
// get a modest acquaintance baseline (they're established, not strangers).
// "연결 없음" world-figures and the dead are skipped.
function reconcilePlayerEdges(state, canonDb) {
  if (!canonDb || !canonDb.all) return [];
  state.npcs = state.npcs || [];
  const have = new Set(state.npcs.map((n) => n.canon_ref));
  const added = [];
  for (const e of canonDb.all()) {
    if (!e || e.type !== "Character") continue;
    const d = e.data || {};
    if (!d.discovered_by_player || d.no_player_relationship) continue;
    if (d.current_status === "dead" || d.role === "player") continue;
    if (have.has(e.canon_id)) continue;
    state.npcs.push({
      canon_ref: e.canon_id,
      relationship_to_player: { from: e.canon_id, to: "player_main", trust: 0.2, affection: 0.12, fear: 0, respect: 0.15, obligation: 0, type: "acquaintance", last_changed_turn: state.turn_number || 0, change_history: [] },
    });
    added.push(e.canon_id);
  }
  return added;
}

module.exports = { findEdge, upsert, applyWorldEvent, playerEdge, ensurePlayerEdge, applyPlayerDelta, reconcilePlayerEdges };
