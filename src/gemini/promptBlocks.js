// Step 7 — Dynamic prompt block assembly (GeminiSystemPrompt §3)
//
// RULE (project): each of the 4 blocks is its own function pulling from exactly
// one engine's output, so the engine behind a block can be swapped without
// touching the others. These functions receive already-retrieved data (Canon
// entities, Memory objects, the Emotion Directive, the SceneSpec) — they do not
// call the engines themselves. src/turn.js does the retrieval and passes it in.

const { SYSTEM_PROMPT_BASE, CONTENT_INTENSITY_LINES, RESPONSE_LENGTH_LINES, PLAYER_AGENCY_LOCK_LINE, CALM_MODE_LINE, META_KNOWLEDGE_STRICT_LINE } = require("./systemPromptBase");
const promptSettings = require("./promptSettings");
const tokenBudget = require("./tokenBudget");
const dimensionRegistry = require("../custom/dimensionRegistry");

const TIER_NAME = ["", "Temporary", "Personal", "Historical", "Cultural", "Legendary"];

// Render one Canon entity's body text at the given LOD (Phase 13 V4).
// "full" = complete psychology; "medium" = name + one-line only.
function renderCanonBody(e, lod) {
  const d = e.data || {};
  if (lod === "medium") {
    const one = e.type === "Character"
        ? (d.goal_current || (d.psychology && d.psychology.desire) || d.current_status || "")
        : e.type === "World" ? (d.notable_features || [])[0] || ""
            : e.type === "Faction" ? (d.stance || "") : "";
    return `[${e.type}] ${d.birth_name || e.canon_id}${one ? " — " + one : ""} (요약)`;
  }

  let desc;

  if (e.type === "Character") {
    const psy = d.psychology || {};
    const bits = [
      d.affiliations && d.affiliations.length ? `소속: ${d.affiliations.join(", ")}` : null,
      (psy.attachment_style || d.attachment_style) ? `애착유형: ${psy.attachment_style || d.attachment_style}` : null,
      psy.core_fear ? `두려움: ${psy.core_fear}` : null,
      psy.desire ? `욕구: ${psy.desire}` : null,
      psy.defense_mechanism ? `방어기제: ${psy.defense_mechanism}` : null,
      d.goal_current ? `현재 목표: ${d.goal_current}` : null,
      d.current_location ? `현재 위치: ${d.current_location}` : null,
      d.current_status ? `상태: ${d.current_status}` : null,
    ].filter(Boolean);

    desc = `${d.birth_name || e.canon_id}${bits.length ? " — " + bits.join(", ") : ""}`;
  } else if (e.type === "World") {
    const feats = (d.notable_features || []).join("; ");
    desc = `${e.canon_id}${feats ? " — " + feats : ""}`;
  } else if (e.type === "Faction") {
    const bits = [
      d.leader ? `수장: ${d.leader}` : null,
      d.stance ? `성향: ${d.stance}` : null,
    ].filter(Boolean);

    desc = `${e.canon_id}${bits.length ? " — " + bits.join(", ") : ""}`;
  } else {
    desc = e.canon_id;
  }

  return `[${e.type}] ${desc}`;
}

// Produce per-entity lines so delta (V5) and token-budget (V3) can operate on
// individual items. lod is { canon_id: "full"|"medium" }. Priority: full > medium.
function renderCanonLines(entities, lod = {}) {
  return (entities || []).map((e) => {
    const level = lod[e.canon_id] || "full";
    return {
      id: e.canon_id,
      body: renderCanonBody(e, level),
      priority: level === "full" ? 3 : 1,
    };
  });
}

// --- <canon_context> — from Canon Database (CanonDatabase §7) -------------
// opts: { lod, unchanged:Set, budget:number, onTrim(fn) }
function buildCanonContext(entities, opts = {}) {
  if (!entities || !entities.length) {
    return "<canon_context>\n(관련 Canon 없음)\n</canon_context>";
  }

  let lines = renderCanonLines(entities, opts.lod);

  if (opts.budget) {
    const r = tokenBudget.trimToBudget(lines, opts.budget);
    if (opts.onTrim) opts.onTrim("canon_context", r);
    lines = r.kept;
  }

  const rendered = lines.map((l) =>
      opts.unchanged && opts.unchanged.has(l.id)
          ? `${l.body.split(" — ")[0]} (이전과 동일)`
          : l.body
  );

  return `<canon_context>\n${rendered.join("\n")}\n위 사실들은 절대 변경하거나 모순되게 서술하지 마라.\n</canon_context>`;
}

