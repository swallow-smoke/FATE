// Phase 3 Wave 3 playtest — Resonance / Addiction / Self-Reflection / Health.
require("dotenv").config();
delete process.env.GEMINI_API_KEY;

const campaignState = require("../src/state/campaignState");
const { createCanonDatabase } = require("../src/canon/canonDatabase");
const { createMemoryEngine } = require("../src/memory/memoryEngine");
const { createKernel } = require("../src/kernel/kernel");
const { runTurn } = require("../src/turn");
const resonanceEngine = require("../src/meta/resonanceEngine");

(async () => {
  const id = "wave3_test";
  const fs = require("fs"), path = require("path");
  for (const s of ["_state", "_memory", "_canon"]) { const p = path.join(campaignState.DATA_DIR, `${id}${s}.json`); if (fs.existsSync(p)) fs.unlinkSync(p); }
  const canonDb = createCanonDatabase(id), memoryEngine = createMemoryEngine(id), kernel = createKernel({ canonDb, memoryEngine });
  const deps = { canonDb, memoryEngine, kernel };

  // --- unit: resonance + addiction on a fabricated engagement log --------
  const rs = { turn_number: 6, settings: { resonance_period: 6 }, player: { emotion_state: { resonance_profile: {} } },
    engagement_log: Array.from({ length: 6 }, (_, i) => ({ turn: i + 1, player_len: 50, tags: i < 5 ? ["grief"] : ["hope"] })) };
  const r = resonanceEngine.recompute(rs);
  console.log("resonance profile:", JSON.stringify(r.profile));
  console.log("addiction block on dominant tag:", r.addiction_block && r.addiction_block.tag === "grief");

  // --- integration -------------------------------------------------------
  let state = campaignState.load(id);
  state.settings = { world_event_period: 15, world_event_ttl: 40, living_npc_period: 100, resonance_period: 5 };
  kernel.request(state, "admin", "canon.register", { canon_id: "char_ria", type: "Character", data: { birth_name: "리아", species: "human", core_values: ["loyalty"], current_location: "old_town", current_status: "alive", affiliations: ["f1"] } });
  kernel.request(state, "admin", "canon.register", { canon_id: "char_kael", type: "Character", data: { birth_name: "카엘", species: "human", core_values: ["family"], current_location: "old_town", current_status: "alive", affiliations: ["f1"] } });
  campaignState.save(state);

  for (let i = 0; i < 12; i++) {
    state = campaignState.load(id);
    const rr = await runTurn(deps, state, `행동 ${i} 입니다 조금 길게 씁니다`);
    const t = rr.trace;
    console.log(`turn ${rr.turn - 1}->${rr.turn} | reflect="${t.self_reflection.note}" | resonance=${t.resonance ? "recomputed" : "-"} | health.npc=${t.campaign_health.npc_utilization_pct}% div=${t.campaign_health.emotion_diversity_pct}%`);
  }
  const f = campaignState.load(id);
  console.log("\nfinal resonance_profile:", JSON.stringify(f.player.emotion_state.resonance_profile));
  console.log("engagement_log length:", (f.engagement_log || []).length);
  console.log("campaign_health cached at turn:", f.campaign_health.computed_turn, JSON.stringify(f.campaign_health.metrics));
  console.log("self_reflection present:", !!f.self_reflection);
})();
