// Phase 4 A1 (built now) + Phase 5 Wave 4 + Phase 6 C/D/E — launcher: campaign
// card grid, empty state, "+새 캠페인" card, delete/duplicate, sort, file
// import, "오늘의 명대사" banner (rule-based selection, no AI call).
"use strict";

let launcherSort = "recent";
let launcherFilter = "active"; // Phase 8 A3 — 진행 중 / 완결됨 / 전체
let launcherList = [];

function isCompleted(c) { return c.campaign_status === "completed" || c.ended; }

function sortCampaigns(list, mode) {
  const arr = list.slice();
  if (mode === "name") arr.sort((a, b) => (a.display_name || a.world_name || a.campaign_id).localeCompare(b.display_name || b.world_name || b.campaign_id, "ko"));
  else if (mode === "turns") arr.sort((a, b) => b.turn_number - a.turn_number);
  else arr.sort((a, b) => new Date(b.updated) - new Date(a.updated));
  return arr;
}

async function renderLauncher() {
  const grid = $("launcherGrid");
  grid.innerHTML = `<div class="muted">캠페인을 불러오는 중…</div>`;
  try { launcherList = await api("/api/campaigns"); } catch (e) { launcherList = []; }

  if (!launcherList.length) {
    $("quoteBanner").classList.add("hidden");
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-mark">N</div>
        <h2>아직 시작된 이야기가 없습니다</h2>
        <button class="primary big-btn" onclick="location.hash='#/new'">＋ 새 캠페인 만들기</button>
      </div>`;
    return;
  }

  showQuoteBanner(sortCampaigns(launcherList, "recent")[0]);
  renderLauncherGrid();
}

function cardHtml(c) {
  return `
    <div class="camp-card" data-id="${escapeHtml(c.campaign_id)}">
      <div class="cc-head">
        <span class="cc-icon">${c.ended ? "✦" : escapeHtml(c.icon || "📖")}</span>
        <button class="cc-menu" data-id="${escapeHtml(c.campaign_id)}" title="더보기">⋯</button>
      </div>
      <b class="cc-name">${escapeHtml(c.display_name || c.world_name || c.campaign_id)}</b>
      <div class="cc-meta">턴 ${c.turn_number}${c.in_world_date ? " · " + escapeHtml(c.in_world_date) : ""}${c.ended ? " · 완결" : ""}</div>
      <div class="cc-summary">${escapeHtml(c.summary || "새로 시작된 이야기")}</div>
      <div class="cc-updated">${fmtDate(c.updated)}</div>
    </div>`;
}

function renderLauncherGrid() {
  const grid = $("launcherGrid");
  const sorted = sortCampaigns(launcherList, launcherSort);
  const active = sorted.filter((c) => !isCompleted(c));
  const completed = sorted.filter(isCompleted);

  let html = "";
  if (launcherFilter === "completed") {
    html = completed.map(cardHtml).join("") || `<div class="muted">완결된 캠페인이 없습니다.</div>`;
  } else {
    html = active.map(cardHtml).join("") + `
      <div class="camp-card new-card" onclick="location.hash='#/new'">
        <div class="cc-plus">＋</div><b>새 캠페인</b>
      </div>`;
    // "전체"일 때만 완결 섹션을 접어서 함께 노출.
    if (launcherFilter === "all" && completed.length) {
      html += `<div class="archive-divider">완결된 이야기 (${completed.length})</div>` + completed.map(cardHtml).join("");
    }
  }
  grid.innerHTML = html;

  grid.querySelectorAll(".camp-card[data-id]").forEach((card) =>
    card.addEventListener("click", (e) => {
      if (e.target.classList.contains("cc-menu")) return;
      location.hash = "#/c/" + card.dataset.id;
    }));
  grid.querySelectorAll(".cc-menu").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCardMenu(btn.dataset.id, btn);
    }));
}

function openCardMenu(id, anchorBtn) {
  const rect = anchorBtn.getBoundingClientRect();
  document.querySelectorAll(".card-menu-pop").forEach((m) => m.remove());
  const pop = document.createElement("div");
  pop.className = "card-menu-pop";
  pop.style.top = rect.bottom + 4 + "px";
  pop.style.left = Math.max(8, rect.right - 140) + "px";
  pop.innerHTML = `
    <button data-act="dup">⑂ 복제</button>
    <button data-act="del" class="danger">🗑 삭제</button>`;
  document.body.appendChild(pop);
  const close = () => pop.remove();
  setTimeout(() => document.addEventListener("click", close, { once: true }), 0);

  pop.querySelector('[data-act="dup"]').addEventListener("click", async (e) => {
    e.stopPropagation();
    const to = (prompt("복제본 캠페인 ID:", id + "_copy") || "").trim();
    close();
    if (!to) return;
    try { await apiPost("/api/campaign/saveas", { from: id, to }); renderLauncher(); showBanner(`"${id}" → "${to}" 로 복제됨.`); }
    catch (err) { showBanner("복제 실패: " + err.message); }
  });
  pop.querySelector('[data-act="del"]').addEventListener("click", async (e) => {
    e.stopPropagation();
    close();
    if (!confirm(`캠페인 "${id}"을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await api("/api/campaign/" + id, { method: "DELETE" });
    renderLauncher();
  });
}