// --- <memory_context> — from Memory Engine (MemoryEngine §8) --------------
function renderMemoryLines(memories) {
  return (memories || []).map((m) => {
    const tier = TIER_NAME[m.tier] || "Temporary";
    const emo = (m.emotion_tags || []).length ? ` (감정: ${m.emotion_tags.join(", ")})` : "";
    const sensory = m.sensory_anchor ? ` / 감각 단서: ${m.sensory_anchor}` : "";
    const callback = m.callback_potential ? ` / 재호출 가능성: ${m.callback_potential}` : "";

    return {
      id: m.id || m.summary,
      body: `[${tier}] ${m.summary}${emo}${sensory}${callback}`,
      priority: m.tier || 1,
    };
  });
}

function buildMemoryContext(memories, opts = {}) {
  if (!memories || !memories.length) {
    return "<memory_context>\n(관련 기억 없음)\n</memory_context>";
  }

  let lines = renderMemoryLines(memories);

  if (opts.budget) {
    const r = tokenBudget.trimToBudget(lines, opts.budget);
    if (opts.onTrim) opts.onTrim("memory_context", r);
    lines = r.kept;
  }

  const rendered = lines.map((l) =>
      opts.unchanged && opts.unchanged.has(l.id)
          ? `${l.body} (이전과 동일)`
          : l.body
  );

  return `<memory_context>\n${rendered.join("\n")}\n위 기억들을 참고하되, 그대로 나열하지 말고 현재 장면에 자연스럽게 녹여라. 특히 감각 단서와 재호출 가능성이 있는 기억은 설명하지 말고 행동·공간·물건을 통해 은근히 되살려라.\n</memory_context>`;
}

// --- <emotion_directive> — from Emotion Engine (EmotionEngine §9) ----------
function buildEmotionDirective(emotionDirective) {
  const d = (emotionDirective && emotionDirective.directive) || {};

  const lines = [
    `이번 장면의 정서적 기류: ${d.primary_emotion || "calm"}`,
    `감정의 밀도: ${d.intensity_target ?? 2}/5${d.recovery_scene ? " (회복과 정리의 흐름)" : ""}`,
  ];

  if (d.avoid && d.avoid.length) {
    lines.push(`피해야 할 정서: ${d.avoid.join(", ")}`);
  }

  if (d.must_include && d.must_include.length) {
    lines.push(`자연스럽게 스며들 요소: ${d.must_include.join(", ")}`);
  }

  return `<emotion_directive>\n${lines.join("\n")}\n이 지시는 장면의 감정 분위기를 정하는 참고용이다.\n감정을 직접 설명하거나 즉시 폭발시키지 마라.\n인물이 감정을 숨기려는 방식, 말하지 못한 것, 달라진 거리감, 오래 붙잡는 물건, 어색해진 침묵으로만 드러내라.\n특히 강한 감정일수록 먼저 참는 모습과 작은 균열을 쌓고, 필요한 경우에만 마지막에 아주 짧게 새어나오게 하라.\n</emotion_directive>`;
}

