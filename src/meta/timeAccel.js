// Phase 14 Part Y — time-acceleration simulation.
//
// When a lot of in-world time passes at once (a big time skip, or a Legacy
// generation turnover) we should not tick the world one turn at a time. Instead
// we batch the offscreen systems — World Simulation events (Phase 3 §1), Living
// NPC goal progress (Phase 3 §4) — over the skipped span in one deterministic
// pass. Only genuinely large beats (events that resolve to Historical tier) are
// worth narrating; the rest just update quietly (reusing Phase 11 Q's "small
// change = no narration" rule). The player gets one "그동안 있었던 일" summary card.
//
// Low-token mode (Phase 12) disables this — otherwise a long absence would pile
// up a burst of calls on reconnect.

"use strict";

const worldSim = require("../world/worldSimulation");
const livingNpc = require("../npc/livingNpc");

const MAX_BATCH_TICKS = 12; // cap the batch regardless of how long the skip is
const TICK_UNIT_DAYS = 30;  // one batch tick ≈ a month of offscreen time

// days: how many in-world days elapsed in this skip. Returns a summary card or
// null (no summary when the span is short or low-token disables it).
function run(state, deps, { days, lowToken } = {}) {
  if (lowToken) return null;
  const span = Number(days) || 0;
  if (span < TICK_UNIT_DAYS) return null; // short skips use the normal per-turn tick
  const ticks = Math.min(MAX_BATCH_TICKS, Math.max(1, Math.round(span / TICK_UNIT_DAYS)));
  const { canonDb, memoryEngine, kernel } = deps;

  const events = [];
  const npcProgress = [];
  for (let i = 0; i < ticks; i++) {
    const ev = worldSim.maybeGenerateEvent(state, canonDb);
    if (ev) events.push({ summary: ev.summary, category: ev.category });
    // Auto-resolve anything that expired during the batch (may promote to Historical).
    const resolved = worldSim.resolveExpiredEvents(state, memoryEngine, kernel);
    for (const r of resolved) events.push({ summary: r.summary, category: r.category, resolved: true });
    const prog = livingNpc.progress(state, canonDb, memoryEngine, kernel);
    if (prog && prog.length) npcProgress.push(...prog);
  }

  // Narrate only the big beats; everything else was applied silently.
  const notable = events.filter((e) => e.resolved || e.category === "conflict" || e.category === "politics");
  const lines = [
    ...notable.map((e) => `· ${e.summary}`),
    ...(npcProgress.length ? [`· 그사이 인물들은 각자의 일을 이어갔다 (${npcProgress.length}건의 변화).`] : []),
  ];
  const summary = lines.length ? lines.join("\n") : "· 큰 사건 없이 시간이 흘렀다.";

  // A single Historical memory marks the elapsed span so it is not forgotten.
  try {
    memoryEngine.write({
      summary: `${span}일 남짓한 시간이 흘렀다. ${notable.length ? notable[0].summary : "세계는 조용히 흘러갔다."}`,
      participants: [], emotion_tags: ["passage_of_time"], emotion_intensity: 1,
      canon_refs: [], tier: 3, tier_reason: "time acceleration span",
    }, state.turn_number);
  } catch (_) {}

  return { span_days: span, ticks, events_generated: events.length, notable: notable.length, npc_changes: npcProgress.length, summary };
}

module.exports = { run, MAX_BATCH_TICKS, TICK_UNIT_DAYS };
