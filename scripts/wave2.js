// Phase 3 Wave 2 playtest — Theme / Rhythm / Debate / Drama.
require("dotenv").config();
delete process.env.GEMINI_API_KEY;

const campaignState = require("../src/state/campaignState");
const { createCanonDatabase } = require("../src/canon/canonDatabase");
const { createMemoryEngine } = require("../src/memory/memoryEngine");
const { createKernel } = require("../src/kernel/kernel");
const { runTurn } = require("../src/turn");
const themeDirector = require("../src/directors/themeDirector");
const rhythmDirector = require("../src/directors/rhythmDirector");
const directorDebate = require("../src/directors/directorDebate");

(async () => {
  // --- unit checks -------------------------------------------------------
  console.log("theme from DNA(politics=5):", themeDirector.initialTheme({ politics: 5, emotion: 2 }) === "권력");

  const tState = { turn_number: 10, narrative_dna: { emotion: 5 }, story_flags: [
    { flag_id: "betrayed_guild", value: true }, { flag_id: "betrayed_king", value: true }, { flag_id: "betrayed_ally", value: true },
  ], theme: { active_theme: "관계", theme_progress: 0.2, theme_history: [{ theme: "관계", turns: [0, null] }], weight_in_scene_selection: 0.3 } };
  themeDirector.run(tState);
  console.log("theme transitions on 3 betrayal flags -> 용서:", tState.theme.active_theme === "용서");

  const rState = { narrative_dna: {}, scene_history: Array.from({ length: 8 }, (_, i) => ({ scene_type: ["discovery"], intensity: 2 })) };
  const rd = rhythmDirector.run(rState);
  console.log("rhythm avoids over-used discovery:", rd.avoid_scene_types.includes("discovery"), "| spike:", rd.intensity_spike);

  const debate = directorDebate.resolve({
    emotion: { directive: { recovery_scene: true, intensity_target: 1, must_include: [], scene_type_hint: ["bond"] } },
    story: { urgency: "high", proposed_beat: "복선 회수", foreshadow_refs: ["foreshadow_x"] },
    rhythm: { avoid_scene_types: [] },
  });
  console.log("debate occurred (recovery vs high urgency):", debate.occurred, "| log lines:", debate.log.length, "| keeps low intensity:", debate.decision.intensity_target === 1);

  // --- integration -------------------------------------------------------
  const id = "wave2_test";
  const fs = require("fs"), path = require("path");
  for (const s of ["_state", "_memory", "_canon"]) { const p = path.join(campaignState.DATA_DIR, `${id}${s}.json`); if (fs.existsSync(p)) fs.unlinkSync(p); }
  const canonDb = createCanonDatabase(id), memoryEngine = createMemoryEngine(id), kernel = createKernel({ canonDb, memoryEngine });
  const deps = { canonDb, memoryEngine, kernel };
  let state = campaignState.load(id);
  state.narrative_dna = { politics: 5, mystery: 4, emotion: 2, survival: 1, horror: 1, romance: 1, exploration: 2, tone: 2 };
  kernel.request(state, "admin", "canon.register", { canon_id: "char_ria", type: "Character", data: { birth_name: "리아", species: "human", core_values: ["loyalty"], current_location: "old_town", current_status: "alive", affiliations: ["faction_x"] } });
  campaignState.save(state);

  console.log("\nintegration run:");
  for (let i = 0; i < 6; i++) {
    state = campaignState.load(id);
    const r = await runTurn(deps, state, `행동 ${i}`);
    const s = r.trace.scene_spec;
    console.log(`turn ${r.turn - 1}->${r.turn} | ${s.scene_type} i=${s.intensity} mood=${s.mood} theme=${s.subtext_theme} | rhythm=${r.trace.rhythm_directive.reason}`);
  }
  const f = campaignState.load(id);
  console.log("\nactive_theme:", f.theme.active_theme, "| scene_history has intensity+mood:", f.scene_history.every((h) => h.intensity != null && h.mood));
})();
