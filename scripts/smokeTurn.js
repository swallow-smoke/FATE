// Smoke test — runs the full turn loop in MOCK mode, no server, no API key.
// Verifies Phase 2: (0) JSON stripping, (1) NPC auto-appearance, (2) scene
// variety + Catharsis gating. Run: npm run smoke
require("dotenv").config();
// Force MOCK mode for a deterministic, offline smoke test (no API calls).
delete process.env.GEMINI_API_KEY;

const campaignState = require("../src/state/campaignState");
const { createCanonDatabase } = require("../src/canon/canonDatabase");
const { createMemoryEngine } = require("../src/memory/memoryEngine");
const { createKernel } = require("../src/kernel/kernel");
const { runTurn } = require("../src/turn");
const { stripJsonBlocks } = require("../src/gemini/geminiClient");

(async () => {
  const campaignId = "smoke_test";
  const fs = require("fs");
  const path = require("path");
  for (const suffix of ["_state", "_memory", "_canon"]) {
    const p = path.join(campaignState.DATA_DIR, `${campaignId}${suffix}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  // --- Step 0: JSON stripping unit checks --------------------------------
  const leak1 = '장면 서술입니다.\n\n```json\n{"new_memories":[{"summary":"x"}]}\n```';
  const leak2 = '순수 서사만 있어야 한다. {"new_memories":[],"canon_updates":[],"flag_changes":[]}';
  console.log("strip fenced json:", !/new_memories/.test(stripJsonBlocks(leak1)));
  console.log("strip trailing json:", !/new_memories/.test(stripJsonBlocks(leak2)));

  const canonDb = createCanonDatabase(campaignId);
  const memoryEngine = createMemoryEngine(campaignId);
  const kernel = createKernel({ canonDb, memoryEngine });
  const deps = { canonDb, memoryEngine, kernel };

  let state = campaignState.load(campaignId);

  // seed canon with a location so the Story Director can place NPCs
  kernel.request(state, "admin", "canon.register", {
    canon_id: "char_ria", type: "Character",
    data: { birth_name: "리아 벨노어", species: "human", core_values: ["loyalty"], current_location: "old_town", current_status: "alive" },
  });
  kernel.request(state, "admin", "canon.register", {
    canon_id: "loc_old_town_bridge", type: "World",
    data: { region: "old_town", terrain: "urban_bridge", notable_features: ["구전설"] },
  });
  // foreshadow so Catharsis is reachable
  state.foreshadow_pool.push({ id: "foreshadow_letter_015", planted_turn: 0, deadline_turn: 8, canon_refs: ["char_ria"], resolved: false });

  const immut = kernel.request(state, "admin", "canon.update", { canon_id: "char_ria", field: "species", new_value: "elf" });
  console.log("immutable-field update rejected:", immut.approved === false);
  campaignState.save(state);

  const inputs = [
    "다리 위에서 주변을 살핀다",
    "리아에게 말을 건다",
    "리아의 손을 잡는다",
    "함께 강을 바라본다",
    "리아에게 과거를 묻는다",
    "그녀의 이야기를 끝까지 듣는다",
    "오래 묻어둔 감정을 털어놓는다",
    "조용히 함께 걷는다",
  ];

  for (const line of inputs) {
    state = campaignState.load(campaignId);
    const r = await runTurn(deps, state, line);
    const s = r.trace.scene_spec;
    console.log(
      `turn ${r.turn - 1}->${r.turn} | ${s.scene_type} i=${s.intensity} emo=${s.primary_emotion} | npcs=[${s.participants.filter((p) => p !== "player").join(",")}] canon=[${r.trace.canon_used}] | ${s._compose_note}`
    );
  }

  const finalState = campaignState.load(campaignId);
  const types = finalState.scene_history.map((h) => h.scene_type[0]);
  console.log("\n--- final ---");
  console.log("scene_type sequence:", JSON.stringify(types));
  console.log("distinct scene_types:", [...new Set(types)].join(", "));
  console.log("catharsis occurred:", types.includes("catharsis"));
  console.log("foreshadow resolved:", finalState.foreshadow_pool[0].resolved);
  console.log("ria appeared in a scene:", finalState.scene_history.some((h) => (h.participants || []).includes("char_ria")));
  console.log("integrity:", JSON.stringify(kernel.verifyIntegrity(finalState)));
})();