// --- <scene_directive> — from Scene Composer (SceneComposer §6) ------------
function buildSceneDirective(spec) {
  if (!spec) {
    return "<scene_directive>\n(장면 명세 없음)\n</scene_directive>";
  }

  const typeMap = {
    conflict: "갈등",
    bond: "유대",
    discovery: "발견",
    reflection: "성찰",
    transition: "전환",
    catharsis: "카타르시스",
    flashback_scene: "회상 장면", // PATCH_NARRATIVE_ACCUMULATION_GAPS

    // Phase 15 CC — plugin-registered scene types merge their labels here.
    ...require("../plugins/plugins").sceneTypeLabels(),
  };

  const moodMap = {
    comedy: "코미디",
    slice_of_life: "일상",
    mystery: "미스터리",
    horror: "공포",
    romance: "로맨스",
    political: "정치극",
    adventure: "모험",
  };

  const types = (spec.scene_type || []).map((t) => typeMap[t] || t).join(" + ");

  const lines = [
    `장면의 기능: ${types}`,
    spec.mood ? `전체 분위기: ${moodMap[spec.mood] || spec.mood}` : null,
    `정서적 방향: ${spec.primary_emotion} — 강도 ${spec.intensity}/5는 직접 표현량이 아니라 장면 아래에 깔리는 압력으로만 반영`,
    `등장 인물: ${(spec.participants || []).join(", ")}`,
  ].filter(Boolean);

  if (spec.location) {
    lines.push(`장소: ${spec.location}`);
  }

  if (spec.must_include && spec.must_include.length) {
    lines.push(`가능하면 자연스럽게 스며들 요소: ${spec.must_include.join(", ")} — 장면의 감정 흐름을 깨면 생략해도 된다.`);
  }

  if (spec.avoid && spec.avoid.length) {
    lines.push(`피할 것: ${spec.avoid.join(", ")}`);
  }

  if (spec.subtext_theme) {
    lines.push(`주제(서브텍스트, 직접 언급 금지): ${spec.subtext_theme} — 상징이나 행동으로만 은은하게 암시할 것`);
  }

  if (spec.inner_voice_hint) {
    lines.push(`내면의 갈등: ${spec.inner_voice_hint} — 직접 설명보다 말하지 못한 반응으로 드러낼 것`);
  }

  if (spec.tone_notes) {
    lines.push(`분위기: ${spec.tone_notes}`);
  }

  if (spec.check_result) {
    lines.push(`판정의 여파: ${spec.check_result} — 결과 자체보다 그 결과를 본 인물들의 반응과 달라진 거리감을 우선하라.`);
  }

  if (spec.ending_directive) {
    lines.push(spec.ending_directive);
  }

  // Phase 7 — slow-context layers (weather, hidden trajectory, difficulty tone,
  // proactive NPC beats, mystery clue). All qualitative; never expose numbers.
  if (spec.weather_line) {
    lines.push(spec.weather_line);
  }

  if (spec.tech_level) {
    // Phase 9 E1 — keep tech/communication era consistent
    const techKo = {
      modern: "현대",
      industrial: "산업화 시대",
      medieval: "중세",
      ancient: "고대",
      fantasy_low: "낮은 판타지",
      fantasy_high: "높은 판타지",
      sci_fi: "SF/근미래",
    }[spec.tech_level] || spec.tech_level;

    lines.push(`기술 수준: ${techKo} — 이 시대에 없는 기술(통신·이동·무기 등)을 등장시키지 말 것.`);
  }

  // Phase 11 S — frame hidden-variable tendencies so they surface only at
  // natural moments, never as mechanical per-turn statements.
  if ((spec.hidden_directives || []).length) {
    lines.push("아래는 캐릭터의 현재 내면 상태 '경향'이다 — 매 문장마다 드러낼 필요 없고, 자연스러운 순간에만 은은하게 반영하라:");
    for (const hd of spec.hidden_directives) {
      lines.push(`· ${hd}`);
    }
  }

  if (spec.difficulty_hint) {
    lines.push(`페이싱 참고: ${spec.difficulty_hint} — 감정 장면에서는 난이도보다 관계의 여운을 우선하라.`);
  }

  if (spec.planner_hint) {
    lines.push(`구조 참고: ${spec.planner_hint} — 장면을 밀어붙이지 말고 이전 사건의 흔적이 남는지 확인하라.`);
  }

  for (const c of spec.npc_candidates || []) {
    lines.push(`NPC 능동 후보: ${c.line} — 단, 장면의 여백을 깨면 등장시키지 말 것.`);
  }

  if (spec.mystery_hint) {
    lines.push(`미스터리 단서(자연스럽게 드러낼 것): ${spec.mystery_hint.content_summary} — 수수께끼: ${spec.mystery_hint.question}`);
  }

  if (spec.sentimental_echo) {
    lines.push(`감정 앵커: ${spec.sentimental_echo.item_name} — 이 물건은 "${spec.sentimental_echo.memory_summary}"와 닿아 있다. 직접 회상 설명을 늘어놓지 말고, 인물이 그 물건을 바라보거나 만지는 방식, 잠깐 멈추는 시간, 말끝이 흐려지는 순간으로만 과거의 감정을 되살려라.`);
  }

  // PATCH 관계 전환 — a relationship is on the cusp of changing; give it weight.
  if (spec.relationship_transition) {
    lines.push(`관계의 결이 달라지는 순간: 두 사람 사이의 거리, 호칭, 침묵의 편안함 또는 어색함, 먼저 건네는 말의 온도가 이전과 달라져야 한다. 반드시 극적인 선언으로 만들 필요는 없다. 오히려 사소하지만 되돌리기 어려운 변화로 다뤄라.`);
  }

  if (spec.place_memory_line) {
    lines.push(`${spec.place_memory_line} — 장소의 과거를 설명하지 말고 현재의 냄새, 빛, 소리, 남은 흔적을 통해 되살려라.`);
  }

  if (spec.flashback_line) {
    lines.push(`${spec.flashback_line} — 긴 회상 설명보다 한두 개의 감각 단서로 짧게 스치게 하라.`);
  }

  // PATCH_NARRATIVE_ACCUMULATION_GAPS — whole-scene time-shift + accumulation lines.
  if (spec.flashback_scene) {
    lines.push(spec.flashback_scene);
  }

  if (spec.chapter_line) {
    lines.push(spec.chapter_line);
  }

  if (spec.narrative_arc_line) {
    lines.push(spec.narrative_arc_line);
  }

  if (spec.motif_line) {
    lines.push(spec.motif_line);
  }

  if (spec.echo_line) {
    lines.push(spec.echo_line);
  }

  // PATCH_WEBNOVEL_TECHNIQUES — 고구마-사이다 rhythm cue + NPC spotlight (캐빨).
  if (spec.tension_debt_line) {
    lines.push(spec.tension_debt_line);
  }

  if (spec.npc_arc_line) {
    lines.push(spec.npc_arc_line);
  }

  // PATCH_INDIVIDUAL_WORKS_ANALYSIS — climax-pattern break + neglected-cast nudge.
  if (spec.climax_fatigue_line) {
    lines.push(spec.climax_fatigue_line);
  }

  if (spec.cast_neglect_line) {
    lines.push(spec.cast_neglect_line);
  }

  // Genre status-window exception goes LAST so it clearly scopes the numeric
  // permission after all the "hide everything" directives above.
  if (spec.status_window_directive) {
    lines.push(spec.status_window_directive);
  }

  if (spec.nickname_line) {
    lines.push(spec.nickname_line);
  }

  // Phase 16+ · situational world/state directives.
  if (spec.festival_line) {
    lines.push(spec.festival_line);
  }

  if (spec.home_line) {
    lines.push(spec.home_line);
  }

  if (spec.wanted_line) {
    lines.push(spec.wanted_line);
  }

  if (spec.promise_line) {
    lines.push(`${spec.promise_line} — 약속은 말보다 기다린 흔적, 비워둔 자리, 치우지 못한 물건으로 먼저 드러내라.`);
  }

  if (spec.calendar_line) {
    lines.push(spec.calendar_line);
  }

  if (spec.secret_line) {
    lines.push(`${spec.secret_line} — 비밀을 바로 고백시키지 말고 피하는 주제, 멈칫하는 대답, 지나치게 정돈된 거짓말로 먼저 암시하라.`);
  }

  return `<scene_directive>\n${lines.join("\n")}\n위 항목들은 장면을 구성하기 위한 내부 방향이다.\n본문에 그대로 드러내지 말고, 인물의 행동·침묵·시선·호칭 변화·공간의 정적·물건의 재등장으로만 구현하라.\n특히 must_include는 체크리스트처럼 한 번씩 언급하지 말고, 장면 흐름상 자연스러운 것만 녹여라.\n</scene_directive>`;
}

