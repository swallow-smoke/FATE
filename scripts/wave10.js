// Phase 10 smoke — stats (M1/M2/M3), countdowns (O), choice-hint data (H),
// daily summary (J2), schedule hints (J1). (1) in-process (2) HTTP (mock :3000)
const BASE = "http://localhost:3000";
const id = "smoke10_" + Date.now().toString(36);

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
  console.log("== Phase 10 smoke ==", id);
  const campaignState = require("../src/state/campaignState");
  const { createKernel } = require("../src/kernel/kernel");
  const presets = require("../src/game/genreStatPresets");
  const countdowns = require("../src/game/countdowns");

  // ---- M1: genre preset ------------------------------------------------------
  const stf = campaignState.newCampaign("unit10");
  stf.world.tech_level = "fantasy_low";
  const applied = presets.applyPreset(stf);
  check("M1 fantasy_low starts with 마력 trait (value 0, visible)", applied && applied.name === "마력" && applied.value === 0 && applied.visible_to_player === true, applied);
  check("M1 preset is idempotent (no duplicate)", presets.applyPreset(stf) === null, stf.player.dynamic_traits.length);
  const stMed = campaignState.newCampaign("unit10b"); stMed.world.tech_level = "medieval";
  check("M1 medieval has no forced special stat", presets.applyPreset(stMed) === null, presets.presetFor("medieval"));

  // ---- M3: trait.delete leaves a Historical memory ---------------------------
  const mems = [];
  const kernel = createKernel({ canonDb: { get: () => null, all: () => [] }, memoryEngine: { all: () => mems, write: (o, t) => { const m = { id: "m" + mems.length, ...o, timestamp: { campaign_turn: t } }; mems.push(m); return m; } } });
  stf.turn_number = 50;
  const del = kernel.request(stf, "sd", "trait.delete", { name: "마력" });
  check("M3 trait.delete removes the trait", del.approved && !stf.player.dynamic_traits.some((t) => t.name === "마력"), del);
  check("M3 trait.delete writes a Historical (tier 3) memory note", mems.some((m) => m.tier === 3 && /마력/.test(m.summary)), mems);

  // ---- O: countdown shows only revealed events -------------------------------
  const stc = campaignState.newCampaign("unit10c");
  stc.turn_number = 10;
  stc.scheduled_actions = [
    { action_id: "a1", type: "letter_delivery", status: "pending", trigger_turn: 14, revealed_to_player: true, payload: { recipient: "char_x" } },
    { action_id: "a2", type: "npc_response", status: "pending", trigger_turn: 13, revealed_to_player: false, payload: {} },
  ];
  stc.foreshadow_pool = [{ id: "f1", deadline_turn: 20, resolved: false, revealed_to_player: true, label: "사절단 도착" }];
  const cds = countdowns.build(stc);
  check("O includes revealed letter + revealed foreshadow", cds.length === 2, cds);
  check("O excludes the unrevealed scheduled action (no spoilers)", !cds.some((c) => c.kind === "npc_response"), cds);
  check("O is sorted by turns_left ascending", cds[0].turns_left <= cds[1].turns_left, cds);

  // ---- HTTP: M1 on wizard create, M2 manual add, H stats, J2 daily, J1 sched -
  await j("POST", "/api/wizard/create", {
    campaign_id: id, world_name: "10 세계", era: "fantasy", genre_preset: "fantasy",
    regions: [{ canon_id: "loc_10", name: "성", notable_features: ["관문"] }], factions: [],
    player: { birth_name: "테스터10", species: "human", background: "검증", core_values: [], psychology: {} },
    npcs: [], narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  });
  const pl0 = await j("GET", `/api/player/${id}`);
  check("M1 wizard-created fantasy campaign has 마력 trait", (pl0.data.dynamic_traits || []).some((t) => t.name === "마력"), pl0.data.dynamic_traits);
  check("H player endpoint exposes stats for choice hints", pl0.data.stats && typeof pl0.data.stats === "object", pl0.data.stats);

  const add = await j("POST", `/api/player/${id}/trait`, { name: "손재주", description: "무엇이든 잘 만든다" });
  check("M2 manual trait add", add.data.ok && add.data.trait.origin === "manual", add.data);
  const dupAdd = await j("POST", `/api/player/${id}/trait`, { name: "손재주" });
  check("M2 duplicate manual trait rejected (409)", dupAdd.status === 409, dupAdd.data);

  // J2 — a time-skip that rolls the in-world day emits a daily summary
  const skip = await j("POST", "/api/turn", { campaign_id: id, player_input: "하루를 보낸다", time_skip: { amount: 1, unit: "일" } });
  check("J2 day rollover produces a daily summary", skip.data.daily_summary && skip.data.daily_summary.summary, skip.data.daily_summary);
  check("O turn response carries countdowns array", Array.isArray(skip.data.countdowns), skip.data.countdowns);

  // O — send a letter (revealed), confirm it shows in worldtab countdowns
  await j("POST", "/api/seed", { campaign_id: id });
  const letter = await j("POST", `/api/campaign/${id}/letter`, { recipient: "char_ria", content: "곧 찾아가겠소" });
  check("O letter enqueued", letter.data.ok, letter.data);
  const wt = await j("GET", `/api/worldtab/${id}`);
  check("O worldtab exposes countdowns including the sent letter", (wt.data.countdowns || []).some((c) => c.kind === "letter_delivery"), wt.data.countdowns);

  // J1 — seeded NPC carries a schedule_hint in canon
  const canon = await j("GET", `/api/canon/${id}`);
  check("J1 seeded NPC has a schedule_hint in canon", (canon.data.entities || []).some((e) => e.data && e.data.schedule_hint), (canon.data.entities || []).map((e) => e.canon_id));

  await j("DELETE", `/api/campaign/${id}`);
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
