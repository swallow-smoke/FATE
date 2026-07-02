// Turn orchestrator — wires the Kernel lifecycle (NarrativeKernel §4).
// MVP implements steps 3, 5, 8, 9, 10, 11, 12 (per the build instructions).
//
// Ordering note: §4 lists memory retrieval (step 3) before the Directors, using
// "the current Scene's participants/location". On a fresh turn the only real
// scene context is produced by the Scene Composer (step 8), so we compose the
// scene first and then retrieve memory against that fresh SceneSpec — strictly
// better relevance than reusing last turn's scene. Prompt assembly (step 9)
// still receives <memory_context> before the Gemini call, which is the point.

const { produceDirective, applyOutcome, catharsisReady } = require("./emotion/emotionEngine");
const promptBlocks = require("./gemini/promptBlocks");
const gemini = require("./gemini/geminiClient");
const { EXTRACTION_SYSTEM_PROMPT } = require("./gemini/systemPromptBase");
const worldSim = require("./world/worldSimulation");
const relationshipGraph = require("./relationship/relationshipGraph");
const livingNpc = require("./npc/livingNpc");
const themeDirector = require("./directors/themeDirector");
const rhythmDirector = require("./directors/rhythmDirector");
const resonanceEngine = require("./meta/resonanceEngine");
const selfReflection = require("./meta/selfReflection");
const campaignHealth = require("./meta/campaignHealth");
const dynamicQuest = require("./quest/dynamicQuest");
const legacyEngine = require("./legacy/legacyEngine");
const skillCheck = require("./game/skillCheck");
const endingSystem = require("./game/endingSystem");
const rumors = require("./world/rumors");
const factionReputation = require("./world/factionReputation");
const inventory = require("./inventory/inventory");
const undo = require("./undo/undo");
const turnLog = require("./history/turnLog");
const phase7plus = require("./meta/phase7plus");
const npcBrain = require("./npc/npcBrain");
const consequenceChains = require("./story/consequenceChains");
const mystery = require("./mystery/mystery");
const npcLifecycle = require("./canon/npcLifecycle");
const letters = require("./comm/letters");
const npcSocial = require("./npc/npcSocial");

const APPEARANCE_WINDOW = 10; // "recently appeared" = within the last N turns

