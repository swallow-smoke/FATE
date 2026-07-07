// Phase 16 · System 1 — Living Places
//
// Not only NPCs but *places* change over time. Each discovered World canon
// entity carries a `condition` (0..1 health) that drifts on a periodic cadence
// and reacts to nearby world events. When the condition crosses a stage
// boundary the place TRANSITIONS (번영→안정→쇠락→황폐→폐허, or 재건 back up) and
// we record it in the place's `place_history`, write a Memory, and flag it as a
// "key moment" so the caller can enrich the summary with an LLM pass.
//
// calm_mode: the caller skips the autonomous tick entirely (the world stays put
// for a player who wants a quiet relationship-focused game). Places already
// discovered keep their state; nothing degrades on its own.

"use strict";

// Stage thresholds on condition (high → low). The label is the qualitative
// "what state is this place in" surfaced to the player and woven into scenes.
const STAGES = [
  { min: 0.82, label: "번영" },
  { min: 0.60, label: "안정" },
  { min: 0.38, label: "쇠락" },
  { min: 0.15, label: "황폐" },
  { min: -1,   label: "폐허" },
];

function stageOf(condition) {
  const c = Math.max(0, Math.min(1, condition));
  for (const s of STAGES) if (c >= s.min) return s.label;
  return "폐허";
}

// Infer a coarse place kind from terrain / features / name so the transition
// prose fits (a forest burns; a tavern gets remodelled or shuttered).
function inferKind(entity) {
  const d = entity.data || {};
  const hay = `${entity.canon_id} ${d.region || ""} ${d.terrain || ""} ${(d.notable_features || []).join(" ")} ${d.place_kind || ""}`;
  if (/던전|미궁|유적|동굴|dungeon|catacomb|ruin/i.test(hay)) return "dungeon";
  if (/숲|산|평야|초원|늪|황무지|바다|강|forest|mountain|plain|wild|swamp|woods/i.test(hay)) return "wild";
  if (/성|항구|탑|다리|요새|신전|건물|castle|port|tower|fort|temple|bridge/i.test(hay)) return "structure";
  return "settlement"; // 마을·도시·여관·시장 등 기본
}

// Rule-based transition summaries per (kind, direction). direction: "down"|"up".
// `severe` marks a big single-tick drop (disaster) vs a slow decline.
function ruleSummary(kind, direction, severe) {
  const KO = {
    settlement: {
      down: severe ? "갑작스러운 사건으로 크게 쇠락했다" : "활기가 조금씩 빠져나가고 쇠퇴하기 시작했다",
      up: "다시 사람이 모이고 활기를 되찾고 있다",
    },
    wild: {
      down: severe ? "화마가 휩쓸고 지나가 황폐해졌다" : "돌보는 이 없어 서서히 거칠어지고 있다",
      up: "새싹이 돋고 생명이 천천히 돌아오고 있다",
    },
    structure: {
      down: severe ? "무너지고 부서져 흉물이 되어간다" : "손길이 닿지 않아 조금씩 낡아간다",
      up: "보수의 손길이 닿아 다시 제 모습을 갖춰간다",
    },
    dungeon: {
      down: severe ? "일부가 붕괴해 지형이 뒤바뀌었다" : "안쪽이 서서히 무너져 내리고 있다",
      up: "무언가가 다시 이곳을 채우기 시작했다 (재생성)",
    },
  };
  return (KO[kind] || KO.settlement)[direction];
}

function ensurePlace(entity, turn) {
  const d = entity.data;
  if (typeof d.condition !== "number") d.condition = 0.75; // 대부분 처음엔 멀쩡
  if (!d.place_kind) d.place_kind = inferKind(entity);
  if (!d.place_stage) d.place_stage = stageOf(d.condition);
  if (!d.place_trend) d.place_trend = "stable";
  if (!Array.isArray(d.place_history)) d.place_history = [];
  if (d.last_place_tick_turn == null) d.last_place_tick_turn = turn;
}

