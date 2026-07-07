// Phase 16 · A-tier #7 — Flashback
//
// When the present strongly rhymes with the past — same emotional colour, place,
// or people, and enough time has passed — the GM briefly cuts to a flashback.
// This is a targeted, cooldown-gated sibling of ordinary memory retrieval: we
// pick the single most resonant *old* memory and hand the Scene Composer a line
// asking it to weave a short remembered beat into the narration.
//
// Read-only over the Memory Engine; safe under calm_mode (it deepens immersion,
// it doesn't move the world).

"use strict";

const MIN_AGE = 8;       // memory must be at least this many turns old
const COOLDOWN = 5;      // don't fire flashbacks more often than this
const MIN_INTENSITY = 2;

// Resonance of an old memory against the current scene (higher = better match).
function resonance(mem, sceneSpec, turn) {
  const age = turn - (mem.timestamp.campaign_turn || 0);
  if (age < MIN_AGE) return 0;
  if ((mem.emotion_intensity || 0) < MIN_INTENSITY) return 0;

  const sceneEmotions = new Set([sceneSpec.primary_emotion, ...(sceneSpec.emotion_tags || [])].filter(Boolean));
  const parts = new Set(sceneSpec.participants || []);
  const emo = (mem.emotion_tags || []).filter((t) => sceneEmotions.has(t)).length;
  const peopleMatch = (mem.participants || []).some((p) => parts.has(p)) ? 1 : 0;
  const placeMatch = mem.location && sceneSpec.location === mem.location ? 1 : 0;

  if (!emo && !peopleMatch && !placeMatch) return 0; // must rhyme somehow
  // weight: emotional echo is the point; place/people ground it; tier/age add depth.
  return emo * 2 + peopleMatch * 1.5 + placeMatch * 1.5 + (mem.tier || 1) * 0.5 + Math.min(age, 60) / 60;
}

// Returns the best resonant memory (not this turn's), or null.
function detect(state, memoryEngine, sceneSpec) {
  const turn = state.turn_number;
  if (state.last_flashback_turn != null && turn - state.last_flashback_turn < COOLDOWN) return null;
  let best = null, bestScore = 0;
  for (const m of memoryEngine.all() || []) {
    const s = resonance(m, sceneSpec, turn);
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return bestScore >= 3.5 ? best : null; // threshold: only a genuine rhyme fires
}

function directiveLine(mem) {
  if (!mem) return null;
  const when = (mem.timestamp && mem.timestamp.in_world_date) || ((mem.timestamp && mem.timestamp.campaign_turn) + "턴 전");
  return `회상(플래시백): 지금 이 순간이 과거의 한 장면과 겹친다 — "${mem.summary}" (${when}). 현재 서술 중간에 짧은 회상 한 조각을 자연스럽게 끼워 넣어 감정의 결을 두텁게 하라(길게 늘이지 말 것).`;
}

// Convenience: detect + mark cooldown + return the directive line (or null).
function lineFor(state, memoryEngine, sceneSpec) {
  const mem = detect(state, memoryEngine, sceneSpec);
  if (!mem) return null;
  state.last_flashback_turn = state.turn_number;
  return directiveLine(mem);
}

// PATCH_NARRATIVE_ACCUMULATION_GAPS · flashback_scene — the whole-scene sibling
// of the inline flashback line. Instead of weaving one remembered beat into the
// present, the entire next scene is *set in the past* (a time-shift). It fires
// only when (a) the player explicitly reaches for the past, or (b) a memory
// rhymes so hard the moment demands it — and much more rarely than the inline
// flashback (its own long cooldown). Returns { scene_type: "flashback_scene",
// line, memory } or null. Caller merges scene_type and sets sceneSpec.flashback_scene.
const SCENE_COOLDOWN = 25;
const EXPLICIT_RE = /(회상한다|회상해|떠올린다|떠올려|기억을 되짚|그때를 생각|과거로|옛 기억|돌이켜)/;

function maybeFlashbackScene(state, memoryEngine, sceneSpec, playerInput) {
  const turn = state.turn_number;
  if (state.last_flashback_scene_turn != null && turn - state.last_flashback_scene_turn < SCENE_COOLDOWN) return null;
  const explicit = EXPLICIT_RE.test(String(playerInput || ""));
  // Find the strongest resonant memory; explicit intent lowers the bar.
  let best = null, bestScore = 0;
  for (const m of memoryEngine.all() || []) {
    const s = resonance(m, sceneSpec, turn);
    if (s > bestScore) { bestScore = s; best = m; }
  }
  const threshold = explicit ? 2.0 : 5.5; // whole-scene needs a much stronger rhyme
  if (!best || bestScore < threshold) return null;
  state.last_flashback_scene_turn = turn;
  const when = (best.timestamp && best.timestamp.in_world_date) || ((best.timestamp && best.timestamp.campaign_turn) + "턴 전");
  return {
    scene_type: "flashback_scene",
    memory: best.id || best.summary,
    line: `[시간대 전환 · 회상 장면] 이번 장면 전체를 과거의 한 순간으로 옮겨 서술하라 — "${best.summary}" (${when}). 현재가 아니라 그때 그 자리에서 벌어지는 일로 그리되, 끝맺을 때 짧게 현재로 되돌아오는 여운을 남겨라. 회상임을 설명하지 말고 장면 자체로 보여줘라.`,
  };
}

module.exports = { detect, directiveLine, lineFor, maybeFlashbackScene, MIN_AGE, COOLDOWN, SCENE_COOLDOWN };
