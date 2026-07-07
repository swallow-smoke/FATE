// Step 1 — Unified State Schema (09-Developer/StateSchema.md)
//
// The single CampaignState object the Kernel loads/saves every turn.
// MVP fields (StateSchema §8): campaign_id, turn_number, player, npcs[],
// story_flags, current_scene, db_refs.
// Reserved fields (narrative_dna, story_structure, foreshadow_pool,
// world.active_events) are created but start at minimal defaults.

const fs = require("fs");
const path = require("path");
const phase7plus = require("../meta/phase7plus");
const migrations = require("./migrations");
const dimensionRegistry = require("../custom/dimensionRegistry");
const promptSettings = require("../gemini/promptSettings");

const DATA_DIR = path.join(__dirname, "..", "..", "data");

// Default Narrative DNA preset (StateSchema §2). Reserved for later tuning;
// the MVP does not read most of these yet.
function defaultNarrativeDna() {
  return {
    tone: 3,
    emotion: 4,
    politics: 2,
    survival: 3,
    horror: 2,
    mystery: 3,
    romance: 2,
    exploration: 3,
  };
}

// Player emotion_state — full-ish shape per EmotionEngine §2, though the MVP
// only writes primary_emotion / intensity / fatigue_tracker (EmotionEngine §11).
function defaultPlayerEmotionState() {
  return {
    scope: "player",
    turn: 0,
    current_wave: {
      primary_emotion: "calm",
      secondary_emotion: null,
      intensity: 0,
      turns_at_current_intensity: 0,
    },
    fatigue_tracker: {},
    recent_history: [],
    resonance_profile: {},
  };
}

