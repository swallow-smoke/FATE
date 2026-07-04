// Router + init. Routes: #/ (launcher), #/new (wizard), #/c/<id> (game).
"use strict";

function showView(name) {
  ["launcher", "launcher-settings", "wizard", "game"].forEach((v) => $("view-" + v).classList.toggle("hidden", v !== name));
}

async function route() {
  const h = location.hash || "#/";
  if (h.startsWith("#/c/")) {
    const id = h.slice(4);
    showView("game");
    if (NOS.campaign !== id) await enterCampaign(id);
  } else if (h === "#/settings") {
    showView("launcher-settings");
    NOS.campaign = null;
    renderLauncherSettings();
  } else if (h === "#/new") {
    showView("wizard");
    if (!maybeResumeWizardDraft()) setWizStep(1); // Phase 7 Part B — draft resume
  } else {
    showView("launcher");
    NOS.campaign = null;
    renderLauncher();
  }
}

// Load a campaign into the game view (restores chat + dev panels + settings).
async function enterCampaign(id) {
  NOS.campaign = id;
  localStorage.setItem("nos_campaign", id);
  $("log").innerHTML = "";
  const s = await api("/api/state/" + id);
  NOS.settingsCache = s.settings || {};
  NOS.playerStats = (s.player && s.player.stats) || {}; // Phase 10 H — choice hints
  window._playerName = (s.player && s.player.name) || ""; // C8 — speaker attribution
  refreshAdvancedButton(!!(s.settings && s.settings.advanced_mode)); // Phase 7 Part D
  const displayName = (s.meta && (s.meta.display_name || s.meta.world_name)) || id;
  $("campTitle").textContent = `${(s.meta && s.meta.icon) || "📖"} ${displayName}`;
  $("campSub").textContent = `턴 ${s.turn_number} · ${s.in_world_date || ""}`;
  if (s.player && s.player.emotion_state && s.player.emotion_state.current_wave) {
    setEmotionalResonance(s.player.emotion_state.current_wave.primary_emotion, s.player.emotion_state.current_wave.intensity);
  } else {
    setEmotionalResonance("calm", 0);
  }
  addSystem(`캠페인 "${displayName}" 로드됨 · 현재 턴 ${s.turn_number}.`);
  window._bookmarkedTurns = s.bookmarked_turns || [];
  await updateMentionCandidates(); // C8 — load speaker list before replaying history
  (s.recent_dialogue || []).forEach((r) => { addPlayer(r.player); addGM(r.gm, r.turn + 1, r.in_world_date, NOS.emotion.name, NOS.emotion.intensity, { skipKinetic: true }); });
  renderProgress(s.story_structure);
  applyDnaTheme(s.narrative_dna);
  if (s.ending && s.ending.reached && s.ending.summary) showEndingScreen(s.ending.summary);

  // dev panel hydration
  if (s.player && s.player.emotion_state) {
    const e = s.player.emotion_state;
    renderEmotion({ primary_emotion: e.current_wave.primary_emotion, intensity: e.current_wave.intensity, fatigue_tracker: e.fatigue_tracker, recent_history: e.recent_history }, e.resonance_profile);
  } else renderEmotion(null);
  renderMemoryThisTurn([]);
  renderHealth(s.campaign_health && s.campaign_health.metrics, null, { self_reflection: s.self_reflection });
  refreshHealth();
  NOS.lastTrace = null; renderTrace(null);
  refreshCanon();

  // undo availability + recap modal (Wave 1)
  try {
    const u = await api("/api/undo/" + id);
    $("undoBtn").disabled = !u.available;
    $("regenBtn").disabled = !u.available;
  } catch (e) { $("undoBtn").disabled = true; $("regenBtn").disabled = true; }
  maybeShowRecap();

  // C5/C6 — load notifications silently on enter (no toast burst for old items).
  refreshNotifications({ silent: true });

  // return to story tab
  document.querySelector('.ptab[data-ptab="story"]').click();
}

// ---------- init ----------
window.addEventListener("hashchange", route);
document.addEventListener("DOMContentLoaded", () => {
  wireDevPanel();
  wireStoryControls();
  wirePlayerTabs();
  wireNotifications(); // C5/C6/C7
  wireAdvanced();
  wireLauncher();
  wireWizard();
  applyAccessibility();
  setEmotionalResonance("calm", 0);
  api("/api/status").then((d) => {
    $("mode").textContent = d.mock ? "· MOCK 모드 (API 키 없음)" : "· LIVE (" + d.narrative_model + ")";
  }).catch(() => {});
  route();
});