// Damage/relief pressure from world events touching this place's region.
function eventPressure(entity, events) {
  const d = entity.data;
  const region = d.region || entity.canon_id;
  let p = 0, severe = false;
  for (const ev of events || []) {
    const hits = [...(ev.affected_regions || []), ...(ev.affected_factions || [])];
    if (!hits.includes(region) && !hits.includes(d.controlling_faction)) continue;
    if (ev.category === "conflict" || ev.category === "nature") { p -= 0.12; severe = true; }
    else if (ev.category === "economy") p -= 0.06;
    else if (ev.category === "politics") p -= 0.04;
    else if (ev.category === "culture") p += 0.03;
  }
  return { pressure: p, severe };
}

// Advance every discovered place one tick. Returns { transitions, drifts }.
// transitions carry key_moment:true for the LLM enrichment pass in runTurn.
function tick(state, canonDb, memoryEngine, { lowToken = false } = {}) {
  const turn = state.turn_number;
  const period = (state.settings && state.settings.place_tick_period) || 12;
  if (turn === 0 || turn % period !== 0) return { transitions: [], drifts: [] };

  const places = canonDb.all().filter((e) => e.type === "World" && e.data && e.data.discovered_by_player);
  const events = (state.world && state.world.active_events || []).filter(
    (e) => e.status === "ongoing" || (e.resolved_turn != null && turn - e.resolved_turn <= period)
  );
  const transitions = [], drifts = [];

  for (const place of places) {
    ensurePlace(place, turn);
    const d = place.data;
    const before = d.condition;
    const beforeStage = stageOf(before);

    const { pressure, severe } = eventPressure(place, events);
    // gentle random walk + event pressure. Very low places have a small chance
    // to REBUILD when nothing is actively hurting them (숲 복구 / 던전 재생성).
    let drift = (Math.random() - 0.45) * 0.05 + pressure;
    if (before < 0.2 && pressure >= 0 && Math.random() < 0.4) drift += 0.06 + Math.random() * 0.08;

    let after = Math.max(0, Math.min(1, before + drift));
    d.condition = Math.round(after * 1000) / 1000;
    d.place_trend = after > before + 0.005 ? "rising" : after < before - 0.005 ? "declining" : "stable";
    const afterStage = stageOf(after);
    drifts.push({ canon_id: place.canon_id, from: Math.round(before * 100) / 100, to: d.condition, trend: d.place_trend });

    if (afterStage === beforeStage) { d.last_place_tick_turn = turn; continue; }

    // --- a real stage transition ------------------------------------------
    const direction = after < before ? "down" : "up";
    const name = (d.notable_features && d.notable_features[0]) || place.canon_id;
    const summary = ruleSummary(d.place_kind, direction, severe);
    const entry = {
      turn, in_world_date: state.in_world_date || null,
      from_stage: beforeStage, to_stage: afterStage,
      cause: severe ? "재난·사건" : direction === "up" ? "회복" : "세월",
      summary,
    };
    d.place_stage = afterStage;
    d.place_history = [...(d.place_history || []), entry].slice(-15);
    d.last_place_tick_turn = turn;

    // Historical-ish memory so the change can be recalled / referenced later.
    if (!lowToken && memoryEngine && memoryEngine.write) {
      memoryEngine.write({
        summary: `[장소] ${name}: ${beforeStage} → ${afterStage}. ${summary}`,
        participants: [place.canon_id],
        emotion_tags: [direction === "up" ? "warmth" : "loss"],
        emotion_intensity: 2,
        location: d.region || place.canon_id,
        canon_refs: [place.canon_id],
        tier: 2, tier_reason: "living place transition",
      }, turn);
    }

    transitions.push({
      canon_id: place.canon_id, name,
      place_kind: d.place_kind, from_stage: beforeStage, to_stage: afterStage,
      direction, cause: entry.cause, summary, key_moment: true, history_index: d.place_history.length - 1,
    });
  }

  if (places.length) canonDb.persist();
  return { transitions, drifts };
}

module.exports = { tick, ensurePlace, stageOf, inferKind, STAGES };
