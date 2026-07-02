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
const wiki = require("./wiki/renderCanon");
const turnLog = require("./history/turnLog");
const personalStore = require("./personal/personalStore");
const highlights = require("./game/highlights");
const worldTemplates = require("./world/worldTemplates");
const letters = require("./comm/letters");

// Phase 8 D2 — content guardrail applied at Canon-registration time (before the
// Kernel), independent of the runtime prompt safety. Blocks a minor age being
// paired with a romance relationship type in the wizard's character data.
const MINOR_RE = /(미성년|아동|어린이|초등|중학생|중학교|소아|유아|10대\s*초반|１０대)/;
const ROMANCE_RE = /(로맨스|romance|연인|애인|사랑|연애|결혼|약혼)/i;
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
app.use(express.json({ limit: "10mb" })); // import bundles can be large
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
  });
});

// POST /api/state/:id/advanced-mode — toggle the Advanced panel (Part D).
app.post("/api/state/:id/advanced-mode", (req, res) => {
  const state = campaignState.load(req.params.id);
  state.settings = state.settings || {};
  state.settings.advanced_mode = !!req.body.enabled;
  campaignState.save(state);
  res.json({ ok: true, advanced_mode: state.settings.advanced_mode });
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
      "다음 TRPG 대화 기록을 3~5문장으로 요약해 '지난 이야기' 리캡을 작성하라. 순수 텍스트로만.",
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
    for (const k of ["choices_ui", "content_intensity", "recap_hours", "world_event_period", "response_length", "expected_campaign_length", "low_token_mode", "rpd_limit"]) {
      if (b.settings[k] !== undefined) state.settings[k] = b.settings[k];
    }
  }
  if (Array.isArray(b.house_rules)) {
    state.house_rules = b.house_rules.map((r) => String(r).slice(0, 500)).slice(0, 20);
  }
  // Phase 6 D — player-chosen display name / icon (never touches meta.world_name,
  // which stays whatever the wizard/AI generated).
  if (b.meta) {
    if (b.meta.display_name !== undefined) state.meta.display_name = String(b.meta.display_name || "").slice(0, 60) || null;
    if (b.meta.icon !== undefined) state.meta.icon = String(b.meta.icon || "📖").slice(0, 8);
  }
  campaignState.save(state);
  res.json({ ok: true, narrative_dna: state.narrative_dna, settings: state.settings, house_rules: state.house_rules, meta: state.meta });
});

// GET /api/usage/:id — usage/cost monitor (Wave 3).
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

// --- wizard (Phase 4 A2-A4, built now) --------------------------------------
app.post("/api/wizard/world", async (req, res) => {
  try {
    gemini.setCampaign("wizard");
    res.json(await wizardGen.generateWorld((req.body.text || "").slice(0, 2000)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/wizard/characters", async (req, res) => {
  try {
    gemini.setCampaign("wizard");
    res.json(await wizardGen.generateCharacters((req.body.text || "").slice(0, 2000), req.body.world || {}, req.body.npc_count || 3));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/wizard/create — A3 pipeline: confirmed wizard output → new
// campaign; every entity goes through kernel canon.register validation.
app.post("/api/wizard/create", (req, res) => {
  const b = req.body || {};
  const id = (b.campaign_id || "camp_" + Date.now().toString(36)).trim();
  if (!/^[\w-]+$/.test(id)) return res.status(400).json({ error: "valid campaign_id required" });
  if (fs.existsSync(campaignState.statePath(id))) return res.status(409).json({ error: "campaign already exists" });

  // Phase 8 D2 — structural content guardrail before any canon registration.
  const guardrail = contentGuardrail(b);
  if (guardrail.length) return res.status(422).json({ error: "content_guardrail", problems: guardrail });

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
  // Phase 10 M1 — register the genre-based starting stat (rate-limit exempt).
  require("./game/genreStatPresets").applyPreset(state);
  if (b.player) {
    state.player.name = b.player.birth_name || null;
    state.player.background = b.player.background || null;
    state.player.psychology = b.player.psychology || {};
    if (Array.isArray(b.player.core_values)) state.player.traits = b.player.core_values.slice(0, 5);
  }
  campaignState.save(state);
  const failed = results.filter((r) => !r.approved);
  res.json({ ok: true, campaign_id: id, registered: results.length - failed.length, failed });
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
app.post("/api/comm/:id/read", (req, res) => {
  const state = campaignState.load(req.params.id);
  for (const a of state.scheduled_actions || []) if (a.type === "npc_message") a.unread = false;
  campaignState.save(state);
  res.json({ ok: true });
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
  });
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
  });
});

// --- inventory tab (Wave 2) --------------------------------------------------
app.get("/api/inventory/:id", (req, res) => {
  const state = campaignState.load(req.params.id);
  res.json({ items: state.inventory || [] });
});

// DELETE /api/campaign/:id — launcher card delete.
app.delete("/api/campaign/:id", (req, res) => {
  const id = req.params.id;
  if (!fs.existsSync(campaignState.statePath(id))) return res.status(404).json({ error: "not found" });
  for (const suffix of ["_state", "_memory", "_canon", "_usage", "_undo", "_notes", "_turnlog"]) {
    const p = path.join(campaignState.DATA_DIR, `${id}${suffix}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  depsByCampaign.delete(id);
  res.json({ ok: true });
});

// GET /api/keys — Phase 8 D1. API key pool status (counts + exhaustion only —
// never the key values). POST reloads the pool from the environment.
app.get("/api/keys", (req, res) => res.json(gemini.keysStatus()));
app.post("/api/keys/reload", (req, res) => res.json({ ok: true, loaded: gemini.reloadKeys(), status: gemini.keysStatus() }));

// GET /api/status — runtime mode.
app.get("/api/status", (req, res) => {
  res.json({ mock: !gemini.hasKey(), narrative_model: gemini.NARRATIVE_MODEL, extract_model: gemini.EXTRACT_MODEL });
});

// GET /api/state/:id — full state (used to restore chat on load).
app.get("/api/state/:id", (req, res) => {
  res.json(campaignState.load(req.params.id));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const mode = gemini.hasKey() ? `LIVE (${gemini.NARRATIVE_MODEL})` : "MOCK (no GEMINI_API_KEY)";
  console.log(`NarrativeOS MVP on http://localhost:${PORT}  —  ${mode}`);
});
