// Phase 13-15 UI smoke — drives a real browser to catch frontend JS errors in
// the new Advanced tabs (prompt/performance), settings theme/plugin cards, and
// the snapshot-restore section. Structural (backend) coverage is in wave13-15.
const { chromium } = require("playwright");
const BASE = "http://localhost:3000";
const id = "uicheck_" + Date.now().toString(36);

let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name, extra || ""); } }
async function api(path, body) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

(async () => {
  console.log("== UI check ==", id);
  await api("/api/wizard/create", {
    campaign_id: id, world_name: "UI 세계", era: "fantasy", genre_preset: "fantasy",
    regions: [{ canon_id: "loc_ui", name: "성", notable_features: ["x"] }], factions: [],
    player: { birth_name: "UI테스터", species: "human", background: "t", core_values: [], psychology: {} },
    npcs: [], narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  });
  await api("/api/seed", { campaign_id: id });
  await api("/api/turn", { campaign_id: id, player_input: "성을 둘러본다" });
  await fetch(`${BASE}/api/state/${id}/advanced-mode`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto(`${BASE}/#/c/${id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("app loaded without errors", errors.length === 0, errors.join(" | "));

  // Open Advanced panel + click the new tabs.
  await page.click("#advancedBtn").catch(() => {});
  await page.waitForTimeout(400);
  const advVisible = await page.isVisible("#advancedPanel").catch(() => false);
  check("Advanced panel opens", advVisible);
  for (const t of ["prompt", "performance", "psychology", "health"]) {
    await page.click(`#advTabs .atab[data-atab="${t}"]`).catch(() => {});
    await page.waitForTimeout(200);
  }
  check("Advanced prompt/performance tabs render without errors", errors.length === 0, errors.join(" | "));
  await page.click("#advClose").catch(() => {});

  // Campaign settings tab now only holds story-affecting settings; the theme/
  // plugin/usage/key cards moved to the launcher settings view (#/settings).
  await page.click('.ptab[data-ptab="settings"]').catch(() => {});
  await page.waitForTimeout(500);
  const pointerVisible = await page.isVisible("#gotoLauncherSettings").catch(() => false);
  check("campaign settings tab links to launcher settings", pointerVisible);

  // Launcher settings view — exercise theme + plugin generators there.
  await page.goto(`${BASE}/#/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.fill("#themeDesc", "짙은 청록 항구").catch(() => {});
  await page.click("#themeGen").catch(() => {});
  await page.waitForTimeout(600);
  const themePrev = await page.textContent("#themePreview").catch(() => "");
  check("theme generate produces a preview", themePrev && themePrev.length > 0, themePrev);
  await page.fill("#pluginDesc", "사이버펑크 도시").catch(() => {});
  await page.click("#pluginGen").catch(() => {});
  await page.waitForTimeout(600);
  const plugPrev = await page.textContent("#pluginPreview").catch(() => "");
  check("plugin generate produces a preview", plugPrev && plugPrev.length > 0, plugPrev);
  check("no JS errors after settings interactions", errors.length === 0, errors.join(" | "));

  await browser.close();
  await fetch(`${BASE}/api/campaign/${id}`, { method: "DELETE" });
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("UI CHECK CRASH:", e); process.exit(1); });
