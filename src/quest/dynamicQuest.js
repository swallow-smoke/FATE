// Phase 3 · Wave 4 · System 14 — Dynamic Quest
//
// Quests are not authored ahead of time — they derive from World Simulation
// events. When an event of category conflict/politics fires, a Quest Canon
// entity + a soft quest_hint are created. The hint is NOT forced: the Story
// Director may weave it into a story_directive, nothing more.

const QUEST_CATEGORIES = ["conflict", "politics"];

const HINTS = {
  conflict: "국경의 충돌에 누군가는 개입해야 한다",
  politics: "권력 다툼 속에서 편을 정하라는 압박이 온다",
};

// Called when a new world event is generated. Returns the quest or null.
function maybeCreate(state, event, canonDb, kernel) {
  if (!event || !QUEST_CATEGORIES.includes(event.category)) return null;
  const quest_id = `quest_${event.world_event_id}`;
  if (canonDb.get(quest_id)) return null;

  const r = kernel.request(state, "quest_engine", "canon.register", {
    canon_id: quest_id,
    type: "Quest",
    data: {
      origin_event: event.world_event_id,
      quest_type: event.category,
      status: "open",
      quest_hint: HINTS[event.category],
      involved_refs: [...(event.affected_factions || []), ...(event.affected_regions || [])],
    },
  });
  if (!r.approved) return null;

  state.quests = state.quests || [];
  const quest = { quest_id, hint: HINTS[event.category], origin_event: event.world_event_id, status: "open", created_turn: state.turn_number };
  state.quests.push(quest);
  return quest;
}

// Soft hint for the Story Director: the most recent open quest, if any.
function activeHint(state) {
  const open = (state.quests || []).filter((q) => q.status === "open");
  return open.length ? open[open.length - 1] : null;
}

module.exports = { maybeCreate, activeHint, QUEST_CATEGORIES };