// Phase 6 E — "오늘의 명대사": rule-based (bookmark-first) selection, no LLM.
async function showQuoteBanner(topCampaign) {
  if (!topCampaign) { $("quoteBanner").classList.add("hidden"); return; }
  try {
    const d = await api("/api/quote/" + topCampaign.campaign_id);
    if (!d.quote) { $("quoteBanner").classList.add("hidden"); return; }
    $("quoteBanner").innerHTML = `<span class="qb-mark">❝</span> ${escapeHtml(d.quote.text)} <span class="qb-src">— ${escapeHtml(topCampaign.display_name || topCampaign.world_name || topCampaign.campaign_id)}, 턴 ${d.quote.turn}${d.quote.source === "bookmark" ? " · 북마크됨" : ""}</span>`;
    $("quoteBanner").classList.remove("hidden");
  } catch (e) { $("quoteBanner").classList.add("hidden"); }
}

// Wave 4 — file import: full backup restore OR world-template-only import.
function wireLauncher() {
  // App-wide settings live in their own view (#/settings) — screen/theme,
  // accessibility, custom themes, API keys, plugins, aggregate usage.
  $("launcherSettingsBtn").addEventListener("click", () => { location.hash = "#/settings"; });
  $("lsBack").addEventListener("click", () => { location.hash = "#/"; });

  $("sortSel").addEventListener("change", (e) => { launcherSort = e.target.value; renderLauncherGrid(); });
  $("filterSel").addEventListener("change", (e) => { launcherFilter = e.target.value; renderLauncherGrid(); }); // Phase 8 A3

  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    let bundle;
    try { bundle = JSON.parse(await file.text()); } catch { showBanner("JSON 파일을 읽을 수 없습니다."); return; }
    if (bundle.format !== "narrativeos_backup_v1") { showBanner("NarrativeOS 백업 파일이 아닙니다."); return; }
    openModal(`
      <h3>파일에서 불러오기</h3>
      <p class="muted">"${escapeHtml((bundle.state && bundle.state.campaign_id) || "백업")}" — 어떻게 가져올까요?</p>
      <div class="modal-row"><input id="impId" placeholder="새 캠페인 ID" value="camp_${Date.now().toString(36)}" /></div>
      <div class="modal-actions">
        <button id="impFull" class="primary">캠페인 전체 복원</button>
        <button id="impWorld">세계관 템플릿만 (지역/세력)</button>
        <button onclick="closeModal()">취소</button></div>`);
    const doImport = async (mode) => {
      try {
        const d = await apiPost("/api/import", { bundle, new_id: $("impId").value.trim(), mode });
        closeModal();
        renderLauncher();
        showBanner(`불러오기 완료: ${d.campaign_id}`);
      } catch (err) { showBanner("불러오기 실패: " + err.message); }
    };
    $("impFull").addEventListener("click", () => doImport("full"));
    $("impWorld").addEventListener("click", () => doImport("world_template"));
  });
}
