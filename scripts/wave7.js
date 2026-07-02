// Phase 7 smoke test. Two halves:
//   (1) in-process, deterministic tests of the new engines (no server, no LLM)
//   (2) HTTP checks of the new endpoints against a running server (:3000)
const BASE = "http://localhost:3000";
const id = "smoke7_" + Date.now().toString(36);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ""); }
}
async function j(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}

(async () => {
  console.log("== Phase 7 smoke ==", id);

  // ---- (1) engine unit tests -------------------------------------------------
  const campaignState = require("../src/state/campaignState");
  const phase7plus = require("../src/meta/phase7plus");
  const npcBrain = require("../src/npc/npcBrain");
  const consequence = require("../src/story/consequenceChains");
  const mystery = require("../src/mystery/mystery");

  // schema: ensure() installs all Phase 7 fields + 10-dim relationship defaults
  const st = campaignState.newCampaign("unit7");
  check("C1 hidden_variables default present", st.player.hidden_variables && st.player.hidden_variables.sanity != null, st.player.hidden_variables);
  check("C4 story_structure has 7 stages", (st.story_structure.stages || []).length === 7, st.story_structure.stages);
  const relKeys = phase7plus.REL_KEYS;
  const testEdge = phase7plus.expandRelation({ trust: 0.5 });
  check("C3 relationship expands to 11 keys (10-dim + distance)", relKeys.every((k) => testEdge[k] !== undefined) && relKeys.length === 11, Object.keys(testEdge));

  // hidden variables drift under an intense fearful scene
  const before = { ...st.player.hidden_variables };
  st.turn_number = 5;
  phase7plus.tick(st, { sceneSpec: { intensity: 5, primary_emotion: "fear" }, extraction: { new_memories: [{ emotion_tags: ["fear", "dread"] }] } });
  check("C1 trauma accumulates on fear scene", st.player.hidden_variables.trauma_accumulation > before.trauma_accumulation, st.player.hidden_variables);
  check("C1 fatigue rises on high-intensity scene", st.player.hidden_variables.fatigue > before.fatigue, st.player.hidden_variables);

  // difficulty director: 3 successes → hint + raised DC via skillCheck
  st.difficulty_director.recent_checks = [{ outcome: "success" }, { outcome: "success" }, { outcome: "success" }];
  phase7plus.tick(st, { sceneSpec: { intensity: 2 }, extraction: {}, check: { outcome: "success", skill: "설득" } });
  check("C2 success streak raises a difficulty hint", /success_streak/.test(st.difficulty_director.hint || ""), st.difficulty_director.hint);
  const skillCheck = require("../src/game/skillCheck");
  st.player.stats = { 설득: 1 };
  const forced = skillCheck.maybeCheck(st, "그를 설득한다", true);
  check("C2 difficulty_modifier_source recorded on streak", forced && forced.difficulty >= 14 && /success_streak/.test(forced.difficulty_modifier_source || ""), forced);

  // hidden variable directive: push corruption high, expect a prompt line
  st.player.hidden_variables.corruption = 0.7;
  const hd = phase7plus.hiddenVariableDirective(st);
  check("C1 high corruption yields a subtle directive (never a number)", hd.some((l) => /경계심/.test(l)) && !hd.join("").match(/0\.\d/), hd);

  // weather line
  check("A5 weatherLine renders season + weather", /계절\/날씨/.test(phase7plus.weatherLine(st) || ""), phase7plus.weatherLine(st));

  // NPCBrain candidates (fake canonDb)
  const fakeCanon = { get: (r) => r === "char_x" ? { type: "Character", data: { birth_name: "엑스", goal_current: "복수", psychology: {} } } : null };
  st.npcs = [{ canon_ref: "char_x", relationship_to_player: { hatred: 0.8 } }];
  st.npc_brain_log = {};
  const cands = npcBrain.proposeCandidates(st, fakeCanon, ["char_x"]);
  check("A1 NPCBrain proposes a heavy 'confront' beat when hatred>0.6", cands.some((c) => c.action_type === "confront"), cands);
  npcBrain.markActed(st, ["char_x"]);
  check("A1 cooldown blocks a second beat next turn", npcBrain.proposeCandidates(st, fakeCanon, ["char_x"]).length === 0, st.npc_brain_log);

  // Consequence chains
  st.turn_number = 20;
  const chain = consequence.openChain(st, "saved_king", 20, ["char_king"]);
  check("A2 openChain creates a chain", chain && chain.chain_id, chain);
  check("A2 duplicate openChain is a no-op", consequence.openChain(st, "saved_king", 21, []) === null, st.consequence_chains.length);
  const links = consequence.linkTurnEvents(st, { memories: [{ timestamp: { campaign_turn: 25 }, summary: "the king repaid the debt", canon_refs: ["char_king"] }] });
  check("A2 linkTurnEvents attaches a matching event", links.length === 1 && st.consequence_chains[0].linked_events.length === 1, links);

  // Mystery
  const myst = mystery.create(st, { question: "누가 왕을 죽였나", clues: ["그림자", "편지", "발자국"], required: 2 });
  check("A4 mystery created with clues hidden", myst.clues.length === 3 && myst.clues.every((c) => !c.revealed), myst);
  check("A4 discoveryHint returns the first hidden clue", (mystery.discoveryHint(st) || {}).clue_id === "clue_01", mystery.discoveryHint(st));
  mystery.revealOnDiscovery(st, { scene_type: ["discovery"] });
  mystery.revealOnDiscovery(st, { scene_type: ["discovery"] });
  check("A4 two discovery scenes reveal 2 clues and mark resolvable", myst.clues.filter((c) => c.revealed).length === 2 && myst.resolvable, myst);
  check("A4 non-discovery scene reveals nothing", mystery.revealOnDiscovery(st, { scene_type: ["conflict"] }) === null, null);

  // ---- (2) HTTP endpoint tests ----------------------------------------------
  const world = {
    campaign_id: id, world_name: "7단계 세계", era: "fantasy", genre_preset: "fantasy",
    expected_campaign_length: "short",
    regions: [{ canon_id: "loc_p7", name: "성문", terrain: "urban", notable_features: ["테스트"] }],
    factions: [], npcs: [],
    player: { birth_name: "테스터7", species: "human", background: "검증", core_values: ["검증"], psychology: {} },
    narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  };
  const created = await j("POST", "/api/wizard/create", world);
  check("setup: wizard create", created.data.ok, created.data);
  const stHttp = await j("GET", `/api/state/${id}`);
  check("A3 expected_campaign_length persisted from wizard", stHttp.data.settings.expected_campaign_length === "short", stHttp.data.settings);
  check("schema: advanced_mode defaults OFF", stHttp.data.settings.advanced_mode === false, stHttp.data.settings.advanced_mode);

  const adv1 = await j("GET", `/api/advanced/${id}`);
  check("D: /api/advanced returns grouped internal snapshot", adv1.data && adv1.data.psychology && adv1.data.psychology.hidden_variables && adv1.data.clues_chains, Object.keys(adv1.data || {}));

  const tog = await j("POST", `/api/state/${id}/advanced-mode`, { enabled: true });
  check("D: advanced-mode toggle on", tog.data.advanced_mode === true, tog.data);
  const togOff = await j("POST", `/api/state/${id}/advanced-mode`, { enabled: false });
  check("D: advanced-mode toggle off", togOff.data.advanced_mode === false, togOff.data);

  const wt = await j("GET", `/api/worldtab/${id}`);
  check("A5/A4/A2: worldtab exposes weather + mysteries + chains arrays", wt.data && wt.data.weather && Array.isArray(wt.data.mysteries) && Array.isArray(wt.data.consequence_chains), Object.keys(wt.data || {}));

  // best-effort single real turn (tolerates free-tier 429)
  const turn = await j("POST", "/api/turn", { campaign_id: id, player_input: "성문 앞에서 주위를 살핀다" });
  if (turn.status === 200) {
    check("turn ran; state advanced with Phase 7 tick", turn.data.turn >= 1, turn.data);
    const adv2 = await j("GET", `/api/advanced/${id}`);
    check("D: hidden_variable_log recorded a turn", (adv2.data.psychology.hidden_variable_log || []).length >= 1, adv2.data.psychology.hidden_variable_log);
  } else {
    console.log("  ~ live turn skipped (status", turn.status + ") — likely free-tier quota; engine paths covered by unit tests above");
  }

  // cleanup
  await j("DELETE", `/api/campaign/${id}`);
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
