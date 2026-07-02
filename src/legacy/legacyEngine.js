// Phase 3 · Wave 4 · System 13 — Legacy Engine
//
// When the player character dies or retires (Story Flag trigger), a new
// generation begins: a successor is chosen, legacy traits are inherited, and
// the predecessor's major events are promoted to Cultural-tier memory so the
// world remembers them. Only generation turnover + trait inheritance here —
// no elaborate cutscene (a single transition card in the UI is enough).

const TRIGGER_FLAGS = ["player_died", "player_retired"];

function triggeredBy(state) {
  return (state.story_flags || []).find((f) => TRIGGER_FLAGS.includes(f.flag_id) && f.value === true);
}

// Advance a generation if triggered and not already handled. Returns a legacy
// event (for the UI transition card) or null.
function checkAndAdvance(state, canonDb, memoryEngine, kernel) {
  const trigger = triggeredBy(state);
  if (!trigger) return null;
  const prevGen = state.player.generation || 1;
  if (state.player._legacy_gen_at === trigger.flag_id) return null; // already advanced for this flag

  // 1. Choose a successor: prefer an NPC in a "family" relationship, else the
  //    first registered Character.
  const familyEdge = (state.relationship_graph.edges || []).find((e) => e.type === "family");
  const chars = canonDb.all().filter((e) => e.type === "Character");
  const successorRef =
    (familyEdge && (familyEdge.to || familyEdge.from)) || (chars[0] && chars[0].canon_id) || null;

  // 2. Promote the predecessor's major events into a Cultural-tier memory.
  const predecessorRef = `player_gen${prevGen}`;
  const predMems = memoryEngine
    .all()
    .filter((m) => (m.participants || []).includes("player") && m.tier >= 2)
    .slice(-5)
    .map((m) => m.summary);
  const legacyMem = memoryEngine.write(
    {
      summary: `[전설] ${prevGen}세대의 이야기가 후대에 전해진다: ${predMems.join(" / ") || "이름 없는 여정"}`,
      participants: [predecessorRef, successorRef].filter(Boolean),
      emotion_tags: ["legacy"],
      emotion_intensity: 3,
      canon_refs: successorRef && canonDb.get(successorRef) ? [successorRef] : [],
      tier: 4,
      tier_reason: "generation turnover -> Cultural",
    },
    state.turn_number
  );

  // 3. Inherit traits into the new generation.
  const inherited = [...(state.player.traits || []), `${prevGen}세대의 유산`];
  state.player.generation = prevGen + 1;
  state.player.legacy = {
    predecessor_ref: predecessorRef,
    legacy_traits: inherited,
    world_memory_of_predecessor: legacyMem.id,
  };
  state.player._legacy_gen_at = trigger.flag_id;
  // fresh emotional slate for the new character; world/canon/relationships persist
  state.player.emotion_state.current_wave = { primary_emotion: "calm", secondary_emotion: null, intensity: 0, turns_at_current_intensity: 0 };
  state.player.emotion_state.fatigue_tracker = {};

  return {
    generation: state.player.generation,
    predecessor_ref: predecessorRef,
    successor_ref: successorRef,
    legacy_traits: inherited,
    world_memory_of_predecessor: legacyMem.id,
    trigger: trigger.flag_id,
  };
}

module.exports = { checkAndAdvance, TRIGGER_FLAGS };
