// Phase 3 · Wave 2 · System 7 — Director Debate
//
// Replaces the Phase 2 hardcoded "Emotion Directive always wins" with a real
// adjudication. First a rule-based priority tree (NarrativeKernel §5):
//   1. Canon consistency  2. Emotion recovery  3. Foreshadow deadline
//   4. Rhythm diversity    5. Story default
// Only genuinely ambiguous clashes would escalate to a low-cost LLM call; the
// rule tree resolves the common cases deterministically and emits the debate
// transcript in the EmotionEngine §7 format for the debug trace.

const LOW_TYPES = ["discovery", "reflection", "bond"];

// Detect + resolve conflicts among directives. Returns:
//   { occurred, decision: { allowed?, intensity_target?, must_include? }, log }
function resolve({ emotion, story, rhythm }) {
  const ed = emotion.directive;
  const log = [];
  let decision = {};
  let occurred = false;

  // Case A — Emotion wants rest, Story wants to push a high-urgency beat.
  if (ed.recovery_scene && story.urgency === "high") {
    occurred = true;
    log.push({ speaker: "Emotion Director", text: `회복이 필요하다. 강도를 ${ed.intensity_target}/5 이하로 유지해야 한다.` });
    log.push({ speaker: "Story Director", text: `그러나 이번 사건(${story.proposed_beat})을 지금 다뤄야 구조가 무너지지 않는다.` });
    log.push({ speaker: "Rhythm Director", text: "그렇다면 낮은 강도의 발견(Discovery)/성찰 장면 안에서 사건을 '발견'으로 처리하자." });
    // Emotion wins on intensity (priority 2), Story's beat survives as low-key discovery.
    decision = {
      allowed: LOW_TYPES,
      intensity_target: ed.intensity_target,
      must_include: [...(ed.must_include || []), ...(story.foreshadow_refs || [])],
    };
    log.push({ speaker: "Kernel", text: `승인 → 장면=발견/성찰, 강도=${ed.intensity_target}, 사건은 저강도 발견으로 회수.` });
    return { occurred, decision, reasoning_log: "Emotion 회복(우선순위2) vs Story 마감(3) → Rhythm 절충안 채택", log };
  }

  // Case B — Rhythm flags the emotion-preferred type as over-used.
  const hint = ed.scene_type_hint || [];
  if (rhythm && rhythm.avoid_scene_types && hint.length && hint.every((t) => rhythm.avoid_scene_types.includes(t))) {
    occurred = true;
    log.push({ speaker: "Emotion Director", text: `선호 장면 타입: ${hint.join(", ")}` });
    log.push({ speaker: "Rhythm Director", text: `그 타입들은 최근 과다 사용됨(${rhythm.avoid_scene_types.join(",")}). 다른 타입을 쓰자.` });
    decision = { avoid: rhythm.avoid_scene_types };
    log.push({ speaker: "Kernel", text: "승인 → Rhythm 규칙(우선순위4)에 따라 대체 타입 선택." });
    return { occurred, decision, reasoning_log: "Emotion 선호 vs Rhythm 다양성(4) → Rhythm 채택", log };
  }

  return { occurred: false, decision: {}, reasoning_log: null, log: [] };
}

module.exports = { resolve };
