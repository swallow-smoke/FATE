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

module.exports = { findEdge, upsert, applyWorldEvent };
