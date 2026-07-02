// Phase 3 Wave 1 playtest — World Sim / NPC Psychology / Relationship Graph /
// Living NPC. MOCK mode, short periods so events actually fire in a few turns.
require("dotenv").config();
delete process.env.GEMINI_API_KEY;

const campaignState = require("../src/state/campaignState");
const { createCanonDatabase } = require("../src/canon/canonDatabase");
const { createMemoryEngine } = require("../src/memory/memoryEngine");
const { createKernel } = require("../src/kernel/kernel");
const { runTurn } = require("../src/turn");

(async () => {
  const id = "wave1_test";
  const fs = require("fs"), path = require("path");
  for (const s of ["_state", "_memory", "_canon"]) {
    const p = path.join(campaignState.DATA_DIR, `${id}${s}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const canonDb = createCanonDatabase(id);
  const memoryEngine = createMemoryEngine(id);
  const kernel = createKernel({ canonDb, memoryEngine });
  const deps = { canonDb, memoryEngine, kernel };

  let state = campaignState.load(id);
  // short periods for testing
  state.settings = { world_event_period: 3, world_event_ttl: 3, living_npc_period: 6, resonance_period: 30 };
  // seed two NPCs at a location, with psychology + goals + faction
  kernel.request(state, "admin", "canon.register", { canon_id: "char_ria", type: "Character", data: { birth_name: "리아", species: "human", core_values: ["loyalty"], current_location: "old_town", current_status: "alive", affiliations: ["faction_dockworkers"], psychology: { attachment_style: "avoidant", core_fear: "버림받는 것", defense_mechanism: "회피" }, goal_current: "조합 신뢰 회복" } });
  kernel.request(state, "admin", "canon.register", { canon_id: "char_kael", type: "Character", data: { birth_name: "카엘", species: "human", core_values: ["family"], current_location: "old_town", current_status: "alive", affiliations: ["faction_dockworkers"], psychology: { attachment_style: "anxious" }, goal_current: "리아를 지키기" } });
  kernel.request(state, "admin", "canon.register", { canon_id: "faction_dockworkers", type: "Faction", data: { founding_principle: "mutual_aid", stance: "neutral" } });
  kernel.request(state, "admin", "canon.register", { canon_id: "loc_bridge", type: "World", data: { region: "old_town", terrain: "bridge" } });
  kernel.request(state, "admin", "relationship.update", { from: "char_ria", to: "char_kael", trust: 0.6, affection: 0.7, type: "family" });
  campaignState.save(state);

  for (let i = 0; i < 9; i++) {
    state = campaignState.load(id);
    const r = await runTurn(deps, state, `행동 ${i}`);
    const w = r.trace.world;
    console.log(`turn ${r.turn - 1}->${r.turn} | npcs=[${r.trace.scene_spec.participants.filter((p) => p !== "player")}] | gen=${w.generated_event || "-"} resolved=[${w.resolved_events}] rel±=${w.relationship_changes.length} living=${w.living_npc_changes.length}`);
  }

  const f = campaignState.load(id);
  console.log("\n--- final ---");
  console.log("active_events:", f.world.active_events.map((e) => `${e.world_event_id}:${e.category}:${e.status}`).join(" | "));
  console.log("rel edges:", f.relationship_graph.edges.map((e) => `${e.from}->${e.to} trust=${e.trust.toFixed(2)} (${e.type})`).join(" | "));
  const ria = canonDb.get("char_ria");
  console.log("ria current_status:", ria.data.current_status);
  console.log("ria goal_progressed:", ria.data.goal_progressed_turn || "no");
  console.log("historical memories:", memoryEngine.all().filter((m) => m.tier >= 3).length);
  console.log("psychology in canon_context:", require("../src/gemini/promptBlocks").buildCanonContext([ria]).includes("방어기제") || require("../src/gemini/promptBlocks").buildCanonContext([ria]).includes("애착유형"));
})();
