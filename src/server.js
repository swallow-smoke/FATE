// Local server — wires the engines and exposes the turn + panel endpoints.
require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");

const campaignState = require("./state/campaignState");
const { createCanonDatabase } = require("./canon/canonDatabase");
const { createMemoryEngine } = require("./memory/memoryEngine");
const { createKernel } = require("./kernel/kernel");
const { runTurn } = require("./turn");
const gemini = require("./gemini/geminiClient");
const usageLog = require("./usage/usageLog");
const undo = require("./undo/undo");
const wizardGen = require("./wizard/generator");
const rumors = require("./world/rumors");
const factionReputation = require("./world/factionReputation");
const worldNews = require("./world/worldNews"); // Phase 16 · World News
const npcGoals = require("./npc/npcGoals"); // Phase 16 · NPC Goal System
const worldHistory = require("./world/worldHistory"); // Phase 16 · World History Book
const nicknames = require("./npc/nicknames"); // Phase 16 · Nickname System
// Phase 16+ · Living World expansion
const titles = require("./player/titles");
const familyTree = require("./canon/familyTree");
const property = require("./player/property");
const wantedSys = require("./world/wanted");
const festivals = require("./world/festivals");
const calendar = require("./player/calendar");
const livingObjects = require("./inventory/livingObjects");
const npcSecrets = require("./npc/secrets");
const promises = require("./player/promises");
const regionReputation = require("./world/regionReputation");
const organizations = require("./world/organizations");
const inspector = require("./meta/inspector");
const wiki = require("./wiki/renderCanon");
const turnLog = require("./history/turnLog");
const personalStore = require("./personal/personalStore");
const highlights = require("./game/highlights");
const worldTemplates = require("./world/worldTemplates");
const letters = require("./comm/letters");
const dimensionRegistry = require("./custom/dimensionRegistry");
const feedbackStore = require("./feedback/feedbackStore");
// PATCH Notion Import — 링크 자동 가져오기.
const notionStore = require("./notion/notionStore");
const notionClient = require("./notion/notionClient");
const notionImport = require("./notion/notionImport");
const promptSettings = require("./gemini/promptSettings");

// Phase 8 D2 — content guardrail applied at Canon-registration time (before the
// Kernel), independent of the runtime prompt safety. Blocks a minor age being
// paired with a romance relationship type in the wizard's character data.
const MINOR_RE = /(미성년|아동|어린이|초등|중학생|중학교|소아|유아|10대\s*초반|１０대)/;
const ROMANCE_RE = /(로맨스|romance|연인|애인|사랑|연애|결혼|약혼)/i;
const START_OPENERS = {
  arrival: "낯선 공기가 먼저 피부에 닿는다. 이곳의 거리와 사람들은 아직 당신을 모르지만, 어쩐지 오래전부터 기다리고 있었던 것처럼 조용히 길을 내준다.",
  letter: "편지는 예상보다 가벼웠고, 그래서 더 불길했다. 봉투의 접힌 자국 사이로 오래 닫아둔 이름 하나가 천천히 되살아난다.",
  rainy_reunion: "비가 내린다. 물기 어린 빛 너머, 한때 익숙했던 얼굴이 잠시 당신을 알아보고 멈춘다.",
  missing: "누군가 사라졌다는 말은 처음엔 소문처럼 들렸다. 하지만 사람들이 피하는 시선과 닫힌 문들이 그 말을 점점 사실처럼 만든다.",
  quiet_day: "아무 일도 일어나지 않은 듯한 하루다. 그래서인지 작은 소리와 사소한 표정들이 평소보다 선명하게 다가온다.",
};
function ageIsMinor(v) {
  if (v == null) return false;
  const n = Number(String(v).replace(/[^0-9]/g, ""));
  if (Number.isFinite(n) && String(v).match(/\d/)) return n > 0 && n < 18;
  return MINOR_RE.test(String(v));
}
function contentGuardrail(body) {
  const problems = [];
  const people = [body.player, ...((body.npcs) || [])].filter(Boolean);
  for (const p of people) {
    const age = p.age ?? (p.psychology && p.psychology.age) ?? (p.data && p.data.age);
    const relType = [p.relationship_type, p.relationship_to_player_type, p.rel_type, p.psychology && p.psychology.relationship_type].filter(Boolean).join(" ");
    const bg = [p.background, p.birth_name, JSON.stringify(p.psychology || {})].join(" ");
    const minor = ageIsMinor(age) || MINOR_RE.test(bg);
    const romance = ROMANCE_RE.test(relType) || ROMANCE_RE.test(bg);
    if (minor && romance) problems.push(`${p.birth_name || "인물"}: 미성년 설정과 로맨스 관계는 함께 설정할 수 없습니다.`);
  }
  return problems;
}

// Phase 5 Wave 3 — every Gemini call's token counts feed the usage log.
gemini.setUsageListener(usageLog.record);

const app = express();
app.use(express.json({ limit: "50mb" })); // import bundles and long world bibles can be large
app.use(express.static(path.join(__dirname, "..", "public")));

// Cache engine instances per campaign so their in-memory Canon/Memory stay in
// sync with what was persisted this session.
const depsByCampaign = new Map();
function getDeps(campaignId) {
  if (!depsByCampaign.has(campaignId)) {
    const canonDb = createCanonDatabase(campaignId);
    const memoryEngine = createMemoryEngine(campaignId);
    const kernel = createKernel({ canonDb, memoryEngine });
    depsByCampaign.set(campaignId, { canonDb, memoryEngine, kernel });
  }
  return depsByCampaign.get(campaignId);
}

function sanitizeWriterPage(page) {
  const src = page || {};
  const id = String(src.id || ("page_" + Date.now().toString(36))).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const now = new Date().toISOString();
  return {
    id,
    type: String(src.type || "note").slice(0, 40),
    title: String(src.title || "새 문서").slice(0, 120),
    icon: String(src.icon || "DOC").slice(0, 20),
    status: String(src.status || "draft").slice(0, 40),
    tags: Array.isArray(src.tags) ? src.tags.map((t) => String(t).slice(0, 32)).filter(Boolean).slice(0, 12) : [],
    summary: String(src.summary || "").slice(0, 2000),
    body: String(src.body || "").slice(0, 120000),
    created_at: src.created_at || now,
    updated_at: now,
  };
}

function ensureWriterWorkspace(state) {
  campaignState.migrate(state);
  state.writer_workspace = state.writer_workspace || { active_page_id: "book", pages: [] };
  if (!Array.isArray(state.writer_workspace.pages)) state.writer_workspace.pages = [];
  return state.writer_workspace;
}

// Phase 6 A — slash commands. Human types them directly; the only "AI" here
// is /판정 forcing an existing deterministic check, and /휴식 just rewrites
// the input text — nothing here calls an LLM by itself.
function parseSlash(input) {
  const m = input.match(/^\/(판정|휴식|메모)\s*(.*)$/s);
  if (!m) return { command: null, rest: input };
  return { command: m[1], rest: m[2].trim() };
}

