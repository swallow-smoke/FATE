// Phase 16 · System 5 — Place Memory
//
// A place remembers what happened in it. When the player returns to a location
// where meaningful things occurred (첫 만남 → 고백 → 전투 → 화재), we gather those
// memories plus the place's own physical history (Living Places) and hand the
// Scene Composer a directive line so the AI can naturally acknowledge the past
// — "이 항구에 다시 서니…" — instead of treating every visit as the first.
//
// Read-only over the Memory Engine + Canon; safe under calm_mode (this is a
// "surface what already happened" feature, not autonomous world motion).

"use strict";

// Collect the memories that happened AT this location (by memory.location or a
// canon_ref pointing at the place entity) plus the place's transition history.
function forLocation(state, canonDb, memoryEngine, location) {
  if (!location) return null;
  const placeEntity = canonDb.all().find((e) => e.type === "World" && (e.canon_id === location || (e.data && e.data.region) === location));
  const placeRefs = new Set([location, placeEntity && placeEntity.canon_id].filter(Boolean));

  const mems = (memoryEngine.all() || [])
    .filter((m) => (m.location && placeRefs.has(m.location)) || (m.canon_refs || []).some((r) => placeRefs.has(r)))
    .sort((a, b) => (a.timestamp.campaign_turn || 0) - (b.timestamp.campaign_turn || 0))
    .map((m) => ({
      turn: m.timestamp.campaign_turn,
      in_world_date: m.timestamp.in_world_date || null,
      summary: m.summary,
      emotion_tags: m.emotion_tags || [],
      tier: m.tier,
    }));

  const place_history = (placeEntity && placeEntity.data && placeEntity.data.place_history) || [];
  const place_name = (placeEntity && placeEntity.data && (placeEntity.data.notable_features || [])[0]) || location;
  const place_stage = (placeEntity && placeEntity.data && placeEntity.data.place_stage) || null;

  if (!mems.length && !place_history.length) return null;
  return { location, place_name, place_stage, memories: mems, place_history, canon_id: placeEntity && placeEntity.canon_id };
}

// Is this a genuine RE-visit? (there is at least one prior memory here, not from
// this very turn). Avoids firing on the first time the player sees a place.
function isRevisit(pm, turn) {
  return !!pm && (pm.memories || []).some((m) => m.turn != null && m.turn < turn);
}

// Compact directive line for <scene_directive>. Names the most emotionally
// charged past beats (top 3 by tier/intensity order already sorted by time) plus
// the place's own change, so the AI weaves continuity in without reciting a list.
function directiveLine(pm) {
  if (!pm) return null;
  const beats = (pm.memories || [])
    .filter((m) => !/^\[장소\]/.test(m.summary || "")) // 물리적 변천은 아래 changeNote가 담당
    .slice()
    .sort((a, b) => (b.tier || 0) - (a.tier || 0))
    .slice(0, 3)
    .sort((a, b) => (a.turn || 0) - (b.turn || 0))
    .map((m) => `${m.in_world_date || m.turn + "턴"}: ${m.summary}`);
  const changed = (pm.place_history || []).slice(-1)[0];
  const changeNote = changed ? ` 그리고 이곳은 ${changed.from_stage}에서 ${changed.to_stage}(으)로 변했다(${changed.summary}).` : "";
  if (!beats.length && !changeNote) return null;
  return `이 장소(${pm.place_name})의 기억: ${beats.join(" / ")}.${changeNote} 플레이어가 이곳에 다시 섰다는 사실과 그 기억의 무게를 서술에 자연스럽게 녹여라(나열하지 말 것).`;
}

module.exports = { forLocation, isRevisit, directiveLine };
