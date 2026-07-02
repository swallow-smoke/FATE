// Phase 7+ compatibility layer.
// Implements the cheap, deterministic surface area for the later design docs:
// schema defaults, relationship expansion, hidden-variable drift, stage/weather
// ticks, scheduled actions, consequence/mystery shells, and Advanced payloads.

"use strict";

const REL_KEYS = ["trust", "affection", "fear", "respect", "obligation", "dependency", "hatred", "guilt", "obsession", "jealousy", "distance"];
const HIDDEN_DEFAULTS = {
  sanity: 0.8,
  fatigue: 0.2,
  stress: 0.25,
  trauma_accumulation: 0.1,
  humanity: 0.9,
  corruption: 0.05,
  hope: 0.6,
  willpower: 0.7,
  guilt: 0.15,
};
const STAGES = ["prologue", "act1", "act2", "midpoint", "act3", "climax", "ending"];
const SEASONS = ["spring", "summer", "autumn", "winter"];
const WEATHER_BY_SEASON = {
  spring: ["soft rain", "clear wind", "mist"],
  summer: ["humid heat", "sun glare", "sudden shower"],
  autumn: ["dry wind", "cloudy sky", "cold drizzle"],
  winter: ["frost", "still cold", "snow"],
};

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(Number(v)) ? Number(v) : 0));
}

function defaultStoryStructure(old) {
  if (old && old.current_stage) return old;
  const progress = old && old.act_progress != null ? old.act_progress : 0;
  return {
    current_stage: old && old.current_act === "Act 1" ? "act1" : "prologue",
    stages: STAGES.slice(),
    stage_progress: clamp01(progress),
    stage_entered_turn: 0,
    current_act: old && old.current_act ? old.current_act : "Act 1",
    act_progress: clamp01(progress),
  };
}

function defaultWeather() {
  return { current_season: "spring", current_weather: "clear wind", changed_turn: 0 };
}

function expandRelation(rel) {
  const out = rel || {};
  for (const k of REL_KEYS) {
    if (out[k] === undefined) out[k] = k === "distance" ? 0.3 : 0;
    out[k] = clamp01(out[k]);
  }
  return out;
}

function ensure(state) {
  state.schema_version = Math.max(Number(state.schema_version || 4), 7);
  state.story_structure = defaultStoryStructure(state.story_structure);
  state.player = state.player || {};
  if (!state.player.hidden_variables) state.player.hidden_variables = { ...HIDDEN_DEFAULTS };
  if (!state.player.dynamic_traits) state.player.dynamic_traits = [];
  state.hidden_variable_log = state.hidden_variable_log || [];
  state.difficulty_director = state.difficulty_director || { recent_checks: [], hint: null, last_updated_turn: 0 };
  state.campaign_planner = state.campaign_planner || { expected_length: "normal", last_checked_turn: 0, hint: null };
  state.consequence_chains = state.consequence_chains || [];
  state.mysteries = state.mysteries || [];
  state.scheduled_actions = state.scheduled_actions || [];
  state.news_pool = state.news_pool || [];
  state.daily_summaries = state.daily_summaries || [];
  state.integrity_log = state.integrity_log || [];
  state.prompt_profile = state.prompt_profile || { prompt_version: "nos-v1.2", last_token_budget: null, low_token_mode: false };
  state.world = state.world || {};
  if (!state.world.weather) state.world.weather = defaultWeather();
  if (!state.world.tech_level) state.world.tech_level = inferTechLevel(state);
  state.relationship_graph = state.relationship_graph || { edges: [] };
  for (const edge of state.relationship_graph.edges || []) expandRelation(edge);
  for (const npc of state.npcs || []) expandRelation(npc.relationship_to_player);
  state.settings = state.settings || {};
  if (state.settings.advanced_mode === undefined) state.settings.advanced_mode = false;
  if (state.settings.low_token_mode === undefined) state.settings.low_token_mode = false;
  if (state.settings.expected_campaign_length === undefined) state.settings.expected_campaign_length = "normal";
  return state;
}

function inferTechLevel(state) {
  const era = String((state.meta && state.meta.era) || (state.meta && state.meta.genre_preset) || "fantasy").toLowerCase();
  if (/sf|sci|space|cyber/.test(era)) return "sci_fi";
  if (/modern|school|zombie/.test(era)) return "modern";
  if (/ancient/.test(era)) return "ancient";
  if (/medieval/.test(era)) return "medieval";
  return "fantasy_low";
}

