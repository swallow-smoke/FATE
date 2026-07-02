// Phase 11 Part P (NPC 선제 연락) + Part Q (NPC-NPC 백그라운드 상호작용).
//
// P: met NPCs sometimes reach out first (proactivity score over a threshold) —
//    delivered as an unread message; ignoring them slowly raises `distance`.
// Q: every ~25 turns, NPC-NPC edges drift from shared goals / conflicts /
//    shared events. Big swings write a quiet memory the player may later find;
//    small ones change numbers silently. The player is NEVER pinged in realtime.

"use strict";

const PROACTIVE_PERIOD = 7;   // background contact check cadence
const PROACTIVE_THRESHOLD = 0.55;
const SOCIAL_PERIOD = 25;     // NPC-NPC interaction cadence
const IGNORE_TURNS = 10;      // unanswered this long → distance creeps up

let seq = 0;

function metNpcs(state, canonDb) {
  return (state.npcs || []).filter((n) => {
    const e = canonDb.get(n.canon_ref);
    return e && e.data && e.data.discovered_by_player && e.data.current_status !== "dead";
  });
}

function proactivityScore(state, canonDb, edge) {
  const ent = canonDb.get(edge.canon_ref);
  const rel = edge.relationship_to_player || {};
  const psy = (ent && ent.data && ent.data.psychology) || {};
  const extraversion = psy.attachment_style === "secure" ? 0.3 : psy.attachment_style === "anxious" ? 0.35 : 0.15;
  const affection = (rel.affection || 0) * 0.4;
  const goalRelated = ent && ent.data && /플레이어|당신/.test(ent.data.goal_current || "") ? 0.2 : 0;
  const last = (state.npc_contact_log || {})[edge.canon_ref];
  const silence = last == null ? 0.2 : Math.min(0.3, (state.turn_number - last) / 40);
  return extraversion + affection + goalRelated + silence;
}

// P — run at turn start (esp. after a time skip) or on the background cadence.
function proactiveContact(state, canonDb, { force = false, lowToken = false } = {}) {
  const turn = state.turn_number;
  // U3 — low-token widens the cadence (never fully off; P is core to the feel).
  const period = lowToken ? 30 : PROACTIVE_PERIOD;
  if (!force && turn % period !== 0) return { messages: [], distance_drift: [] };
  state.npc_contact_log = state.npc_contact_log || {};
  const messages = [], distance_drift = [];

  for (const edge of metNpcs(state, canonDb)) {
    const ref = edge.canon_ref;
    // ignored-contact consequence: an unanswered message ages → distance up.
    const unread = (state.scheduled_actions || []).find((a) => a.type === "npc_message" && a.payload.sender === ref && a.unread && turn - a.created_turn >= IGNORE_TURNS);
    if (unread && edge.relationship_to_player) {
      edge.relationship_to_player.distance = Math.min(1, (edge.relationship_to_player.distance || 0) + 0.03);
      distance_drift.push({ npc_ref: ref, distance: edge.relationship_to_player.distance });
      continue; // don't pile a new message on an ignored one
    }
    if (proactivityScore(state, canonDb, edge) < PROACTIVE_THRESHOLD) continue;
    // don't double up if there's already an unread message from them
    if ((state.scheduled_actions || []).some((a) => a.type === "npc_message" && a.payload.sender === ref && a.unread)) continue;

    const ent = canonDb.get(ref);
    const name = (ent && ent.data && ent.data.birth_name) || ref;
    seq += 1;
    const msg = {
      action_id: `npcmsg_${String(seq).padStart(4, "0")}`,
      type: "npc_message",
      created_turn: turn, trigger_turn: turn,
      payload: { sender: ref, recipient: "player", content_summary: `${name}이(가) 먼저 연락을 해왔다 (${(ent && ent.data && ent.data.goal_current) || "안부"})` },
      status: "delivered", unread: true, revealed_to_player: true,
    };
    state.scheduled_actions = state.scheduled_actions || [];
    state.scheduled_actions.push(msg);
    state.npc_contact_log[ref] = turn;
    messages.push(msg);
  }
  return { messages, distance_drift };
}

// Q — run on the social cadence from the world tick. Deterministic rules; big
// swings emit a quiet memory (no realtime notice to the player).
function backgroundInteract(state, canonDb, memoryEngine, kernel, { lowToken = false } = {}) {
  const turn = state.turn_number;
  if (turn === 0 || turn % SOCIAL_PERIOD !== 0) return { changes: [], memories: [] };
  const edges = (state.relationship_graph && state.relationship_graph.edges) || [];
  const changes = [], memories = [];
  const activeEvent = ((state.world && state.world.active_events) || []).slice(-1)[0] || null;

  for (const edge of edges) {
    const a = canonDb.get(edge.from), b = canonDb.get(edge.to);
    if (!a || !b) continue;
    let delta = 0, reason = null;
    const goalA = (a.data && a.data.goal_current) || "", goalB = (b.data && b.data.goal_current) || "";
    if (goalA && goalB && goalA === goalB) { delta += 0.04; reason = "공동의 목표"; }
    const affA = (a.data && a.data.affiliations) || [], affB = (b.data && b.data.affiliations) || [];
    if (affA.some((f) => affB.includes(f)) && edge.type !== "family" && Math.random() < 0.3) { delta -= 0.03; reason = "이해관계 마찰"; }
    if (activeEvent && [...(activeEvent.affected_factions || []), ...(activeEvent.affected_regions || [])].some((r) => affA.includes(r) || affB.includes(r))) {
      delta += (activeEvent.category === "conflict" ? -0.08 : 0.06); reason = `세계의 사건(${activeEvent.category})`;
    }
    if (!delta) continue;
    edge.trust = Math.max(0, Math.min(1, (edge.trust || 0) + delta));
    changes.push({ from: edge.from, to: edge.to, delta: Math.round(delta * 100) / 100, reason });
    // big swing → a quiet memory the player may later stumble on.
    // U3 — low-token: numbers only, skip the narrative memory entirely.
    if (!lowToken && Math.abs(delta) >= 0.08 && memoryEngine && memoryEngine.write) {
      const summary = `${(a.data && a.data.birth_name) || edge.from}와(과) ${(b.data && b.data.birth_name) || edge.to} 사이가 ${delta > 0 ? "가까워졌다" : "틀어졌다"} (${reason})`;
      const m = memoryEngine.write({ summary, participants: [edge.from, edge.to], emotion_tags: [delta > 0 ? "warmth" : "tension"], emotion_intensity: 2, canon_refs: [edge.from, edge.to].filter((r) => canonDb.get(r)) }, turn);
      memories.push(m.id || summary);
    }
  }
  return { changes, memories };
}

module.exports = { proactiveContact, backgroundInteract, PROACTIVE_PERIOD, SOCIAL_PERIOD };
