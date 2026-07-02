// Phase 8 follow-up smoke — C2 (player death/retirement confirmation) + D1
// (API key rotation). Runs against the mock server on :3000.
const BASE = "http://localhost:3000";
const id = "smoke8b_" + Date.now().toString(36);

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
  console.log("== Phase 8b smoke ==", id);

  // ---- D1: key rotation (in-process) ----------------------------------------
  // Fresh require of the client with a controlled env pool.
  delete require.cache[require.resolve("../src/gemini/geminiClient")];
  process.env.GEMINI_API_KEYS = "keyA,keyB,keyC";
  const gc = require("../src/gemini/geminiClient");
  gc.reloadKeys();
  const st0 = gc.keysStatus();
  check("D1 loads 3 keys from GEMINI_API_KEYS", st0.total === 3 && st0.available === 3, st0);
  check("D1 hasKey true with pool", gc.hasKey() === true, gc.hasKey());
  check("D1 keysStatus never leaks key values", JSON.stringify(st0).indexOf("keyA") === -1, st0);
  delete process.env.GEMINI_API_KEYS;
  delete require.cache[require.resolve("../src/gemini/geminiClient")];

  // ---- D1: keys endpoint (mock server has no keys) --------------------------
  const keys = await j("GET", "/api/keys");
  check("D1 /api/keys returns pool status", keys.status === 200 && typeof keys.data.total === "number", keys.data);

  // ---- C2: staged transition + confirm flow (HTTP, mock turns) --------------
  await j("POST", "/api/wizard/create", {
    campaign_id: id, world_name: "8b 세계", era: "fantasy", genre_preset: "fantasy",
    regions: [{ canon_id: "loc_8b", name: "고개", notable_features: ["관문"] }],
    factions: [{ canon_id: "fac_8b", name: "무리", founding_principle: "loyalty", leader: "두목", stance: "neutral" }],
    player: { birth_name: "테스터8b", species: "human", background: "검증", core_values: [], psychology: {} },
    npcs: [], narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  });
  // seed a family edge so the Legacy Engine can pick a successor
  await j("POST", "/api/seed", { campaign_id: id });

  // explicit retirement declaration → staged (NOT auto-applied)
  const t1 = await j("POST", "/api/turn", { campaign_id: id, player_input: "나는 이 모든 것을 뒤로하고 은퇴하겠다" });
  check("C2 explicit retirement is staged, not auto-confirmed", t1.data.pending_transition && t1.data.pending_transition.trigger_flag === "player_retired", t1.data.pending_transition);
  const stMid = await j("GET", `/api/state/${id}`);
  check("C2 no generation advance before confirmation", (stMid.data.player.generation || 1) === 1, stMid.data.player.generation);
  check("C2 trigger flag NOT set before confirmation", !(stMid.data.story_flags || []).some((f) => f.flag_id === "player_retired" && f.value === true), stMid.data.story_flags);

  // cancel path
  const cancel = await j("POST", `/api/campaign/${id}/confirm-transition`, { confirm: false });
  check("C2 cancel clears the pending transition", cancel.data.ok && cancel.data.cancelled, cancel.data);
  const stAfterCancel = await j("GET", `/api/state/${id}`);
  check("C2 still generation 1 after cancel", (stAfterCancel.data.player.generation || 1) === 1 && !stAfterCancel.data.pending_legacy_transition, stAfterCancel.data.pending_legacy_transition);

  // stage again, then confirm → generation advances
  await j("POST", "/api/turn", { campaign_id: id, player_input: "여기서 죽더라도 물러서지 않겠다 — 은퇴한다" });
  const confirm = await j("POST", `/api/campaign/${id}/confirm-transition`, { confirm: true });
  check("C2 confirm advances a generation via Legacy Engine", confirm.data.ok && confirm.data.confirmed && confirm.data.legacy_event && confirm.data.legacy_event.generation === 2, confirm.data);
  const stFinal = await j("GET", `/api/state/${id}`);
  check("C2 generation persisted = 2, pending cleared", (stFinal.data.player.generation === 2) && !stFinal.data.pending_legacy_transition, { gen: stFinal.data.player.generation });

  // confirm with nothing pending → 409
  const none = await j("POST", `/api/campaign/${id}/confirm-transition`, { confirm: true });
  check("C2 confirm with no pending → 409", none.status === 409, none.data);

  await j("DELETE", `/api/campaign/${id}`);
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
