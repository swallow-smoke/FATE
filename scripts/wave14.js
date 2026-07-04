// Phase 14 smoke — integrity watchdog (W), debug tools (X), time accel (Y),
// compression (Z). Golden/regression (AA) runs separately via scripts/golden.js.
const BASE = "http://localhost:3000";
const id = "smoke14_" + Date.now().toString(36);

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
  console.log("== Phase 14 smoke ==", id);

  // ---- W2 Hallucination Checker (in-process) -------------------------------
  const iw = require("../src/meta/integrityWatch");
  const fakeCanon = { all: () => [
    { canon_id: "char_dead", type: "Character", data: { birth_name: "고인", current_status: "dead" } },
    { canon_id: "char_live", type: "Character", data: { birth_name: "생존자", current_status: "alive" } },
  ] };
  const w1 = iw.evaluate({ turn_number: 5 }, fakeCanon, {
    narrative: "그때 고인이 문을 열고 걸어 들어왔다.",
    extraction: { integrity_issues: [], proper_nouns: [{ name: "신비인물", kind: "character", is_recurring: true }] },
  });
  check("W2 dead character reappearance -> high issue + regenerate", w1.regenerate === true && w1.dead_reappearances.length === 1, w1.dead_reappearances);
  check("W2 unknown recurring name -> register candidate", w1.register_candidates.some((c) => c.name === "신비인물"), w1.register_candidates);
  const w2 = iw.evaluate({ turn_number: 6 }, fakeCanon, { narrative: "평범한 하루였다.", extraction: { integrity_issues: [], proper_nouns: [] } });
  check("W2 clean narrative -> no regenerate", w2.regenerate === false, w2);

  // ---- V6 streak via commit (in-process) -----------------------------------
  const st = { turn_number: 1, integrity_log: [] };
  iw.commit(st, { parse_failure: true, issues: [], register_candidates: [] });
  iw.commit(st, { parse_failure: true, issues: [], register_candidates: [] });
  const c3 = iw.commit(st, { parse_failure: true, issues: [], register_candidates: [] });
  check("V6 3rd consecutive parse failure logs a high warning", c3.parse_failure_streak === 3 && st.integrity_log.some((l) => l.source === "validator"), st.integrity_log);
  iw.commit(st, { parse_failure: false, issues: [], register_candidates: [] });
  check("V6 streak resets on success", (st.extraction_failure_streak || 0) === 0);

  // ---- X4 LLM Recorder (in-process) ----------------------------------------
  const usageLog = require("../src/usage/usageLog");
  const fs = require("fs");
  const rid = "rec14_" + Date.now().toString(36);
  for (let i = 0; i < 25; i++) usageLog.record({ campaign_id: rid, model: "gemini-2.5-pro", kind: "narrative", prompt_tokens: 10, output_tokens: 5, prompt_snapshot: "P" + i, response_snapshot: "R" + i });
  const ru = usageLog.load(rid);
  check("X4 recorder keeps newest 20 snapshots by default", (ru.recent_calls || []).length === 20 && ru.recent_calls[19].response === "R24", (ru.recent_calls || []).length);
  const rp = usageLog.usagePath(rid); if (fs.existsSync(rp)) fs.unlinkSync(rp);

  // ---- HTTP setup -----------------------------------------------------------
  await j("POST", "/api/wizard/create", {
    campaign_id: id, world_name: "14 세계", era: "fantasy", genre_preset: "fantasy",
    regions: [{ canon_id: "loc_14", name: "성", notable_features: ["탑"] }], factions: [],
    player: { birth_name: "테스터14", species: "human", background: "검증", core_values: [], psychology: {} },
    npcs: [], narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  });
  await j("POST", "/api/seed", { campaign_id: id });
  await j("POST", "/api/turn", { campaign_id: id, player_input: "성을 둘러본다" });

  // ---- Y Time Acceleration (HTTP) ------------------------------------------
  const skip = await j("POST", "/api/turn", { campaign_id: id, player_input: "긴 여정을 떠난다", time_skip: { amount: 1, unit: "년" } });
  check("Y large skip returns a time_accel summary card", skip.data.time_accel && skip.data.time_accel.summary && skip.data.time_accel.span_days >= 300, skip.data.time_accel);
  const smallSkip = await j("POST", "/api/turn", { campaign_id: id, player_input: "잠깐 쉰다", time_skip: { amount: 2, unit: "일" } });
  check("Y small skip does NOT batch-simulate (null)", smallSkip.data.time_accel == null, smallSkip.data.time_accel);

  // ---- X3 Explain Mode (HTTP) ----------------------------------------------
  const exp = await j("POST", `/api/explain/${id}`, {});
  check("X3 explain returns a human-readable explanation", exp.data && typeof exp.data.explanation === "string" && exp.data.explanation.length > 0, exp.data);

  // ---- X1/X2 Advanced debug views (HTTP) -----------------------------------
  const adv = await j("GET", `/api/advanced/${id}`);
  check("X1 advanced exposes last prompt + context cache status", adv.data.prompt.last_prompt && adv.data.prompt.context_cache, Object.keys(adv.data.prompt || {}));
  check("X2 advanced exposes performance profiler entries", (adv.data.performance || []).length >= 2, (adv.data.performance || []).length);

  // ---- Z Export compression (HTTP) -----------------------------------------
  const plain = await fetch(`${BASE}/api/export/${id}`);
  const gz = await fetch(`${BASE}/api/export/${id}?gz=1`);
  const gzBuf = Buffer.from(await gz.arrayBuffer());
  check("Z gzip export has gzip magic bytes + is smaller than plain JSON", gzBuf[0] === 0x1f && gzBuf[1] === 0x8b, [gzBuf[0], gzBuf[1]]);
  const plainLen = Number(plain.headers.get("content-length")) || (await plain.text()).length;
  check("Z gzip export smaller than plain", gzBuf.length < plainLen, { gz: gzBuf.length, plain: plainLen });

  // ---- V8 snapshots endpoint reachable (HTTP) ------------------------------
  const snaps = await j("GET", `/api/snapshots/${id}`);
  check("V8 snapshots endpoint responds (list, possibly empty)", Array.isArray(snaps.data.snapshots), snaps.data);

  await j("DELETE", `/api/campaign/${id}`);
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
