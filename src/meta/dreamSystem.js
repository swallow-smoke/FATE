// Phase 16 · A-tier #6 — Dream System
//
// When the player sleeps (an in-world day rolls over, or they explicitly rest),
// they may dream. Three kinds:
//   · 악몽(nightmare)   — recent tension/loss bleeds into sleep
//   · 예지몽(prophetic) — an unresolved foreshadow surfaces as symbolic imagery
//                         (so the dream literally does foreshadowing work)
//   · 회상몽(recall)    — a strong old memory replays
// Not every night — only when something is charged enough to dream about.
//
// LLM writes the dream prose (key moment); a rule-based template is the fallback
// under mock / low-token. calm_mode keeps dreams (they're intimate, not world
// churn) but avoids nightmares so a quiet romance playthrough stays gentle.

"use strict";

const HISTORY_MAX = 20;

const NIGHTMARE_TAGS = new Set(["fear", "tension", "loss", "dread", "grief", "anger", "horror"]);
const WARM_TAGS = new Set(["warmth", "joy", "love", "triumph", "hope", "relief"]);

// Pick what to dream about. Returns { type, seed } or null (no dream tonight).
function selectDream(state, memoryEngine) {
  const turn = state.turn_number;
  const calm = !!(state.settings && state.settings.calm_mode);

  // 1) 예지몽 — an unresolved foreshadow whose deadline is approaching.
  const fs = (state.foreshadow_pool || []).find((f) => !f.resolved && (f.deadline_turn - turn) <= 15);
  if (fs && Math.random() < 0.6) {
    return { type: "예지몽", seed: { kind: "foreshadow", id: fs.id, summary: fs.summary || fs.hint || "다가올 무언가", refs: fs.canon_refs || [] } };
  }

  // Recent emotional colour from the last handful of memories.
  const recent = (memoryEngine.all() || []).slice(-12);
  const nightmareFuel = recent.filter((m) => (m.emotion_tags || []).some((t) => NIGHTMARE_TAGS.has(t)) && (m.emotion_intensity || 0) >= 3);
  const warmOld = recent.filter((m) => (m.emotion_tags || []).some((t) => WARM_TAGS.has(t)) && (m.emotion_intensity || 0) >= 2);

  // 2) 악몽 — recent charged negative memory (suppressed in calm mode).
  if (!calm && nightmareFuel.length && Math.random() < 0.55) {
    const m = nightmareFuel[nightmareFuel.length - 1];
    return { type: "악몽", seed: { kind: "memory", summary: m.summary, refs: m.canon_refs || [] } };
  }

  // 3) 회상몽 — a warm memory replays.
  if (warmOld.length && Math.random() < 0.5) {
    const m = warmOld[Math.floor(Math.random() * warmOld.length)];
    return { type: "회상몽", seed: { kind: "memory", summary: m.summary, refs: m.canon_refs || [] } };
  }
  return null;
}

function ruleText(type, seed) {
  if (type === "예지몽") return `안개 속에서 아직 오지 않은 무언가가 어른거린다. ${seed.summary} — 잠에서 깨어도 그 잔상이 쉬이 지워지지 않는다.`;
  if (type === "악몽") return `식은땀에 젖어 눈을 뜬다. 꿈속에서 ${seed.summary} 그 순간이 몇 번이고 되풀이되었다.`;
  return `꿈결에 오래된 장면이 되살아난다. ${seed.summary} 그 온기가 아직 손끝에 남은 듯하다.`;
}

// Generate at most one dream for this sleep. Async so it can use the LLM.
async function maybeGenerate(state, memoryEngine, gemini, { lowToken = false, trigger = "day" } = {}) {
  const pick = selectDream(state, memoryEngine);
  if (!pick) return null;

  let text = ruleText(pick.type, pick.seed);
  if (!lowToken && gemini && gemini.hasKey && gemini.hasKey()) {
    try {
      const promptSettings = require("../gemini/promptSettings");
      const instr = pick.type === "예지몽"
        ? "다음 실마리를 상징과 이미지로만 암시하는 짧은 예지몽을 2~3문장으로 써라. 직접 설명하지 말고 꿈처럼 몽환적으로. 순수 텍스트."
        : pick.type === "악몽"
        ? "다음 기억이 뒤틀려 되풀이되는 짧은 악몽을 2~3문장으로 써라. 순수 텍스트, 메타 설명 금지."
        : "다음 기억이 따뜻하게 되살아나는 짧은 꿈을 2~3문장으로 써라. 순수 텍스트, 메타 설명 금지.";
      const out = await gemini.summarize(promptSettings.getPrompt(state, "dream.generate", instr, { kind: pick.type }), pick.seed.summary || "", "dream");
      if (out && out.trim()) text = out.trim();
    } catch (_) { /* keep rule text */ }
  }

  const dream = {
    turn: state.turn_number,
    in_world_day: state.in_world_day || null,
    in_world_date: state.in_world_date || null,
    type: pick.type,
    text,
    seed_kind: pick.seed.kind,
    seed_ref: pick.seed.id || null,
    trigger,
  };
  state.dreams = [...(state.dreams || []), dream].slice(-HISTORY_MAX);

  // A 예지몽 records a faint Personal memory so the foreshadow can later "click".
  if (pick.type === "예지몽" && memoryEngine && memoryEngine.write) {
    memoryEngine.write({
      summary: `[예지몽] ${pick.seed.summary}`,
      participants: [], emotion_tags: ["foreboding"], emotion_intensity: 2,
      canon_refs: (pick.seed.refs || []).filter(Boolean), tier: 2, tier_reason: "prophetic dream",
    }, state.turn_number);
  }
  return dream;
}

module.exports = { maybeGenerate, selectDream, ruleText, HISTORY_MAX };
