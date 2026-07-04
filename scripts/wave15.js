// Phase 15 smoke — custom themes (BB), plugin system (CC), preview (DD).
const BASE = "http://localhost:3000";
const id = "smoke15_" + Date.now().toString(36);

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
  console.log("== Phase 15 smoke ==", id);

  // ---- BB2 theme token validation (in-process) -----------------------------
  const themes = require("../src/theme/themes");
  const good = themes.validateTokens({ "--color-bg": "#1a1f26", "--color-accent": "rgb(74,144,164)", "--font-body": "Noto Serif KR", "--radius-base": "6px" });
  check("BB2 valid tokens pass", good.ok && good.tokens["--color-bg"] === "#1a1f26", good);
  check("BB2 url()/script value rejected", !themes.validateTokens({ "--color-bg": "url(http://x)" }).ok);
  check("BB2 javascript: scheme rejected", !themes.validateTokens({ "--color-bg": "javascript:alert(1)" }).ok);
  check("BB2 unknown variable name rejected", themes.validateTokens({ "--evil-var": "#fff" }).rejected.some((r) => r.key === "--evil-var"));
  check("BB2 unregistered font rejected", !themes.validateTokens({ "--font-body": "Comic Sans" }).ok);
  check("BB2 radius out of range rejected", !themes.validateTokens({ "--radius-base": "999px" }).ok);

  // ---- CC3 plugin manifest validation (in-process) -------------------------
  const plugins = require("../src/plugins/plugins");
  const okm = plugins.validateManifest({ name: "테스트팩", extends: [{ type: "scene_type", value: { id: "hacking", label: "해킹", tone_notes: "긴장", EVIL: "x" } }] });
  check("CC3 valid scene_type manifest passes", okm.ok && okm.manifest.extends[0].value.label === "해킹", okm.reason);
  check("CC3 extra fields stripped (no EVIL)", okm.ok && okm.manifest.extends[0].value.EVIL === undefined, okm.manifest.extends[0].value);
  check("CC3 disallowed extension type rejected", !plugins.validateManifest({ extends: [{ type: "new_director", value: {} }] }).ok);
  check("CC3 missing required field rejected", !plugins.validateManifest({ extends: [{ type: "scene_type", value: { id: "x" } }] }).ok);
  check("CC3 advanced_widget bad data_source rejected", !plugins.validateManifest({ extends: [{ type: "advanced_widget", value: { title: "t", data_source: "SECRET", render: "list" } }] }).ok);

  // ---- HTTP: theme generate → preview → save → delete ----------------------
  const tg = await j("POST", "/api/themes/generate", { description: "습기 찬 항구도시, 짙은 청록" });
  check("BB3 generate returns valid tokens + human preview (DD)", tg.data.valid && typeof tg.data.preview === "string" && tg.data.preview.length > 0, tg.data);
  const ts = await j("POST", "/api/themes", { name: "항구 테마", tokens: tg.data.tokens, description: "습기 찬 항구도시" });
  check("BB save persists a validated theme", ts.data.ok && ts.data.theme.theme_id, ts.data);
  const tl = await j("GET", "/api/themes");
  check("theme appears in list", (tl.data.themes || []).some((t) => t.theme_id === ts.data.theme.theme_id));
  const tbad = await j("POST", "/api/themes", { name: "나쁜테마", tokens: { "--color-bg": "url(x)" } });
  check("BB save rejects invalid tokens (422)", tbad.status === 422, tbad.status);
  await j("DELETE", `/api/themes/${ts.data.theme.theme_id}`);

  // ---- HTTP: plugin generate → register (Kernel) → toggle → consume → delete
  const pg = await j("POST", "/api/plugins/generate", { description: "사이버펑크 팩" });
  check("CC4 generate returns a valid manifest + preview", pg.data.valid && (pg.data.preview || []).length > 0, pg.data);
  const manifest = { name: "사이버펑크 팩", extends: [
    { type: "scene_type", value: { id: "hacking15", label: "해킹15", tone_notes: "긴장, 시간 압박" } },
    { type: "dynamic_trait_preset", value: { genre: "cyberpunk15", trait_name: "해킹 숙련도" } },
    { type: "house_rules_bundle", value: { name: "사펑 규칙", rules_text: "네온을 자주 묘사한다\n기업의 존재감을 유지한다" } },
  ] };
  const pr = await j("POST", "/api/plugins", { manifest });
  check("CC3 register via Kernel succeeds", pr.data.ok && pr.data.plugin.plugin_id, pr.data);
  const pid = pr.data.plugin.plugin_id;
  check("CC plugin scene-type label is merged into engine table", plugins.sceneTypeLabels()["hacking15"] === "해킹15", plugins.sceneTypeLabels());
  check("CC plugin trait preset merged", plugins.traitPresets()["cyberpunk15"] === "해킹 숙련도", plugins.traitPresets());
  const preg = await j("POST", "/api/plugins", { manifest: { extends: [{ type: "bogus", value: {} }] } });
  check("CC register rejects invalid manifest (422)", preg.status === 422, preg.status);

  // house_rules_bundle applied to a campaign
  await j("POST", "/api/wizard/create", {
    campaign_id: id, world_name: "15 세계", era: "fantasy", genre_preset: "fantasy",
    regions: [{ canon_id: "loc_15", name: "성", notable_features: ["x"] }], factions: [],
    player: { birth_name: "테스터15", species: "human", background: "t", core_values: [], psychology: {} },
    npcs: [], narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  });
  const ap = await j("POST", `/api/campaign/${id}/apply-plugin-bundle`, { plugin_id: pid });
  check("CC house_rules_bundle applies to campaign House Rules", ap.data.ok && ap.data.house_rules.includes("네온을 자주 묘사한다"), ap.data);

  // toggle off → scene label no longer merged
  await j("POST", `/api/plugins/${pid}/toggle`, { enabled: false });
  check("CC toggle disables consumption", plugins.sceneTypeLabels()["hacking15"] === undefined);

  // cleanup
  await j("DELETE", `/api/plugins/${pid}`);
  await j("DELETE", `/api/campaign/${id}`);
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
