// Phase 9 smoke — dynamic traits (F) + era communication: letters (E4/E5).
// (1) in-process Kernel/engine tests  (2) HTTP endpoint tests (mock server :3000)
const BASE = "http://localhost:3000";
const id = "smoke9_" + Date.now().toString(36);

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
  console.log("== Phase 9 smoke ==", id);
  const campaignState = require("../src/state/campaignState");
  const { createKernel } = require("../src/kernel/kernel");
  const letters = require("../src/comm/letters");

  // ---- F3: Kernel trait.create / trait.update validation --------------------
  const fakeCanon = { get: (r) => (r === "char_a" ? { canon_id: "char_a", type: "Character", data: {} } : null), all: () => [] };
  const kernel = createKernel({ canonDb: fakeCanon, memoryEngine: { all: () => [], write: () => ({}) } });
  const st = campaignState.newCampaign("unit9");
  st.turn_number = 88;
  const c1 = kernel.request(st, "sd", "trait.create", { name: "모성", category: "psychological", origin_summary: "임신 확인", canon_refs: ["char_a"], player_facing_description: "아이를 지키려는 마음" });
  check("F3 trait.create succeeds", c1.approved && c1.patch.name === "모성" && c1.patch.visible_to_player === true, c1);
  check("F1 value stored but default 0.3 (never shown to player elsewhere)", c1.patch.value === 0.3, c1.patch);
  const dup = kernel.request(st, "sd", "trait.create", { name: "모성" });
  check("F3 duplicate name rejected", !dup.approved, dup.reason);
  st.turn_number = 95; // 7 turns later (< 20 cooldown)
  const rl = kernel.request(st, "sd", "trait.create", { name: "자신감", canon_refs: ["char_a"] });
  check("F3 rate limit: new trait within 20 turns rejected", !rl.approved, rl.reason);
  st.turn_number = 110; // > 20 turns after first
  const c2 = kernel.request(st, "sd", "trait.create", { name: "자신감", canon_refs: ["char_a"] });
  check("F3 new trait allowed after cooldown", c2.approved, c2.reason);
  // update throttle
  const u1 = kernel.request(st, "sd", "trait.update", { name: "모성", value: 0.5 });
  check("F3 trait.update applies after interval", u1.approved && u1.patch.value === 0.5, u1);
  const u2 = kernel.request(st, "sd", "trait.update", { name: "모성", value: 0.9 });
  check("F3 trait.update throttled if too soon", !u2.approved, u2.reason);

  // ---- E4/E5: letters (in-process) ------------------------------------------
  const canonRows = {
    char_ria: { canon_id: "char_ria", type: "Character", data: { birth_name: "리아", current_location: "far_town" } },
    far_town: { canon_id: "far_town", type: "World", data: { travel_distance_tier: "far" } },
  };
  const fakeCanonFull = { get: (r) => canonRows[r] || null, all: () => Object.values(canonRows), register: (p) => { canonRows[p.canon_id] = { canon_id: p.canon_id, type: p.type, data: p.data }; return { ok: true, entity: canonRows[p.canon_id] }; } };
  const letterKernel = createKernel({ canonDb: fakeCanonFull, memoryEngine: { all: () => [] } });
  const ls = campaignState.newCampaign("unit9b");
  ls.turn_number = 10;
  ls.npcs = [{ canon_ref: "char_ria", relationship_to_player: { hatred: 0, distance: 0.2 } }];
  const canonDbL = fakeCanonFull;
  const sent = letters.sendLetter(ls, canonDbL, { recipient: "char_ria", content: "곧 만나러 가겠소" });
  check("E4 letter enqueued with distance-based ETA (far → 4턴)", sent.ok && sent.eta_turns === 4 && ls.scheduled_actions.length === 1, sent);
  check("E5 scheduled_action is pending until trigger_turn", ls.scheduled_actions[0].status === "pending" && ls.scheduled_actions[0].trigger_turn === 14, ls.scheduled_actions[0]);
  // before trigger: nothing delivered
  ls.turn_number = 12;
  const early = letters.deliverDue(ls, canonDbL, letterKernel, () => 0.99);
  check("E5 nothing delivered before trigger_turn", early.delivered.length === 0 && early.intercepted.length === 0, early);
  // at trigger, force NO intercept → delivered + response candidate
  ls.turn_number = 14;
  const del = letters.deliverDue(ls, canonDbL, letterKernel, () => 0.99);
  check("E4 delivered on time yields an NPC response candidate", del.delivered.length === 1 && del.directive_candidates.length === 1 && del.directive_candidates[0].action_type === "letter_response", del);
  // a second letter, force intercept → becomes a rumor
  ls.turn_number = 20;
  letters.sendLetter(ls, canonDbL, { recipient: "char_ria", content: "비밀을 전한다" });
  ls.turn_number = 24;
  const intr = letters.deliverDue(ls, canonDbL, letterKernel, () => 0.0);
  check("E4 intercepted letter leaks as a Rumor", intr.intercepted.length === 1, intr);

  // ---- HTTP: dynamic traits surface + letters endpoint ----------------------
  await j("POST", "/api/wizard/create", {
    campaign_id: id, world_name: "9 세계", era: "fantasy", genre_preset: "fantasy",
    regions: [{ canon_id: "loc_9", name: "성", notable_features: ["관문"] }], factions: [],
    player: { birth_name: "테스터9", species: "human", background: "검증", core_values: [], psychology: {} },
    npcs: [], narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  });
  const stW = await j("GET", `/api/state/${id}`);
  check("E1 wizard set tech_level from era", stW.data.world.tech_level === "fantasy_low", stW.data.world.tech_level);

  // seed NPCs so a letter has a recipient
  await j("POST", "/api/seed", { campaign_id: id });
  await j("POST", "/api/turn", { campaign_id: id, player_input: "리아와 인사한다" }); // discover NPC
  const comm = await j("GET", `/api/comm/${id}`);
  check("E4 comm endpoint reports tech_level + letters channel", comm.data.channel === "letters" && comm.data.tech_level === "fantasy_low", comm.data);

  // F2/F5: a life-changing narrative → mock proposes a trait → surfaces on player
  await j("POST", "/api/turn", { campaign_id: id, player_input: "나는 임신을 확인했다" });
  const player = await j("GET", `/api/player/${id}`);
  check("F2/F4 dynamic trait appears player-facing (description only)", (player.data.dynamic_traits || []).some((t) => t.name === "모성") && (player.data.dynamic_traits || []).every((t) => t.value === undefined), player.data.dynamic_traits);
  const adv = await j("GET", `/api/advanced/${id}`);
  check("F4 Advanced psychology carries dynamic_traits with value", (adv.data.psychology.dynamic_traits || []).some((t) => t.name === "모성" && t.value != null), adv.data.psychology.dynamic_traits);

  // F5: a trivial scene proposes NO trait
  const before = (await j("GET", `/api/player/${id}`)).data.dynamic_traits.length;
  await j("POST", "/api/turn", { campaign_id: id, player_input: "가벼운 잡담을 나눈다" });
  const after = (await j("GET", `/api/player/${id}`)).data.dynamic_traits.length;
  check("F5 trivial scene adds no new trait", after === before, { before, after });

  await j("DELETE", `/api/campaign/${id}`);
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
