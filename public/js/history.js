// Phase 6 B — 채팅 텍스트 검색, 북마크, 세션 경계선, NPC/감정 필터, 최근 검색어.
// All human-driven browsing over the full transcript log; no AI involved.
"use strict";

let historyOpen = false;

function wireHistoryPanel() {
  $("historyToggleBtn").addEventListener("click", async () => {
    historyOpen = !historyOpen;
    $("historyPanel").classList.toggle("hidden", !historyOpen);
    if (historyOpen) await primeHistoryFilters();
  });
  $("histGo").addEventListener("click", runHistorySearch);
  $("histQ").addEventListener("keydown", (e) => { if (e.key === "Enter") runHistorySearch(); });
  $("histNpc").addEventListener("change", runHistorySearch);
  $("histEmotion").addEventListener("change", runHistorySearch);

  // B — 맨 아래로 스크롤 버튼: appears once the log is scrolled up.
  $("log").addEventListener("scroll", () => {
    const log = $("log");
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    $("scrollBottomBtn").classList.toggle("hidden", nearBottom);
  });
  $("scrollBottomBtn").addEventListener("click", scrollLog);

  // B — 읽기 모드: hides badges/controls, novel-style flow.
  $("readModeBtn").addEventListener("click", () => {
    document.body.classList.toggle("read-mode");
    $("readModeBtn").classList.toggle("active", document.body.classList.contains("read-mode"));
  });
}

// Populate NPC/emotion dropdowns from what's actually appeared, plus recent searches.
async function primeHistoryFilters() {
  try {
    const d = await api(`/api/history/${NOS.campaign}`);
    const npcs = [...new Set(d.entries.flatMap((e) => e.participants || []).filter((p) => p !== "player"))];
    const emotions = [...new Set(d.entries.map((e) => e.primary_emotion).filter(Boolean))];
    $("histNpc").innerHTML = `<option value="">모든 인물</option>` + npcs.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    $("histEmotion").innerHTML = `<option value="">모든 감정</option>` + emotions.map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join("");
    renderRecentSearches(d.recent_searches || []);
  } catch (e) { /* optional */ }
}

function renderRecentSearches(list) {
  const box = $("histRecent");
  if (!list.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<span class="muted">최근 검색:</span> ` + list.map((s) =>
    `<button class="chip" data-q="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("");
  box.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => { $("histQ").value = b.dataset.q; runHistorySearch(); }));
}

async function runHistorySearch() {
  const q = $("histQ").value.trim();
  const npc = $("histNpc").value;
  const emotion = $("histEmotion").value;
  const box = $("histResults");
  box.innerHTML = `<div class="muted">검색 중…</div>`;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (npc) params.set("npc", npc);
  if (emotion) params.set("emotion", emotion);
  const d = await api(`/api/history/${NOS.campaign}?${params.toString()}`);
  const boundarySet = new Set((d.boundaries || []).map((b) => b.before_turn));
  if (!d.entries.length) { box.innerHTML = `<div class="muted">일치하는 장면이 없습니다.</div>`; return; }
  box.innerHTML = d.entries.slice().reverse().map((e) => `
    ${boundarySet.has(e.turn) ? `<div class="session-divider">— 새 세션 —</div>` : ""}
    <div class="hist-item">
      <div class="hist-meta">턴 ${e.turn} · ${escapeHtml(e.in_world_date || "")} ${e.primary_emotion ? "· " + escapeHtml(e.primary_emotion) : ""}</div>
      <div class="hist-text">${escapeHtml((e.gm || "").slice(0, 220))}${(e.gm || "").length > 220 ? "…" : ""}</div>
    </div>`).join("");
  renderRecentSearches(d.recent_searches || []);
}

// --- bookmarks (called from story.js's addGM) ------------------------------
async function toggleBookmark(turn, btn) {
  const d = await apiPost(`/api/bookmark/${NOS.campaign}`, { turn });
  const on = (d.bookmarked_turns || []).includes(turn);
  btn.classList.toggle("on", on);
  btn.title = on ? "북마크 해제" : "이 장면 북마크";
}