function newCampaign(campaignId) {
  const state = {
    schema_version: migrations.CURRENT_SCHEMA_VERSION,
    campaign_id: campaignId,
    turn_number: 0,

    // Phase 8 A3/B — campaign lifecycle: "active" | "completed". World
    // templates snapshotted from this campaign's World/Faction canon (B1).
    campaign_status: "active",
    world_templates: [],
    in_world_day: 1, // numeric day counter (time-skip advances this)
    in_world_date: "1일차",

    narrative_dna: defaultNarrativeDna(),
    story_structure: { current_act: "Act 1", act_progress: 0.0 },

    player: {
      ref: "player_main",
      emotion_state: defaultPlayerEmotionState(),
      traits: [],
      known_flags: [],
      // Phase 4 B1 — skill modifiers used by dice checks (0..3)
      stats: { 설득: 1, 전투: 1, 은신: 1, 지식: 1, 직감: 1 },
      // Phase 5 Wave 2 — Identity Engine (lightweight): growth trajectory
      identity_milestones: [], // { turn, from_trait, to_trait, trigger_summary }
      // Phase 3 · Legacy Engine (Wave 4)
      generation: 1,
      legacy: { predecessor_ref: null, legacy_traits: [], world_memory_of_predecessor: null },
      // Phase 16+ · Dynamic Title — earned epithets (북부의 영웅 / 용 사냥꾼 / 배신자).
      titles: [], // { id, title, earned_turn, reason, source, scope }
    },

    npcs: [], // player-NPC RelationshipEdge (StateSchema §5)

    world: {
      regions: [],
      active_events: [], // Phase 3 · World Simulation (Wave 1)
      news: [], // Phase 16 · World News (자동 뉴스/게시판/공고/소문 집계)
    },

    // Phase 3 · NPC-NPC Relationship Graph (Wave 1)
    relationship_graph: { edges: [] },

    // PATCH 관계 전환 — player↔NPC label transitions detected at extraction time.
    // { milestone_id, npc_ref, turn, from_label, to_label, trigger_summary }
    relationship_milestones: [],

    // Phase 3 · Theme Director (Wave 2)
    theme: { active_theme: null, theme_progress: 0, theme_history: [], weight_in_scene_selection: 0.3 },

    // Phase 3 · Campaign Health cache (Wave 3), recomputed every 10 turns
    campaign_health: { computed_turn: -1, metrics: {} },

    // Phase 3 · AI Self Reflection (Wave 3) — last turn's reflection, fed forward
    self_reflection: null,

    story_flags: [],
    foreshadow_pool: [],
    quests: [], // Phase 3 · Dynamic Quest (Wave 4)

    // PATCH_NARRATIVE_ACCUMULATION_GAPS — Arc-bound growth goals + recurring
    // motif registry. Echo state lives on Character canon (data.echo_state).
    narrative_arcs: [], // { arc_id, title, kind, goal, status, progress, milestones_hit, chapter, canon_refs }
    motifs: [],         // { motif_id, label, category, occurrences, first_seen_turn, last_echoed_turn }
    // PATCH_CHAPTER_CHECKLIST — chapter units with required-canon/foreshadow checklists.
    chapters: [],       // { chapter_id, index, title, status, checklist:[{kind,ref,done}], arc_refs }
    writer_workspace: defaultWriterWorkspace(),
    // PATCH_WEBNOVEL_TECHNIQUES — 고구마-사이다 rhythm, per-NPC 캐빨 arcs, and
    // pre-registered narrative tricks the Watchdog must not "correct".
    tension_debt: { level: 0, last_payoff_turn: null, peak: 0, history: [] },
    npc_arcs: [],        // { arc_id, npc_ref, title, stage, tension, spotlight_turn }
    narrative_tricks: [], // { trick_id, kind, description, canon_refs, registered_turn, active }
    // PATCH_IP_EXTENSIONS_PROJECT_MIO — soft-goal checklist + multiple dice pools.
    soft_goals: [],      // { goal_id, text, done, created_turn }
    dice_pools: [],      // { pool_id, name, faces, count, modifier, dc }

    // Phase 5 Wave 2 — inventory + faction reputation
    inventory: [],
    faction_reputation: [],

    // Phase 4 B2 — ending state
    ending: { reached: false, ending_id: null, label: null, summary: null },

    // Phase 5 Wave 3 — House Rules (free-text GM rules; cannot override the
    // absolute prohibitions in SYSTEM_PROMPT_BASE)
    house_rules: [],
    custom_registry: dimensionRegistry.DEFAULT_REGISTRY,
    prompt_overrides: {
      enabled: false,
      system_addendum: "",
      extraction_addendum: "",
    },
    prompt_settings: promptSettings.defaults(),

    // Phase 5 — wizard metadata (genre preset, world name/era)
    // Phase 6 D — display_name/icon let the player rename the card without
    // touching the AI-generated world_name.
    meta: { world_name: null, era: "fantasy", genre_preset: null, created_at: null, display_name: null, icon: "📖" },

    // Phase 6 B — bookmarked turn numbers (player-curated, purely additive).
    bookmarked_turns: [],

    // Phase 6 C — play statistics. session_started_at is set on load, folded
    // into total_playtime_seconds on each save.
    play_stats: { total_turns: 0, first_played_at: null, total_playtime_seconds: 0, session_started_at: null },

    // Phase 6 E — "사건 필요해" 버튼: consumed once by the next story beat.
    forced_beat: null, // "high" | null

    // Phase 6 A — slash-command state (per-turn overrides consumed by turn.js)
    // is passed as call options, not persisted here.

    dreams: [], // Phase 16 · Dream System — 수면 시 생성된 꿈 카드 로그

    // Phase 16+ · Living World expansion state.
    family_graph: { edges: [] },        // Family Tree — { from, to, type } (대칭 유지)
    properties: [],                     // Home/Property — { id, kind, name, region, level, upgrades, contents }
    wanted: [],                         // Wanted — { id, scope_id, level, bounty, reason, since_turn, status }
    festivals: { fired: [], last_check_day: 0 }, // Festivals — 발생 로그(정의는 모듈)
    personal_calendar: [],              // Personal Calendar — { id, title, kind, day, created_turn, done }
    promises: [],                       // Promise — { id, npc_ref, summary, made_turn, due_day, status }
    region_reputation: [],              // Region Reputation — { scope, scope_id, standing, label, history }
    organizations: [],                  // Organization — { id, name, hq, ranks, rules, funds, rivals, member }

    current_scene: null,
    recent_dialogue: [],
    scene_history: [],
    last_check: null, // last dice check result (dev panel only)

    settings: {
      world_event_period: 15, living_npc_period: 100, resonance_period: 30,
      // Phase 16 · Living World — 자율 세계 진행 주기(턴). calm_mode가 켜지면 이
      // 자율 진행들은 멈추거나 최소화된다(장소 변화·목표 진행·뉴스).
      place_tick_period: 12, npc_goal_period: 8, news_period: 6,
      wanted_tick_period: 10, living_object_period: 14, // Phase 16+ 자율 진행 주기
      // Phase 5 Wave 3 — player-facing settings (choices UI defaults OFF)
      choices_ui: false,
      content_intensity: "medium", // low | medium | high
      recap_hours: 6, // show session recap if away >= N hours
      response_length: "normal", // short | normal | long — Phase 6 A
      // PATCH_INDIVIDUAL_WORKS_ANALYSIS — 상태창 가시성 모드: off(기본, 순수 서사) |
      // litrpg(상태창 노출) | minimal. 장르 예외로 지정 수치만 노출을 허용한다.
      status_window_mode: "off",
      // PATCH_IP_EXTENSIONS_PROJECT_MIO — IP-campaign toggles (both default off).
      fixed_protagonist: { enabled: false, canon_ref: null },
      meta_knowledge_strict: false,
      // C9 — 플레이어 캐릭터 행동 대리 금지 (기본 켜짐). 켜지면 GM은 플레이어
      // 캐릭터의 행동/대사/선택을 임의로 서술하지 않고 상황·NPC 반응까지만 서술한다.
      player_agency_lock: true,
      content_intensity_notes: {
        low: dimensionRegistry.DEFAULT_REGISTRY.intensity_guides.low,
        medium: dimensionRegistry.DEFAULT_REGISTRY.intensity_guides.medium,
        high: dimensionRegistry.DEFAULT_REGISTRY.intensity_guides.high,
      },
    },

    db_refs: {
      memory_db: `${campaignId}_memory.json`,
      canon_db: `${campaignId}_canon.json`,
    },
  };
  dimensionRegistry.ensure(state);
  return phase7plus.ensure(state);
}

