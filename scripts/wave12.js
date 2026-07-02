// Phase 12 smoke — usage dashboard by category (U2) + low-token mode (U3).
const BASE = "http://localhost:3000";
const id = "smoke12_" + Date.now().toString(36);

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
  console.log("== Phase 12 smoke ==", id);
  const usageLog = require("../src/usage/usageLog");

  // ---- U2: category + daily aggregation (in-process) ------------------------
  const uid = "usage12_" + Date.now().toString(36);
  usageLog.record({ campaign_id: uid, model: "gemini-2.5-pro", kind: "narrative", prompt_tokens: 1000, output_tokens: 500 });
  usageLog.record({ campaign_id: uid, model: "gemini-2.5-flash", kind: "narrative_retry", prompt_tokens: 800, output_tokens: 200 });
  usageLog.record({ campaign_id: uid, model: "gemini-2.5-flash", kind: "reflection", prompt_tokens: 200, output_tokens: 50 });
  const u = usageLog.load(uid);
  check("U2 narrative + narrative_retry fold into one category", u.by_category.narrative && u.by_category.narrative.calls === 2, u.by_category);
  check("U2 reflection folds into extraction category", u.by_category.extraction && u.by_category.extraction.calls === 1, u.by_category);
  check("U2 daily total counts all 3 calls today", Object.values(u.daily)[0].call_count === 3, u.daily);
  const t80 = usageLog.todaySummary(u, 3);
  check("U2 todaySummary computes pct + warn at/над 80%", t80.pct === 100 && t80.warn === true, t80);
  const tNoLimit = usageLog.todaySummary(u, 0);
  check("U2 no limit → no warn", tNoLimit.limit === null && tNoLimit.warn === false, tNoLimit);
  // cleanup usage file
  const fs = require("fs"), path = require("path");
  const up = usageLog.usagePath(uid); if (fs.existsSync(up)) fs.unlinkSync(up);

  // ---- HTTP setup -----------------------------------------------------------
  await j("POST", "/api/wizard/create", {
    campaign_id: id, world_name: "12 세계", era: "fantasy", genre_preset: "fantasy",
    regions: [{ canon_id: "loc_12", name: "성", notable_features: ["x"] }], factions: [],
    player: { birth_name: "테스터12", species: "human", background: "검증", core_values: [], psychology: {} },
    npcs: [], narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  });

  // U2: settings persist rpd_limit; usage endpoint returns today summary shape
  const setr = await j("POST", `/api/state/${id}/settings`, { settings: { rpd_limit: 250 } });
  check("U2 rpd_limit persisted", setr.data.settings.rpd_limit === 250, setr.data.settings);
  const usage = await j("GET", `/api/usage/${id}`);
  check("U2 usage endpoint exposes by_category + today + rpd_limit", usage.data.by_category !== undefined && usage.data.today && usage.data.rpd_limit === 250, Object.keys(usage.data));

  // ---- U3: low-token mode gating --------------------------------------------
  await j("POST", `/api/state/${id}/settings`, { settings: { low_token_mode: true } });
  // day rollover turn → daily_summary present but empty (divider only) + low_token
  const skip = await j("POST", "/api/turn", { campaign_id: id, player_input: "하루를 보낸다", time_skip: { amount: 1, unit: "일" } });
  check("U3 low-token daily digest is divider-only (no summary text)", skip.data.daily_summary && skip.data.daily_summary.low_token === true && skip.data.daily_summary.summary === "", skip.data.daily_summary);
  const stAfter = await j("GET", `/api/state/${id}`);
  check("U3 low-token skips self-reflection (null)", stAfter.data.self_reflection === null, stAfter.data.self_reflection);

  // recap forced under low-token → raw text, low_token flag
  const recap = await j("GET", `/api/recap/${id}?force=1`);
  check("U3 low-token recap returns raw (low_token flag)", recap.data.low_token === true, recap.data);

  // highlights disabled under low-token
  const hl = await j("POST", `/api/highlights/${id}`);
  check("U3 low-token highlights disabled", hl.data.disabled === true, hl.data);

  // turn off low-token → highlights work again (endpoint responds normally)
  await j("POST", `/api/state/${id}/settings`, { settings: { low_token_mode: false } });
  const hl2 = await j("POST", `/api/highlights/${id}`);
  check("U3 highlights re-enabled when low-token off", hl2.data.disabled !== true, hl2.data);

  await j("DELETE", `/api/campaign/${id}`);
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
