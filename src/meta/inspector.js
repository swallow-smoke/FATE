// Phase 16+ · Entity Inspector
//
// One read-only lens over everything the game knows about a single entity —
// NPC, place, faction, item, event — pulled together from Canon, Memory, the
// relationship graph, family tree, letters, news, rumors and the scene history.
// Pure aggregation (no writes); the UI renders it as a single inspector panel so
// the player can explore an entity's whole footprint in the world at a glance.

"use strict";

function nameOf(canonDb, id) { const e = canonDb.get(id); return (e && e.data && (e.data.birth_name || (e.data.notable_features || [])[0] || e.data.display_name)) || id; }

function inspect(state, canonDb, memoryEngine, entityId) {
  if (!entityId) return null;
  const ent = canonDb.get(entityId);
  const mems = memoryEngine.all() || [];

  // --- basic info -------------------------------------------------------
  const basic = ent
    ? { canon_id: ent.canon_id, type: ent.type, name: nameOf(canonDb, entityId), data: ent.data || {} }
    : { canon_id: entityId, type: "Unknown", name: entityId, data: {} };

  // --- appearances (memories + scene history) ---------------------------
  const touches = (m) => (m.participants || []).includes(entityId) || (m.canon_refs || []).includes(entityId) || m.location === entityId;
  const appearances = mems.filter(touches).map((m) => ({ turn: m.timestamp.campaign_turn, date: m.timestamp.in_world_date, summary: m.summary, tier: m.tier }));
  const sceneAppears = (state.scene_history || []).filter((h) => (h.participants || []).includes(entityId)).map((h) => h.turn);

  // --- related NPCs / places (co-occurrence + relationship graph + family)
  const related = new Map();
  const addRel = (id, why) => { if (id && id !== entityId) { const r = related.get(id) || { canon_id: id, name: nameOf(canonDb, id), reasons: new Set() }; r.reasons.add(why); related.set(id, r); } };
  for (const m of mems) if (touches(m)) for (const p of [...(m.participants || []), ...(m.canon_refs || [])]) addRel(p, "함께 등장");
  for (const e of (state.relationship_graph && state.relationship_graph.edges) || []) { if (e.from === entityId) addRel(e.to, e.type || "관계"); if (e.to === entityId) addRel(e.from, e.type || "관계"); }
  for (const e of (state.family_graph && state.family_graph.edges) || []) if (e.from === entityId) addRel(e.to, `가족:${e.type}`);

  // --- letters / news / rumors / events referencing it ------------------
  const letters = (state.scheduled_actions || []).filter((a) => a.type === "npc_message" || a.type === "letter").filter((a) => a.payload && (a.payload.sender === entityId || a.payload.recipient === entityId)).map((a) => ({ id: a.action_id, summary: a.payload.content_summary, status: a.status }));
  const news = ((state.world && state.world.news) || []).filter((n) => (n.refs || []).includes(entityId)).map((n) => ({ kind: n.kind, headline: n.headline, turn: n.turn }));
  const rumors = canonDb.all().filter((e) => e.type === "Rumor" && ((e.data && e.data.source_event) === entityId || (e.data && (e.data.content || "")).includes(basic.name))).map((e) => ({ content: e.data.content, stage: e.data.mutation_stage || 0 }));
  const events = ((state.world && state.world.active_events) || []).filter((ev) => [...(ev.affected_factions || []), ...(ev.affected_regions || [])].includes(entityId)).map((ev) => ({ id: ev.world_event_id, summary: ev.summary, status: ev.status }));

  // --- player relationship (if a Character) -----------------------------
  const npcEdge = (state.npcs || []).find((n) => n.canon_ref === entityId);
  const player_relationship = npcEdge ? { rel: npcEdge.relationship_to_player, nickname: ent && ent.data && ent.data.player_nickname } : null;

  return {
    basic,
    player_relationship,
    related: [...related.values()].map((r) => ({ canon_id: r.canon_id, name: r.name, reasons: [...r.reasons] })).slice(0, 30),
    appearances: appearances.slice(-30),
    scene_turns: sceneAppears.slice(-20),
    letters, news, rumors, events,
    // convenience passthroughs for the specific viewers
    goal: ent && ent.data && ent.data.goal_state ? { goal: ent.data.goal_state.goal, progress: Math.round((ent.data.goal_state.progress || 0) * 100), status: ent.data.goal_state.status } : null,
    secrets_public: ent && ent.data && ent.data.secrets ? (ent.data.secrets.public || []) : [],
  };
}

module.exports = { inspect };