function updateHiddenVariables(state, sceneSpec, extraction) {
  const hv = state.player.hidden_variables || { ...HIDDEN_DEFAULTS };
  const intensity = clamp01((sceneSpec && sceneSpec.intensity ? sceneSpec.intensity : 0) / 5);
  const tags = new Set([
    sceneSpec && sceneSpec.primary_emotion,
    ...((extraction && extraction.new_memories) || []).flatMap((m) => m.emotion_tags || []),
  ].filter(Boolean).map((x) => String(x).toLowerCase()));
  hv.fatigue = clamp01(hv.fatigue + intensity * 0.035 - 0.01);
  hv.stress = clamp01(hv.stress + intensity * 0.04 - (tags.has("calm") || tags.has("relief") ? 0.035 : 0.005));
  hv.sanity = clamp01(hv.sanity - intensity * 0.018 + (tags.has("hope") || tags.has("relief") ? 0.018 : 0));
  hv.trauma_accumulation = clamp01(hv.trauma_accumulation + (tags.has("fear") || tags.has("dread") || tags.has("despair") ? 0.025 : 0));
  hv.corruption = clamp01(hv.corruption + (tags.has("anger") || tags.has("obsession") ? 0.012 : 0));
  hv.hope = clamp01(hv.hope + (tags.has("hope") || tags.has("warmth") ? 0.025 : 0) - (tags.has("despair") ? 0.035 : 0));
  hv.willpower = clamp01(hv.willpower + (tags.has("resolve") ? 0.025 : 0) - hv.fatigue * 0.008);
  hv.guilt = clamp01(hv.guilt + (tags.has("guilt") || tags.has("betrayal") ? 0.03 : 0));
  hv.humanity = clamp01(hv.humanity - hv.corruption * 0.004 + (tags.has("mercy") ? 0.018 : 0));
  state.player.hidden_variables = hv;
  state.hidden_variable_log = [
    ...(state.hidden_variable_log || []),
    { turn: state.turn_number, primary_emotion: sceneSpec && sceneSpec.primary_emotion, intensity: sceneSpec && sceneSpec.intensity },
  ].slice(-30);
}

function updateDifficulty(state, check) {
  const dd = state.difficulty_director || { recent_checks: [] };
  if (check) {
    dd.recent_checks = [...(dd.recent_checks || []), { turn: state.turn_number, outcome: check.outcome, skill: check.skill }].slice(-5);
  }
  const last = (dd.recent_checks || []).slice(-3);
  const wins = last.filter((c) => c.outcome === "success").length;
  const fails = last.filter((c) => c.outcome === "fail").length;
  dd.hint = wins >= 3
    ? "recent_success_streak: 다음 판정은 숫자 난이도 대신 보상/후폭풍을 더 무겁게 다룬다."
    : fails >= 2
    ? "recent_failure_streak: 다음 장면에는 작은 여지를 배치한다."
    : null;
  dd.last_updated_turn = state.turn_number;
  state.difficulty_director = dd;
}

function updateStoryStage(state) {
  const ss = state.story_structure = defaultStoryStructure(state.story_structure);
  const idx = STAGES.indexOf(ss.current_stage);
  const expectedTurns = { short: 80, normal: 180, long: 320 }[state.settings.expected_campaign_length || "normal"] || 180;
  const stageSize = Math.max(8, Math.round(expectedTurns / STAGES.length));
  ss.stage_progress = clamp01((state.turn_number - (ss.stage_entered_turn || 0)) / stageSize);
  if (ss.stage_progress >= 1 && idx >= 0 && idx < STAGES.length - 1 && !((state.ending || {}).reached)) {
    ss.current_stage = STAGES[idx + 1];
    ss.stage_entered_turn = state.turn_number;
    ss.stage_progress = 0;
  }
  ss.current_act = stageToAct(ss.current_stage);
  ss.act_progress = ss.stage_progress;
}

function stageToAct(stage) {
  return { prologue: "Prologue", act1: "Act 1", act2: "Act 2", midpoint: "Midpoint", act3: "Act 3", climax: "Climax", ending: "Ending" }[stage] || "Act 1";
}

function updatePlanner(state) {
  const planner = state.campaign_planner || {};
  const ss = state.story_structure || {};
  planner.expected_length = state.settings.expected_campaign_length || "normal";
  planner.last_checked_turn = state.turn_number;
  planner.hint = ss.stage_progress > 0.75
    ? `stage_pressure: ${ss.current_stage} 마무리 사건 후보를 우선한다.`
    : ss.stage_progress < 0.15
    ? `stage_settle: ${ss.current_stage} 진입 직후라 관계/성찰 비중을 허용한다.`
    : null;
  state.campaign_planner = planner;
}

function updateWeather(state) {
  const w = state.world.weather || defaultWeather();
  const day = state.in_world_day || 1;
  const season = SEASONS[Math.floor((day - 1) / 30) % SEASONS.length];
  if (season !== w.current_season || state.turn_number - (w.changed_turn || 0) >= 8) {
    const pool = WEATHER_BY_SEASON[season] || WEATHER_BY_SEASON.spring;
    w.current_season = season;
    w.current_weather = pool[state.turn_number % pool.length];
    w.changed_turn = state.turn_number;
  }
  state.world.weather = w;
}

