// Phase 16 · System 2 — NPC Goal System
//
// Every NPC with a `goal_current` gets a structured `goal_state` that advances
// on a periodic cadence even when the player is nowhere near — "델타: 연구 완성 /
// 동생 찾기 / 왕국 탈출". Progress is nudged by the NPC's psychology, faction
// fortunes, and world events. Crossing a milestone writes a Memory (and feeds
// World News); reaching 1.0 ACHIEVES the goal, a hostile shock can FAIL it, and
// either outcome changes the NPC's behaviour (current_status / next goal).
//
// This is the richer sibling of livingNpc.progress (which only nudged a status
// string every 100 turns off resolved events). Both can coexist; this one owns
// the fine-grained goal_state, livingNpc stays as the coarse legacy hook.
//
// calm_mode: caller skips the autonomous advance (NPCs don't chase goals in the
// background); their goal_state is preserved untouched.

"use strict";

// Milestone thresholds on progress (0..1). Labels are generic, rule-based; the
// key-moment (achieved/failed) prose can be enriched by an LLM pass upstream.
const MILESTONES = [
  { at: 0.34, label: "첫걸음을 뗐다" },
  { at: 0.67, label: "결정적 진전을 이뤘다" },
  { at: 1.0,  label: "목표를 이뤘다" },
];

function ambitionFactor(entity) {
  const psy = (entity.data && entity.data.psychology) || {};
  // secure/anxious attachment + explicit ambition/drive nudge the pace.
  let f = 0.05;
  if (psy.attachment_style === "secure") f += 0.02;
  if (psy.attachment_style === "avoidant") f += 0.01;
  if (/야망|집념|끈기|결단|driven|ambitious/i.test(JSON.stringify(psy))) f += 0.03;
  return f;
}

function ensureGoalState(entity, turn) {
  const d = entity.data;
  if (!d.goal_current) return null;
  if (!d.goal_state || d.goal_state.goal !== d.goal_current) {
    // (re)seed when the goal string changes or none exists yet.
    d.goal_state = {
      goal: d.goal_current,
      progress: 0,
      status: "active", // active | achieved | failed
      milestones_hit: 0,
      started_turn: turn,
      last_progress_turn: turn,
    };
  }
  return d.goal_state;
}

// One advancement tick for all NPCs with an active goal. Returns
// { milestones, outcomes } — outcomes are achieved/failed (key moments).
function advance(state, canonDb, memoryEngine, { lowToken = false } = {}) {
  const turn = state.turn_number;
  const period = (state.settings && state.settings.npc_goal_period) || 8;
  if (turn === 0 || turn % period !== 0) return { milestones: [], outcomes: [] };

  const events = (state.world && state.world.active_events) || [];
  const resolvedFactions = new Set(events.filter((e) => e.status === "resolved").flatMap((e) => e.affected_factions || []));
  const conflictFactions = new Set(events.filter((e) => e.status === "ongoing" && e.category === "conflict").flatMap((e) => e.affected_factions || []));

  const milestones = [], outcomes = [];

  for (const npc of canonDb.all().filter((e) => e.type === "Character")) {
    const d = npc.data || {};
    if (d.current_status === "dead" || d.no_player_relationship) continue;
    const gs = ensureGoalState(npc, turn);
    if (!gs || gs.status !== "active") continue;

    const name = d.birth_name || npc.canon_id;
    const affs = d.affiliations || [];

    // A hostile shock while the goal is active can derail it entirely.
    if (affs.some((a) => conflictFactions.has(a)) && Math.random() < 0.25) {
      gs.status = "failed";
      gs.failed_turn = turn;
      d.goal_current = `${gs.goal} (좌절됨)`;
      d.current_status = `${(d.current_status || "alive").split(" · ")[0]} · 목표 좌절: ${gs.goal}`;
      if (!lowToken && memoryEngine) memoryEngine.write({
        summary: `${name}의 목표가 좌절되었다: ${gs.goal}`,
        participants: [npc.canon_id], emotion_tags: ["loss"], emotion_intensity: 3,
        canon_refs: [npc.canon_id], tier: 2, tier_reason: "npc goal failed",
      }, turn);
      outcomes.push({ canon_id: npc.canon_id, name, goal: gs.goal, outcome: "failed", key_moment: true });
      continue;
    }

    // Progress nudge: base ambition + a boost when a relevant faction event resolved.
    let step = ambitionFactor(npc) + (Math.random() * 0.04);
    if (affs.some((a) => resolvedFactions.has(a))) step += 0.06;
    gs.progress = Math.min(1, gs.progress + step);
    gs.last_progress_turn = turn;

    // Did we cross a new milestone this tick?
    const hitCount = MILESTONES.filter((m) => gs.progress >= m.at).length;
    if (hitCount > gs.milestones_hit) {
      const ms = MILESTONES[hitCount - 1];
      gs.milestones_hit = hitCount;
      const achieved = ms.at >= 1.0;
      if (achieved) {
        gs.status = "achieved";
        gs.achieved_turn = turn;
        d.goal_current = `${gs.goal} (달성)`;
        d.current_status = `${(d.current_status || "alive").split(" · ")[0]} · 목표 달성: ${gs.goal}`;
      }
      if (!lowToken && memoryEngine) memoryEngine.write({
        summary: `${name}는 오프스크린에서 ${ms.label}: ${gs.goal}`,
        participants: [npc.canon_id], emotion_tags: [achieved ? "triumph" : "resolve"], emotion_intensity: achieved ? 3 : 2,
        canon_refs: [npc.canon_id], tier: 2, tier_reason: "npc goal milestone",
      }, turn);
      const rec = { canon_id: npc.canon_id, name, goal: gs.goal, milestone: ms.label, progress: Math.round(gs.progress * 100) / 100, key_moment: achieved };
      milestones.push(rec);
      if (achieved) outcomes.push({ ...rec, outcome: "achieved" });
    }
  }

  canonDb.persist();
  return { milestones, outcomes };
}

// Player-facing snapshot of what met NPCs are working toward (relations tab).
function playerVisible(state, canonDb) {
  return canonDb.all()
    .filter((e) => e.type === "Character" && e.data && e.data.discovered_by_player && e.data.goal_state)
    .map((e) => ({
      canon_ref: e.canon_id,
      name: e.data.birth_name || e.canon_id,
      goal: e.data.goal_state.goal,
      progress: Math.round((e.data.goal_state.progress || 0) * 100),
      status: e.data.goal_state.status,
    }));
}

module.exports = { advance, ensureGoalState, playerVisible, MILESTONES };