function buildCustomRegistry(state) {
  if (!state) return null;
  return dimensionRegistry.registryPromptLine(state);
}

function buildPromptOverride(state) {
  const custom = promptSettings.appendBlock(state, "narrative.system_addendum", "");
  const po = state && state.prompt_overrides;
  const legacy = po && po.enabled && String(po.system_addendum || "").trim()
    ? String(po.system_addendum).slice(0, 6000)
    : "";
  const body = [custom, legacy].map((s) => String(s || "").trim()).filter(Boolean).join("\n\n");
  if (!body) return null;

  return `<campaign_prompt_override>\n${body}\n이 캠페인별 추가 지시는 위 시스템 절대 원칙과 충돌하지 않는 범위에서 실제 서사 생성에 반영한다.\n</campaign_prompt_override>`;
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

  if (!recent.length) {
    return "<recent_dialogue>\n(이전 대화 없음 — 캠페인 시작)\n</recent_dialogue>";
  }

  const lines = recent.map((r) => `플레이어: ${r.player}\nGM: ${r.gm}`);

  return `<recent_dialogue>\n${lines.join("\n\n")}\n위 최근 대화는 사건 연속성을 위한 참고다.\n직전 GM의 문장 구조나 건조한 설명 방식을 반복하지 말고, 현재 장면의 감정과 관계 변화에 맞춰 새롭게 서술하라.\n</recent_dialogue>`;
}

