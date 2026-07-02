// Phase 5 Wave 2 — Rumor system (activates the previously-unused Canon type).
//
// Schema (per handoff): { canon_id, content, origin_region, spread_regions[],
// accuracy: "true|distorted|false", spread_turn }. World Simulation events
// spawn rumors with some probability; spread is rule-based (adjacent regions
// every 5-10 turns). The player only ever sees rumors they have HEARD.

const SPREAD_PERIOD_MIN = 5;
const SPREAD_PERIOD_MAX = 10;
const SPAWN_CHANCE = 0.6;

const ACCURACIES = ["true", "distorted", "false"];

function distort(summary, accuracy) {
  if (accuracy === "true") return summary;
  if (accuracy === "distorted") return `${summary} — 라는 이야기가 부풀려져 돌고 있다`;
  return `${summary} — 라는 소문이 있지만 사실이 아니다`;
}

// Called from the world tick when a world event was generated this turn.
function maybeSpawnFromEvent(state, event, canonDb, kernel) {
  if (!event || Math.random() > SPAWN_CHANCE) return null;
  const origin = (event.affected_regions && event.affected_regions[0]) || null;
  const accuracy = ACCURACIES[Math.floor(Math.random() * ACCURACIES.length)];
  const canon_id = `rumor_${event.world_event_id}`;
  if (canonDb.get(canon_id)) return null;
  const r = kernel.request(state, "world_sim", "canon.register", {
    canon_id,
    type: "Rumor",
    data: {
      content: distort(event.summary, accuracy),
      origin_region: origin,
      spread_regions: origin ? [origin] : [],
      accuracy,
      spread_turn: state.turn_number,
      next_spread_turn: state.turn_number + SPREAD_PERIOD_MIN + Math.floor(Math.random() * (SPREAD_PERIOD_MAX - SPREAD_PERIOD_MIN + 1)),
      heard_by_player: false,
      source_event: event.world_event_id,
    },
  });
  return r.approved ? r.patch : null;
}

// Rule-based propagation: every 5-10 turns a rumor reaches one more region.
// "Adjacent" is approximated as any registered region not yet reached.
function tickSpread(state, canonDb) {
  const turn = state.turn_number;
  const regions = canonDb.all().filter((e) => e.type === "World").map((e) => (e.data && e.data.region) || e.canon_id);
  const changed = [];
  for (const r of canonDb.all().filter((e) => e.type === "Rumor")) {
    const d = r.data;
    if (d.next_spread_turn == null || turn < d.next_spread_turn) continue;
    const unreached = regions.filter((x) => !(d.spread_regions || []).includes(x));
    if (unreached.length) {
      d.spread_regions = [...(d.spread_regions || []), unreached[0]];
      changed.push({ rumor: r.canon_id, reached: unreached[0] });
    }
    d.next_spread_turn = turn + SPREAD_PERIOD_MIN + Math.floor(Math.random() * (SPREAD_PERIOD_MAX - SPREAD_PERIOD_MIN + 1));
  }
  if (changed.length) canonDb.persist();
  return changed;
}

// Mark rumors heard when the player's current location is inside their spread.
function markHeard(state, canonDb, location) {
  if (!location) return [];
  const heard = [];
  for (const r of canonDb.all().filter((e) => e.type === "Rumor")) {
    if (!r.data.heard_by_player && (r.data.spread_regions || []).includes(location)) {
      r.data.heard_by_player = true;
      r.data.heard_turn = state.turn_number;
      heard.push(r.canon_id);
    }
  }
  if (heard.length) canonDb.persist();
  return heard;
}

// Player-facing list: ONLY heard rumors, never accuracy (internal value).
function playerVisible(canonDb) {
  return canonDb
    .all()
    .filter((e) => e.type === "Rumor" && e.data.heard_by_player)
    .map((e) => ({ canon_id: e.canon_id, content: e.data.content, origin_region: e.data.origin_region, heard_turn: e.data.heard_turn }));
}

module.exports = { maybeSpawnFromEvent, tickSpread, markHeard, playerVisible };
