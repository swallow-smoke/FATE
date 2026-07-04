// Phase 13 smoke — engine infra/optimization (V1-V9 + extras).
const BASE = "http://localhost:3000";
const id = "smoke13_" + Date.now().toString(36);

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
  console.log("== Phase 13 smoke ==", id);

  // ---- V9 Narrative Scheduler (in-process) ---------------------------------
  const sched = require("../src/meta/scheduleConfig");
  const base = sched.resolve({ settings: {} });
  check("V9 default world_simulation_event = 15", base.world_simulation_event === 15, base);
  const low = sched.resolve({ settings: { low_token_mode: true } });
  check("V9 low-token stretches proactive check 7 -> 30", low.npc_proactive_contact_check === 30, low);
  check("V9 isDue true at cadence turn", sched.isDue({ settings: {} }, "campaign_health_recalc", 20) === true);
  check("V9 isDue false off-cadence", sched.isDue({ settings: {} }, "campaign_health_recalc", 21) === false);

  // ---- V3 Token Budget (in-process) ----------------------------------------
  const tb = require("../src/gemini/tokenBudget");
  check("V3 estimateTokens grows with length", tb.estimateTokens("a".repeat(220)) === 100, tb.estimateTokens("a".repeat(220)));
  const trim = tb.trimToBudget([{ text: "x".repeat(220), priority: 1 }, { text: "y".repeat(220), priority: 3 }], 100);
  check("V3 trims lowest-priority item to fit budget", trim.kept.length === 1 && trim.kept[0].priority === 3 && trim.dropped.length === 1, { kept: trim.kept.length, dropped: trim.dropped.length });

  // ---- V1/V2 Context Cache (in-process) ------------------------------------
  const cc = require("../src/gemini/contextCache");
  const c1 = cc.evaluate("cctest", "STATIC A");
  check("V1 first eval = new (miss)", c1.reason === "new" && c1.hit === false, c1);
  const c2 = cc.evaluate("cctest", "STATIC A");
  check("V1 second eval same text = hit", c2.hit === true, c2);
  const c3 = cc.evaluate("cctest", "STATIC B");
  check("V2 changed static text invalidates", c3.invalidated === true && c3.hit === false, c3);
  const c4 = cc.evaluate("cctest2", "S", { ttlMs: 0, now: 1000 });
  const c5 = cc.evaluate("cctest2", "S", { ttlMs: 0, now: 2000 });
  check("V2 TTL expiry recreates", c5.expired === true && c5.hit === false, c5);

  // ---- V5 Delta Context (in-process) ---------------------------------------
  const opt = require("../src/gemini/contextOptimizer");
  const st = { scene_history: [] };
  const u1 = opt.unchangedIds(st, "canon", [{ id: "a", body: "AAA" }, { id: "b", body: "BBB" }]);
  check("V5 first pass: nothing unchanged", u1.size === 0, [...u1]);
  const u2 = opt.unchangedIds(st, "canon", [{ id: "a", body: "AAA" }, { id: "b", body: "CHANGED" }]);
  check("V5 second pass: unchanged 'a' detected, changed 'b' not", u2.has("a") && !u2.has("b"), [...u2]);

  // ---- V6 Deterministic Validator (in-process) -----------------------------
  const gc = require("../src/gemini/geminiClient");
  check("V6 parses clean JSON", gc.parseExtraction('{"new_memories":[{"summary":"x"}]}').new_memories.length === 1);
  const fenced = gc.parseExtraction('```json\n{"flag_changes":[{"flag_id":"f","value":true}]}\n```');
  check("V6 recovers fenced JSON", fenced.flag_changes.length === 1 && fenced._recovered === true, fenced._recovered);
  const noisy = gc.parseExtraction('sure! here you go: {"canon_updates":[{"canon_id":"c"}]} thanks');
  check("V6 recovers by slicing to first/last brace", noisy.canon_updates.length === 1 && noisy._recovered === true, noisy._recovered);
  const bad = gc.parseExtraction("not json at all");
  check("V6 unparseable -> empty schema + _parse_error", bad._parse_error && bad.new_memories.length === 0, bad._parse_error);
  check("V6 empty schema includes integrity_issues + proper_nouns", Array.isArray(bad.integrity_issues) && Array.isArray(bad.proper_nouns));

  // ---- HTTP: full pipeline --------------------------------------------------
  await j("POST", "/api/wizard/create", {
    campaign_id: id, world_name: "13 세계", era: "fantasy", genre_preset: "fantasy",
    regions: [{ canon_id: "loc_13", name: "성", notable_features: ["오래된 다리"] }], factions: [],
    player: { birth_name: "테스터13", species: "human", background: "검증", core_values: [], psychology: {} },
    npcs: [], narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  });
  await j("POST", "/api/seed", { campaign_id: id });

  const t1 = await j("POST", "/api/turn", { campaign_id: id, player_input: "리아에게 다가가 말을 건다", debug: true });
  check("turn 1 runs", t1.data && t1.data.turn === 1, t1.data && t1.data.error);
  check("V1 context_cache evaluated in trace", t1.data.trace.context_cache && t1.data.trace.context_cache.reason === "new", t1.data.trace.context_cache);

  const t2 = await j("POST", "/api/turn", { campaign_id: id, player_input: "리아와 계속 이야기한다", debug: true });
  check("V5 delta: turn 2 prompt marks something '(이전과 동일)'", t2.data.trace.system_prompt.includes("이전과 동일"), null);
  check("V1 context_cache hit on turn 2 (static unchanged)", t2.data.trace.context_cache.hit === true, t2.data.trace.context_cache);

  // Memory importance scoring
  const mem = await j("GET", `/api/memory/${id}`);
  check("Memory objects carry importance score", (mem.data.memories || []).every((m) => typeof m.importance === "number"), (mem.data.memories || [])[0]);

  // W1 watchdog: mock flags high severity on the marker word "모순".
  const tw = await j("POST", "/api/turn", { campaign_id: id, player_input: "모순", debug: true });
  check("W1 watchdog regenerates on high-severity integrity issue", !!tw.data.trace.watchdog_regen, tw.data.trace.watchdog_regen);

  // Advanced payload has the new infra/debug views.
  const adv = await j("GET", `/api/advanced/${id}`);
  check("Advanced: prompt viewer (last_prompt)", adv.data.prompt && adv.data.prompt.last_prompt && adv.data.prompt.last_prompt.system_prompt, Object.keys(adv.data.prompt || {}));
  check("Advanced: token budget recorded", adv.data.prompt.prompt_profile.last_token_budget && adv.data.prompt.prompt_profile.last_token_budget.total_budget === 8000, adv.data.prompt.prompt_profile.last_token_budget);
  check("Advanced: prompt_version stamped", adv.data.prompt.prompt_profile.prompt_version === "nos-v1.3", adv.data.prompt.prompt_profile.prompt_version);
  check("Advanced: performance profiler log present", Array.isArray(adv.data.performance) && adv.data.performance.length >= 1, (adv.data.performance || []).slice(-1));
  check("Advanced: integrity log has watchdog entry", (adv.data.integrity.log || []).some((l) => l.source === "watchdog"), adv.data.integrity.log);
  check("V7 state_change_log present", Array.isArray(adv.data.state_change_log) && adv.data.state_change_log.length >= 1);

  await j("DELETE", `/api/campaign/${id}`);
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
