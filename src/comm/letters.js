// Phase 9 Part E4 (letters) + E5 (Scheduled Action Queue).
//
// A letter is a turn-based scheduled_action: sent now, delivered at a future
// trigger_turn based on travel distance. In transit it may be intercepted
// (relationship hatred/distance + active conflict raise the odds); an
// intercepted letter leaks as a Rumor. On delivery, the recipient's response is
// fed to the story as a directive candidate (NPCBrain, Phase 7 A1).
//
// This is the medieval/ancient/fantasy communication channel. The modern
// in-game-internet channel (E3) is a separate implementation activated by a
// different tech_level — only one is built per campaign (per handoff).

"use strict";

const TIER_DELAY = { near: 2, far: 4, very_far: 7 };
let seq = 0;

function recipientDistanceTier(canonDb, recipientRef) {
  const npc = canonDb.get(recipientRef);
  const loc = npc && npc.data && npc.data.current_location;
  const world = loc ? canonDb.get(loc) : null;
  return (world && world.data && world.data.travel_distance_tier) || "near";
}

function playerToNpcEdge(state, recipientRef) {
  const n = (state.npcs || []).find((x) => x.canon_ref === recipientRef);
  return (n && n.relationship_to_player) || {};
}

function interceptProbability(state, canonDb, recipientRef) {
  const rel = playerToNpcEdge(state, recipientRef);
  const tier = recipientDistanceTier(canonDb, recipientRef);
  const distancePenalty = { near: 0, far: 0.15, very_far: 0.3 }[tier] || 0;
  const conflictActive = ((state.world && state.world.active_events) || []).some((e) => e.category === "conflict" || e.category === "politics");
  let p = 0.05 + (rel.hatred || 0) * 0.5 + (rel.distance || 0) * 0.2 + distancePenalty + (conflictActive ? 0.15 : 0);
  return Math.max(0, Math.min(0.95, p));
}

// E5 — enqueue a letter as a scheduled_action.
function sendLetter(state, canonDb, { recipient, content }) {
  if (!recipient) return { ok: false, reason: "수신인이 필요합니다" };
  if (!canonDb.get(recipient)) return { ok: false, reason: "알 수 없는 수신인" };
  state.scheduled_actions = state.scheduled_actions || [];
  const tier = recipientDistanceTier(canonDb, recipient);
  const delay = TIER_DELAY[tier] || 2;
  seq += 1;
  const action = {
    action_id: `sched_${String(seq).padStart(4, "0")}`,
    type: "letter_delivery",
    created_turn: state.turn_number,
    trigger_turn: state.turn_number + delay,
    payload: { sender: "player", recipient, content_summary: String(content || "").slice(0, 300) },
    intercept_probability: interceptProbability(state, canonDb, recipient),
    status: "pending",
    revealed_to_player: true, // Phase 10 O — the player sent it, so it's known
  };
  state.scheduled_actions.push(action);
  return { ok: true, action, eta_turns: delay, distance_tier: tier };
}

// E5 step-2 — at turn start, resolve any letters whose trigger_turn has arrived.
// Returns { delivered, intercepted, directive_candidates } for story injection.
function deliverDue(state, canonDb, kernel, rng = Math.random) {
  const turn = state.turn_number;
  const delivered = [], intercepted = [], directive_candidates = [];
  for (const a of state.scheduled_actions || []) {
    if (a.status !== "pending" || a.type !== "letter_delivery" || a.trigger_turn > turn) continue;
    const recipient = a.payload.recipient;
    if (rng() < (a.intercept_probability || 0)) {
      a.status = "intercepted";
      intercepted.push(a);
      // Leak as a Rumor canon entity (distorted/partial), if the kernel allows.
      if (kernel) {
        const rid = `rumor_letter_${a.action_id}`;
        kernel.request(state, "world_sim", "canon.register", {
          canon_id: rid, type: "Rumor",
          data: { origin_region: (canonDb.get(recipient) && canonDb.get(recipient).data && canonDb.get(recipient).data.current_location) || "어딘가", accuracy: "distorted", source_event: a.action_id, content: `가로채인 편지의 내용이 새어나간다: ${a.payload.content_summary.slice(0, 60)}`, spread_regions: [], discovered_by_player: false },
        });
      }
    } else {
      a.status = "delivered";
      delivered.push(a);
      const ent = canonDb.get(recipient);
      const name = (ent && ent.data && ent.data.birth_name) || recipient;
      directive_candidates.push({ npc_ref: recipient, action_type: "letter_response", line: `${name}이(가) 플레이어의 편지를 받고 반응한다 (답장하거나 직접 찾아온다) — 내용: ${a.payload.content_summary.slice(0, 60)}` });
    }
  }
  return { delivered, intercepted, directive_candidates };
}

module.exports = { sendLetter, deliverDue, interceptProbability, TIER_DELAY };
