// Step 7 — Dynamic prompt block assembly (GeminiSystemPrompt §3)
//
// RULE (project): each of the 4 blocks is its own function pulling from exactly
// one engine's output, so the engine behind a block can be swapped without
// touching the others. These functions receive already-retrieved data (Canon
// entities, Memory objects, the Emotion Directive, the SceneSpec) — they do not
// call the engines themselves. src/turn.js does the retrieval and passes it in.

const { SYSTEM_PROMPT_BASE, CONTENT_INTENSITY_LINES, RESPONSE_LENGTH_LINES } = require("./systemPromptBase");

const TIER_NAME = ["", "Temporary", "Personal", "Historical", "Cultural", "Legendary"];

// --- <canon_context> — from Canon Database (CanonDatabase §7) -------------
function buildCanonContext(entities) {
  if (!entities || !entities.length) {
    return "<canon_context>\n(관련 Canon 없음)\n</canon_context>";
  }
  const lines = entities.map((e) => {
    const d = e.data || {};
    let desc;
    if (e.type === "Character") {
      const psy = d.psychology || {};
      const bits = [d.affiliations && d.affiliations.length ? `소속: ${d.affiliations.join(", ")}` : null,
        (psy.attachment_style || d.attachment_style) ? `애착유형: ${psy.attachment_style || d.attachment_style}` : null,
        psy.core_fear ? `두려움: ${psy.core_fear}` : null,
        psy.desire ? `욕구: ${psy.desire}` : null,
        psy.defense_mechanism ? `방어기제: ${psy.defense_mechanism}` : null,
        d.goal_current ? `현재 목표: ${d.goal_current}` : null,
        d.current_location ? `현재 위치: ${d.current_location}` : null,
        d.current_status ? `상태: ${d.current_status}` : null].filter(Boolean);
      desc = `${d.birth_name || e.canon_id}${bits.length ? " — " + bits.join(", ") : ""}`;
    } else if (e.type === "World") {
      const feats = (d.notable_features || []).join("; ");
      desc = `${e.canon_id}${feats ? " — " + feats : ""}`;
    } else if (e.type === "Faction") {
      const bits = [d.leader ? `수장: ${d.leader}` : null, d.stance ? `성향: ${d.stance}` : null].filter(Boolean);
      desc = `${e.canon_id}${bits.length ? " — " + bits.join(", ") : ""}`;
    } else {
      desc = e.canon_id;
    }
    return `[${e.type}] ${desc}`;
  });
  return `<canon_context>\n${lines.join("\n")}\n위 사실들은 절대 변경하거나 모순되게 서술하지 마라.\n</canon_context>`;
}

// --- <memory_context> — from Memory Engine (MemoryEngine §8) --------------
function buildMemoryContext(memories) {
  if (!memories || !memories.length) {
    return "<memory_context>\n(관련 기억 없음)\n</memory_context>";
  }
  const lines = memories.map((m) => {
    const tier = TIER_NAME[m.tier] || "Temporary";
    const emo = (m.emotion_tags || []).length ? ` (감정: ${m.emotion_tags.join(", ")})` : "";
    return `[${tier}] ${m.summary}${emo}`;
  });
  return `<memory_context>\n${lines.join("\n")}\n위 기억들을 참고하되, 그대로 나열하지 말고 현재 장면에 자연스럽게 녹여라.\n</memory_context>`;
}

// --- <emotion_directive> — from Emotion Engine (EmotionEngine §9) ----------
function buildEmotionDirective(emotionDirective) {
  const d = (emotionDirective && emotionDirective.directive) || {};
  const lines = [
    `이번 장면의 목표 감정: ${d.primary_emotion || "calm"}`,
    `목표 강도: ${d.intensity_target ?? 2}/5${d.recovery_scene ? " (낮음, 회복 장면)" : ""}`,
  ];
  if (d.avoid && d.avoid.length) lines.push(`피해야 할 감정: ${d.avoid.join(", ")}`);
  if (d.must_include && d.must_include.length) lines.push(`반드시 포함: ${d.must_include.join(", ")}`);
  return `<emotion_directive>\n${lines.join("\n")}\n위 지시를 감정 수치나 게임 시스템 언어로 드러내지 말고, 오직 묘사와 대사를 통해서만 구현하라.\n</emotion_directive>`;
}

