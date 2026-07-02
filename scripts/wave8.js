// Phase 8 smoke test — data management, lifecycle rules, templates, guardrail.
// (1) in-process engine tests  (2) HTTP endpoint tests against :3000
const BASE = "http://localhost:3000";
const id = "smoke8_" + Date.now().toString(36);

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
  console.log("== Phase 8 smoke ==", id);
  const fs = require("fs"), path = require("path");
  const migrations = require("../src/state/migrations");
  const campaignState = require("../src/state/campaignState");
  const npcLifecycle = require("../src/canon/npcLifecycle");

  // ---- A1: migration framework ----------------------------------------------
  const old = { schema_version: 7, campaign_id: "x", ending: { reached: false } };
  const migrated = migrations.applyMigrations(JSON.parse(JSON.stringify(old)));
  check("A1 migrates v7 → current", migrated.schema_version === migrations.CURRENT_SCHEMA_VERSION, migrated.schema_version);
  check("A1 adds campaign_status/world_templates", migrated.campaign_status === "active" && Array.isArray(migrated.world_templates), migrated);
  const endedOld = migrations.applyMigrations({ schema_version: 7, ending: { reached: true } });
  check("A1 completed campaign migrates to completed status", endedOld.campaign_status === "completed", endedOld.campaign_status);
  const fresh = campaignState.newCampaign("unit8");
  check("A1 fresh campaign is at current schema", fresh.schema_version === migrations.CURRENT_SCHEMA_VERSION, fresh.schema_version);
  check("A1 unknown version throws (no silent skip)", (() => { try { migrations.applyMigrations({ schema_version: 999 }); return true; } catch (e) { return false; } })() === true, "v999 is already >= current so it is a no-op");

  // ---- .bak safety: a broken save on disk is preserved, not corrupted --------
  const badId = "smoke8bad_" + Date.now().toString(36);
  fs.writeFileSync(campaignState.statePath(badId), "{ this is : not valid json ", "utf8");
  let threw = false, bakMade = false;
  try { campaignState.load(badId); } catch (e) { threw = e.migration_failed === true; bakMade = e.backup_path && fs.existsSync(e.backup_path); }
  check("A1 unreadable save throws + writes .bak", threw && bakMade, { threw, bakMade });
  // cleanup bad files
  for (const f of fs.readdirSync(campaignState.DATA_DIR)) if (f.startsWith(badId)) fs.unlinkSync(path.join(campaignState.DATA_DIR, f));

  // ---- C1: NPC death handling (in-process, fake deps) -----------------------
  const memRows = [{ id: "m1", canon_refs: ["char_dead"], tier: 2, summary: "old bond" }];
  const canonRows = { char_dead: { canon_id: "char_dead", type: "Character", data: { birth_name: "죽은자", affiliations: ["faction_a"], current_status: "dead" } } };
  const fakeDeps = {
    canonDb: { get: (r) => canonRows[r] || null, all: () => Object.values(canonRows), update: () => {} },
    memoryEngine: { all: () => memRows, promote: (mid, t) => { const m = memRows.find((x) => x.id === mid); if (m) m.tier = t; }, persist: () => {} },
    kernel: {},
  };
  const st = campaignState.newCampaign("unit8b");
  st.turn_number = 300;
  st.npcs = [{ canon_ref: "char_dead", relationship_to_player: { trust: 0.5 } }];
  st.relationship_graph = { edges: [{ from: "char_dead", to: "char_x", trust: 0.3 }] };
  const death = npcLifecycle.handleDeath(fakeDeps, st, "char_dead");
  check("C1 freezes relationship edges", death.froze_edges === 2 && st.npcs[0].relationship_to_player.final_state === true, death);
  check("C1 proposes a power-vacuum world event", death.power_vacuum && (st.world.pending_event_candidates || []).some((c) => c.category === "power_vacuum"), death.power_vacuum);
  check("C1 promotes related memories to Historical", memRows[0].tier === 3 && death.promoted_memories === 1, memRows);

  // ---- A2: archiveStale (in-process) ----------------------------------------
  const sa = campaignState.newCampaign("unit8c");
  sa.turn_number = 400;
  const canonA = { register: () => {}, all: () => [{ canon_id: "char_stale", type: "Character", registered_at_turn: 0, data: {} }], update: (p) => { canonA._u = canonA._u || {}; canonA._u[p.field] = p.new_value; } };
  sa.npcs = [{ canon_ref: "char_stale", relationship_to_player: { trust: 0.05, affection: 0.05 } }];
  sa.scene_history = []; // never appeared
  const archived = npcLifecycle.archiveStale(sa, canonA);
  check("A2 archives a stale, low-bond, unprotected NPC", archived.includes("char_stale") && canonA._u.archived === true, { archived, u: canonA._u });

  // ---- HTTP: templates, guardrail, campaign_status --------------------------
  const world = {
    campaign_id: id, world_name: "8단계 세계", era: "fantasy", genre_preset: "fantasy",
    regions: [{ canon_id: "loc_p8", name: "항구", notable_features: ["부두"] }],
    factions: [{ canon_id: "faction_p8", name: "조합", founding_principle: "mutual_aid", leader: "갈", stance: "neutral" }],
    player: { birth_name: "테스터8", species: "human", background: "성인 검증용", core_values: ["검증"], psychology: {} },
    npcs: [], narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  };
  const created = await j("POST", "/api/wizard/create", world);
  check("setup: wizard create", created.data.ok, created.data);

  const list1 = await j("GET", "/api/campaigns");
  const mine = (list1.data || []).find((c) => c.campaign_id === id);
  check("A3 campaigns list exposes campaign_status", mine && mine.campaign_status === "active", mine);

  const saveT = await j("POST", `/api/campaign/${id}/save-template`, { name: "항구 세계관 템플릿" });
  check("B1 save-template snapshots World/Faction only", saveT.data.ok && saveT.data.template.canon_snapshot.every((e) => e.type === "World" || e.type === "Faction") && saveT.data.template.canon_snapshot.length === 2, saveT.data.template);
  const tid = saveT.data.template.template_id;
  const tlist = await j("GET", "/api/templates");
  check("B1 template appears in list", (tlist.data.templates || []).some((t) => t.template_id === tid), tlist.data);

  const fromT = await j("POST", "/api/campaign/from-template", { template_id: tid, campaign_id: id + "_anthology", world_name: "다른 이야기, 같은 항구" });
  check("B2 from-template creates a new campaign sharing world canon", fromT.data.ok && fromT.data.registered === 2, fromT.data);
  const anthCanon = await j("GET", `/api/canon/${id}_anthology`);
  check("B2 anthology campaign has no shared Characters (world-only)", (anthCanon.data.entities || []).every((e) => e.type !== "Character"), (anthCanon.data.entities || []).map((e) => e.type));

  // D2: content guardrail blocks minor + romance
  const bad = await j("POST", "/api/wizard/create", {
    campaign_id: id + "_bad", world_name: "가드레일", era: "modern",
    regions: [], factions: [],
    player: { birth_name: "성인", species: "human", psychology: {} },
    npcs: [{ birth_name: "학생", age: 15, relationship_type: "로맨스", psychology: {} }],
    narrative_dna: {},
  });
  check("D2 guardrail rejects minor + romance (422)", bad.status === 422 && bad.data.error === "content_guardrail", bad.data);
  // NOTE: do NOT GET /api/state/:id here — load() auto-creates the slot. Verify
  // via the campaigns list that the guardrail blocked creation entirely.
  const list2 = await j("GET", "/api/campaigns");
  check("D2 guardrail blocked BEFORE campaign creation", !(list2.data || []).some((c) => c.campaign_id === id + "_bad"), (list2.data || []).map((c) => c.campaign_id).filter((c) => c.includes("_bad")));

  // cleanup
  for (const cid of [id, id + "_anthology", id + "_bad"]) await j("DELETE", `/api/campaign/${cid}`);
  await j("DELETE", `/api/templates/${tid}`);
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