// Fill missing fields on older saved campaigns so they load without crashing.
function migrate(state) {
  const d = newCampaign(state.campaign_id);
  for (const k of ["narrative_dna", "story_structure", "world", "relationship_graph", "theme", "campaign_health", "settings", "quests"]) {
    if (state[k] === undefined) state[k] = d[k];
  }
  if (state.self_reflection === undefined) state.self_reflection = null;
  if (!state.world.active_events) state.world.active_events = [];
  if (!state.world.news) state.world.news = []; // Phase 16 · World News
  dimensionRegistry.ensure(state);
  if (!state.dreams) state.dreams = []; // Phase 16 · Dream System
  // Phase 16+ · Living World expansion — backfill on older saves.
  if (state.player && !state.player.titles) state.player.titles = [];
  if (!state.family_graph) state.family_graph = { edges: [] };
  if (!state.family_graph.edges) state.family_graph.edges = [];
  if (!state.properties) state.properties = [];
  if (!state.wanted) state.wanted = [];
  if (!state.festivals) state.festivals = { fired: [], last_check_day: 0 };
  if (!state.personal_calendar) state.personal_calendar = [];
  if (!state.promises) state.promises = [];
  if (!state.region_reputation) state.region_reputation = [];
  if (!state.organizations) state.organizations = [];
  // PATCH_NARRATIVE_ACCUMULATION_GAPS — backfill on older saves.
  if (!Array.isArray(state.narrative_arcs)) state.narrative_arcs = [];
  if (!Array.isArray(state.motifs)) state.motifs = [];
  if (!Array.isArray(state.chapters)) state.chapters = []; // PATCH_CHAPTER_CHECKLIST
  if (!state.writer_workspace || typeof state.writer_workspace !== "object") state.writer_workspace = defaultWriterWorkspace();
  if (!Array.isArray(state.writer_workspace.pages)) state.writer_workspace.pages = defaultWriterWorkspace().pages;
  if (!state.writer_workspace.active_page_id) state.writer_workspace.active_page_id = (state.writer_workspace.pages[0] && state.writer_workspace.pages[0].id) || "book";
  // PATCH_WEBNOVEL_TECHNIQUES — backfill on older saves.
  if (!state.tension_debt || typeof state.tension_debt !== "object") state.tension_debt = { level: 0, last_payoff_turn: null, peak: 0, history: [] };
  if (!Array.isArray(state.npc_arcs)) state.npc_arcs = [];
  if (!Array.isArray(state.narrative_tricks)) state.narrative_tricks = [];
  // PATCH_IP_EXTENSIONS_PROJECT_MIO — backfill soft goals + dice pools + settings.
  if (!Array.isArray(state.soft_goals)) state.soft_goals = [];
  if (!Array.isArray(state.dice_pools)) state.dice_pools = [];
  if (state.settings && !state.settings.fixed_protagonist) state.settings.fixed_protagonist = { enabled: false, canon_ref: null };
  if (state.settings && state.settings.meta_knowledge_strict === undefined) state.settings.meta_knowledge_strict = false;
  if (!state.relationship_graph.edges) state.relationship_graph.edges = [];
  if (state.player && state.player.generation === undefined) {
    state.player.generation = 1;
    state.player.legacy = d.player.legacy;
  }
  if (state.player && state.player.emotion_state && !state.player.emotion_state.resonance_profile) {
    state.player.emotion_state.resonance_profile = {};
  }
  // schema v4 (Phase 5) additions
  for (const k of ["inventory", "faction_reputation", "house_rules"]) {
    if (state[k] === undefined) state[k] = [];
  }
  if (!state.prompt_overrides) state.prompt_overrides = d.prompt_overrides;
  state.prompt_overrides.enabled = !!state.prompt_overrides.enabled;
  state.prompt_overrides.system_addendum = String(state.prompt_overrides.system_addendum || "");
  state.prompt_overrides.extraction_addendum = String(state.prompt_overrides.extraction_addendum || "");
  promptSettings.ensure(state);
  if (state.ending === undefined) state.ending = d.ending;
  if (state.meta === undefined) state.meta = d.meta;
  if (state.meta && state.meta.icon === undefined) state.meta.icon = "📖";
  if (state.meta && state.meta.display_name === undefined) state.meta.display_name = null;
  if (state.bookmarked_turns === undefined) state.bookmarked_turns = [];
  if (state.play_stats === undefined) state.play_stats = d.play_stats;
  if (state.forced_beat === undefined) state.forced_beat = null;
  if (state.in_world_day === undefined) {
    const m = String(state.in_world_date || "").match(/(\d+)/);
    state.in_world_day = m ? Number(m[1]) : 1;
  }
  if (state.player) {
    if (!state.player.stats) state.player.stats = d.player.stats;
    if (!state.player.identity_milestones) state.player.identity_milestones = [];
  if (!state.relationship_milestones) state.relationship_milestones = [];
  }
  for (const [k, v] of Object.entries(d.settings)) {
    if (state.settings[k] === undefined) state.settings[k] = v;
  }
  if (!state.settings.content_intensity_notes) state.settings.content_intensity_notes = d.settings.content_intensity_notes;
  // Phase 8 A1 — run the versioned migration chain (v7 → v8 → …).
  state = migrations.applyMigrations(state);
  dimensionRegistry.ensure(state);
  return phase7plus.ensure(state);
}