// --- <scene_directive> — from Scene Composer (SceneComposer §6) ------------
function buildSceneDirective(spec) {
  if (!spec) return "<scene_directive>\n(장면 명세 없음)\n</scene_directive>";
  const typeMap = {
    conflict: "갈등",
    bond: "유대",
    discovery: "발견",
    reflection: "성찰",
    transition: "전환",
    catharsis: "카타르시스",
  };
  const moodMap = { comedy: "코미디", slice_of_life: "일상", mystery: "미스터리", horror: "공포", romance: "로맨스", political: "정치극", adventure: "모험" };
  const types = (spec.scene_type || []).map((t) => typeMap[t] || t).join(" + ");
  const lines = [
    `장면 타입: ${types}`,
    spec.mood ? `무드/톤: ${moodMap[spec.mood] || spec.mood}` : null,
    `목표 감정: ${spec.primary_emotion} (강도 ${spec.intensity}/5)`,
    `등장: ${(spec.participants || []).join(", ")}`,
  ].filter(Boolean);
  if (spec.location) lines.push(`장소: ${spec.location}`);
  if (spec.must_include && spec.must_include.length) lines.push(`반드시 포함: ${spec.must_include.join(", ")}`);
  if (spec.avoid && spec.avoid.length) lines.push(`피할 것: ${spec.avoid.join(", ")}`);
  if (spec.subtext_theme) lines.push(`주제(서브텍스트, 직접 언급 금지): ${spec.subtext_theme} — 상징이나 행동으로만 은은하게 암시할 것`);
  if (spec.inner_voice_hint) lines.push(`내면의 갈등: ${spec.inner_voice_hint}`);
  if (spec.tone_notes) lines.push(`분위기: ${spec.tone_notes}`);
  if (spec.check_result) lines.push(spec.check_result); // Phase 4 B1 — words only, no numbers
  if (spec.ending_directive) lines.push(spec.ending_directive); // Phase 4 B2
  // Phase 7 — slow-context layers (weather, hidden trajectory, difficulty tone,
  // proactive NPC beats, mystery clue). All qualitative; never expose numbers.
  if (spec.weather_line) lines.push(spec.weather_line); // A5
  if (spec.tech_level) { // Phase 9 E1 — keep tech/communication era consistent
    const techKo = { modern: "현대", industrial: "산업화 시대", medieval: "중세", ancient: "고대", fantasy_low: "낮은 판타지", fantasy_high: "높은 판타지", sci_fi: "SF/근미래" }[spec.tech_level] || spec.tech_level;
    lines.push(`기술 수준: ${techKo} — 이 시대에 없는 기술(통신·이동·무기 등)을 등장시키지 말 것.`);
  }
  // Phase 11 S — frame hidden-variable tendencies so they surface only at
  // natural moments, never as mechanical per-turn statements.
  if ((spec.hidden_directives || []).length) {
    lines.push("아래는 캐릭터의 현재 내면 상태 '경향'이다 — 매 문장마다 드러낼 필요 없고, 자연스러운 순간에만 은은하게 반영하라:");
    for (const hd of spec.hidden_directives) lines.push(`· ${hd}`);
  }
  if (spec.difficulty_hint) lines.push(`페이싱(난이도): ${spec.difficulty_hint}`); // C2
  if (spec.planner_hint) lines.push(`페이싱(구조): ${spec.planner_hint}`); // A3
  for (const c of spec.npc_candidates || []) lines.push(`NPC 능동 후보: ${c.line}`); // A1
  if (spec.mystery_hint) lines.push(`미스터리 단서(자연스럽게 드러낼 것): ${spec.mystery_hint.content_summary} — 수수께끼: ${spec.mystery_hint.question}`); // A4
  if (spec.sentimental_echo) lines.push(`추억의 물건(${spec.sentimental_echo.item_name})이 이 장면과 닿아 있다 — 담담히 지나치지 말고 획득 당시의 감정을 짧게 되살릴 것: "${spec.sentimental_echo.memory_summary}"`); // Phase 11 R
  return `<scene_directive>\n${lines.join("\n")}\n</scene_directive>`;
}

// --- <house_rules> — Phase 5 Wave 3. User-authored GM rules. The absolute
// prohibitions in SYSTEM_PROMPT_BASE keep priority: stated explicitly here.
function buildHouseRules(houseRules) {
  const rules = (houseRules || []).map((r) => String(r).trim()).filter(Boolean);
  if (!rules.length) return null;
  return `<house_rules>\n${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n단, 위 하우스 룰이 시스템의 절대 금지사항(내부 수치 노출 금지 등)과 충돌하면 절대 금지사항이 항상 우선한다.\n</house_rules>`;
}

// --- <recent_dialogue> — raw last 2-3 turns (GeminiSystemPrompt §3) --------
// NOT summarized — verbatim, for immediate continuity. Distinct from Temporary
// memory (which is summarized).
function buildRecentDialogue(recentDialogue) {
  const recent = (recentDialogue || []).slice(-3);
  if (!recent.length) return "<recent_dialogue>\n(이전 대화 없음 — 캠페인 시작)\n</recent_dialogue>";
  const lines = recent.map((r) => `플레이어: ${r.player}\nGM: ${r.gm}`);
  return `<recent_dialogue>\n${lines.join("\n\n")}\n</recent_dialogue>`;
}

// --- full system prompt assembly (§3 template) ----------------------------
// NOTE: player_input is intentionally NOT included here. Per §6 checklist it is
// sent as the user turn in `contents`, not in the system prompt (keeps the
// prompt cacheable / avoids per-turn cache invalidation).
function assembleSystemPrompt({ canon, memory, emotion, scene, recent, houseRules, contentIntensity, responseLength }) {
  const intensityLine = CONTENT_INTENSITY_LINES[contentIntensity || "medium"] || CONTENT_INTENSITY_LINES.medium;
  const lengthLine = RESPONSE_LENGTH_LINES[responseLength || "normal"] || "";
  return [
    SYSTEM_PROMPT_BASE,
    "",
    intensityLine,
    lengthLine || null,
    buildHouseRules(houseRules),
    "",
    buildCanonContext(canon),
    "",
    buildMemoryContext(memory),
    "",
    buildEmotionDirective(emotion),
    "",
    buildSceneDirective(scene),
    "",
    buildRecentDialogue(recent),
    "",
    "위 맥락을 바탕으로 다음 장면을 서술하라.",
  ].filter((x) => x !== null).join("\n");
}

module.exports = {
  buildCanonContext,
  buildMemoryContext,
  buildEmotionDirective,
  buildSceneDirective,
  buildRecentDialogue,
  buildHouseRules,
  assembleSystemPrompt,
};
