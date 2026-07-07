// Phase 5 Wave 2 — Rumor system (activates the previously-unused Canon type).
//
// Schema (per handoff): { canon_id, content, origin_region, spread_regions[],
// accuracy: "true|distorted|false", spread_turn }. World Simulation events
// spawn rumors with some probability; spread is rule-based (adjacent regions
// every 5-10 turns). The player only ever sees rumors they have HEARD.

const SPREAD_PERIOD_MIN = 5;
const SPREAD_PERIOD_MAX = 10;
const SPAWN_CHANCE = 0.6;
const MUTATE_CHANCE = 0.5; // Phase 16 — chance a rumor warps as it reaches a new region

const ACCURACIES = ["true", "distorted", "false"];

function distort(summary, accuracy) {
  if (accuracy === "true") return summary;
  if (accuracy === "distorted") return `${summary} — 라는 이야기가 부풀려져 돌고 있다`;
  return `${summary} — 라는 소문이 있지만 사실이 아니다`;
}

// Phase 16 · Rumor Evolution — escalate a rumor one mutation stage. Each stage
// drifts further from the truth (아프다 → 독살당했다 → 델타가 죽였다). Rule-based so
// it works offline; the newest mutation can be LLM-polished upstream.
function scapegoat(canonDb) {
  const cands = (canonDb.all() || []).filter((e) => e.type === "Character" && e.data && e.data.discovered_by_player && e.data.birth_name);
  if (cands.length) return cands[Math.floor(Math.random() * cands.length)].data.birth_name;
  const facs = (canonDb.all() || []).filter((e) => e.type === "Faction");
  if (facs.length) return (facs[0].data && facs[0].data.display_name) || facs[0].canon_id;
  return "누군가";
}
function escalate(base, stage, canonDb) {
  if (stage <= 1) return `${base} — 사람들은 실제보다 훨씬 부풀려 이야기한다`;
  if (stage === 2) return `${base}... 이제는 그것이 누군가 꾸민 일이라는 말까지 돈다`;
  return `${base}... 급기야 ${scapegoat(canonDb)}의 소행이라는 소문으로 뒤바뀌었다`;
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
      // Phase 16 · Rumor Evolution — mutation chain + per-region believed stage.
      base_content: distort(event.summary, accuracy),
      mutation_stage: 0,
      versions: [{ stage: 0, content: distort(event.summary, accuracy), turn: state.turn_number }],
      region_versions: origin ? { [origin]: 0 } : {},
    },
  });
  return r.approved ? r.patch : null;
}

// Rule-based propagation: every 5-10 turns a rumor reaches one more region.
// "Adjacent" is approximated as any registered region not yet reached.
function tickSpread(state, canonDb, { calm = false } = {}) {
  const turn = state.turn_number;
  const regions = canonDb.all().filter((e) => e.type === "World").map((e) => (e.data && e.data.region) || e.canon_id);
  const changed = [], mutations = [];
  for (const r of canonDb.all().filter((e) => e.type === "Rumor")) {
    const d = r.data;
    if (d.next_spread_turn == null || turn < d.next_spread_turn) continue;
    const unreached = regions.filter((x) => !(d.spread_regions || []).includes(x));
    if (unreached.length) {
      const region = unreached[0];
      d.spread_regions = [...(d.spread_regions || []), region];
      // Phase 16 · Rumor Evolution — reaching a new region may WARP the rumor.
      // Each region then remembers the stage it heard, so different places
      // believe different versions of the same story. Suppressed under calm.
      d.region_versions = d.region_versions || {};
      if (!calm && (d.mutation_stage || 0) < 3 && Math.random() < MUTATE_CHANCE) {
        d.mutation_stage = (d.mutation_stage || 0) + 1;
        const mutated = escalate(d.base_content || d.content, d.mutation_stage, canonDb);
        d.content = mutated;
        d.versions = [...(d.versions || []), { stage: d.mutation_stage, content: mutated, turn }];
        mutations.push({ rumor: r.canon_id, stage: d.mutation_stage, content: mutated, key_moment: d.mutation_stage >= 2 });
      }
      d.region_versions[region] = d.mutation_stage || 0;
      changed.push({ rumor: r.canon_id, reached: region, stage: d.mutation_stage || 0 });
    }
    d.next_spread_turn = turn + SPREAD_PERIOD_MIN + Math.floor(Math.random() * (SPREAD_PERIOD_MAX - SPREAD_PERIOD_MIN + 1));
  }
  if (changed.length) canonDb.persist();
  return { changed, mutations };
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
    .map((e) => ({ canon_id: e.canon_id, content: e.data.content, origin_region: e.data.origin_region, heard_turn: e.data.heard_turn, mutation_stage: e.data.mutation_stage || 0, versions: (e.data.versions || []).length }));
}

module.exports = { maybeSpawnFromEvent, tickSpread, markHeard, playerVisible };