function processScheduledActions(state) {
  const delivered = [];
  for (const action of state.scheduled_actions || []) {
    if (action.status === "pending" && action.trigger_turn <= state.turn_number) {
      action.status = action.intercept_probability && action.intercept_probability > 0.8 ? "intercepted" : "delivered";
      delivered.push(action);
    }
  }
  return delivered;
}

function appendIntegrity(state, warning) {
  if (!warning) return;
  state.integrity_log = [
    ...(state.integrity_log || []),
    { turn: state.turn_number, severity: warning.severity || "warn", message: warning.message || String(warning), source: warning.source || "phase7plus" },
  ].slice(-50);
}

function tick(state, { sceneSpec, extraction, check, integrityWarning } = {}) {
  ensure(state);
  updateHiddenVariables(state, sceneSpec || {}, extraction || {});
  updateDifficulty(state, check);
  updateStoryStage(state);
  updatePlanner(state);
  updateWeather(state);
  const delivered = processScheduledActions(state);
  if (integrityWarning) appendIntegrity(state, { message: JSON.stringify(integrityWarning), source: "kernel" });
  return { delivered_actions: delivered, weather: state.world.weather, planner: state.campaign_planner, difficulty: state.difficulty_director };
}

// C1 — translate the (never-shown) hidden variables into subtle narrative
// flags for <emotion_directive>. Only thresholds crossed produce a line.
function hiddenVariableDirective(state) {
  const hv = (state.player && state.player.hidden_variables) || {};
  const lines = [];
  // Phase 11 S — full Hidden Variable → behavioral tendency mapping. These are
  // TENDENCIES, not descriptions: promptBlocks frames them so the model reflects
  // them only at natural moments, never as a per-turn "저는 피곤합니다" statement.
  if (hv.corruption >= 0.5) lines.push("도덕적으로 마모된 상태 — NPC들의 반응에 미묘한 경계심을 섞을 것.");
  if (hv.fatigue >= 0.6) lines.push("피로가 깊다 — 말투가 평소보다 날카롭거나 퉁명스러워질 수 있음(본인도 자각 못 할 수 있음).");
  if (hv.sanity <= 0.4) lines.push("정신이 위태롭다 — 사소한 것에 과민하거나 판단이 흐려진 모습을 은은하게.");
  if (hv.stress >= 0.6) lines.push("스트레스가 높다 — 짧고 방어적인 반응, 평소라면 안 할 실수.");
  if (hv.willpower <= 0.3) lines.push("의지가 바닥났다 — 포기하고 싶어 하는 기색을, 대사가 아니라 행동의 머뭇거림으로.");
  if (hv.guilt >= 0.5) lines.push("죄책감이 무겁다 — 관련 인물과의 대화에서 시선을 피하거나 화제를 돌리려는 경향.");
  if (hv.hope <= 0.3) lines.push("희망이 낮다 — 냉소적이거나 체념한 듯한 반응 경향(과장하지 말 것).");
  if (hv.trauma_accumulation >= 0.6) lines.push("누적된 상처 — 특정 자극에 과민하게 반응할 여지를 둘 것.");
  if (hv.corruption <= 0.1 && hv.humanity >= 0.85) lines.push("여전히 곧은 심지 — 온기가 배어나게.");
  return lines;
}

// A5 — weather/season line for <scene_directive>.
function weatherLine(state) {
  const w = (state.world && state.world.weather) || null;
  if (!w) return null;
  const seasonKo = { spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" }[w.current_season] || w.current_season;
  return `계절/날씨: ${seasonKo} · ${w.current_weather} — 묘사에 자연스럽게 스며들게 할 것 (날씨를 주제로 만들지는 말 것).`;
}

function stateSummary(state, canonDb, memoryEngine) {
  ensure(state);
  return {
    hidden_variables: state.player.hidden_variables,
    dynamic_traits: state.player.dynamic_traits || [],
    story_structure: state.story_structure,
    difficulty_director: state.difficulty_director,
    campaign_planner: state.campaign_planner,
    weather: state.world.weather,
    tech_level: state.world.tech_level,
    scheduled_actions: state.scheduled_actions || [],
    consequence_chains: state.consequence_chains || [],
    mysteries: state.mysteries || [],
    news_pool: state.news_pool || [],
    daily_summaries: state.daily_summaries || [],
    integrity_log: state.integrity_log || [],
    relationship_edges: state.relationship_graph ? state.relationship_graph.edges || [] : [],
    player_edges: state.npcs || [],
    memory_count: memoryEngine && memoryEngine.all ? memoryEngine.all().length : 0,
    canon_count: canonDb && canonDb.all ? canonDb.all().length : 0,
    prompt_profile: state.prompt_profile,
  };
}

module.exports = {
  REL_KEYS,
  HIDDEN_DEFAULTS,
  STAGES,
  ensure,
  expandRelation,
  tick,
  stateSummary,
  hiddenVariableDirective,
  weatherLine,
};
