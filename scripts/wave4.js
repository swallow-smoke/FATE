// Phase 3 Wave 4 playtest — Dynamic Quest / Legacy Engine / Inner Conflict.
require("dotenv").config();
delete process.env.GEMINI_API_KEY;

const campaignState = require("../src/state/campaignState");
const { createCanonDatabase } = require("../src/canon/canonDatabase");
const { createMemoryEngine } = require("../src/memory/memoryEngine");
const { createKernel } = require("../src/kernel/kernel");
const { runTurn } = require("../src/turn");
const sceneComposer = require("../src/scene/sceneComposer");

(async () => {
  // --- unit: inner_voice_hint on a charged conflict scene ----------------
  const spec = sceneComposer.compose({
    emotion_directive: { directive: { primary_emotion: "anger", intensity_target: 4, scene_type_hint: ["conflict"], avoid: [], must_include: [], recovery_scene: false } },
    story_directive: { urgency: "high", involved_canon_refs: [], participants: [] },
    rhythm_directive: { avoid_scene_types: [], intensity_spike: null },
    theme_directive: { active_theme: "권력" }, sceneHistory: [], turn: 5,
  });
  console.log("inner_voice_hint on conflict i>=3:", !!spec.inner_voice_hint, "| scene:", spec.scene_type, "i=" + spec.intensity);

  // --- integration -------------------------------------------------------
  const id = "wave4_test";
  const fs = require("fs"), path = require("path");
  for (const s of ["_state", "_memory", "_canon"]) { const p = path.join(campaignState.DATA_DIR, `${id}${s}.json`); if (fs.existsSync(p)) fs.unlinkSync(p); }
  const canonDb = createCanonDatabase(id), memoryEngine = createMemoryEngine(id), kernel = createKernel({ canonDb, memoryEngine });
  const deps = { canonDb, memoryEngine, kernel };
  let state = campaignState.load(id);
  // short period + conflict-leaning DNA so a quest-spawning event fires soon
  state.settings = { world_event_period: 3, world_event_ttl: 40, living_npc_period: 100, resonance_period: 30 };
  state.narrative_dna = { politics: 6, survival: 1, horror: 1, mystery: 2, emotion: 2, romance: 1, exploration: 2, tone: 2 };
  kernel.request(state, "admin", "canon.register", { canon_id: "char_ria", type: "Character", data: { birth_name: "리아", species: "human", core_values: ["loyalty"], current_location: "old_town", current_status: "alive", affiliations: ["faction_lords"] } });
  kernel.request(state, "admin", "canon.register", { canon_id: "char_kael", type: "Character", data: { birth_name: "카엘", species: "human", core_values: ["family"], current_location: "old_town", current_status: "alive", affiliations: ["faction_lords"] } });
  kernel.request(state, "admin", "canon.register", { canon_id: "faction_lords", type: "Faction", data: { founding_principle: "honor", stance: "rival" } });
  kernel.request(state, "admin", "relationship.update", { from: "char_ria", to: "char_kael", trust: 0.6, affection: 0.7, type: "family" });
  campaignState.save(state);

  for (let i = 0; i < 7; i++) {
    state = campaignState.load(id);
    const r = await runTurn(deps, state, `행동 ${i}`);
    const w = r.trace.world;
    console.log(`turn ${r.turn - 1}->${r.turn} | event=${w.generated_event || "-"} quest=${w.spawned_quest || "-"} | story.quest_hint=${r.trace.story_directive.quest_hint || "-"}`);
  }

  // --- Legacy trigger: set player_died, then run one more turn -----------
  state = campaignState.load(id);
  kernel.request(state, "admin", "flag.set", { flag_id: "player_died", value: true });
  campaignState.save(state);
  state = campaignState.load(id);
  const rl = await runTurn(deps, state, "쓰러진다");
  console.log("\nlegacy_event:", JSON.stringify(rl.legacy_event));

  const f = campaignState.load(id);
  console.log("\n--- final ---");
  console.log("quests:", (f.quests || []).map((q) => `${q.quest_id}(${q.status})`).join(", ") || "none");
  console.log("Quest canon entities:", canonDb.all().filter((e) => e.type === "Quest").map((e) => e.canon_id).join(", ") || "none");
  console.log("generation:", f.player.generation, "| legacy_traits:", JSON.stringify(f.player.legacy.legacy_traits));
  console.log("predecessor_ref:", f.player.legacy.predecessor_ref, "| cultural memory:", f.player.legacy.world_memory_of_predecessor);
  console.log("cultural-tier memories:", memoryEngine.all().filter((m) => m.tier >= 4).length);
})();