// --- <setup_notes> — C1/C2. World background description + free-text notes the
// player wrote at creation. Reference material only: weave it in naturally, do
// NOT recite or structure it. Kept as a low-priority context block.
function buildSetupNotes(setupNotes) {
  const s = setupNotes || {};
  const lines = [];

  if (s.background && String(s.background).trim()) {
    lines.push(`[세계관 배경]\n${String(s.background).trim()}`);
  }

  if (s.worldNotes && String(s.worldNotes).trim()) {
    lines.push(`[세계 관련 기타 메모]\n${String(s.worldNotes).trim()}`);
  }

  if (s.playerNotes && String(s.playerNotes).trim()) {
    lines.push(`[플레이어 캐릭터 기타 메모]\n${String(s.playerNotes).trim()}`);
  }

  if (!lines.length) return null;

  return `<setup_notes>\n${lines.join("\n\n")}\n이 내용은 참고용 배경이다. 그대로 나열하지 말고 자연스럽게 서사에 녹여라.\n</setup_notes>`;
}

// --- full system prompt assembly (§3 template) ----------------------------
// NOTE: player_input is intentionally NOT included here. Per §6 checklist it is
// sent as the user turn in `contents`, not in the system prompt (keeps the
// prompt cacheable / avoids per-turn cache invalidation).
// optimize (Phase 13): { canonLod, canonUnchanged, memoryUnchanged, allocation }
// — enables Dynamic LOD (V4), Delta Context (V5) and Token Budget (V3). When
// omitted, behaviour is identical to before (full LOD, no delta, no trimming).
function assembleSystemPrompt({
                                canon,
                                memory,
                                emotion,
                                scene,
                                recent,
                                houseRules,
                                contentIntensity,
                                responseLength,
                                playerAgencyLock,
                                calmMode,
                                setupNotes,
                                state,
                                optimize,
                                // PATCH_IP_EXTENSIONS_PROJECT_MIO — campaign-level IP directives.
                                metaKnowledgeStrict,
                                fixedProtagonistLine,
                                softGoalsLine,
                              }) {
  const intensityLine = CONTENT_INTENSITY_LINES[contentIntensity || "medium"] || CONTENT_INTENSITY_LINES.medium;
  const customIntensity = state && state.settings && state.settings.content_intensity_notes && state.settings.content_intensity_notes[contentIntensity || "medium"];
  const lengthLine = RESPONSE_LENGTH_LINES[responseLength || "normal"] || "";

  const o = optimize || {};
  const trims = [];
  const onTrim = (block, r) => {
    if (r.dropped.length) {
      trims.push({ block, dropped: r.dropped.length, tokens: r.tokens });
    }
  };

  const alloc = o.allocation || {};

  const prompt = [
    promptSettings.getPrompt(state, "narrative.base", SYSTEM_PROMPT_BASE),
    "",
    intensityLine,
    customIntensity ? `묘사 수위 사용자 설명: ${customIntensity}` : null,
    lengthLine || null,
    playerAgencyLock ? PLAYER_AGENCY_LOCK_LINE : null,
    calmMode ? CALM_MODE_LINE : null,
    // PATCH_IP_EXTENSIONS_PROJECT_MIO — fixed protagonist / meta-knowledge / soft goals.
    fixedProtagonistLine || null,
    metaKnowledgeStrict ? META_KNOWLEDGE_STRICT_LINE : null,
    softGoalsLine || null,
    buildHouseRules(houseRules),
    buildCustomRegistry(state),
    buildPromptOverride(state),
    "",
    buildSetupNotes(setupNotes),
    "",
    buildCanonContext(canon, {
      lod: o.canonLod,
      unchanged: o.canonUnchanged,
      budget: alloc.canon_context,
      onTrim,
    }),
    "",
    buildMemoryContext(memory, {
      unchanged: o.memoryUnchanged,
      budget: alloc.memory_context,
      onTrim,
    }),
    "",
    buildEmotionDirective(emotion),
    "",
    buildSceneDirective(scene),
    "",
    buildRecentDialogue(recent),
    "",
    "위 맥락을 바탕으로 다음 장면을 서술하라. 단, 지시 항목을 처리하는 느낌을 내지 말고, 인물이 감정을 숨기려다 새어나오는 순간과 이전 사건의 흔적을 중심으로 체험형 소설처럼 이어가라.",
  ].filter((x) => x !== null).join("\n");

  return {
    prompt,
    trims,
    tokens_estimate: tokenBudget.estimateTokens(prompt),
  };
}

module.exports = {
  buildCanonContext,
  buildMemoryContext,
  renderCanonLines,
  renderMemoryLines,
  buildEmotionDirective,
  buildSceneDirective,
  buildRecentDialogue,
  buildHouseRules,
  buildSetupNotes,
  buildCustomRegistry,
  buildPromptOverride,
  assembleSystemPrompt,
};
