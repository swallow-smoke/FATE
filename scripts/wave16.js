// Post-Phase16 patch smoke — the 5 patches added after the Living-World batch:
//  · PATCH_NARRATIVE_ACCUMULATION_GAPS (narrative arcs / motifs / echo / flashback_scene)
//  · PATCH_CHAPTER_CHECKLIST (chapter required-canon/foreshadow checklist, pinned canon)
//  · PATCH_WEBNOVEL_TECHNIQUES (tension_debt 고구마-사이다 / npc_arc 캐빨 / watchdog trick exception)
//  · PATCH_INDIVIDUAL_WORKS_ANALYSIS (status-window mode / cast neglect / climax fatigue)
//  · PATCH_IP_EXTENSIONS_PROJECT_MIO (fixed protagonist / meta-knowledge strict / dice pools / soft goals / canon level)
const BASE = "http://localhost:3000";
const id = "smoke16_" + Date.now().toString(36);

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
  console.log("== Post-Phase16 patch smoke ==", id);

  // ---- in-process module unit checks ---------------------------------------
  const arcs = require("../src/story/narrativeArcs");
  const motifs = require("../src/story/motifs");
  const chapters = require("../src/story/chapters");
  const tensionDebt = require("../src/directors/tensionDebt");
  const npcArc = require("../src/npc/npcArc");
  const iw = require("../src/meta/integrityWatch");
  const statusWindow = require("../src/game/statusWindow");
  const castNeglect = require("../src/meta/castNeglect");
  const climaxFatigue = require("../src/directors/climaxFatigue");
  const dicePools = require("../src/game/dicePools");
  const softGoals = require("../src/player/softGoals");
  const fixedProtagonist = require("../src/player/fixedProtagonist");

  // NARRATIVE_ACCUMULATION_GAPS
  { const s = { turn_number: 5 }; const a = arcs.open(s, { title: "겁을 이겨낸다", kind: "growth", goal: "두려움을 넘어선다" }, 5);
    const r = arcs.advance(s, a.arc_id, 0.7, 6);
    check("arc opens + crosses milestones", !!a && r.crossed.length === 2, r);
    check("arc growth directive", !!arcs.activeGrowthDirective(s)); }
  { const s = { turn_number: 1 }; motifs.register(s, { label: "붉은 리본", category: "object" }, 1); motifs.register(s, { label: "붉은 리본" }, 4);
    check("motif dedups + recurs", s.motifs.length === 1 && s.motifs[0].occurrences === 2 && !!motifs.recurringDirective(s, 20)); }

  // CHAPTER_CHECKLIST
  { const s = { turn_number: 3, foreshadow_pool: [{ id: "fs_1", resolved: false }], scene_history: [] };
    const cdb = { get: (r) => ({ type: "Character", data: { birth_name: r } }) };
    chapters.open(s, { title: "1장", required_canon: ["npc_a"], required_foreshadow: ["fs_1"] }, 3);
    check("chapter pins required canon", chapters.pinnedCanonRefs(s).includes("npc_a"));
    chapters.tick(s, cdb, { participants: ["npc_a"], canon_refs: [] });
    s.foreshadow_pool[0].resolved = true;
    const t = chapters.tick(s, cdb, { participants: [], canon_refs: [] });
    check("chapter ready when checklist complete", t.ready === true, t); }

  // WEBNOVEL_TECHNIQUES
  { const s = { turn_number: 1, settings: {} };
    for (let i = 0; i < 5; i++) { s.turn_number = i; tensionDebt.update(s, { sceneSpec: { scene_type: ["conflict"], intensity: 3 }, check: { outcome: "fail" } }); }
    check("tension_debt accumulates + signals 사이다 due", s.tension_debt.level >= tensionDebt.HIGH && !!tensionDebt.directive(s));
    s.turn_number = 5; tensionDebt.update(s, { sceneSpec: { scene_type: ["catharsis"], intensity: 4 } });
    check("tension_debt pays down on catharsis", s.tension_debt.last_payoff_turn === 5); }
  { const s = { turn_number: 1 }; npcArc.open(s, "npc_x", "복수", 1); npcArc.build(s, "npc_x", 1.2, 2);
    check("npc_arc reaches spotlight_due", npcArc.forNpc(s, "npc_x").stage === "spotlight_due" && !!npcArc.directive(s, { get: () => ({ data: { birth_name: "X" } }) }, ["npc_x"])); }
  { const s = { turn_number: 2, narrative_tricks: [] }; iw.registerTrick(s, { kind: "faked_death", description: "X는 죽은 척", canon_refs: ["npc_x"] }); s.turn_number = 5;
    const ev = iw.evaluate(s, { all: () => [{ type: "Character", canon_id: "npc_x", data: { current_status: "dead", birth_name: "npc_x" } }] }, { narrative: "npc_x가 다시 나타났다", extraction: { integrity_issues: [] } });
    check("registered trick exempts dead-reappearance (no regen)", ev.regenerate === false && ev.exempted.length === 1, ev);
    const ev2 = iw.evaluate({ turn_number: 5, narrative_tricks: [] }, { all: () => [] }, { narrative: "x", extraction: { integrity_issues: [{ type: "canon_contradiction", description: "y", severity: "high" }] } });
    check("un-registered high issue still regenerates", ev2.regenerate === true); }

  // INDIVIDUAL_WORKS_ANALYSIS
  { const s = { settings: {}, player: { stats: { 설득: 2 }, dynamic_traits: [{ name: "마력", value: 0.5, visible_to_player: true }] } };
    check("status window off by default", statusWindow.build(s).visible === false && !statusWindow.allowsNumbers(s));
    statusWindow.setMode(s, "litrpg");
    check("litrpg window exposes stats + permits numbers", statusWindow.build(s).visible && statusWindow.allowsNumbers(s) && !!statusWindow.promptDirective(s)); }
  { const s = { turn_number: 50, npc_arcs: [{ npc_ref: "npc_y", stage: "build" }], npcs: [], promises: [], scene_history: [] };
    const cdb = { get: () => ({ type: "Character", registered_at_turn: 0, data: { birth_name: "Y" } }) };
    check("neglect detects invested absent NPC", castNeglect.detect(s, cdb).length === 1 && !!castNeglect.directive(s, cdb)); }
  { const s = { turn_number: 1, climax_log: [] };
    for (let i = 0; i < 3; i++) { s.turn_number = i; climaxFatigue.record(s, { scene_type: ["catharsis"], mood: "romance", intensity: 4 }); }
    check("climax fatigue fires on repeated pattern", climaxFatigue.assess(s).fatigued && !!climaxFatigue.directive(s)); }

  // IP_EXTENSIONS
  { const s = { turn_number: 1 }; dicePools.define(s, { name: "마력", faces: 6, count: 3, dc: 10 });
    const roll = dicePools.roll(s, "pool_마력", { rng: () => 0.99 });
    check("dice pool rolls + outcome word", roll.ok && roll.outcome === "success" && roll.dice.length === 3, roll); }
  { const s = { turn_number: 1 }; softGoals.add(s, "화해한다"); const gid = s.soft_goals[0].goal_id;
    check("soft goal directive before done", !!softGoals.promptDirective(s));
    softGoals.applyExtraction(s, [{ goal_id: gid, done: true }], 2);
    check("soft goal marked done via extraction", s.soft_goals[0].done === true && softGoals.promptDirective(s) === null); }

  // ---- HTTP: seed a campaign, exercise the endpoints -----------------------
  const wc = await j("POST", "/api/wizard/create", {
    campaign_id: id, world_name: "16 세계", era: "fantasy", genre_preset: "fantasy",
    regions: [{ canon_id: "loc_16", name: "성", notable_features: ["x"] }], factions: [],
    player: { birth_name: "테스터16", species: "human", background: "t", core_values: [], psychology: {} },
    npcs: [{ canon_id: "npc_mio16", birth_name: "미오16", species: "human", background: "학생", core_values: [], psychology: {} }],
    narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  });
  check("wizard seeds campaign", wc.status === 200, wc.data);

  // status-window mode + it flows through a turn
  const sw = await j("POST", `/api/state/${id}/status-window-mode`, { mode: "litrpg" });
  check("HTTP status-window-mode set", sw.status === 200 && sw.data.mode === "litrpg", sw.data);
  const t1 = await j("POST", "/api/turn", { campaign_id: id, player_input: "상태를 확인한다" });
  check("HTTP turn returns visible status_window", t1.status === 200 && t1.data.status_window && t1.data.status_window.visible === true, t1.data && t1.data.status_window);

  // narrative-trick registration
  const tr = await j("POST", `/api/campaign/${id}/narrative-trick`, { kind: "planted_reversal", description: "배신자는 아군", canon_refs: ["npc_mio16"] });
  check("HTTP narrative-trick registers", tr.status === 200 && !!tr.data.trick.trick_id, tr.data);
  const trbad = await j("POST", `/api/campaign/${id}/narrative-trick`, { kind: "not_a_kind" });
  check("HTTP bad trick kind rejected", trbad.status === 400);

  // IP toggles + soft goals + dice pools + canon level
  const fp = await j("POST", `/api/state/${id}/fixed-protagonist`, { enabled: true, canon_ref: "npc_mio16" });
  check("HTTP fixed-protagonist enables on a Character", fp.status === 200 && fp.data.fixed_protagonist.enabled, fp.data);
  const fpbad = await j("POST", `/api/state/${id}/fixed-protagonist`, { enabled: true, canon_ref: "loc_16" });
  check("HTTP fixed-protagonist rejects non-Character", fpbad.status === 400);
  await j("POST", `/api/state/${id}/meta-knowledge-strict`, { enabled: true });
  const sg = await j("POST", `/api/soft-goals/${id}`, { action: "add", text: "미오와 화해한다" });
  check("HTTP soft-goal add", sg.status === 200 && sg.data.soft_goals.length === 1, sg.data);
  const dpd = await j("POST", `/api/dice-pools/${id}`, { action: "define", name: "운명", faces: 20, count: 1 });
  check("HTTP dice-pool define", dpd.status === 200 && dpd.data.dice_pools.length === 1, dpd.data);
  const dpr = await j("POST", `/api/dice-pools/${id}`, { action: "roll", pool_id: "pool_운명" });
  check("HTTP dice-pool roll returns outcome", dpr.status === 200 && ["success", "partial", "fail"].includes(dpr.data.outcome), dpr.data);
  const cl = await j("POST", `/api/canon/${id}/level`, { canon_id: "npc_mio16", level: "core" });
  check("HTTP canon level set to core", cl.status === 200 && cl.data.canon_level === "core", cl.data);

  // aggregate story-arcs endpoint carries every patch's read model
  const sa = await j("GET", `/api/story-arcs/${id}`);
  const K = sa.data || {};
  check("story-arcs endpoint carries all patch keys",
    ["narrative_arcs", "motifs", "echoes", "chapters", "tension_debt", "npc_arcs", "narrative_tricks",
      "status_window", "neglected_cast", "climax_fatigue", "fixed_protagonist", "meta_knowledge_strict",
      "soft_goals", "dice_pools", "core_canon"].every((k) => k in K), Object.keys(K));
  check("story-arcs reflects core canon", (K.core_canon || []).some((c) => c.canon_id === "npc_mio16"), K.core_canon);
  check("story-arcs reflects registered trick", (K.narrative_tricks || []).length === 1, K.narrative_tricks);

  // cleanup
  await j("DELETE", `/api/campaign/${id}`);
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
