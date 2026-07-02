// Phase 7 Part A2 — Consequence 체인 추적
//
// When a Story Flag first turns true, open a chain. Thereafter, any world event
// or memory that references the flag's origin (shared canon_ref, or the flag
// subject appearing in the summary) is appended as a linked event, so the World
// tab can draw the 원인 → 결과 arrow. Lightweight: no graph solver, just append.

"use strict";

let seq = 0;

function subjectTokens(flagId) {
  // "saved_king" → ["saved","king"]; used for fuzzy summary matching.
  return String(flagId).toLowerCase().split(/[_\s]+/).filter((t) => t.length > 2);
}

// Open a chain the first time a given flag becomes true.
function openChain(state, flagId, turn, canonRefs = []) {
  state.consequence_chains = state.consequence_chains || [];
  if (state.consequence_chains.some((c) => c.origin_flag === flagId)) return null;
  seq += 1;
  const chain = {
    chain_id: `chain_${String(seq).padStart(4, "0")}`,
    origin_flag: flagId,
    origin_turn: turn,
    origin_refs: [...new Set(canonRefs)],
    linked_events: [],
  };
  state.consequence_chains.push(chain);
  return chain;
}

function matches(chain, refs, summary) {
  const refHit = (refs || []).some((r) => chain.origin_refs.includes(r));
  const text = String(summary || "").toLowerCase();
  const tokenHit = subjectTokens(chain.origin_flag).some((t) => text.includes(t));
  return refHit || tokenHit;
}

// Called at turn end with this turn's fresh memories + world event. Appends any
// that reference an open chain's origin. Deduplicates by (turn, summary).
function linkTurnEvents(state, { memories = [], worldEvent = null } = {}) {
  const linked = [];
  const chains = state.consequence_chains || [];
  const items = [
    ...memories.map((m) => ({ turn: m.timestamp ? m.timestamp.campaign_turn : state.turn_number, summary: m.summary, refs: m.canon_refs || [], world_event_ref: null })),
    ...(worldEvent ? [{ turn: state.turn_number, summary: worldEvent.summary, refs: [...(worldEvent.affected_factions || []), ...(worldEvent.affected_regions || [])], world_event_ref: worldEvent.world_event_id }] : []),
  ];
  for (const chain of chains) {
    for (const it of items) {
      if (it.turn === chain.origin_turn && !it.world_event_ref) continue; // the flag's own turn
      if (!matches(chain, it.refs, it.summary)) continue;
      if (chain.linked_events.some((e) => e.turn === it.turn && e.summary === it.summary)) continue;
      const entry = { turn: it.turn, summary: it.summary, world_event_ref: it.world_event_ref };
      chain.linked_events.push(entry);
      linked.push({ chain_id: chain.chain_id, ...entry });
    }
  }
  return linked;
}

module.exports = { openChain, linkTurnEvents };
