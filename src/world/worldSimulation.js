// Phase 3 · Wave 1 · System 1 — World Simulation (lightweight)
//
// NOT a real economy/ecology simulation (explicitly out of scope). Instead a
// periodic rule-based world-event generator. Every N turns it emits one event,
// stores it in world.active_events (StateSchema §2), and auto-resolves events
// whose deadline has passed — recording the outcome as a Historical memory
// (08-Memory promotion pattern).

const CATEGORIES = ["politics", "economy", "nature", "culture", "conflict"];

// Category templates for rule-based summaries.
const TEMPLATES = {
  politics: "권력 구도에 균열이 생겼다",
  economy: "교역로가 흔들리며 물가가 요동친다",
  nature: "이상 기후가 지역을 덮쳤다",
  culture: "오래된 관습을 둘러싼 논쟁이 번진다",
  conflict: "국경에서 무력 충돌의 조짐이 보인다",
};

// Weight each category using Narrative DNA + world state (rule-based).
function categoryWeights(state, canonDb) {
  const dna = state.narrative_dna || {};
  const factions = canonDb.all().filter((e) => e.type === "Faction");
  const recentFlags = (state.story_flags || []).filter((f) => f.set_at_turn >= state.turn_number - 20);

  const w = {
    politics: 1 + (dna.politics || 0) + factions.length,
    economy: 1 + (dna.survival || 0) * 0.5,
    nature: 1 + (dna.survival || 0) + (dna.horror || 0) * 0.3,
    culture: 1 + (dna.emotion || 0) * 0.3,
    conflict: 1 + (dna.politics || 0) * 0.5 + recentFlags.length * 0.5,
  };
  return w;
}

function pickCategory(state, canonDb) {
  const w = categoryWeights(state, canonDb);
  const total = CATEGORIES.reduce((s, c) => s + w[c], 0);
  let r = Math.random() * total;
  for (const c of CATEGORIES) {
    r -= w[c];
    if (r <= 0) return c;
  }
  return "politics";
}

// Generate one event if the period has elapsed. Returns the event or null.
function maybeGenerateEvent(state, canonDb) {
  const period = (state.settings && state.settings.world_event_period) || 15;
  const turn = state.turn_number;
  if (turn === 0 || turn % period !== 0) return null;

  const category = pickCategory(state, canonDb);
  const factions = canonDb.all().filter((e) => e.type === "Faction");
  const worlds = canonDb.all().filter((e) => e.type === "World");
  const affected_factions = factions.slice(0, 2).map((e) => e.canon_id);
  const affected_regions = worlds.slice(0, 1).map((e) => (e.data && e.data.region) || e.canon_id);

  const ttl = (state.settings && state.settings.world_event_ttl) || 40;
  const event = {
    world_event_id: `evt_${String(turn).padStart(4, "0")}`,
    category,
    summary: TEMPLATES[category],
    triggered_turn: turn,
    affected_regions,
    affected_factions,
    status: "ongoing",
    resolution_deadline_turn: turn + ttl,
  };
  state.world.active_events.push(event);
  return event;
}

// Auto-resolve events whose deadline has passed even without player action.
// Returns the list of newly-resolved events (for the caller to log + memory).
function resolveExpiredEvents(state, memoryEngine, kernel) {
  const turn = state.turn_number;
  const resolved = [];
  for (const ev of state.world.active_events) {
    if (ev.status === "ongoing" && turn >= ev.resolution_deadline_turn) {
      ev.status = "resolved";
      ev.resolved_turn = turn;
      resolved.push(ev);
      // Historical memory (no player participation needed).
      memoryEngine.write(
        {
          summary: `[세계] ${ev.summary} — 사건이 일단락되었다.`,
          participants: [...ev.affected_factions, ...ev.affected_regions],
          emotion_tags: ["history"],
          emotion_intensity: 2,
          tier: 3,
          tier_reason: "world_event resolved -> Historical",
        },
        turn
      );
    }
  }
  return resolved;
}

// Ongoing events the Story Director can weave into a scene (Wave 1 hook).
function ongoingEvents(state) {
  return (state.world.active_events || []).filter((e) => e.status === "ongoing");
}

module.exports = { maybeGenerateEvent, resolveExpiredEvents, ongoingEvents, CATEGORIES };