// Minimal Story Director (Phase 2 step 1). NOT the full spec (no Act structure
// / foreshadow planting) — it only makes location-present NPCs enter scenes and
// surfaces a near-deadline foreshadow. urgency is fixed "medium" for now.
function proposeStoryDirective(state, canonDb) {
  const chars = canonDb.all().filter((e) => e.type === "Character");

  // 1. Establish the current location, bootstrapping from an NPC's location on
  //    turn 1 (current_scene is null until the first scene is composed).
  let location = state.current_scene && state.current_scene.location;
  if (!location) {
    const anyChar = chars.find((c) => c.data && c.data.current_location);
    location = anyChar ? anyChar.data.current_location : null;
  }

  // 2. Characters present at this location, de-prioritizing those who appeared
  //    within the last N turns (so NPCs rotate in).
  const recentlyAppeared = new Set(
    (state.scene_history || []).slice(-APPEARANCE_WINDOW).flatMap((h) => h.participants || [])
  );
  const here = chars
    .filter((c) => c.data && c.data.current_location === location)
    .sort((a, b) => (recentlyAppeared.has(a.canon_id) ? 1 : 0) - (recentlyAppeared.has(b.canon_id) ? 1 : 0));
  const selectedNpcs = here.slice(0, 2).map((c) => c.canon_id);

  // 3. Near-deadline foreshadow (active foreshadow_pool).
  const dueForeshadow = (state.foreshadow_pool || []).find(
    (f) => !f.resolved && f.deadline_turn - state.turn_number <= 10
  );
  const foreshadow_refs = dueForeshadow
    ? [dueForeshadow.id, ...(dueForeshadow.canon_refs || [])]
    : [];

  // World entity for the region enriches <canon_context> (not a participant).
  const worldRefs = location
    ? canonDb
        .all()
        .filter((e) => e.type === "World" && ((e.data && e.data.region) === location || e.canon_id === location))
        .map((e) => e.canon_id)
    : [];

  // Wave 1 §1 — weave an ongoing world event into the scene, if any.
  const ongoing = worldSim.ongoingEvents(state);
  const activeEvent = ongoing.length ? ongoing[ongoing.length - 1] : null;
  const eventRefs = activeEvent
    ? [...activeEvent.affected_factions, ...activeEvent.affected_regions].filter((r) => canonDb.get(r))
    : [];

  // Wave 4 §14 — surface an open quest hint (soft; not forced).
  const quest = dynamicQuest.activeHint(state);
  const questRefs = quest && canonDb.get(quest.quest_id) ? [quest.quest_id] : [];

  // Phase 6 E — "사건 필요해" 버튼: player-forced urgency, consumed once.
  let urgency = activeEvent && (activeEvent.category === "conflict" || activeEvent.category === "politics") ? "high" : "medium";
  if (state.forced_beat) { urgency = "forced_high"; state.forced_beat = null; }

  const involved_canon_refs = [...new Set([...selectedNpcs, ...worldRefs, ...foreshadow_refs, ...eventRefs, ...questRefs])];

  // Phase 7 A1 — NPCBrain proposes proactive beats for NPCs present in-scene.
  // Candidates only; Scene Composer/Kernel still decide adoption.
  const npc_candidates = npcBrain.proposeCandidates(state, canonDb, selectedNpcs);

  return {
    quest_hint: quest ? quest.hint : null,
    npc_candidates,
    proposed_beat: dueForeshadow
      ? "심어둔 복선이 표면으로 떠오른다"
      : activeEvent
      ? `세계의 사건이 배경에 스며든다: ${activeEvent.summary}`
      : selectedNpcs.length
      ? "이 장소의 인물이 장면에 관여한다"
      : "장면이 자연스럽게 이어진다",
    participants: selectedNpcs, // Character canon_ids only
    foreshadow_refs,
    involved_canon_refs, // characters + world + foreshadow + event refs
    world_event: activeEvent ? { id: activeEvent.world_event_id, summary: activeEvent.summary, category: activeEvent.category } : null,
    urgency,
    location,
    _due_foreshadow_id: dueForeshadow ? dueForeshadow.id : null,
  };
}

// Wave 1 world tick — runs each turn end. Generates periodic world events,
// auto-resolves expired ones, propagates NPC-NPC relationship effects, and
// advances offscreen NPC goals (Living NPC).
function worldTick(deps, state, trace) {
  const { canonDb, memoryEngine, kernel } = deps;
  const lowToken = !!(state.settings && state.settings.low_token_mode); // Phase 12 U3
  const generated = worldSim.maybeGenerateEvent(state, canonDb);
  const relChanges = generated ? relationshipGraph.applyWorldEvent(state, generated, canonDb) : [];
  // Wave 4 §14 — a conflict/politics event may spawn a Dynamic Quest.
  const quest = generated ? dynamicQuest.maybeCreate(state, generated, canonDb, kernel) : null;
  const resolved = worldSim.resolveExpiredEvents(state, memoryEngine, kernel);
  const npcChanges = livingNpc.progress(state, canonDb, memoryEngine, kernel);
  // Phase 11 Q — NPC-NPC edges drift in the background (every SOCIAL_PERIOD).
  const social = npcSocial.backgroundInteract(state, canonDb, memoryEngine, kernel, { lowToken });
  trace.npc_social = social;
  // Phase 5 Wave 2 — rumors: spawn from this turn's event, propagate, and mark
  // heard when the player's location is inside a rumor's spread.
  const spawnedRumor = generated ? rumors.maybeSpawnFromEvent(state, generated, canonDb, kernel) : null;
  const rumorSpread = rumors.tickSpread(state, canonDb);
  const heard = rumors.markHeard(state, canonDb, state.current_scene && state.current_scene.location);
  // Phase 5 Wave 2 — faction reputation reacts to this turn's flags.
  const repChanges = factionReputation.applyFlagEffects(state, canonDb);
  trace.world = {
    generated_event: generated ? generated.world_event_id : null,
    spawned_quest: quest ? quest.quest_id : null,
    spawned_rumor: spawnedRumor ? spawnedRumor.canon_id : null,
    rumor_spread: rumorSpread,
    rumors_heard: heard,
    reputation_changes: repChanges.map((r) => ({ faction: r.faction_id, label: r.label })),
    relationship_changes: relChanges,
    resolved_events: resolved.map((e) => e.world_event_id),
    living_npc_changes: npcChanges,
  };
}

