// Phase 14 Part AA — Golden Campaign + Regression test.
//
// Runs a FIXED scenario (deterministic wizard seed + a scripted input list) from
// scratch against a running server, then compares STRUCTURAL metrics to a stored
// baseline. Narrative text is expected to differ every run (it's an LLM / mock),
// so text is never compared — only structural indicators (flag counts, canon /
// memory sizes, relationship value ranges, crash-free completion, schema OK).
//
// Usage:
//   node scripts/golden.js            # run + compare to baseline (fail on drift/crash)
//   node scripts/golden.js --bless     # (re)write the baseline from this run
//
// This is a dev tool, run after each phase to catch regressions in earlier work.

const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:3000";
const BASELINE = path.join(__dirname, "golden_baseline.json");
const BLESS = process.argv.includes("--bless");

async function j(method, p, body) {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// The fixed golden scenario — a small deterministic world + scripted inputs.
const SCENARIO = {
  world_name: "골든 캠페인", era: "fantasy", genre_preset: "fantasy",
  regions: [{ canon_id: "loc_gold", name: "황금 항구", notable_features: ["오래된 등대"] }], factions: [],
  player: { birth_name: "골든", species: "human", background: "표류자", core_values: ["curiosity"], psychology: {} },
  npcs: [], narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 4, romance: 2, exploration: 4 },
};
const INPUTS = [
  "항구를 둘러본다", "리아에게 말을 건다", "등대로 향한다", "/판정 자물쇠를 딴다",
  "리아와 과거를 이야기한다", "하루를 보낸다", "조합 사람들을 만난다", "카엘을 찾아간다",
  "결심을 굳힌다", "다시 항구로 돌아온다",
];

function metrics(state, mem, canon) {
  const edges = (state.relationship_graph && state.relationship_graph.edges) || [];
  const relValues = edges.flatMap((e) => Object.entries(e).filter(([k, v]) => typeof v === "number" && !["last_changed_turn"].includes(k)).map(([, v]) => v));
  return {
    turn_number: state.turn_number,
    story_flag_count: (state.story_flags || []).length,
    canon_count: canon.length,
    memory_count: mem.length,
    rel_edge_count: edges.length,
    rel_value_in_range: relValues.every((v) => v >= 0 && v <= 1),
    mystery_count: (state.mysteries || []).length,
    schema_version: state.schema_version,
    hidden_var_keys: Object.keys((state.player && state.player.hidden_variables) || {}).length,
  };
}

(async () => {
  const id = "golden_" + Date.now().toString(36);
  console.log("== Golden Campaign ==", id, BLESS ? "(BLESS)" : "");
  let crashed = null;

  await j("POST", "/api/wizard/create", { campaign_id: id, ...SCENARIO });
  await j("POST", "/api/seed", { campaign_id: id });

  for (let i = 0; i < INPUTS.length; i++) {
    const body = INPUTS[i] === "하루를 보낸다"
      ? { campaign_id: id, player_input: INPUTS[i], time_skip: { amount: 1, unit: "일" } }
      : { campaign_id: id, player_input: INPUTS[i] };
    const r = await j("POST", "/api/turn", body);
    if (r.status !== 200 || (r.data && r.data.error)) { crashed = `turn ${i + 1}: ${r.status} ${r.data && r.data.error}`; break; }
  }

  const st = (await j("GET", `/api/state/${id}`)).data;
  const mem = ((await j("GET", `/api/memory/${id}`)).data || {}).memories || [];
  const canon = ((await j("GET", `/api/canon/${id}`)).data || {}).entities || [];
  const m = metrics(st, mem, canon);
  await j("DELETE", `/api/campaign/${id}`);

  if (crashed) { console.error("REGRESSION: campaign crashed —", crashed); process.exit(1); }
  console.log("metrics:", JSON.stringify(m));

  if (BLESS || !fs.existsSync(BASELINE)) {
    fs.writeFileSync(BASELINE, JSON.stringify(m, null, 2), "utf8");
    console.log(!fs.existsSync(BASELINE) ? "baseline written." : "baseline blessed.");
    process.exit(0);
  }

  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  const problems = [];
  // Exact-match invariants (structure must not regress).
  if (m.turn_number !== base.turn_number) problems.push(`turn_number ${m.turn_number} != ${base.turn_number}`);
  if (m.schema_version !== base.schema_version) problems.push(`schema_version ${m.schema_version} != ${base.schema_version}`);
  if (m.hidden_var_keys !== base.hidden_var_keys) problems.push(`hidden_var_keys ${m.hidden_var_keys} != ${base.hidden_var_keys}`);
  if (!m.rel_value_in_range) problems.push("relationship value out of [0,1]");
  if (m.canon_count < base.canon_count) problems.push(`canon_count regressed ${m.canon_count} < ${base.canon_count}`);
  // Tolerance bands (LLM/mock variation allowed).
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  if (!near(m.memory_count, base.memory_count, Math.max(4, base.memory_count * 0.5))) problems.push(`memory_count ${m.memory_count} far from ${base.memory_count}`);

  if (problems.length) { console.error("REGRESSION:\n - " + problems.join("\n - ")); process.exit(1); }
  console.log("결과: PASS (no structural regression vs baseline)");
  process.exit(0);
})().catch((e) => { console.error("GOLDEN CRASH:", e); process.exit(1); });