function defaultWriterWorkspace() {
  const now = new Date().toISOString();
  return {
    active_page_id: "book",
    pages: [
      {
        id: "book",
        type: "book",
        title: "작품 노트",
        icon: "BOOK",
        status: "draft",
        tags: ["원고"],
        summary: "이야기의 제목, 장르, 핵심 약속을 정리합니다.",
        body: "",
        created_at: now,
        updated_at: now,
      },
      {
        id: "world",
        type: "world",
        title: "세계관",
        icon: "WORLD",
        status: "draft",
        tags: ["설정"],
        summary: "시대, 장소, 규칙, 금기, 역사와 분위기를 모읍니다.",
        body: "",
        created_at: now,
        updated_at: now,
      },
      {
        id: "characters",
        type: "character",
        title: "캐릭터",
        icon: "CAST",
        status: "draft",
        tags: ["인물"],
        summary: "주인공과 주변 인물의 욕망, 결핍, 관계를 정리합니다.",
        body: "",
        created_at: now,
        updated_at: now,
      },
      {
        id: "chapter-1",
        type: "chapter",
        title: "1장",
        icon: "CH01",
        status: "draft",
        tags: ["원고"],
        summary: "첫 장면의 목적과 독자가 궁금해할 질문을 적어둡니다.",
        body: "",
        created_at: now,
        updated_at: now,
      },
    ],
  };
}

function statePath(campaignId) {
  return path.join(DATA_DIR, `${campaignId}_state.json`);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load(campaignId) {
  ensureDataDir();
  const p = statePath(campaignId);
  if (!fs.existsSync(p)) {
    const fresh = newCampaign(campaignId);
    save(fresh);
    return fresh;
  }
  const raw = fs.readFileSync(p, "utf8");
  try {
    return migrate(JSON.parse(raw));
  } catch (e) {
    // Phase 8 A1 rule 4 — preserve the original as .bak and surface the failure
    // instead of silently corrupting a save.
    const bak = p.replace(/\.json$/, `.v${Date.now()}.bak`);
    try { fs.writeFileSync(bak, raw, "utf8"); } catch (_) {}
    const err = new Error(`이 캠페인은 열 수 없습니다 (마이그레이션 실패: ${e.message}). 원본을 백업했습니다: ${path.basename(bak)}`);
    err.migration_failed = true;
    err.backup_path = bak;
    throw err;
  }
}

function save(state) {
  ensureDataDir();
  fs.writeFileSync(statePath(state.campaign_id), JSON.stringify(state, null, 2), "utf8");
  return state;
}

module.exports = {
  DATA_DIR,
  newCampaign,
  migrate,
  statePath,
  load,
  save,
};