// Phase 11 R — choose at most one sentimental item to echo this turn (15-turn
// cooldown per item), returning { item_name, memory_summary } or null.
const ITEM_ECHO_COOLDOWN = 15;
function pickSentimentalEcho(state, memoryEngine) {
  const items = (state.inventory || []).filter((it) => (it.tags || []).includes("sentimental"));
  if (!items.length) return null;
  state.item_echo_log = state.item_echo_log || {};
  const turn = state.turn_number;
  for (const it of items) {
    const last = state.item_echo_log[it.name];
    if (last != null && turn - last < ITEM_ECHO_COOLDOWN) continue;
    let memory_summary = null;
    const ref = it.acquired_context_memory_ref;
    if (ref && memoryEngine.all) {
      const m = memoryEngine.all().find((x) => x.id === ref);
      if (m) memory_summary = m.summary;
    }
    state.item_echo_log[it.name] = turn;
    return { item_name: it.name, memory_summary: memory_summary || `${it.acquired_turn}턴에 얻은 물건` };
  }
  return null;
}

async function runTurn(deps, state, playerInput, options = {}) {
  const { kernel, canonDb, memoryEngine } = deps;
  const trace = {};
  const lowToken = !!(state.settings && state.settings.low_token_mode); // Phase 12 U3

  // Phase 5 Wave 1 — Undo: snapshot the on-disk stores BEFORE any mutation.
  undo.snapshot(state.campaign_id);
  gemini.setCampaign(state.campaign_id); // usage accounting context

  // Phase 5 Wave 1 — time skip: advance the in-world calendar before the scene.
  const prevDay = state.in_world_day || 1; // Phase 10 J2 — detect day rollover
  if (options.time_skip && options.time_skip.amount > 0) {
    const mult = { 시간: 0, 일: 1, 주: 7, 년: 365 }[options.time_skip.unit] ?? 1;
    state.in_world_day = (state.in_world_day || 1) + Math.round(options.time_skip.amount * mult);
    state.in_world_date = `${state.in_world_day}일차`;
  }

  // Phase 4 B1 — dice/skill check for genuinely uncertain player actions.
  // Phase 6 A — `/판정` forces one even without a trigger keyword.
  const check = skillCheck.maybeCheck(state, playerInput, options.force_check);
  state.last_check = check;
  trace.skill_check = check;

  // Phase 8 C2 — detect death/retirement triggers, but NEVER auto-confirm them.
  // A generation turnover is expensive to undo (mass Memory/Canon changes), so
  // we stage a pending transition and let the player confirm via a dialog.
  const LEGACY_FLAGS = ["player_died", "player_retired"];
  let pendingTransition = state.pending_legacy_transition || null;
  if (!pendingTransition && /(은퇴하겠|은퇴한다|여정을 끝내|모든 걸 내려놓|스스로 목숨|여기서 죽)/.test(playerInput)) {
    pendingTransition = { reason: "explicit", trigger_flag: /은퇴/.test(playerInput) ? "player_retired" : "player_died", staged_turn: state.turn_number };
  }
  if (!pendingTransition && check && check.life_or_death && check.outcome === "fail") {
    pendingTransition = { reason: "fatal_check", trigger_flag: "player_died", staged_turn: state.turn_number };
  }

  // Phase 6 C — play stats: first-played timestamp, running turn count, and
  // playtime accrued as wall-clock deltas between consecutive turns (a gap
  // bigger than a session boundary doesn't count as active playtime).
  state.play_stats = state.play_stats || { total_turns: 0, first_played_at: null, total_playtime_seconds: 0, session_started_at: null };
  const ps = state.play_stats;
  if (!ps.first_played_at) ps.first_played_at = new Date().toISOString();
  ps.total_turns += 1;
  const now = Date.now();
  const gapMs = ps.last_turn_at ? now - new Date(ps.last_turn_at).getTime() : Infinity;
  if (gapMs < turnLog.SESSION_GAP_MINUTES * 60000) ps.total_playtime_seconds += Math.round(gapMs / 1000);
  ps.last_turn_at = new Date(now).toISOString();

  // --- Step 5: Directors submit via Kernel.request() ---------------------
  const emotionDirective = produceDirective(state.player.emotion_state, state.turn_number);
  // Wave 3 §10 — apply the PREVIOUS turn's self-reflection to nudge this turn.
  const reflect = state.self_reflection;
  if (reflect && reflect.emotion_skew && !emotionDirective.directive.avoid.includes(reflect.emotion_skew)) {
    emotionDirective.directive.avoid.push(reflect.emotion_skew);
  }
  const edResp = kernel.request(state, "emotion_director", "emotion.directive", emotionDirective);

  // Phase 9 E5 — resolve due scheduled actions (letters) at turn start; feed
  // delivered-letter responses into the story as NPC action candidates.
  const letterResult = letters.deliverDue(state, canonDb, kernel);
  trace.letters = { delivered: letterResult.delivered.map((a) => a.action_id), intercepted: letterResult.intercepted.map((a) => a.action_id) };

  // Phase 11 P — NPCs may reach out first (forced on a time skip, else on the
  // background cadence). Delivered as unread messages; ignoring raises distance.
  const proactive = npcSocial.proactiveContact(state, canonDb, { force: !!(options.time_skip && options.time_skip.amount > 0), lowToken });
  trace.npc_proactive = { messages: proactive.messages.map((m) => m.action_id), distance_drift: proactive.distance_drift };

  const storyDirective = proposeStoryDirective(state, canonDb);
  storyDirective.npc_candidates = [...(storyDirective.npc_candidates || []), ...letterResult.directive_candidates];
  // Catharsis gate (EmotionEngine §6): accumulation + recoverable foreshadow.
  storyDirective.catharsis_ready = catharsisReady(
    state.player.emotion_state,
    storyDirective.foreshadow_refs.length > 0
  );
  const sbResp = kernel.request(state, "story_director", "story.beat", storyDirective);

  // Wave 2 — Rhythm + Theme Directors fill their (previously empty) input slots.
  const rhythmDirective = rhythmDirector.run(state);
  const themeDirective = themeDirector.run(state);

  trace.emotion_directive = emotionDirective;
  trace.story_directive = storyDirective;
  trace.rhythm_directive = rhythmDirective;
  trace.theme_directive = themeDirective;
  trace.director_responses = { emotion: edResp.reason, story: sbResp.reason };

  // --- Step 8: Scene Composer (scene.request) ----------------------------
  const sceneResp = kernel.request(state, "scene_composer", "scene.request", {
    emotion_directive: emotionDirective,
    story_directive: storyDirective,
    rhythm_directive: rhythmDirective,
    theme_directive: themeDirective,
  });
  const sceneSpec = sceneResp.patch;
  if (check) sceneSpec.check_result = skillCheck.directiveLine(check);

  // Phase 7 — enrich the scene directive with the slow-moving context layers.
  phase7plus.ensure(state);
  sceneSpec.weather_line = phase7plus.weatherLine(state);
  sceneSpec.tech_level = state.world && state.world.tech_level; // E1
  sceneSpec.hidden_directives = phase7plus.hiddenVariableDirective(state);
  sceneSpec.difficulty_hint = (state.difficulty_director && state.difficulty_director.hint) || null;
  sceneSpec.planner_hint = (state.campaign_planner && state.campaign_planner.hint) || null;
  sceneSpec.npc_candidates = storyDirective.npc_candidates || [];
  // A4 — a Discovery scene surfaces the next hidden clue.
  sceneSpec.mystery_hint = (sceneSpec.scene_type || []).includes("discovery") ? mystery.discoveryHint(state) : null;
  // Phase 11 R — sentimental item echo: if the player carries a "sentimental"
  // item not echoed recently (15-turn cooldown), weave its acquisition memory
  // back in (Emotional Echo via an item). Not every turn — echoes go dull.
  sceneSpec.sentimental_echo = pickSentimentalEcho(state, memoryEngine);
  // Phase 4 B2 — ending gate: Act 3 + catharsis + no overdue foreshadow.
  const endingCheck = endingSystem.checkConditions(state);
  let endingBranch = null;
  if (endingCheck.ready) {
    endingBranch = endingSystem.pickBranch(state);
    sceneSpec.scene_type = [...new Set([...(sceneSpec.scene_type || []), "ending"])];
    sceneSpec.ending_directive = endingSystem.endingDirective(endingBranch);
  }
  trace.ending_check = endingCheck;
  trace.scene_spec = sceneSpec;
  trace.debate = sceneSpec._debate;

  // --- Step 3: Memory retrieval (against the fresh SceneSpec) -------------
  const retrieved = memoryEngine.retrieve(sceneSpec, state.turn_number);
  trace.retrieved_memories = retrieved.map((m) => ({
    id: m.id,
    tier: m.tier,
    summary: m.summary,
    emotion_tags: m.emotion_tags || [],
  }));

  // Canon filter (CanonDatabase §7): entities for scene participants + refs.
  const canonRefs = [...(sceneSpec.participants || []), ...(sceneSpec.canon_refs || [])];
  const canonUsed = canonDb.relevantTo(canonRefs);
  trace.canon_used = canonUsed.map((e) => e.canon_id);

  // --- Step 9: Assemble the full system prompt (4 blocks + recent) -------
  const systemPrompt = promptBlocks.assembleSystemPrompt({
    canon: canonUsed,
    memory: retrieved,
    emotion: emotionDirective,
    scene: sceneSpec,
    recent: state.recent_dialogue,
    houseRules: state.house_rules,
    contentIntensity: state.settings && state.settings.content_intensity,
    responseLength: state.settings && state.settings.response_length,
  });
  trace.system_prompt = systemPrompt;

  // --- Step 10: Gemini narrative call ------------------------------------
  const narrative = await gemini.generateNarrative(systemPrompt, playerInput);

  // --- Step 11: Post-process extraction -> Memory/Canon/Flag -------------
  const extraction = await gemini.extractFacts(EXTRACTION_SYSTEM_PROMPT, narrative);
  trace.extraction = extraction;

  const applied = { memories: [], canon: [], flags: [] };
  const writtenMemories = []; // full objects, for consequence-chain linking

  for (const nm of extraction.new_memories || []) {
    // Attach scene context; keep only canon_refs that are actually registered
    // (an unregistered ref would be rejected by the Kernel, MemoryEngine §9).
    const refs = (canonRefs || []).filter((r) => canonDb.get(r));
    const r = kernel.request(state, "memory_engine", "memory.write", {
      summary: nm.summary,
      participants: nm.participants && nm.participants.length ? nm.participants : sceneSpec.participants,
      emotion_tags: nm.emotion_tags,
      emotion_intensity: nm.emotion_intensity,
      location: sceneSpec.location,
      canon_refs: refs,
    });
    applied.memories.push({ ok: r.approved, reason: r.reason, id: r.patch && r.patch.id });
    if (r.approved && r.patch) writtenMemories.push(r.patch);
  }

  for (const cu of extraction.canon_updates || []) {
    const r = kernel.request(state, "story_director", "canon.update", cu);
    applied.canon.push({ ok: r.approved, reason: r.reason, canon_id: cu.canon_id });
    // Phase 8 C1 — an NPC transitioning to "dead" triggers lifecycle handling.
    if (r.approved && cu.field === "current_status" && cu.new_value === "dead") {
      const death = npcLifecycle.handleDeath({ canonDb, memoryEngine, kernel }, state, cu.canon_id);
      applied.canon[applied.canon.length - 1].death = death;
      trace.npc_death = death;
    }
  }

  for (const fc of extraction.flag_changes || []) {
    // C2 — narrative death/retirement is staged for confirmation, not applied.
    if (LEGACY_FLAGS.includes(fc.flag_id) && fc.value === true) {
      pendingTransition = pendingTransition || { reason: "narrative", trigger_flag: fc.flag_id, staged_turn: state.turn_number };
      applied.flags.push({ ok: false, reason: "C2: staged for player confirmation", flag_id: fc.flag_id });
      continue;
    }
    const r = kernel.request(state, "story_director", "flag.set", fc);
    applied.flags.push({ ok: r.approved, reason: r.reason, flag_id: fc.flag_id });
    // Phase 7 A2 — a newly-true flag opens a Consequence chain, seeded with the
    // scene's canon refs so later events can link back to it.
    if (r.approved && fc.value === true) {
      consequenceChains.openChain(state, fc.flag_id, state.turn_number, [...(sceneSpec.participants || []), ...(sceneSpec.canon_refs || [])]);
    }
  }

  // Phase 5 Wave 2 — inventory: apply item gains/uses detected by extraction.
  const memRefs = applied.memories.filter((m) => m.ok && m.id).map((m) => m.id);
  applied.items = inventory.applyExtraction(state, canonDb, kernel, extraction, memRefs);

  // Phase 5 Wave 2 — identity milestone when the reflection/extraction call
  // detects a genuine identity shift (Identity Engine, lightweight).
  if (extraction.identity_shift && extraction.identity_shift.to_trait) {
    state.player.identity_milestones.push({
      turn: state.turn_number,
      from_trait: extraction.identity_shift.from_trait || null,
      to_trait: extraction.identity_shift.to_trait,
      trigger_summary: extraction.identity_shift.trigger_summary || "",
    });
    if (!state.player.traits.includes(extraction.identity_shift.to_trait)) {
      state.player.traits.push(extraction.identity_shift.to_trait);
    }
  }

  // Phase 9 F2 — a life-changing event may spawn/grow a dynamic trait. If the
  // trait already exists, nudge it (throttled by the Kernel); else create it
  // (rate-limited by the Kernel). Failures are silent by design (F3 rule 4).
  const traitCand = extraction.new_dynamic_trait_candidate;
  if (traitCand && traitCand.name) {
    const existing = (state.player.dynamic_traits || []).find((t) => t.name === traitCand.name);
    if (existing) {
      const r = kernel.request(state, "story_director", "trait.update", { name: traitCand.name, value: Math.min(1, (existing.value || 0) + 0.1), trend: "growing", player_facing_description: traitCand.player_facing_description });
      trace.trait_update = r.approved ? r.patch : { skipped: r.reason };
    } else {
      const r = kernel.request(state, "story_director", "trait.create", { name: traitCand.name, category: traitCand.category, origin_summary: traitCand.origin_summary, player_facing_description: traitCand.player_facing_description, canon_refs: canonRefs, visible_to_player: true });
      if (r.approved) { state.new_trait_notice = { name: traitCand.name, turn: state.turn_number + 1 }; trace.new_trait = r.patch; }
      else trace.new_trait = { skipped: r.reason };
    }
  }

  // Phase 5 Wave 2 — wiki gating: everything that actually appeared in this
  // scene is now discovered.
  canonDb.markDiscovered([...(sceneSpec.participants || []), ...trace.canon_used], state.turn_number);
  trace.applied = applied;

  // Update player emotion wave with what the scene realized (drives fatigue).
  applyOutcome(
    state.player.emotion_state,
    { primary_emotion: sceneSpec.primary_emotion, intensity: sceneSpec.intensity },
    state.turn_number
  );

  // --- Step 12: Commit CampaignState patch and save ----------------------
  // Resolve the surfaced foreshadow once a Catharsis actually fires so it does
  // not keep re-triggering.
  if (sceneSpec.scene_type.includes("catharsis") && storyDirective._due_foreshadow_id) {
    const fs = (state.foreshadow_pool || []).find((f) => f.id === storyDirective._due_foreshadow_id);
    if (fs) fs.resolved = true;
  }

  state.current_scene = sceneSpec;
  state.scene_history = [
    ...(state.scene_history || []),
    { turn: state.turn_number, scene_type: sceneSpec.scene_type, intensity: sceneSpec.intensity, mood: sceneSpec.mood, participants: sceneSpec.participants },
  ].slice(-10);
  state.recent_dialogue = [
    ...(state.recent_dialogue || []),
    { turn: state.turn_number, in_world_date: state.in_world_date, player: playerInput, gm: narrative },
  ].slice(-3);

  // Phase 6 B — full transcript log (search/filter/bookmarks/session
  // boundaries need more than the 3-turn recent_dialogue window keeps).
  // NOTE: recorded under the POST-increment (displayed) turn number — the
  // same number shown in the UI and used by bookmarks — unlike
  // recent_dialogue's turn field, which is pre-increment and gets +1'd at
  // render time (see public/js/main.js). Keeping this one post-increment
  // avoids an off-by-one between what the player bookmarks and what's stored.
  const turnIntensity = Math.max(sceneSpec.intensity || 0, ...(extraction.new_memories || []).map((m) => m.emotion_intensity || 0));
  turnLog.append(state.campaign_id, {
    turn: state.turn_number + 1, in_world_date: state.in_world_date, player: playerInput, gm: narrative,
    primary_emotion: sceneSpec.primary_emotion, participants: sceneSpec.participants, emotion_intensity: turnIntensity,
  });

  // Wave 1/4 — world simulation / relationship / living-NPC / quest tick.
  worldTick({ canonDb, memoryEngine, kernel }, state, trace);

  // Phase 7 — slow-context tick: hidden variables, difficulty director, story
  // stage / planner, weather, scheduled actions. Runs after the world tick so
  // this turn's scene + extraction + check are all available.
  const activeEvent = (worldSim.ongoingEvents(state).slice(-1) || [])[0] || null;
  const p7 = phase7plus.tick(state, { sceneSpec, extraction, check, integrityWarning: null });
  trace.phase7 = p7;
  // A2 — link this turn's memories / world event into any open consequence chain.
  trace.consequence_links = consequenceChains.linkTurnEvents(state, { memories: writtenMemories, worldEvent: activeEvent });
  // A4 — a Discovery scene reveals the next mystery clue.
  trace.mystery_reveal = mystery.revealOnDiscovery(state, sceneSpec);
  // A1 — start the cooldown for NPCs whose proactive beat was on the table.
  npcBrain.markActed(state, (storyDirective.npc_candidates || []).map((c) => c.npc_ref));
  // Phase 8 A2 — archive long-dormant, low-bond NPCs every 100 turns.
  if (state.turn_number > 0 && state.turn_number % 100 === 0) {
    trace.archived_npcs = npcLifecycle.archiveStale(state, canonDb);
  }

  // Wave 4 §13 — Legacy Engine: advance a generation if death/retirement flag
  // was set this turn (flags applied above in step 11).
  const legacyEvent = legacyEngine.checkAndAdvance(state, canonDb, memoryEngine, kernel);
  trace.legacy_event = legacyEvent;

  // Wave 3 — engagement log feeds the Resonance Engine (§9).
  const turnTags = [...new Set([sceneSpec.primary_emotion, ...(extraction.new_memories || []).flatMap((m) => m.emotion_tags || [])])].filter(Boolean);
  state.engagement_log = [...(state.engagement_log || []), { turn: state.turn_number, player_len: playerInput.length, tags: turnTags }].slice(-60);
  trace.resonance = resonanceEngine.recompute(state); // null unless on period

  // Wave 3 — AI self-reflection (fed to next turn) + Campaign Health cache.
  // U3 — low-token: skip the optional reflection LLM call entirely.
  state.self_reflection = lowToken ? null : await selfReflection.reflect(state, gemini);
  trace.self_reflection = state.self_reflection;
  trace.campaign_health = campaignHealth.get(state, canonDb, memoryEngine).metrics;

  const integrity = kernel.verifyIntegrity(state);
  if (!integrity.ok) {
    // MVP: report but do not roll back (auto-rollback is post-MVP).
    trace.integrity_warning = integrity.missing;
  }

  // Phase 4 B2 — commit the ending if this turn's scene was the ending scene.
  let endingSummary = null;
  if (endingBranch) {
    state.ending = { reached: true, ending_id: endingBranch.id, label: endingBranch.label, summary: null };
    endingSummary = endingSystem.buildSummary(state, trace.campaign_health);
    state.ending.summary = endingSummary;
    state.campaign_status = "completed"; // Phase 8 A3 — launcher archive section
  }

  // Phase 10 M3 — age out faded traits: value 0 + trend "fading" for 20+ turns
  // → delete (leaving a Historical note). Track when the fade began.
  for (const t of state.player.dynamic_traits || []) {
    if ((t.value || 0) <= 0 && t.trend === "fading") t.fading_since_turn = t.fading_since_turn || state.turn_number;
    else t.fading_since_turn = null;
  }
  for (const t of [...(state.player.dynamic_traits || [])]) {
    if (t.fading_since_turn && state.turn_number - t.fading_since_turn >= 20) {
      kernel.request(state, "story_director", "trait.delete", { trait_id: t.trait_id });
    }
  }

  // Phase 10 J2 — "그날의 정리": when in-world day rolls over, summarize the day
  // just left (rule-based fallback keeps this working offline/mock).
  let dailySummary = null;
  if ((state.in_world_day || 1) > prevDay) {
    const dayMems = memoryEngine.all().filter((m) => m.tier >= 2).slice(-5).map((m) => m.summary);
    let text = null;
    // U3 — low-token: no LLM digest; the UI shows only a day divider.
    try {
      if (!lowToken && gemini.hasKey() && dayMems.length) text = await gemini.summarize("다음은 하루 동안 있었던 일이다. 3~4문장으로 '그날의 정리'를 서술하라. 순수 텍스트로만.", dayMems.join("\n"), "daily_digest");
    } catch (_) {}
    if (!text && !lowToken) text = dayMems.length ? dayMems.slice(-3).join(" ") : `${prevDay}일차가 조용히 지나갔다.`;
    dailySummary = { day: prevDay, summary: text || "", low_token: lowToken, created_turn: state.turn_number };
    state.daily_summaries = [...(state.daily_summaries || []), dailySummary].slice(-30);
  }

  // C2 — persist any staged transition so the confirm endpoint can act on it.
  state.pending_legacy_transition = pendingTransition || null;

  state.turn_number += 1;
  require("./state/campaignState").save(state);

  return {
    narrative, trace, turn: state.turn_number, legacy_event: legacyEvent,
    check: check ? { skill: check.skill, outcome: check.outcome, crafting: check.crafting } : null,
    ending: endingSummary,
    pending_transition: pendingTransition || null, // Phase 8 C2
    daily_summary: dailySummary, // Phase 10 J2
  };
}

module.exports = { runTurn, proposeStoryDirective };
