// Phase 5 smoke test — exercises the new endpoints end-to-end against a
// running server (http://localhost:3000). Uses a throwaway campaign id.
const BASE = "http://localhost:3000";
const id = "smoke5_" + Date.now().toString(36);

async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ""); }
}

(async () => {
  console.log("== Phase 5 smoke ==", id);

  // 1. wizard create (mock-shaped payload; skips live LLM by passing confirmed data)
  const world = {
    campaign_id: id, world_name: "스모크 세계", era: "fantasy", genre_preset: "fantasy",
    regions: [{ canon_id: "loc_smoke_town", name: "스모크 마을", terrain: "urban", notable_features: ["테스트 마을"] }],
    factions: [{ canon_id: "faction_smoke", name: "스모크 조합", founding_principle: "mutual_aid", leader: "갈", stance: "neutral" }],
    player: { birth_name: "테스터", species: "human", background: "시험을 위해 태어난 자", core_values: ["검증"], psychology: { core_fear: "버그", desire: "그린 테스트" } },
    npcs: [{ canon_id: "char_smokey", birth_name: "스모키", species: "human", role: "npc", core_values: ["loyalty"], current_location: "loc_smoke_town", affiliations: ["faction_smoke"], goal_current: "마을 지키기", psychology: { attachment_style: "secure", core_fear: "화재", desire: "평온", defense_mechanism: "유머" } }],
    narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  };
  const created = await j("POST", "/api/wizard/create", world);
  check("wizard/create ok", created.status === 200 && created.data.ok, created.data);
  check("wizard registered 3 canon", created.data.registered === 3, created.data);

  // 2. state has Phase 5 fields
  const st = await j("GET", `/api/state/${id}`);
  check("state.inventory[]", Array.isArray(st.data.inventory));
  check("state.house_rules[]", Array.isArray(st.data.house_rules));
  check("state.meta.world_name", st.data.meta.world_name === "스모크 세계");
  check("player.stats", st.data.player.stats && st.data.player.stats["설득"] === 1);

  // 3. settings patch (DNA + house rules + choices toggle)
  const set = await j("POST", `/api/state/${id}/settings`, {
    narrative_dna: { horror: 5 },
    settings: { choices_ui: true, content_intensity: "low" },
    house_rules: ["전투 묘사는 짧게"],
  });
  check("settings patch", set.data.ok && set.data.narrative_dna.horror === 5 && set.data.settings.choices_ui === true);

  // 4. a turn with a skill-check trigger + time skip
  const t1 = await j("POST", "/api/turn", { campaign_id: id, player_input: "마을 사람을 설득해서 하룻밤 묵게 해달라고 한다", debug: true, time_skip: { amount: 3, unit: "일" } });
  check("turn ok", t1.status === 200 && !!t1.data.narrative, t1.data && t1.data.error);
  check("skill check fired", t1.data.check && t1.data.check.skill === "설득", t1.data.check);
  check("time skip advanced date", /4일차/.test(t1.data.in_world_date), t1.data.in_world_date);
  check("undo available after turn", t1.data.undo_available === true);
  check("no numbers leaked in narrative", !/(trust|신뢰도\s*[+\-]\d|DC\s*\d|1d20)/i.test(t1.data.narrative));

  // 5. undo → turn count rolls back
  const undoR = await j("POST", `/api/campaign/${id}/undo`);
  check("undo ok", undoR.status === 200 && undoR.data.ok, undoR.data);
  const st2 = await j("GET", `/api/state/${id}`);
  check("turn rolled back to 0", st2.data.turn_number === 0, st2.data.turn_number);

  // 6. player/world/wiki/relations/inventory/usage endpoints
  const [pl, wt, wk, rel, inv, us] = await Promise.all([
    j("GET", `/api/player/${id}`), j("GET", `/api/worldtab/${id}`), j("GET", `/api/wiki/${id}`),
    j("GET", `/api/relations/${id}`), j("GET", `/api/inventory/${id}`), j("GET", `/api/usage/${id}`),
  ]);
  check("player tab", pl.data.name === "테스터", pl.data);
  check("worldtab shape", Array.isArray(wt.data.timeline) && Array.isArray(wt.data.rumors) && Array.isArray(wt.data.reputation));
  check("wiki discovered pages (region+faction)", (wk.data.pages || []).length >= 2, wk.data.pages && wk.data.pages.map((p) => p.canon_id));
  check("wiki hides undiscovered npc", (wk.data.undiscovered_ids || []).includes("char_smokey"), wk.data.undiscovered_ids);
  check("relations empty before meeting", (rel.data.player_edges || []).length === 0);
  check("inventory empty", (inv.data.items || []).length === 0);
  check("usage log exists", typeof us.data.calls === "number");

  // 7. wiki page render — sentence style with [[links]]
  const page = (wk.data.pages || []).find((p) => p.canon_id === "faction_smoke");
  check("wiki faction page sentence-style", page && /스모크 조합/.test(page.body) && /세력이다/.test(page.body), page && page.body);

  // 8. export → import as new campaign
  const exp = await j("GET", `/api/export/${id}`);
  check("export bundle", exp.data.format === "narrativeos_backup_v1" && exp.data.canon.length >= 3);
  const imp = await j("POST", "/api/import", { bundle: exp.data, new_id: id + "_re", mode: "full" });
  check("full import", imp.data.ok, imp.data);
  const impW = await j("POST", "/api/import", { bundle: exp.data, new_id: id + "_tpl", mode: "world_template" });
  check("world-template import", impW.data.ok && impW.data.imported === 2, impW.data);

  // 9. recap (force)
  const rc = await j("GET", `/api/recap/${id}?force=1`);
  check("recap endpoint", rc.status === 200);

  // 10. campaigns list shows the new cards with metadata
  const list = await j("GET", "/api/campaigns");
  const card = (list.data || []).find((c) => c.campaign_id === id);
  check("launcher card metadata", card && card.world_name === "스모크 세계", card);

  // cleanup
  for (const cid of [id, id + "_re", id + "_tpl"]) await j("DELETE", `/api/campaign/${cid}`);
  const after = await j("GET", "/api/campaigns");
  check("cleanup", !(after.data || []).some((c) => c.campaign_id.startsWith(id)));

  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
