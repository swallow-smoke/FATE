// Phase 3 · Wave 3 · System 11 — Campaign Health Dashboard
//
// Developer/writer metrics only (NEVER shown to the in-game player). Recomputed
// on a 10-turn cadence and cached in state.campaign_health.

const HEALTH_PERIOD = 10;
const EMOTION_VOCAB = 15; // reference vocabulary size for the diversity ratio

function compute(state, canonDb, memoryEngine) {
  const turn = state.turn_number;
  const memories = memoryEngine.all();

  // 감정 다양성 %: unique emotion_tags recalled/created in last 50 turns / vocab
  const recentMem = memories.filter((m) => (m.last_recalled_turn ?? m.timestamp.campaign_turn) >= turn - 50);
  const tags = new Set(recentMem.flatMap((m) => m.emotion_tags || []));
  const emotion_diversity = Math.min(1, tags.size / EMOTION_VOCAB);

  // 복선 회수율 %
  const fs = state.foreshadow_pool || [];
  const foreshadow_resolution = fs.length ? fs.filter((f) => f.resolved).length / fs.length : null;

  // NPC 활용도 %: distinct NPCs in last 50 scene turns / registered characters
  const chars = canonDb.all().filter((e) => e.type === "Character");
  const appeared = new Set((state.scene_history || []).slice(-50).flatMap((h) => (h.participants || []).filter((p) => p !== "player")));
  const npc_utilization = chars.length ? Math.min(1, appeared.size / chars.length) : null;

  // 세계 변화율 %: resolved world events / total
  const ev = state.world.active_events || [];
  const world_change = ev.length ? ev.filter((e) => e.status === "resolved").length / ev.length : null;

  // 선택 영향력 %: story_flags whose id echoes into any memory summary
  const flags = state.story_flags || [];
  const echoed = flags.filter((f) => memories.some((m) => (m.summary || "").includes(f.flag_id) || (m.canon_refs || []).includes(f.flag_id)));
  const choice_impact = flags.length ? echoed.length / flags.length : null;

  const metrics = {
    emotion_diversity_pct: pct(emotion_diversity),
    foreshadow_resolution_pct: pct(foreshadow_resolution),
    npc_utilization_pct: pct(npc_utilization),
    world_change_pct: pct(world_change),
    choice_impact_pct: pct(choice_impact),
  };
  state.campaign_health = { computed_turn: turn, metrics };
  return state.campaign_health;
}

function pct(v) {
  return v == null ? null : Math.round(v * 100);
}

// Return cached metrics, recomputing only every HEALTH_PERIOD turns.
function get(state, canonDb, memoryEngine) {
  const turn = state.turn_number;
  const ch = state.campaign_health;
  if (!ch || ch.computed_turn < 0 || turn - ch.computed_turn >= HEALTH_PERIOD) {
    return compute(state, canonDb, memoryEngine);
  }
  return ch;
}

module.exports = { compute, get, HEALTH_PERIOD };
