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
    },

    npcs: [], // player-NPC RelationshipEdge (StateSchema §5)

    world: {
      regions: [],
      active_events: [], // Phase 3 · World Simulation (Wave 1)
    },

    // Phase 3 · NPC-NPC Relationship Graph (Wave 1)
    relationship_graph: { edges: [] },

    // Phase 3 · Theme Director (Wave 2)
    theme: { active_theme: null, theme_progress: 0, theme_history: [], weight_in_scene_selection: 0.3 },

    // Phase 3 · Campaign Health cache (Wave 3), recomputed every 10 turns
    campaign_health: { computed_turn: -1, metrics: {} },

    // Phase 3 · AI Self Reflection (Wave 3) — last turn's reflection, fed forward
    self_reflection: null,

    story_flags: [],
    foreshadow_pool: [],
    quests: [], // Phase 3 · Dynamic Quest (Wave 4)

    // Phase 5 Wave 2 — inventory + faction reputation
    inventory: [],
    faction_reputation: [],

    // Phase 4 B2 — ending state
    ending: { reached: false, ending_id: null, label: null, summary: null },

    // Phase 5 Wave 3 — House Rules (free-text GM rules; cannot override the
    // absolute prohibitions in SYSTEM_PROMPT_BASE)
    house_rules: [],

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

    current_scene: null,
    recent_dialogue: [],
    scene_history: [],
    last_check: null, // last dice check result (dev panel only)

    settings: {
      world_event_period: 15, living_npc_period: 100, resonance_period: 30,
      // Phase 5 Wave 3 — player-facing settings (choices UI defaults OFF)
      choices_ui: false,
      content_intensity: "medium", // low | medium | high
      recap_hours: 6, // show session recap if away >= N hours
      response_length: "normal", // short | normal | long — Phase 6 A
    },

    db_refs: {
      memory_db: `${campaignId}_memory.json`,
      canon_db: `${campaignId}_canon.json`,
    },
  };
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
  }
  for (const [k, v] of Object.entries(d.settings)) {
    if (state.settings[k] === undefined) state.settings[k] = v;
  }
  // Phase 8 A1 — run the versioned migration chain (v7 → v8 → …).
  state = migrations.applyMigrations(state);
  return phase7plus.ensure(state);
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
