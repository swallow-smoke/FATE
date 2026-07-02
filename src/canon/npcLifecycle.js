// Phase 8 Part A2 + C1 — NPC lifecycle: archival of stale NPCs and death
// handling. Canon is never deleted (immutable-history principle) — we only set
// flags (archived / death freeze) on the mutable data.

"use strict";

const STALE_TURNS = 200; // no scene appearance for this many turns
const LOW = 0.2;         // "all relationship dims low" threshold

// Gather every canon_id currently protected by an active foreshadow / mystery
// so we never archive an NPC the story still needs.
function protectedRefs(state) {
  const refs = new Set();
  for (const f of state.foreshadow_pool || []) if (!f.resolved) (f.canon_refs || []).forEach((r) => refs.add(r));
  for (const m of state.mysteries || []) if (!m.resolved) (m.clues || []).forEach(() => {}); // mysteries hold summaries, not refs
  for (const c of state.consequence_chains || []) (c.origin_refs || []).forEach((r) => refs.add(r));
  return refs;
}

function lastSeenTurn(state, canonId) {
  let last = -Infinity;
  for (const h of state.scene_history || []) if ((h.participants || []).includes(canonId)) last = Math.max(last, h.turn);
  return last;
}

function edgeLow(state, canonId) {
  const n = (state.npcs || []).find((x) => x.canon_ref === canonId);
  const rel = (n && n.relationship_to_player) || {};
  const dims = ["trust", "affection", "fear", "respect", "obligation", "hatred", "obsession", "dependency"];
  return dims.every((d) => (rel[d] || 0) < LOW);
}

// A2 — mark stale NPCs archived. Returns the list of archived canon_ids.
function archiveStale(state, canonDb) {
  const turn = state.turn_number;
  const prot = protectedRefs(state);
  const archived = [];
  for (const e of canonDb.all()) {
    if (e.type !== "Character") continue;
    if (e.data && e.data.archived) continue;
    if (e.data && e.data.current_status === "dead") continue; // dead handled separately
    if (prot.has(e.canon_id)) continue;
    const seen = lastSeenTurn(state, e.canon_id);
    const stale = turn - (seen === -Infinity ? (e.registered_at_turn || 0) : seen) >= STALE_TURNS;
    if (stale && edgeLow(state, e.canon_id)) {
      canonDb.update({ canon_id: e.canon_id, field: "archived", new_value: true }, turn);
      canonDb.update({ canon_id: e.canon_id, field: "archived_turn", new_value: turn }, turn);
      archived.push(e.canon_id);
    }
  }
  return archived;
}

// C1 — handle an NPC transitioning to current_status "dead". Freezes edges,
// proposes a power-vacuum world event, promotes related memories, and links the
// death into any open consequence chain. Returns a summary of effects.
function handleDeath(deps, state, canonId) {
  const { canonDb, memoryEngine, kernel } = deps;
  const ent = canonDb.get(canonId);
  if (!ent || ent.type !== "Character") return null;
  const turn = state.turn_number;
  const effects = { canon_id: canonId, froze_edges: 0, power_vacuum: null, promoted_memories: 0, linked_chain: false };

  // 1. Freeze every RelationshipEdge touching this NPC.
  for (const n of state.npcs || []) {
    if (n.canon_ref === canonId && n.relationship_to_player) { n.relationship_to_player.final_state = true; effects.froze_edges++; }
  }
  for (const edge of (state.relationship_graph && state.relationship_graph.edges) || []) {
    if (edge.from === canonId || edge.to === canonId) { edge.final_state = true; effects.froze_edges++; }
  }

  // 2. Power vacuum in an affiliated faction → world-event candidate.
  const factions = (ent.data && ent.data.affiliations) || [];
  if (factions.length) {
    effects.power_vacuum = { affected_factions: factions, summary: `${(ent.data && ent.data.birth_name) || canonId}의 죽음으로 세력에 권력 공백이 생긴다` };
    state.world = state.world || {}; state.world.pending_event_candidates = state.world.pending_event_candidates || [];
    state.world.pending_event_candidates.push({ category: "power_vacuum", ...effects.power_vacuum, proposed_turn: turn });
  }

  // 3. Promote this NPC's Personal-tier memories to Historical (death is itself
  //    a promotion reason). Best-effort against whatever the engine exposes.
  try {
    for (const m of memoryEngine.all()) {
      if ((m.canon_refs || []).includes(canonId) && m.tier < 3) {
        if (typeof memoryEngine.promote === "function") memoryEngine.promote(m.id, 3);
        else m.tier = 3;
        effects.promoted_memories++;
      }
    }
    if (typeof memoryEngine.persist === "function") memoryEngine.persist();
  } catch (_) {}

  // 4. Link the death into any consequence chain referencing this NPC.
  const consequence = require("../story/consequenceChains");
  const links = consequence.linkTurnEvents(state, { memories: [{ timestamp: { campaign_turn: turn }, summary: `${(ent.data && ent.data.birth_name) || canonId} 사망`, canon_refs: [canonId] }] });
  effects.linked_chain = links.length > 0;

  return effects;
}

module.exports = { archiveStale, handleDeath, STALE_TURNS };