// POST /api/turn — run one full turn. Always returns dev "panels" (emotion /
// memory / scene). The full trace (system prompt, extracted facts) is only
// returned when debug=true — the chat area never shows it either way.
app.post("/api/turn", async (req, res) => {
  try {
    const campaignId = req.body.campaign_id || "camp_001";
    let playerInput = (req.body.player_input || "").trim();
    if (!playerInput) return res.status(400).json({ error: "player_input required" });

    const { command, rest } = parseSlash(playerInput);

    // /메모 goes straight to the personal notebook — no turn, no LLM call.
    if (command === "메모") {
      if (!rest) return res.status(400).json({ error: "/메모 뒤에 남길 내용을 적어주세요" });
      const note = personalStore.addNote(campaignId, rest);
      return res.json({ note_saved: true, note, narrative: null, turn: campaignState.load(campaignId).turn_number });
    }

    let forceCheck = false;
    if (command === "판정") { playerInput = rest || "상황을 가늠해본다"; forceCheck = true; }
    else if (command === "휴식") { playerInput = rest ? `잠시 휴식을 취한다 — ${rest}` : "잠시 휴식을 취하며 숨을 돌린다"; }

    const deps = getDeps(campaignId);
    const state = campaignState.load(campaignId);
    const result = await runTurn(deps, state, playerInput, { time_skip: req.body.time_skip || null, force_check: forceCheck });

    const emo = state.player.emotion_state;
    const spec = result.trace.scene_spec;
    res.json({
      mock: !gemini.hasKey(),
      turn: result.turn,
      in_world_date: state.in_world_date,
      narrative: result.narrative,
      legacy_event: result.legacy_event || null,
      check: result.check || null, // Phase 4 B1 — outcome words only
      ending: result.ending || null, // Phase 4 B2 — campaign-complete payload
      pending_transition: result.pending_transition || null, // Phase 8 C2 — needs confirm
      daily_summary: result.daily_summary || null, // Phase 10 J2
      time_accel: result.time_accel || null, // Phase 14 Y — batch offscreen summary
      status_window: result.status_window || null, // PATCH_INDIVIDUAL_WORKS_ANALYSIS — genre stat window
      countdowns: require("./game/countdowns").build(state), // Phase 10 O — revealed only
      undo_available: !!undo.available(campaignId),
      story_structure: state.story_structure, // Phase 6 D — progress bar
      play_stats: state.play_stats, // Phase 6 C
      panels: {
        emotion: {
          primary_emotion: emo.current_wave.primary_emotion,
          intensity: emo.current_wave.intensity,
          fatigue_tracker: emo.fatigue_tracker,
          recent_history: emo.recent_history,
        },
        scene: {
          scene_type: spec.scene_type,
          intensity: spec.intensity,
          primary_emotion: spec.primary_emotion,
          participants: spec.participants,
          location: spec.location,
          compose_note: spec._compose_note,
        },
        retrieved_memories: result.trace.retrieved_memories,
        applied: result.trace.applied,
        resonance: emo.resonance_profile || {},
        campaign_health: result.trace.campaign_health,
        world: result.trace.world,
      },
      trace: req.body.debug ? result.trace : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/turn/regenerate — Phase 6 A. Reruns the LAST turn (same player
// input, fresh LLM roll) by restoring the pre-turn snapshot and calling
// runTurn again. Human presses the button; the re-roll itself is the AI part.
app.post("/api/turn/regenerate", async (req, res) => {
  try {
    const campaignId = req.body.campaign_id || "camp_001";
    const before = campaignState.load(campaignId);
    const lastTurn = (before.recent_dialogue || []).slice(-1)[0];
    if (!lastTurn) return res.status(409).json({ error: "재생성할 턴이 없습니다" });

    const r = undo.restore(campaignId);
    if (!r.ok) return res.status(409).json({ error: "되돌릴 스냅샷이 없습니다 (재생성은 직전 턴에서만 가능)" });
    depsByCampaign.delete(campaignId);

    const deps = getDeps(campaignId);
    const state = campaignState.load(campaignId);
    const result = await runTurn(deps, state, lastTurn.player, {});
    res.json({
      turn: result.turn, narrative: result.narrative, in_world_date: state.in_world_date,
      check: result.check || null, ending: result.ending || null, undo_available: !!undo.available(campaignId),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Phase 6 B: bookmarks --------------------------------------------------
app.post("/api/bookmark/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  const turn = Number(req.body.turn);
  state.bookmarked_turns = state.bookmarked_turns || [];
  const i = state.bookmarked_turns.indexOf(turn);
  if (i >= 0) state.bookmarked_turns.splice(i, 1);
  else state.bookmarked_turns.push(turn);
  campaignState.save(state);
  res.json({ bookmarked_turns: state.bookmarked_turns });
});

// --- Phase 6 B: full transcript search / filter / session boundaries ------
app.get("/api/history/:id", (req, res) => {
  const { q, npc, emotion } = req.query;
  const entries = turnLog.search(req.params.id, { q, npc, emotion });
  if (q) personalStore.addRecentSearch(req.params.id, q);
  res.json({ entries, boundaries: turnLog.sessionBoundaries(req.params.id), recent_searches: personalStore.load(req.params.id).recent_searches });
});

// --- Phase 6 D: personal notebook (NEVER read by prompt assembly code) ----
app.get("/api/notes/:id", (req, res) => res.json(personalStore.load(req.params.id)));
app.post("/api/notes/:id", (req, res) => {
  if (!req.body.text) return res.status(400).json({ error: "text required" });
  res.json(personalStore.addNote(req.params.id, req.body.text));
});
app.delete("/api/notes/:id/:noteId", (req, res) => res.json({ notes: personalStore.deleteNote(req.params.id, req.params.noteId) }));

// --- Phase 6 F: next-session goal (separate store, human-written only) ----
app.post("/api/goal/:id", (req, res) => res.json(personalStore.setGoal(req.params.id, req.body.text || "")));

// --- Phase 6 C: play stats --------------------------------------------------
app.get("/api/playstats/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  res.json(state.play_stats || {});
});

// --- Phase 6 C: autosave slot rotation (up to 3) ---------------------------
app.get("/api/autosave/:id", (req, res) => res.json({ slots: undo.list(req.params.id) }));
app.post("/api/autosave/:id/restore", (req, res) => {
  const r = undo.restoreSlot(req.params.id, Number(req.body.turn));
  if (!r.ok) return res.status(409).json(r);
  depsByCampaign.delete(req.params.id);
  res.json({ ok: true, turn: r.turn });
});

// --- Phase 6 E: "사건 필요해" — human forces the next beat's urgency -------
app.post("/api/campaign/:id/force-event", (req, res) => {
  const state = campaignState.load(req.params.id);
  state.forced_beat = "high";
  campaignState.save(state);
  res.json({ ok: true });
});

// --- Phase 6 E: quote pool (rule-based selection, no LLM) + manual highlight
app.get("/api/quote/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  res.json({ quote: highlights.quoteOfTheDay(state, req.params.id) });
});
app.post("/api/highlights/:id", async (req, res) => {
  try {
    const state = campaignState.load(req.params.id);
    // Phase 12 U3 — low-token: highlight summarization is disabled.
    if (state.settings && state.settings.low_token_mode) return res.json({ summary: null, disabled: true, low_token: true });
    const r = await highlights.summarizeSession(state, req.params.id, gemini);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/seed — register a small sample world (+1 foreshadow) for playtesting.
app.post("/api/seed", (req, res) => {
  const campaignId = req.body.campaign_id || "camp_001";
  const deps = getDeps(campaignId);
  const state = campaignState.load(campaignId);
  const seeds = [
    { canon_id: "char_ria", type: "Character", data: { birth_name: "리아 벨노어", species: "human", role: "npc", core_values: ["loyalty", "independence"], current_location: "old_town", current_status: "alive", affiliations: ["faction_dockworkers"],
        psychology: { attachment_style: "avoidant", core_values: ["loyalty", "independence"], core_fear: "버림받는 것", desire: "인정받는 것", defense_mechanism: "회피 - 갈등 상황에서 화제를 돌린다" },
        goal_current: "부두 노동자 조합의 신뢰를 되찾는 것", schedule_hint: "낮에는 부두, 저녁에는 선술집" } },
    { canon_id: "char_kael", type: "Character", data: { birth_name: "카엘 벨노어", species: "human", role: "npc", core_values: ["family", "ambition"], current_location: "old_town", current_status: "alive", affiliations: ["faction_dockworkers"],
        psychology: { attachment_style: "anxious", core_values: ["family"], core_fear: "무력함", desire: "형제의 인정", defense_mechanism: "과잉 통제 - 모든 걸 직접 하려 든다" },
        goal_current: "누나 리아를 지키는 것", schedule_hint: "부두 창고 관리" } },
    { canon_id: "loc_old_town_bridge", type: "World", data: { region: "old_town", terrain: "urban_bridge", climate: "temperate", notable_features: ["구전설: 다리 밑에서 만난 인연은 끊어지지 않는다"] } },
    { canon_id: "faction_dockworkers", type: "Faction", data: { founding_principle: "mutual_aid", leader: "노령의 갈", stance: "neutral" } },
  ];
  const results = seeds.map((s) => deps.kernel.request(state, "admin", "canon.register", s));

  // A seeded NPC-NPC edge (Wave 1 §3) so the Relationship Graph has data.
  if (!(state.relationship_graph.edges || []).length) {
    deps.kernel.request(state, "admin", "relationship.update", { from: "char_ria", to: "char_kael", trust: 0.6, affection: 0.7, type: "family" });
    deps.kernel.request(state, "admin", "relationship.update", { from: "char_kael", to: "char_ria", trust: 0.5, affection: 0.8, type: "family" });
  }

  if (!(state.foreshadow_pool || []).some((f) => f.id === "foreshadow_letter_015")) {
    state.foreshadow_pool.push({ id: "foreshadow_letter_015", planted_turn: state.turn_number, deadline_turn: state.turn_number + 12, canon_refs: ["char_ria"], resolved: false });
  }
  // A sample RelationshipEdge so the Canon/Relationship tab has data to show.
  if (!state.npcs.some((n) => n.canon_ref === "char_ria")) {
    state.npcs.push({
      canon_ref: "char_ria",
      relationship_to_player: { from: "npc_ria", to: "player_main", trust: 0.3, affection: 0.2, fear: 0.05, respect: 0.4, obligation: 0.1, last_changed_turn: state.turn_number, change_history: [] },
    });
  }
  campaignState.save(state);
  res.json({ results, seeded: true });
});

// POST /api/campaign/:id/confirm-transition — Phase 8 C2. Confirm (or cancel) a
// staged player death/retirement. Only on confirm do we set the trigger flag and
// run the Legacy Engine generation turnover (which is otherwise gated off).
app.post("/api/campaign/:id/confirm-transition", (req, res) => {
  const id = req.params.id;
  const deps = getDeps(id);
  const state = campaignState.load(id);
  const pending = state.pending_legacy_transition;
  if (!pending) return res.status(409).json({ error: "확정 대기 중인 세대 전환이 없습니다" });

  if (!req.body || req.body.confirm !== true) {
    state.pending_legacy_transition = null;
    campaignState.save(state);
    return res.json({ ok: true, cancelled: true });
  }
  deps.kernel.request(state, "story_director", "flag.set", { flag_id: pending.trigger_flag, value: true });
  const legacyEngine = require("./legacy/legacyEngine");
  const legacy_event = legacyEngine.checkAndAdvance(state, deps.canonDb, deps.memoryEngine, deps.kernel);
  state.pending_legacy_transition = null;
  campaignState.save(state);
  res.json({ ok: true, confirmed: true, legacy_event });
});

// --- Phase 8 Part B: world templates (앤솔로지 모드) ------------------------
// GET /api/templates — list saved world templates.
app.get("/api/templates", (req, res) => res.json({ templates: worldTemplates.load() }));

// POST /api/campaign/:id/save-template — snapshot this campaign's World/Faction
// canon (no Characters, no history) into a reusable template.
app.post("/api/campaign/:id/save-template", (req, res) => {
  const id = req.params.id;
  if (!fs.existsSync(campaignState.statePath(id))) return res.status(404).json({ error: "not found" });
  const deps = getDeps(id);
  const state = campaignState.load(id);
  const tmpl = worldTemplates.saveTemplate({
    name: (req.body && req.body.name) || (state.meta && state.meta.world_name), source_campaign_id: id,
    canon: deps.canonDb.all(), narrative_dna: state.narrative_dna, world_name: state.meta && state.meta.world_name,
  });
  res.json({ ok: true, template: tmpl });
});

// DELETE /api/templates/:tid
app.delete("/api/templates/:tid", (req, res) => res.json({ templates: worldTemplates.remove(req.params.tid) }));

// POST /api/campaign/from-template — start a NEW campaign from a template. Only
// the world (World/Faction canon) is shared; state/memory are fresh (history is
// NOT shared — distinct from Legacy's same-campaign generations).
app.post("/api/campaign/from-template", (req, res) => {
  const { template_id, campaign_id, world_name } = req.body || {};
  const tmpl = worldTemplates.get(template_id);
  if (!tmpl) return res.status(404).json({ error: "template not found" });
  const id = (campaign_id || "camp_" + Date.now().toString(36)).trim();
  if (!/^[\w-]+$/.test(id)) return res.status(400).json({ error: "valid campaign_id required" });
  if (fs.existsSync(campaignState.statePath(id))) return res.status(409).json({ error: "campaign already exists" });

  const state = campaignState.load(id); // fresh
  const deps = getDeps(id);
  const results = (tmpl.canon_snapshot || []).map((e) =>
    deps.kernel.request(state, "template", "canon.register", { canon_id: e.canon_id, type: e.type, data: e.data, immutable_fields: e.immutable_fields, mutable_fields: e.mutable_fields }));
  if (tmpl.narrative_dna_defaults) {
    for (const [k, v] of Object.entries(tmpl.narrative_dna_defaults)) if (k in state.narrative_dna) state.narrative_dna[k] = v;
  }
  state.meta.world_name = world_name || tmpl.world_name || tmpl.name;
  state.meta.created_at = new Date().toISOString();
  require("./game/genreStatPresets").applyPreset(state); // Phase 10 M1
  campaignState.save(state);
  res.json({ ok: true, campaign_id: id, registered: results.filter((r) => r.approved).length });
});

// --- Campaign slots -------------------------------------------------------
// GET /api/campaigns — list slots (scan data dir for *_state.json).
app.get("/api/campaigns", (req, res) => {
  if (!fs.existsSync(campaignState.DATA_DIR)) return res.json([]);
  const list = fs
    .readdirSync(campaignState.DATA_DIR)
    .filter((f) => f.endsWith("_state.json"))
    .map((f) => {
      const id = f.replace(/_state\.json$/, "");
      let turn_number = 0, updated = null, in_world_date = null, summary = null, world_name = null, ended = false, campaign_status = "active", display_name = null, icon = "📖", first_played_at = null;
      try {
        const s = JSON.parse(fs.readFileSync(path.join(campaignState.DATA_DIR, f), "utf8"));
        turn_number = s.turn_number;
        in_world_date = s.in_world_date || null;
        world_name = (s.meta && s.meta.world_name) || null;
        display_name = (s.meta && s.meta.display_name) || null;
        icon = (s.meta && s.meta.icon) || "📖";
        ended = !!(s.ending && s.ending.reached);
        campaign_status = s.campaign_status || (ended ? "completed" : "active");
        first_played_at = (s.play_stats && s.play_stats.first_played_at) || null;
        const lastGm = (s.recent_dialogue || []).slice(-1).map((r) => r.gm).join("");
        if (lastGm) summary = lastGm.replace(/\s+/g, " ").slice(0, 120);
        updated = fs.statSync(path.join(campaignState.DATA_DIR, f)).mtime;
      } catch (e) {}
      return { campaign_id: id, turn_number, in_world_date, world_name, display_name, icon, summary, ended, campaign_status, updated, first_played_at };
    })
    .sort((a, b) => new Date(b.updated) - new Date(a.updated));
  res.json(list);
});

// POST /api/campaign/new — create a fresh empty slot.
app.post("/api/campaign/new", (req, res) => {
  const id = (req.body.campaign_id || "").trim();
  if (!id || !/^[\w-]+$/.test(id)) return res.status(400).json({ error: "valid campaign_id required (letters/digits/-/_)" });
  if (fs.existsSync(campaignState.statePath(id))) return res.status(409).json({ error: "campaign already exists" });
  depsByCampaign.delete(id);
  const state = campaignState.load(id); // load() creates + saves a fresh campaign
  res.json(state);
});

// POST /api/campaign/saveas — copy a slot's state+canon+memory to a new id.
app.post("/api/campaign/saveas", (req, res) => {
  const from = (req.body.from || "").trim();
  const to = (req.body.to || "").trim();
  if (!from || !to || !/^[\w-]+$/.test(to)) return res.status(400).json({ error: "valid from/to required" });
  if (!fs.existsSync(campaignState.statePath(from))) return res.status(404).json({ error: "source not found" });
  if (fs.existsSync(campaignState.statePath(to))) return res.status(409).json({ error: "target already exists" });

  const state = campaignState.load(from);
  state.campaign_id = to;
  state.db_refs = { memory_db: `${to}_memory.json`, canon_db: `${to}_canon.json` };
  campaignState.save(state);
  // Phase 6 C — "캠페인 복제" reuses this exact endpoint (same mechanism as
  // Phase5's 분기세이브, per the handoff note not to fork the logic). Personal
  // notes/goal + transcript log travel with the copy since it's still "your"
  // campaign, just under a new id — unlike the JSON export, which is meant to
  // be shareable and deliberately excludes them.
  for (const suffix of ["_canon", "_memory", "_notes", "_turnlog"]) {
    const src = path.join(campaignState.DATA_DIR, `${from}${suffix}.json`);
    const dst = path.join(campaignState.DATA_DIR, `${to}${suffix}.json`);
    if (fs.existsSync(src)) fs.copyFileSync(src, dst);
  }
  depsByCampaign.delete(to);
  res.json({ ok: true, campaign_id: to });
});

// GET /api/canon/:id — Canon entities + RelationshipEdges (Canon tab).
app.get("/api/canon/:id", (req, res) => {
  const deps = getDeps(req.params.id);
  const state = campaignState.load(req.params.id);
  res.json({
    entities: deps.canonDb.all(),
    npcs: state.npcs || [],
    relationship_graph: state.relationship_graph || { edges: [] },
  });
});

// GET /api/memory/:id — full Memory DB (Memory tab "show all" toggle).
app.get("/api/memory/:id", (req, res) => {
  const deps = getDeps(req.params.id);
  res.json({ memories: deps.memoryEngine.all() });
});

// GET /api/health/:id — Campaign Health metrics (dev dashboard).
app.get("/api/health/:id", (req, res) => {
  const deps = getDeps(req.params.id);
  const state = campaignState.load(req.params.id);
  res.json(require("./meta/campaignHealth").get(state, deps.canonDb, deps.memoryEngine));
});

// GET /api/advanced/:id — Phase 7 Part D. One read-only snapshot of every
// internal variable for the Advanced panel (default OFF in the UI). Grouped to
// match the panel's sub-tabs.
app.get("/api/advanced/:id", (req, res) => {
  const deps = getDeps(req.params.id);
  const state = campaignState.load(req.params.id);
  const phase7plus = require("./meta/phase7plus");
  const summary = phase7plus.stateSummary(state, deps.canonDb, deps.memoryEngine);
  const emo = state.player.emotion_state || {};
  res.json({
    advanced_mode: !!(state.settings && state.settings.advanced_mode),
    emotion: { current_wave: emo.current_wave, fatigue_tracker: emo.fatigue_tracker, recent_history: emo.recent_history, resonance_profile: emo.resonance_profile },
    psychology: { hidden_variables: summary.hidden_variables, hidden_variable_log: state.hidden_variable_log || [], npc_brain_log: state.npc_brain_log || {}, dynamic_traits: state.player.dynamic_traits || [], active_hidden_directives: phase7plus.hiddenVariableDirective(state) },
    relationships: { player_edges: (state.npcs || []).map((n) => ({ canon_ref: n.canon_ref, rel: n.relationship_to_player })), npc_edges: summary.relationship_edges },
    memory: deps.memoryEngine.all(),
    canon: deps.canonDb.all(),
    story_structure: summary.story_structure,
    campaign_planner: summary.campaign_planner,
    difficulty: summary.difficulty_director,
    world: { active_events: (state.world && state.world.active_events) || [], weather: summary.weather, rumors: rumors.playerVisible ? deps.canonDb.all().filter((e) => e.type === "Rumor") : [] },
    clues_chains: { mysteries: summary.mysteries, consequence_chains: summary.consequence_chains },
    campaign_health: require("./meta/campaignHealth").get(state, deps.canonDb, deps.memoryEngine).metrics,
    director_log: state.director_debate_log || [],
    scheduled_actions: summary.scheduled_actions,
    integrity_log: summary.integrity_log,
    // Phase 13/14 — infra + debug views.
    prompt: { last_prompt: state.last_prompt || null, prompt_profile: state.prompt_profile || {}, context_cache: require("./gemini/contextCache").status(req.params.id) }, // X1 + V1/V3
    performance: state.perf_log || [], // X2
    registry: dimensionRegistry.ensure(state),
    feedback: feedbackStore.load(req.params.id),
    integrity: { log: summary.integrity_log, hallucination_candidates: state.hallucination_candidates || [], extraction_failure_streak: state.extraction_failure_streak || 0 }, // W
    snapshots: require("./state/snapshots").list(req.params.id), // V8
    state_change_log: (state.state_change_log || []).slice(-20), // V7
  });
});

// GET /api/snapshots/:id — Phase 13 V8 long-range rollback snapshots.
app.get("/api/snapshots/:id", (req, res) => res.json({ snapshots: require("./state/snapshots").list(req.params.id) }));

// POST /api/snapshots/:id/restore — destructive; the client shows a confirm.
app.post("/api/snapshots/:id/restore", (req, res) => {
  const r = require("./state/snapshots").restore(req.params.id, Number(req.body.turn));
  if (!r.ok) return res.status(409).json(r);
  depsByCampaign.delete(req.params.id); // engines must reload rolled-back files
  res.json({ ok: true, turn: r.turn });
});

// POST /api/explain/:id — Phase 14 X3 Explain Mode (manual only). Reconstructs a
// human-readable "why did this scene happen" from the turn's reasoning artifacts
// via one optional LLM call (falls back to a rule-based summary in mock mode).
app.post("/api/explain/:id", async (req, res) => {
  try {
    const state = campaignState.load(req.params.id);
    const lp = state.last_prompt;
    const perf = (state.perf_log || []).slice(-1)[0] || {};
    const ss = state.story_structure || {};
    const facts = [
      `현재 단계: ${ss.current_stage} (${Math.round((ss.stage_progress || 0) * 100)}%)`,
      `페이싱 힌트: ${(state.campaign_planner && state.campaign_planner.hint) || "없음"}`,
      `난이도 힌트: ${(state.difficulty_director && state.difficulty_director.hint) || "없음"}`,
      `활성 내면 지시: ${(require("./meta/phase7plus").hiddenVariableDirective(state) || []).join(" / ") || "없음"}`,
    ].join("\n");
    gemini.setCampaign(req.params.id);
    let explanation = null;
    try {
      if (gemini.hasKey()) explanation = await gemini.summarize(promptSettings.getPrompt(state, "summary.explain"), facts, "explain");
    } catch (_) {}
    if (!explanation) explanation = `이 장면은 ${facts.split("\n").join("; ")} 라는 내부 상태를 바탕으로 연출되었습니다.`;
    res.json({ explanation, factors: facts, turn: lp && lp.turn });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/state/:id/advanced-mode — toggle the Advanced panel (Part D).
app.post("/api/state/:id/advanced-mode", (req, res) => {
  const state = campaignState.load(req.params.id);
  state.settings = state.settings || {};
  state.settings.advanced_mode = !!req.body.enabled;
  campaignState.save(state);
  res.json({ ok: true, advanced_mode: state.settings.advanced_mode });
});

// PATCH_INDIVIDUAL_WORKS_ANALYSIS — set the status-window visibility mode
// (off | litrpg | minimal). A genre-scoped exception to the no-numbers rule.
app.post("/api/state/:id/status-window-mode", (req, res) => {
  const statusWindow = require("./game/statusWindow");
  const state = campaignState.load(req.params.id);
  const r = statusWindow.setMode(state, (req.body && req.body.mode) || "");
  if (!r.ok) return res.status(400).json({ error: r.reason, modes: [...statusWindow.MODES] });
  campaignState.save(state);
  res.json({ ok: true, mode: r.mode, window: statusWindow.build(state) });
});

// PATCH_IP_EXTENSIONS_PROJECT_MIO — fixed protagonist mode (play a canon char).
app.post("/api/state/:id/fixed-protagonist", (req, res) => {
  const deps = getDeps(req.params.id);
  const state = campaignState.load(req.params.id);
  const r = require("./player/fixedProtagonist").set(state, { enabled: !!(req.body && req.body.enabled), canon_ref: req.body && req.body.canon_ref }, deps.canonDb);
  if (!r.ok) return res.status(400).json({ error: r.reason });
  campaignState.save(state);
  res.json(r);
});

// PATCH_IP_EXTENSIONS_PROJECT_MIO — meta-knowledge strict mode toggle.
app.post("/api/state/:id/meta-knowledge-strict", (req, res) => {
  const state = campaignState.load(req.params.id);
  state.settings = state.settings || {};
  state.settings.meta_knowledge_strict = !!(req.body && req.body.enabled);
  campaignState.save(state);
  res.json({ ok: true, meta_knowledge_strict: state.settings.meta_knowledge_strict });
});

// PATCH_IP_EXTENSIONS_PROJECT_MIO — soft-goal checklist CRUD.
app.get("/api/soft-goals/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  res.json({ soft_goals: require("./player/softGoals").ensure(state) });
});
app.post("/api/soft-goals/:id", (req, res) => {
  const softGoals = require("./player/softGoals");
  const state = campaignState.load(req.params.id);
  const action = (req.body && req.body.action) || "add";
  let r;
  if (action === "add") r = softGoals.add(state, req.body && req.body.text, "player");
  else if (action === "toggle") r = softGoals.toggle(state, req.body && req.body.goal_id, req.body && req.body.done);
  else if (action === "remove") r = softGoals.remove(state, req.body && req.body.goal_id);
  else return res.status(400).json({ error: `unknown action "${action}"` });
  if (!r.ok) return res.status(400).json({ error: r.reason });
  campaignState.save(state);
  res.json({ ...r, soft_goals: softGoals.ensure(state) });
});

// PATCH_IP_EXTENSIONS_PROJECT_MIO — multiple named dice pools: define / roll / delete.
app.get("/api/dice-pools/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  res.json({ dice_pools: require("./game/dicePools").ensure(state) });
});
app.post("/api/dice-pools/:id", (req, res) => {
  const dicePools = require("./game/dicePools");
  const state = campaignState.load(req.params.id);
  const action = (req.body && req.body.action) || "define";
  let r;
  if (action === "define") r = dicePools.define(state, req.body || {});
  else if (action === "roll") r = dicePools.roll(state, req.body && req.body.pool_id, { bonus: (req.body && req.body.bonus) || 0 });
  else if (action === "remove") r = dicePools.remove(state, req.body && req.body.pool_id);
  else return res.status(400).json({ error: `unknown action "${action}"` });
  if (!r.ok) return res.status(400).json({ error: r.reason });
  if (action !== "roll") campaignState.save(state); // rolls don't persist
  res.json({ ...r, dice_pools: dicePools.ensure(state) });
});

// PATCH_IP_EXTENSIONS_PROJECT_MIO — set a canon entity's Canon Level.
app.post("/api/canon/:id/level", (req, res) => {
  const deps = getDeps(req.params.id);
  const r = deps.canonDb.setLevel(req.body && req.body.canon_id, req.body && req.body.level);
  if (!r.ok) return res.status(400).json({ error: r.reason, levels: deps.canonDb.CANON_LEVELS });
  res.json({ ok: true, canon_id: r.entity.canon_id, canon_level: r.entity.canon_level });
});

// ==========================================================================
// Phase 5 — new endpoints
// ==========================================================================

// POST /api/campaign/:id/undo — roll back state+memory+canon to the snapshot
// taken before the last turn. One-shot (single depth by design).
app.post("/api/campaign/:id/undo", (req, res) => {
  const r = undo.restore(req.params.id);
  if (!r.ok) return res.status(409).json(r);
  depsByCampaign.delete(req.params.id); // engines must reload rolled-back files
  res.json({ ok: true, turn: r.turn, state: campaignState.load(req.params.id) });
});

// GET /api/undo/:id — is a rollback snapshot available?
app.get("/api/undo/:id", (req, res) => {
  const a = undo.available(req.params.id);
  res.json({ available: !!a, info: a });
});

// GET /api/recap/:id — session recap if the player was away >= recap_hours.
app.get("/api/recap/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const state = campaignState.load(id);
    const p = campaignState.statePath(id);
    const hoursAway = fs.existsSync(p) ? (Date.now() - fs.statSync(p).mtimeMs) / 3600000 : 0;
    const threshold = (state.settings && state.settings.recap_hours) || 6;
    const force = req.query.force === "1";
    if (!force && hoursAway < threshold) return res.json({ recap: null, hours_away: Math.round(hoursAway * 10) / 10 });
    // Phase 12 U3 — low-token: no summary LLM call; show raw recent turns instead.
    if (state.settings && state.settings.low_token_mode) {
      const raw = (state.recent_dialogue || []).slice(-3).map((r) => r.gm).join("\n\n");
      return res.json({ recap: raw || null, low_token: true, hours_away: Math.round(hoursAway * 10) / 10 });
    }
    const dialogue = (state.recent_dialogue || []).map((r) => `플레이어: ${r.player}\nGM: ${r.gm}`).join("\n\n");
    if (!dialogue) return res.json({ recap: null });
    gemini.setCampaign(id);
    let recap = await gemini.summarize(
      promptSettings.getPrompt(state, "summary.recap"),
      dialogue
    );
    if (!recap) {
      // mock/no-key fallback: last GM narration's first sentences
      const lastGm = (state.recent_dialogue || []).slice(-1).map((r) => r.gm).join("");
      recap = lastGm.split(/(?<=[.!?다])\s+/).slice(0, 3).join(" ");
    }
    res.json({ recap, hours_away: Math.round(hoursAway * 10) / 10, turn: state.turn_number });
  } catch (e) {
    res.json({ recap: null, error: e.message });
  }
});

// --- settings (Wave 3) ----------------------------------------------------
// POST /api/state/:id/settings — patch narrative_dna / settings / house_rules.
app.post("/api/state/:id/settings", (req, res) => {
  const state = campaignState.load(req.params.id);
  const b = req.body || {};
  if (b.narrative_dna) {
    for (const [k, v] of Object.entries(b.narrative_dna)) {
      if (k in state.narrative_dna) state.narrative_dna[k] = Math.max(1, Math.min(5, Number(v)));
    }
  }
  if (b.settings) {
    for (const k of ["choices_ui", "content_intensity", "recap_hours", "world_event_period", "response_length", "expected_campaign_length", "low_token_mode", "rpd_limit", "player_agency_lock", "calm_mode"]) {
      if (b.settings[k] !== undefined) state.settings[k] = b.settings[k];
    }
    // Living World 자율 진행 주기(턴). 설정 탭 "세계 자율 진행 주기" 카드에서 조정.
    // 1~500턴으로 클램프해 폭주/0값을 막는다.
    for (const k of ["place_tick_period", "npc_goal_period", "news_period", "wanted_tick_period", "living_object_period", "living_npc_period", "resonance_period"]) {
      if (b.settings[k] !== undefined) {
        const n = Math.round(Number(b.settings[k]));
        if (Number.isFinite(n)) state.settings[k] = Math.max(1, Math.min(500, n));
      }
    }
    if (b.settings.content_intensity_notes && typeof b.settings.content_intensity_notes === "object") {
      state.settings.content_intensity_notes = state.settings.content_intensity_notes || {};
      for (const k of ["low", "medium", "high"]) {
        if (b.settings.content_intensity_notes[k] !== undefined) {
          state.settings.content_intensity_notes[k] = String(b.settings.content_intensity_notes[k]).slice(0, 600);
          state.custom_registry = dimensionRegistry.ensure(state);
          state.custom_registry.intensity_guides[k] = state.settings.content_intensity_notes[k];
        }
      }
    }
  }
  if (Array.isArray(b.house_rules)) {
    state.house_rules = b.house_rules.map((r) => String(r).slice(0, 500)).slice(0, 20);
  }
  if (b.prompt_overrides) {
    state.prompt_overrides = state.prompt_overrides || { enabled: false, system_addendum: "", extraction_addendum: "" };
    if (b.prompt_overrides.enabled !== undefined) state.prompt_overrides.enabled = !!b.prompt_overrides.enabled;
    if (b.prompt_overrides.system_addendum !== undefined) state.prompt_overrides.system_addendum = String(b.prompt_overrides.system_addendum || "").slice(0, 6000);
    if (b.prompt_overrides.extraction_addendum !== undefined) state.prompt_overrides.extraction_addendum = String(b.prompt_overrides.extraction_addendum || "").slice(0, 4000);
  }
  if (b.prompt_settings) {
    promptSettings.ensure(state);
    if (b.prompt_settings.enabled !== undefined) state.prompt_settings.enabled = !!b.prompt_settings.enabled;
  }
  // Phase 6 D — player-chosen display name / icon (never touches meta.world_name,
  // which stays whatever the wizard/AI generated).
  if (b.meta) {
    if (b.meta.display_name !== undefined) state.meta.display_name = String(b.meta.display_name || "").slice(0, 60) || null;
    if (b.meta.icon !== undefined) state.meta.icon = String(b.meta.icon || "📖").slice(0, 8);
  }
  campaignState.save(state);
  res.json({ ok: true, narrative_dna: state.narrative_dna, settings: state.settings, house_rules: state.house_rules, prompt_overrides: state.prompt_overrides, prompt_settings: state.prompt_settings, meta: state.meta });
});

app.get("/api/prompts/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  res.json(promptSettings.clientPayload(state));
});

app.post("/api/prompts/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  promptSettings.ensure(state);
  if (req.body && req.body.enabled !== undefined) state.prompt_settings.enabled = !!req.body.enabled;
  campaignState.save(state);
  res.json(promptSettings.clientPayload(state));
});

app.post("/api/prompts/:id/:key", (req, res) => {
  const state = campaignState.load(req.params.id);
  const r = promptSettings.setItem(state, req.params.key, req.body || {});
  if (!r.ok) return res.status(404).json({ error: r.reason });
  campaignState.save(state);
  res.json({ ok: true, prompts: promptSettings.clientPayload(state) });
});

// --- Custom Dimension Registry --------------------------------------------
app.get("/api/registry/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  res.json({ registry: dimensionRegistry.ensure(state), hidden_variables: (state.player && state.player.hidden_variables) || {} });
});

app.post("/api/registry/:id/:kind", (req, res) => {
  try {
    const state = campaignState.load(req.params.id);
    const reg = dimensionRegistry.ensure(state);
    const map = { dimension: "dimensions", emotion: "emotion_vocab", theme: "themes", scene: "scene_types" };
    const listKey = map[req.params.kind];
    if (!listKey) return res.status(400).json({ error: "invalid registry kind" });
    const item = dimensionRegistry.upsert(reg[listKey], req.body || {});
    if (listKey === "dimensions" && item.kind === "hidden" && state.player) {
      state.player.hidden_variables = state.player.hidden_variables || {};
      if (state.player.hidden_variables[item.id] === undefined) state.player.hidden_variables[item.id] = Number(item.default_value ?? 0.5);
    }
    campaignState.save(state);
    res.json({ ok: true, item, registry: reg });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/registry/:id/:kind/:itemId/archive", (req, res) => {
  const state = campaignState.load(req.params.id);
  const reg = dimensionRegistry.ensure(state);
  const map = { dimension: "dimensions", emotion: "emotion_vocab", theme: "themes", scene: "scene_types" };
  const list = reg[map[req.params.kind]];
  if (!list) return res.status(400).json({ error: "invalid registry kind" });
  const item = list.find((x) => x.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: "not found" });
  item.archived = req.body && req.body.archived !== undefined ? !!req.body.archived : true;
  campaignState.save(state);
  res.json({ ok: true, item });
});

// --- tester feedback -------------------------------------------------------
app.get("/api/feedback/:id", (req, res) => res.json({ feedback: feedbackStore.load(req.params.id) }));
app.post("/api/feedback/:id", (req, res) => {
  try { res.json({ ok: true, feedback: feedbackStore.add(req.params.id, req.body || {}) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/usage/:id — usage/cost monitor (Wave 3).
// Launcher (global) — aggregated usage across every campaign, read-only.
app.get("/api/usage", (req, res) => {
  const agg = usageLog.aggregateAll();
  res.json({ ...agg, estimated_cost_usd: usageLog.estimateCost(agg) });
});

app.get("/api/usage/:id", (req, res) => {
  const u = usageLog.load(req.params.id);
  const state = campaignState.load(req.params.id);
  const rpd = state.settings && state.settings.rpd_limit;
  res.json({ ...u, estimated_cost_usd: usageLog.estimateCost(u), today: usageLog.todaySummary(u, rpd), rpd_limit: rpd || null });
});

// --- export / import (Wave 3-4) --------------------------------------------
// GET /api/export/:id — full JSON backup (state + memory + canon in one file).
app.get("/api/export/:id", (req, res) => {
  const id = req.params.id;
  if (!fs.existsSync(campaignState.statePath(id))) return res.status(404).json({ error: "not found" });
  const deps = getDeps(id);
  const bundle = {
    format: "narrativeos_backup_v1",
    exported_at: new Date().toISOString(),
    state: campaignState.load(id),
    memory: deps.memoryEngine.all(),
    canon: deps.canonDb.all(),
  };
  // Phase 14 Z — optional gzip for the shareable backup (smaller file on disk).
  if (req.query.gz === "1") {
    const gz = require("./util/compress").gzipString(JSON.stringify(bundle));
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${id}_backup.json.gz"`);
    return res.send(gz);
  }
  res.setHeader("Content-Disposition", `attachment; filename="${id}_backup.json"`);
  res.json(bundle);
});

// GET /api/export/:id/narrative — reading-copy markdown (memory summaries +
// verbatim recent dialogue). No LLM post-processing required.
app.get("/api/export/:id/narrative", (req, res) => {
  const id = req.params.id;
  if (!fs.existsSync(campaignState.statePath(id))) return res.status(404).json({ error: "not found" });
  const deps = getDeps(id);
  const state = campaignState.load(id);
  const lines = [`# ${state.meta && state.meta.world_name ? state.meta.world_name : id} — 서사 기록`, ""];
  lines.push(`(${state.turn_number}턴 · ${state.in_world_date})`, "", "## 이야기의 흐름", "");
  for (const m of deps.memoryEngine.all()) {
    lines.push(`- [${m.timestamp.campaign_turn}턴] ${m.summary}`);
  }
  lines.push("", "## 최근 장면 (원문)", "");
  for (const r of state.recent_dialogue || []) {
    lines.push(`**플레이어:** ${r.player}`, "", r.gm, "", "---", "");
  }
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${id}_story.md"`);
  res.send(lines.join("\n"));
});

// POST /api/import — restore a backup as a NEW campaign, or extract only the
// world template part (mode: "world_template" → Canon World/Faction only).
app.post("/api/import", (req, res) => {
  const { bundle, new_id, mode } = req.body || {};
  if (!bundle || bundle.format !== "narrativeos_backup_v1") return res.status(400).json({ error: "not a NarrativeOS backup file" });
  const id = (new_id || "").trim();
  if (!id || !/^[\w-]+$/.test(id)) return res.status(400).json({ error: "valid new_id required" });
  if (fs.existsSync(campaignState.statePath(id))) return res.status(409).json({ error: "campaign already exists" });

  if (mode === "world_template") {
    // Wave 4 — only World/Faction canon feeds a fresh campaign.
    const state = campaignState.load(id); // fresh
    const deps = getDeps(id);
    const picked = (bundle.canon || []).filter((e) => e.type === "World" || e.type === "Faction");
    const results = picked.map((e) =>
      deps.kernel.request(state, "import", "canon.register", {
        canon_id: e.canon_id, type: e.type, data: e.data,
        immutable_fields: e.immutable_fields, mutable_fields: e.mutable_fields,
      })
    );
    if (bundle.state && bundle.state.meta) state.meta.world_name = bundle.state.meta.world_name;
    campaignState.save(state);
    return res.json({ ok: true, campaign_id: id, imported: results.filter((r) => r.approved).length, mode });
  }

  // Full restore.
  const state = bundle.state;
  state.campaign_id = id;
  state.db_refs = { memory_db: `${id}_memory.json`, canon_db: `${id}_canon.json` };
  campaignState.save(campaignState.migrate(state));
  fs.writeFileSync(path.join(campaignState.DATA_DIR, `${id}_memory.json`), JSON.stringify(bundle.memory || [], null, 2), "utf8");
  fs.writeFileSync(path.join(campaignState.DATA_DIR, `${id}_canon.json`), JSON.stringify(bundle.canon || [], null, 2), "utf8");
  depsByCampaign.delete(id);
  res.json({ ok: true, campaign_id: id, mode: "full" });
});

function removeCampaignFiles(id, { keepState = false } = {}) {
  for (const suffix of ["_memory", "_canon", "_usage", "_undo", "_notes", "_turnlog"]) {
    const p = path.join(campaignState.DATA_DIR, `${id}${suffix}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  if (!keepState && fs.existsSync(campaignState.statePath(id))) fs.unlinkSync(campaignState.statePath(id));
  depsByCampaign.delete(id);
}

function createRiaSample(id) {
  removeCampaignFiles(id);
  const state = campaignState.load(id);
  const deps = getDeps(id);
  const body = {
    world_name: "안개의 항구",
    era: "modern",
    genre_preset: "modern",
    background_description: "비가 자주 내리는 오래된 항구 도시. 폐창고와 작은 서점, 선착장 게시판 사이로 오래된 약속과 소문이 천천히 되살아난다.",
    world_notes: "초반부는 리아와 플레이어가 오래된 다리 근처에서 다시 마주치는 조용한 체험형 소설 톤으로 시작한다.",
    regions: [
      { canon_id: "loc_old_town_bridge", name: "구시가지 다리", description: "항구와 구시가를 잇는 낡은 돌다리.", notable_features: ["비 냄새", "젖은 가로등", "오래된 약속의 장소"] },
      { canon_id: "loc_harbor_bookshop", name: "항구 서점", description: "선원들의 기록과 오래된 편지를 맡아두는 작은 서점.", notable_features: ["낡은 편지", "바다 냄새"] },
    ],
    factions: [
      { canon_id: "faction_harbor_watch", name: "항구 감시단", description: "항구의 질서와 소문을 동시에 관리하는 느슨한 조직.", goal: "최근 사라진 화물과 사람들의 흔적을 쫓는다." },
    ],
    player: { birth_name: "방문자", species: "human", background: "몇 년 만에 안개의 항구로 돌아온 사람.", core_values: ["기억", "약속"], psychology: { core_fear: "중요한 말을 또 놓치는 것", desire: "과거의 빈칸을 확인하는 것" } },
    npcs: [
      { canon_id: "char_ria", birth_name: "리아", species: "human", role: "npc", background: "플레이어와 오래전 약속을 나눈 항구 서점의 기록 담당자.", core_values: ["기억", "조심스러운 진심"], goal_current: "사라진 편지 묶음의 행방을 찾기", current_location: "loc_old_town_bridge", relationship_to_player_type: "친구", psychology: { attachment_style: "avoidant", core_fear: "다시 기대했다가 버려지는 것", desire: "한 번은 제대로 이유를 듣는 것", defense_mechanism: "농담으로 말을 돌림" } },
    ],
    narrative_dna: { tone: 3, emotion: 5, politics: 1, survival: 1, horror: 1, mystery: 3, romance: 2, exploration: 2 },
    expected_campaign_length: "normal",
  };
  wizardGen.registerAll(deps.kernel, state, body);
  state.meta = { world_name: body.world_name, era: body.era, genre_preset: body.genre_preset, created_at: new Date().toISOString(), display_name: "리아 샘플 캠페인", icon: "🌧" };
  state.world.background_description = body.background_description;
  state.world.notes = body.world_notes;
  state.player.name = body.player.birth_name;
  state.player.background = body.player.background;
  state.player.traits = body.player.core_values;
  state.player.psychology = body.player.psychology;
  state.settings.choices_ui = true;
  state.custom_registry = dimensionRegistry.ensure(state);
  state.custom_registry.onboarding.intro_seen = true;
  state.custom_registry.onboarding.scenario_preset = "ria_sample";
  state.recent_dialogue = [{
    turn: 0,
    in_world_date: state.in_world_date,
    player: "다리 위에서 리아를 발견하고, 아직 말을 걸지 못한 채 멈춰 선다.",
    gm: "비는 오래된 돌다리의 틈마다 고여 있었다. 항구 쪽에서 올라온 안개가 가로등 아래로 낮게 흐르고, 그 너머에서 리아가 낡은 우산을 접고 있었다.\n\n그녀는 당신을 알아본다. 아주 짧게, 숨을 삼키는 표정이 지나간다.\n\n\"정말 돌아왔네.\"\n\n리아는 그렇게 말하고 나서야 시선을 옆으로 돌린다. 말끝에 묻은 물기 때문인지, 오래 참은 감정 때문인지는 아직 알 수 없다.\n\n- 리아에게 조용히 인사한다\n- 왜 이곳에 있었는지 묻는다\n- 말없이 다리 난간에 기대어 함께 비를 본다",
  }];
  campaignState.save(state);
  return state;
}

app.post("/api/sample/ria", (req, res) => {
  const id = req.body && req.body.campaign_id ? String(req.body.campaign_id).trim() : "sample_ria";
  if (!/^[\w-]+$/.test(id)) return res.status(400).json({ error: "valid campaign_id required" });
  if (fs.existsSync(campaignState.statePath(id)) && !(req.body && req.body.overwrite)) return res.status(409).json({ error: "campaign already exists", campaign_id: id });
  const state = createRiaSample(id);
  res.json({ ok: true, campaign_id: state.campaign_id });
});

app.post("/api/campaign/:id/reset", (req, res) => {
  const id = req.params.id;
  if (!fs.existsSync(campaignState.statePath(id))) return res.status(404).json({ error: "not found" });
  const old = campaignState.load(id);
  const backupId = `${id}_before_reset_${Date.now().toString(36)}`;
  campaignState.save({ ...old, campaign_id: backupId, db_refs: { memory_db: `${backupId}_memory.json`, canon_db: `${backupId}_canon.json` } });
  removeCampaignFiles(id, { keepState: false });
  const fresh = campaignState.load(id);
  fresh.meta = { ...fresh.meta, world_name: (old.meta && old.meta.world_name) || "다시 시작한 이야기", display_name: old.meta && old.meta.display_name, icon: old.meta && old.meta.icon || "📖" };
  campaignState.save(fresh);
  res.json({ ok: true, campaign_id: id, backup_id: backupId });
});

// --- wizard (Phase 4 A2-A4, built now) --------------------------------------
app.post("/api/wizard/world", async (req, res) => {
  try {
    gemini.setCampaign("wizard");
    const promptState = req.body.campaign_id && fs.existsSync(campaignState.statePath(req.body.campaign_id)) ? campaignState.load(req.body.campaign_id) : null;
    res.json(await wizardGen.generateWorld((req.body.text || "").slice(0, 2000), promptState));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/wizard/characters", async (req, res) => {
  try {
    gemini.setCampaign("wizard");
    const promptState = req.body.campaign_id && fs.existsSync(campaignState.statePath(req.body.campaign_id)) ? campaignState.load(req.body.campaign_id) : null;
    res.json(await wizardGen.generateCharacters((req.body.text || "").slice(0, 2000), req.body.world || {}, req.body.npc_count || 3, promptState));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/wizard/suggest — B1 per-field AI help. Suggests ONLY the requested
// field; the wizard form stays empty until the user accepts a suggestion.
app.post("/api/wizard/suggest", async (req, res) => {
  try {
    gemini.setCampaign("wizard");
    const { field, context } = req.body || {};
    if (context && context.campaign_id && fs.existsSync(campaignState.statePath(context.campaign_id))) {
      context.prompt_state = campaignState.load(context.campaign_id);
    }
    res.json(await wizardGen.suggestField(field, context || {}));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/wizard/create — A3 pipeline: confirmed wizard output → new
// campaign; every entity goes through kernel canon.register validation.
app.post("/api/wizard/create", (req, res) => {
  const b = req.body || {};
  const id = (b.campaign_id || "camp_" + Date.now().toString(36)).trim();
  if (!/^[\w-]+$/.test(id)) return res.status(400).json({ error: "valid campaign_id required" });
  if (fs.existsSync(campaignState.statePath(id))) return res.status(409).json({ error: "campaign already exists" });

  // Local wizard guardrail is advisory only. School-life campaigns often contain
  // age/romance keywords in harmless setup text, so creation should not hard-stop
  // before the player can edit and start the campaign.
  const guardrail = contentGuardrail(b);

  const state = campaignState.load(id); // fresh state
  const deps = getDeps(id);
  const results = wizardGen.registerAll(deps.kernel, state, b);

  if (b.narrative_dna) {
    for (const [k, v] of Object.entries(b.narrative_dna)) {
      if (k in state.narrative_dna) state.narrative_dna[k] = Math.max(1, Math.min(5, Number(v)));
    }
  }
  state.meta = {
    world_name: b.world_name || null,
    era: b.era || "fantasy",
    genre_preset: b.genre_preset || null,
    created_at: new Date().toISOString(),
  };
  // Phase 7 A3 — expected campaign length feeds the Campaign Planner's pacing.
  if (b.expected_campaign_length && ["short", "normal", "long"].includes(b.expected_campaign_length)) {
    state.settings.expected_campaign_length = b.expected_campaign_length;
  }
  // Phase 9 E1 — world tech_level: explicit, else inferred from the era/preset.
  const TECH_BY_ERA = { sf: "sci_fi", modern: "modern", school: "modern", zombie: "modern", fantasy: "fantasy_low" };
  state.world = state.world || {};
  state.world.tech_level = b.tech_level || TECH_BY_ERA[b.era] || TECH_BY_ERA[b.genre_preset] || "fantasy_low";
  // C1/C2 — free-text world background + notes, referenced in the GM prompt.
  if (b.background_description) state.world.background_description = String(b.background_description).slice(0, 200000);
  if (b.world_notes) state.world.notes = String(b.world_notes).slice(0, 200000);
  // Phase 10 M1 — register the genre-based starting stat (rate-limit exempt).
  require("./game/genreStatPresets").applyPreset(state);
  if (b.player) {
    state.player.name = b.player.birth_name || null;
    state.player.background = b.player.background || null;
    state.player.psychology = b.player.psychology || {};
    if (Array.isArray(b.player.core_values)) state.player.traits = b.player.core_values.slice(0, 5);
    if (b.player.notes) state.player.notes = String(b.player.notes).slice(0, 4000); // C2
  }
  state.custom_registry = dimensionRegistry.ensure(state);
  state.custom_registry.onboarding.content_reviewed = true;
  state.custom_registry.onboarding.scenario_preset = b.scenario_preset || null;
  if (b.scenario_preset && START_OPENERS[b.scenario_preset]) {
    state.recent_dialogue = [{
      turn: 0,
      in_world_date: state.in_world_date,
      player: "이야기를 시작한다.",
      gm: `${START_OPENERS[b.scenario_preset]}\n\n- 주변을 천천히 둘러본다\n- 가장 먼저 눈에 들어온 사람에게 다가간다\n- 지금 이곳에 온 이유를 떠올린다`,
    }];
  }
  const importItems = Array.isArray(b.import_items) ? b.import_items.slice(0, 500) : [];
  const importResults = importItems.length ? notionImport.registerItems(deps.kernel, state, deps.canonDb, importItems) : [];
  campaignState.save(state);
  const failed = results.filter((r) => !r.approved);
  const importFailed = importResults.filter((r) => !r.ok);
  res.json({
    ok: true,
    campaign_id: id,
    registered: results.length - failed.length,
    failed,
    imported_settings: importResults.length - importFailed.length,
    import_failed: importFailed,
    guardrail_warnings: guardrail,
  });
});

// --- player tab (Wave 2) ----------------------------------------------------
app.get("/api/player/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  const visibleFlags = (state.story_flags || []).filter((f) => f.visible_to_player);
  res.json({
    name: state.player.name || "이름 없는 모험가",
    background: state.player.background || null,
    traits: state.player.traits || [],
    stats: state.player.stats || {}, // Phase 10 H — client computes choice-weight hints
    generation: state.player.generation,
    identity_milestones: state.player.identity_milestones || [],
    highlight_flags: visibleFlags,
    item_count: (state.inventory || []).length,
    // Phase 9 F4 — player-facing dynamic traits: description only, never value.
    dynamic_traits: (state.player.dynamic_traits || []).filter((t) => t.visible_to_player)
      .map((t) => ({ name: t.name, category: t.category, player_facing_description: t.player_facing_description, origin_event_turn: t.origin_event_turn, trend: t.trend })),
    new_trait_notice: state.new_trait_notice || null,
    decision_points: state.decision_points || [], // Phase 11 T — journey tree
  });
});

// POST /api/player/:id/trait — Phase 10 M2. Player manually adds a trait. This
// bypasses the AI-detection rate limit (explicit player intent) but keeps the
// duplicate-name check. Value starts at 0; grows through play.
app.post("/api/player/:id/trait", (req, res) => {
  const state = campaignState.load(req.params.id);
  const name = String((req.body && req.body.name) || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  state.player.dynamic_traits = state.player.dynamic_traits || [];
  if (state.player.dynamic_traits.some((t) => t.name === name)) return res.status(409).json({ error: "이미 있는 특성입니다" });
  const trait = {
    trait_id: `trait_manual_${Date.now().toString(36)}`, name,
    category: (req.body && req.body.category) || "psychological",
    origin_event_turn: state.turn_number, origin_summary: "플레이어가 직접 추가함",
    canon_refs: [], value: 0, trend: "stable", last_updated_turn: state.turn_number,
    visible_to_player: true, origin: "manual",
    player_facing_description: String((req.body && req.body.description) || name).slice(0, 200),
  };
  state.player.dynamic_traits.push(trait);
  campaignState.save(state);
  res.json({ ok: true, trait });
});

// POST /api/player/:id/ack-trait — clear the "new trait" quiet notice once the
// character tab has surfaced it (so it doesn't badge forever).
app.post("/api/player/:id/ack-trait", (req, res) => {
  const state = campaignState.load(req.params.id);
  state.new_trait_notice = null;
  campaignState.save(state);
  res.json({ ok: true });
});

// --- Phase 9 Part E4 — letters (era communication) -------------------------
// GET /api/comm/:id — channel status: tech_level, letter recipients (met NPCs),
// and this campaign's letters in flight / resolved.
app.get("/api/comm/:id", (req, res) => {
  const deps = getDeps(req.params.id);
  const state = campaignState.load(req.params.id);
  const recipients = (state.npcs || []).filter((n) => { const e = deps.canonDb.get(n.canon_ref); return e && e.data && e.data.discovered_by_player; })
    .map((n) => { const e = deps.canonDb.get(n.canon_ref); return { canon_ref: n.canon_ref, name: (e.data.birth_name || n.canon_ref) }; });
  res.json({
    tech_level: (state.world && state.world.tech_level) || "fantasy_low",
    channel: "letters",
    recipients,
    letters: (state.scheduled_actions || []).filter((a) => a.type === "letter_delivery")
      .map((a) => ({ action_id: a.action_id, recipient: a.payload.recipient, content_summary: a.payload.content_summary, created_turn: a.created_turn, trigger_turn: a.trigger_turn, status: a.status })),
    // Phase 11 P — incoming NPC-initiated messages (unread badge source).
    incoming: (state.scheduled_actions || []).filter((a) => a.type === "npc_message")
      .map((a) => ({ action_id: a.action_id, sender: a.payload.sender, content_summary: a.payload.content_summary, created_turn: a.created_turn, unread: !!a.unread })),
    unread_count: (state.scheduled_actions || []).filter((a) => a.type === "npc_message" && a.unread).length,
  });
});

// POST /api/comm/:id/read — mark NPC messages read (clears the unread badge).
// Optional body { sender } marks only that sender's messages read (C7 — opening
// one conversation in the comm modal). No sender = mark all read.
app.post("/api/comm/:id/read", (req, res) => {
  const state = campaignState.load(req.params.id);
  const sender = req.body && req.body.sender;
  for (const a of state.scheduled_actions || []) {
    if (a.type === "npc_message" && (!sender || a.payload.sender === sender)) a.unread = false;
  }
  campaignState.save(state);
  res.json({ ok: true, unread_count: (state.scheduled_actions || []).filter((a) => a.type === "npc_message" && a.unread).length });
});

// POST /api/campaign/:id/letter — send a letter (creates a scheduled_action).
app.post("/api/campaign/:id/letter", (req, res) => {
  const deps = getDeps(req.params.id);
  const state = campaignState.load(req.params.id);
  const r = letters.sendLetter(state, deps.canonDb, { recipient: req.body.recipient, content: req.body.content });
  if (!r.ok) return res.status(400).json({ error: r.reason });
  campaignState.save(state);
  res.json({ ok: true, eta_turns: r.eta_turns, distance_tier: r.distance_tier, action_id: r.action.action_id });
});

// --- world tab (Wave 2): timeline / foreshadow / rumor / reputation ---------
app.get("/api/worldtab/:id", (req, res) => {
  const deps = getDeps(req.params.id);
  const state = campaignState.load(req.params.id);
  const timeline = deps.memoryEngine
    .all()
    .filter((m) => m.tier >= 3)
    .map((m) => ({ turn: m.timestamp.campaign_turn, summary: m.summary, tier: m.tier }));
  res.json({
    timeline,
    foreshadow: (state.foreshadow_pool || []).map((f) => ({ id: f.id, planted_turn: f.planted_turn, resolved: !!f.resolved })),
    rumors: rumors.playerVisible(deps.canonDb),
    reputation: factionReputation.playerVisible(state, deps.canonDb),
    // Phase 7 A5/A4/A2 — weather widget, mysteries (revealed clues only), and
    // consequence chains ("선택의 결과").
    weather: (state.world && state.world.weather) || null,
    mysteries: (state.mysteries || []).map((m) => ({
      question: m.question, resolved: !!m.resolved, resolvable: !!m.resolvable,
      clues: (m.clues || []).filter((c) => c.revealed).map((c) => ({ content_summary: c.content_summary, revealed_turn: c.revealed_turn })),
      hidden_count: (m.clues || []).filter((c) => !c.revealed).length,
    })),
    consequence_chains: (state.consequence_chains || []).map((c) => ({
      origin_flag: c.origin_flag, origin_turn: c.origin_turn, linked_events: c.linked_events || [],
    })),
    countdowns: require("./game/countdowns").build(state), // Phase 10 O
    // PATCH 관계 전환 — surfaced to the notification system (toast + sidebar).
    relationship_milestones: (state.relationship_milestones || []).map((m) => {
      const e = deps.canonDb.get(m.npc_ref);
      return { ...m, npc_name: (e && e.data && e.data.birth_name) || m.npc_ref };
    }),
    // Phase 16 · World News — 자동 뉴스 피드(신문/게시판/공고/소문) + 미열람 수.
    news: worldNews.playerVisible(state),
    news_unseen: worldNews.unseenCount(state),
    // Phase 16 · Living Places — 플레이어가 아는(발견한) 장소들의 현재 상태/변천사.
    places: deps.canonDb.all()
      .filter((e) => e.type === "World" && e.data && e.data.discovered_by_player)
      .map((e) => ({
        canon_id: e.canon_id,
        name: (e.data.notable_features || [])[0] || e.data.region || e.canon_id,
        region: e.data.region || null,
        place_kind: e.data.place_kind || null,
        stage: e.data.place_stage || null,
        trend: e.data.place_trend || null,
        history: (e.data.place_history || []).slice().reverse(),
      })),
    // Phase 16 · World History Book — 자동 편찬된 세계 연대기.
    history: worldHistory.build(state, deps.canonDb, deps.memoryEngine),
    // Phase 16 · Dream System — 최근 꿈 기록(최신순).
    dreams: (state.dreams || []).slice().reverse(),
    // Phase 16+ · Festivals / Wanted / Organizations / Region Reputation.
    festivals: festivals.playerVisible(state),
    wanted: wantedSys.playerVisible(state),
    organizations: organizations.playerVisible(state),
    region_reputation: regionReputation.playerVisible(state),
  });
});

// Phase 16+ · Entity Inspector — one lens over everything about an entity.
app.get("/api/inspect/:id/:entityId", (req, res) => {
  const deps = getDeps(req.params.id);
  const state = campaignState.load(req.params.id);
  res.json(inspector.inspect(state, deps.canonDb, deps.memoryEngine, req.params.entityId) || { error: "not found" });
});

// Phase 16+ · Personal Calendar — list + add an entry.
app.get("/api/calendar/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  calendar.sync(state);
  campaignState.save(state);
  res.json({ upcoming: calendar.playerVisible(state) });
});
app.post("/api/calendar/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  const b = req.body || {};
  const entry = calendar.add(state, { title: b.title, kind: b.kind, day: Number(b.day) }, state.turn_number);
  campaignState.save(state);
  res.json({ ok: !!entry, entry });
});

// Phase 16+ · Home/Property — list.
app.get("/api/property/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  res.json({ properties: property.playerVisible(state) });
});

// Phase 16 · World News — mark all news read (clears the unread badge).
app.post("/api/worldtab/:id/news-seen", (req, res) => {
  const state = campaignState.load(req.params.id);
  const n = worldNews.markAllSeen(state);
  campaignState.save(state);
  res.json({ ok: true, marked: n });
});

// --- wiki (Wave 2) ----------------------------------------------------------
app.get("/api/wiki/:id", (req, res) => {
  const deps = getDeps(req.params.id);
  res.json(wiki.buildIndex(deps.canonDb, deps.memoryEngine));
});

// --- relationships tab (Wave 2): met NPCs only, qualitative payload ----------
app.get("/api/relations/:id", (req, res) => {
  const deps = getDeps(req.params.id);
  const state = campaignState.load(req.params.id);
  const met = (state.npcs || []).filter((n) => {
    const e = deps.canonDb.get(n.canon_ref);
    return e && e.data && e.data.discovered_by_player;
  });
  res.json({
    player_edges: met.map((n) => {
      const e = deps.canonDb.get(n.canon_ref);
      return { canon_ref: n.canon_ref, name: (e.data.birth_name || n.canon_ref), rel: n.relationship_to_player, schedule_hint: e.data.schedule_hint || null }; // Phase 10 J1
    }),
    npc_edges: (state.relationship_graph.edges || []).filter((edge) => {
      const a = deps.canonDb.get(edge.from), b = deps.canonDb.get(edge.to);
      return a && b && a.data.discovered_by_player && b.data.discovered_by_player;
    }),
    // PATCH 관계 전환 — "관계 변화 이력" (identity_milestones와 같은 UI 패턴). Adds
    // each milestone's NPC display name for the frontend.
    relationship_milestones: (state.relationship_milestones || []).map((m) => {
      const e = deps.canonDb.get(m.npc_ref);
      return { ...m, npc_name: (e && e.data && e.data.birth_name) || m.npc_ref };
    }),
    // Phase 16 · NPC Goal System — met NPCs' long-term goals + progress.
    npc_goals: npcGoals.playerVisible(state, deps.canonDb),
    // Phase 16 · Nickname System — how each NPC addresses the player.
    nicknames: nicknames.playerVisible(state, deps.canonDb),
    // Phase 16+ · Dynamic Title / Promise / Family Tree.
    titles: titles.playerVisible(state),
    promises: promises.playerVisible(state, deps.canonDb),
    family: familyTree.members(state).map((ref) => familyTree.treeFor(state, deps.canonDb, ref)),
  });
});

// PATCH_WEBNOVEL_TECHNIQUES — register a DELIBERATE narrative trick so the
// Watchdog won't "correct" the resulting apparent contradiction. Pre-registration
// only: it takes effect from this turn forward, never retroactively.
app.post("/api/campaign/:id/narrative-trick", (req, res) => {
  const integrityWatch = require("./meta/integrityWatch");
  const state = campaignState.load(req.params.id);
  const r = integrityWatch.registerTrick(state, {
    kind: (req.body && req.body.kind) || "",
    description: (req.body && req.body.description) || "",
    canon_refs: (req.body && req.body.canon_refs) || [],
  });
  if (!r.ok) return res.status(400).json({ error: r.reason });
  campaignState.save(state);
  res.json({ ok: true, trick: r.trick, kinds: [...integrityWatch.TRICK_KINDS] });
});

// PATCH_NARRATIVE_ACCUMULATION_GAPS — narrative arcs (growth through-lines),
// recurring motifs, and active echoes (departed/dead but still-felt NPCs).
app.get("/api/story-arcs/:id", (req, res) => {
  const deps = getDeps(req.params.id);
  const state = campaignState.load(req.params.id);
  const echoNpc = require("./npc/echoNpc");
  res.json({
    narrative_arcs: (state.narrative_arcs || []).map((a) => ({
      ...a,
      canon_names: (a.canon_refs || []).map((r) => { const e = deps.canonDb.get(r); return (e && e.data && e.data.birth_name) || r; }),
    })),
    motifs: (state.motifs || []).slice().sort((a, b) => b.occurrences - a.occurrences),
    echoes: echoNpc.activeEchoes(deps.canonDb).map((e) => ({ canon_ref: e.canon_id, name: (e.data.birth_name || e.canon_id), echo_state: e.data.echo_state })),
    // PATCH_WEBNOVEL_TECHNIQUES — rhythm debt, per-NPC 캐빨 arcs, registered tricks.
    tension_debt: state.tension_debt || null,
    npc_arcs: (state.npc_arcs || []).map((a) => { const e = deps.canonDb.get(a.npc_ref); return { ...a, npc_name: (e && e.data && e.data.birth_name) || a.npc_ref }; }),
    narrative_tricks: (state.narrative_tricks || []).filter((t) => t.active),
    // PATCH_INDIVIDUAL_WORKS_ANALYSIS — status window, neglected cast, climax fatigue.
    status_window: require("./game/statusWindow").build(state),
    neglected_cast: require("./meta/castNeglect").detect(state, deps.canonDb),
    climax_fatigue: require("./directors/climaxFatigue").assess(state),
    // PATCH_IP_EXTENSIONS_PROJECT_MIO — IP toggles, soft goals, dice pools, core canon.
    fixed_protagonist: (state.settings && state.settings.fixed_protagonist) || { enabled: false },
    meta_knowledge_strict: !!(state.settings && state.settings.meta_knowledge_strict),
    soft_goals: state.soft_goals || [],
    dice_pools: state.dice_pools || [],
    core_canon: (deps.canonDb.all() || []).filter((e) => (e.canon_level || "campaign") === "core").map((e) => ({ canon_id: e.canon_id, name: (e.data && e.data.birth_name) || e.canon_id })),
    // PATCH_CHAPTER_CHECKLIST — chapters with per-item done state + canon names.
    chapters: (state.chapters || []).map((c) => ({
      ...c,
      checklist: (c.checklist || []).map((i) => {
        const e = i.kind === "canon" ? deps.canonDb.get(i.ref) : null;
        const label = e ? (e.data.birth_name || i.ref) : i.ref;
        return { ...i, label };
      }),
    })),
  });
});

// --- writer workspace: Notion-like world/character/manuscript pages ----------
app.get("/api/writer/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  const workspace = ensureWriterWorkspace(state);
  res.json({ workspace, world_name: state.meta && state.meta.world_name, campaign_id: state.campaign_id });
});

app.post("/api/writer/:id/page", (req, res) => {
  const state = campaignState.load(req.params.id);
  const workspace = ensureWriterWorkspace(state);
  const page = sanitizeWriterPage(req.body && req.body.page);
  const idx = workspace.pages.findIndex((p) => p.id === page.id);
  if (idx >= 0) {
    page.created_at = workspace.pages[idx].created_at || page.created_at;
    workspace.pages[idx] = page;
  } else {
    workspace.pages.push(page);
  }
  workspace.active_page_id = page.id;
  workspace.pages = workspace.pages.slice(0, 200);
  campaignState.save(state);
  res.json({ ok: true, workspace, page });
});

app.post("/api/writer/:id/active", (req, res) => {
  const state = campaignState.load(req.params.id);
  const workspace = ensureWriterWorkspace(state);
  const pageId = String((req.body && req.body.page_id) || "");
  if (workspace.pages.some((p) => p.id === pageId)) workspace.active_page_id = pageId;
  campaignState.save(state);
  res.json({ ok: true, workspace });
});

app.delete("/api/writer/:id/page/:pageId", (req, res) => {
  const state = campaignState.load(req.params.id);
  const workspace = ensureWriterWorkspace(state);
  if (workspace.pages.length <= 1) return res.status(409).json({ error: "last page cannot be deleted" });
  workspace.pages = workspace.pages.filter((p) => p.id !== req.params.pageId);
  if (!workspace.pages.some((p) => p.id === workspace.active_page_id)) {
    workspace.active_page_id = workspace.pages[0] && workspace.pages[0].id;
  }
  campaignState.save(state);
  res.json({ ok: true, workspace });
});

// --- inventory tab (Wave 2) --------------------------------------------------
app.get("/api/inventory/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  // Phase 16+ · Living Objects — attach each item's current condition + history.
  const cond = {};
  for (const c of livingObjects.playerVisible(state)) cond[c.name] = c;
  res.json({ items: (state.inventory || []).map((it) => ({ ...it, living: cond[it.name] || null })) });
});

// DELETE /api/campaign/:id — launcher card delete.
app.delete("/api/campaign/:id", (req, res) => {
  const id = req.params.id;
  if (!fs.existsSync(campaignState.statePath(id))) return res.status(404).json({ error: "not found" });
  for (const suffix of ["_state", "_memory", "_canon", "_usage", "_undo", "_notes", "_turnlog"]) {
    const p = path.join(campaignState.DATA_DIR, `${id}${suffix}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  // Phase 13 V8 — also remove long-range snapshot files ({id}_snap_{turn}.json.gz).
  for (const s of require("./state/snapshots").list(id)) {
    try { fs.unlinkSync(path.join(campaignState.DATA_DIR, s.file)); } catch (_) {}
  }
  depsByCampaign.delete(id);
  res.json({ ok: true });
});

// GET /api/keys — Phase 8 D1. API key pool status (counts + exhaustion only —
// never the key values). POST reloads the pool from the environment.
app.get("/api/keys", (req, res) => res.json(gemini.keysStatus()));
app.post("/api/keys/reload", (req, res) => res.json({ ok: true, loaded: gemini.reloadKeys(), status: gemini.keysStatus() }));

// C4 — runtime API config (설정 탭 API 섹션): models + UI-entered keys, which
// override .env and persist across restarts. Key VALUES are never returned.
app.get("/api/runtime-config", (req, res) => res.json({ ...gemini.getRuntimeConfig(), keys: gemini.keysStatus() }));
app.post("/api/runtime-config", (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.narrative_model) patch.narrative_model = String(b.narrative_model);
  if (b.extract_model) patch.extract_model = String(b.extract_model);
  // keys: accept a newline/comma-separated string or an array. Absent = unchanged.
  if (b.keys !== undefined) {
    patch.keys = Array.isArray(b.keys) ? b.keys : String(b.keys).split(/[\n,]/);
  }
  const cfg = gemini.applyRuntimeConfig(patch);
  res.json({ ok: true, ...cfg, keys: gemini.keysStatus() });
});

// ==========================================================================
// PATCH Notion Import — 링크 자동 가져오기 (§2 연동 · §3 수집 · §4 분류 ·
// §5 중복 · §6 리뷰는 프론트 · §7 등록 · §8 비용).
// ==========================================================================

// §2 — Notion 연동 토큰 (평문 저장 금지: notionStore가 암호문만 보관, 값은 미노출).
app.get("/api/notion/config", (req, res) => res.json(notionStore.status()));
app.post("/api/notion/config", (req, res) => {
  const token = (req.body && req.body.token) || "";
  if (typeof req.body.default_depth !== "undefined") notionStore.setDefaultDepth(req.body.default_depth);
  if (!token) return res.json({ ok: true, ...notionStore.status() }); // 깊이만 갱신
  try { return res.json({ ok: true, ...notionStore.setToken(token) }); }
  catch (e) { return res.status(400).json({ error: e.message }); }
});
app.delete("/api/notion/config", (req, res) => res.json({ ok: true, ...notionStore.clear() }));

// §3 — 재귀 수집(깊이 제한) + §5 중복 그룹핑. LLM 호출 없음.
app.post("/api/notion/discover", async (req, res) => {
  try {
    const { url, max_depth } = req.body || {};
    if (!url) return res.status(400).json({ error: "Notion 페이지 링크가 필요합니다." });
    const r = await notionClient.discover(url, max_depth);
    const pages = notionImport.groupDuplicates(r.pages || []);
    res.json({ ok: true, pages, mock: !!r.mock, truncated: !!r.truncated, count: pages.length });
  } catch (e) { res.status(e.status === 401 ? 401 : 500).json({ error: e.message }); }
});

// §4 — 선택 페이지 본문 fetch + 구조화 분류. usage는 notion_import 카테고리로 적재.
app.post("/api/notion/analyze", async (req, res) => {
  try {
    const { campaign_id, pages } = req.body || {};
    const list = Array.isArray(pages) ? pages.slice(0, 200) : [];
    if (!list.length) return res.status(400).json({ error: "분석할 페이지가 없습니다." });
    gemini.setCampaign(campaign_id || "notion_import");
    const promptState = campaign_id && fs.existsSync(campaignState.statePath(campaign_id)) ? campaignState.load(campaign_id) : null;
    const items = [];
    for (const p of list) {
      const text = await notionClient.fetchPageText(p.id);
      const cls = await notionImport.classifyPageText(p.title || "", text, promptState);
      for (const expanded of notionImport.expandImportItem(cls, p.title || "")) {
        items.push({ page_id: p.id, page_title: p.title || "", ...expanded });
      }
    }
    res.json({ ok: true, items, analyzed: items.length, mock: !gemini.hasKey() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// §4(파일 경로) — 업로드한 .md/.txt 문서 텍스트를 그대로 분류. Notion과 같은
// 분류 파이프라인·usage 카테고리(notion_import)를 재사용한다. 클라이언트가
// 배치로 나눠 보내므로(수십 개 파일 대응) 한 요청은 작게 유지된다.
app.post("/api/import/analyze-text", async (req, res) => {
  try {
    const { campaign_id, docs } = req.body || {};
    const list = Array.isArray(docs) ? docs.slice(0, 200) : [];
    if (!list.length) return res.status(400).json({ error: "분석할 문서가 없습니다." });
    gemini.setCampaign(campaign_id || "notion_import");
    const promptState = campaign_id && fs.existsSync(campaignState.statePath(campaign_id)) ? campaignState.load(campaign_id) : null;
    const items = [];
    for (const d of list) {
      const cls = await notionImport.classifyPageText(d.title || "", d.text || "", promptState);
      for (const expanded of notionImport.expandImportItem(cls, d.title || "")) {
        items.push({ page_id: d.id || d.title, page_title: d.title || "", ...expanded });
      }
    }
    res.json({ ok: true, items, analyzed: items.length, mock: !gemini.hasKey() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// §7 — 사람이 리뷰·편집한 항목을 정식 경로로 등록(면제 없음).
app.post("/api/notion/import", (req, res) => {
  const { campaign_id, items } = req.body || {};
  if (!campaign_id || !fs.existsSync(campaignState.statePath(campaign_id))) return res.status(404).json({ error: "campaign not found" });
  const deps = getDeps(campaign_id);
  const state = campaignState.load(campaign_id);
  const results = notionImport.registerItems(deps.kernel, state, deps.canonDb, items || []);
  campaignState.save(state);
  res.json({ ok: true, results, imported: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) });
});

// GET /api/status — runtime mode.
app.get("/api/status", (req, res) => {
  res.json({ mock: !gemini.hasKey(), narrative_model: gemini.NARRATIVE_MODEL, extract_model: gemini.EXTRACT_MODEL });
});

// GET /api/state/:id — full state (used to restore chat on load).
app.get("/api/state/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  // PATCH 관계 전환 — heal missing player↔NPC edges on campaign open so the
  // relations tab / comm / milestones have data immediately (not only after a
  // turn). Persist so the next turn's proactive-contact pass sees them too.
  const deps = getDeps(req.params.id);
  const added = require("./relationship/relationshipGraph").reconcilePlayerEdges(state, deps.canonDb);
  if (added.length) campaignState.save(state);
  res.json(state);
});

// ==========================================================================
// Phase 15 — declarative themes (BB) + plugins (CC), both with preview (DD).
// ==========================================================================
const themes = require("./theme/themes");
const plugins = require("./plugins/plugins");
// A campaign-less Kernel so plugin.register routes through the same validation
// envelope as every other write (CC3). plugin.register ignores canon/memory/state.
const globalKernel = createKernel({ canonDb: { get: () => null, all: () => [] }, memoryEngine: { all: () => [] } });

// GET /api/themes — list saved themes.
app.get("/api/themes", (req, res) => res.json({ themes: themes.load(), allowed_keys: [...themes.ALLOWED_KEYS], allowed_fonts: themes.ALLOWED_FONTS }));

// POST /api/themes/generate — BB3. Free-text → token JSON (validated). NOT saved
// (DD preview first). Mock/no-key falls back to a deterministic sample.
app.post("/api/themes/generate", async (req, res) => {
  try {
    const desc = String((req.body && req.body.description) || "").slice(0, 500);
    let tokens = null;
    if (gemini.hasKey()) {
      gemini.setCampaign("theme");
      const prompt = promptSettings.getPrompt(null, "theme.generate", undefined, { allowed_keys: [...themes.ALLOWED_KEYS].join(", "), allowed_fonts: themes.ALLOWED_FONTS.join(", ") });
      try { const g = await gemini.generateStructured(prompt, desc, { temperature: 0.4 }); tokens = g && g.tokens; } catch (_) {}
    }
    if (!tokens) {
      // deterministic fallback sample (dark harbor city) so the flow works offline.
      tokens = { "--color-bg": "#1a1f26", "--color-surface": "#242b33", "--color-text": "#e4e6eb", "--color-accent": "#4a90a4", "--color-danger": "#b0473f", "--font-body": "Noto Serif KR", "--radius-base": "6px" };
    }
    const v = themes.validateTokens(tokens);
    res.json({ tokens: v.tokens, rejected: v.rejected, valid: v.ok, preview: themes.describe(v.tokens), from_description: desc, mock: !gemini.hasKey() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/themes — save a (validated) theme after preview confirmation.
app.post("/api/themes", (req, res) => {
  const r = themes.save({ name: (req.body && req.body.name), tokens: (req.body && req.body.tokens) || {}, created_from_description: req.body && req.body.description });
  if (!r.ok) return res.status(422).json({ error: r.reason, rejected: r.rejected });
  res.json({ ok: true, theme: r.theme });
});
app.delete("/api/themes/:tid", (req, res) => res.json({ themes: themes.remove(req.params.tid) }));

// GET /api/plugins — list registered plugins.
app.get("/api/plugins", (req, res) => res.json({ plugins: plugins.load(), extension_points: Object.keys(plugins.EXTENSION_POINTS) }));

// POST /api/plugins/generate — CC4. Free-text → manifest (validated, NOT registered).
app.post("/api/plugins/generate", async (req, res) => {
  try {
    const desc = String((req.body && req.body.description) || "").slice(0, 500);
    let manifest = null;
    if (gemini.hasKey()) {
      gemini.setCampaign("plugin");
      const prompt = promptSettings.getPrompt(null, "plugin.generate", undefined, { extension_points: Object.keys(plugins.EXTENSION_POINTS).join(", ") });
      try { manifest = await gemini.generateStructured(prompt, desc, { temperature: 0.4 }); } catch (_) {}
    }
    if (!manifest) {
      manifest = { name: desc ? desc.slice(0, 20) + " 팩" : "샘플 팩", extends: [{ type: "scene_type", value: { id: "investigation", label: "조사", tone_notes: "차분하고 관찰적인 묘사, 단서에 집중" } }], created_from_description: desc };
    }
    const v = plugins.validateManifest(manifest);
    res.json({ valid: v.ok, manifest: v.manifest || null, rejected: v.rejected || [], reason: v.reason || null, preview: v.ok ? plugins.describe(v.manifest) : [], mock: !gemini.hasKey() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/plugins — register a manifest through the Kernel (CC3).
app.post("/api/plugins", (req, res) => {
  const r = globalKernel.request({ turn_number: 0 }, "settings", "plugin.register", (req.body && req.body.manifest) || req.body);
  if (!r.approved) return res.status(422).json({ error: r.reason, rejected: (r.patch && r.patch.rejected) || [] });
  res.json({ ok: true, plugin: r.patch });
});
app.post("/api/plugins/:pid/toggle", (req, res) => {
  const p = plugins.setEnabled(req.params.pid, !!(req.body && req.body.enabled));
  if (!p) return res.status(404).json({ error: "plugin not found" });
  res.json({ ok: true, plugin: p });
});
app.delete("/api/plugins/:pid", (req, res) => res.json({ plugins: plugins.remove(req.params.pid) }));

// POST /api/campaign/:id/apply-plugin-bundle — apply a plugin's house-rules
// bundle to this campaign's House Rules (the one extension that lands in state).
app.post("/api/campaign/:id/apply-plugin-bundle", (req, res) => {
  const p = plugins.get((req.body && req.body.plugin_id) || "");
  if (!p) return res.status(404).json({ error: "plugin not found" });
  const bundles = (p.extends || []).filter((e) => e.type === "house_rules_bundle");
  if (!bundles.length) return res.status(400).json({ error: "이 플러그인에는 하우스 룰 묶음이 없습니다" });
  const state = campaignState.load(req.params.id);
  const added = bundles.flatMap((e) => String(e.value.rules_text || "").split(/\n+/).map((s) => s.trim()).filter(Boolean));
  state.house_rules = [...(state.house_rules || []), ...added].map((r) => String(r).slice(0, 500)).slice(0, 20);
  campaignState.save(state);
  res.json({ ok: true, house_rules: state.house_rules, added });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const mode = gemini.hasKey() ? `LIVE (${gemini.NARRATIVE_MODEL})` : "MOCK (no GEMINI_API_KEY)";
  console.log(`NarrativeOS MVP on http://localhost:${PORT}  —  ${mode}`);
});
