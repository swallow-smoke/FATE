"use strict";

let writerWorkspace = null;
let writerActiveId = null;
let writerSaveTimer = null;

const WRITER_TYPES = {
  book: { label: "작품", icon: "BOOK", hint: "작품의 약속, 장르, 제목, 독자에게 줄 감정을 정리합니다." },
  world: { label: "세계관", icon: "WORLD", hint: "시대, 규칙, 장소, 역사, 금기, 분위기를 노션 페이지처럼 쌓습니다." },
  character: { label: "캐릭터", icon: "CAST", hint: "욕망, 결핍, 비밀, 말투, 관계를 한 문서에 모읍니다." },
  chapter: { label: "원고", icon: "CH", hint: "책을 쓰듯 장면과 문단을 이어 씁니다." },
  note: { label: "메모", icon: "NOTE", hint: "아직 분류되지 않은 아이디어를 보관합니다." },
};

async function loadWriterTab() {
  const box = $("writerBody");
  if (!box) return;
  box.innerHTML = `<div class="muted">집필실을 여는 중...</div>`;
  try {
    const data = await api("/api/writer/" + NOS.campaign);
    writerWorkspace = data.workspace || { active_page_id: "book", pages: [] };
    writerActiveId = writerWorkspace.active_page_id || ((writerWorkspace.pages[0] || {}).id);
    renderWriterWorkspace();
  } catch (e) {
    box.innerHTML = `<div class="content-card"><h3>집필실을 열지 못했습니다</h3><p class="muted">${escapeHtml(e.message)}</p></div>`;
  }
}

function renderWriterWorkspace() {
  const box = $("writerBody");
  const pages = writerWorkspace.pages || [];
  const page = pages.find((p) => p.id === writerActiveId) || pages[0] || newWriterPage("note");
  writerActiveId = page.id;
  const grouped = writerGroupedPages(pages);
  box.innerHTML = `
    <div class="writer-shell">
      <aside class="writer-nav">
        <div class="writer-nav-head">
          <div>
            <span class="eyebrow">Writing Room</span>
            <h2>집필실</h2>
          </div>
          <button id="writerNewNote" title="새 문서">+</button>
        </div>
        <div class="writer-new-row">
          <button data-new-type="world">세계관</button>
          <button data-new-type="character">캐릭터</button>
          <button data-new-type="chapter">장</button>
        </div>
        <div class="writer-page-list">
          ${Object.entries(grouped).map(([type, items]) => writerGroupHtml(type, items)).join("")}
        </div>
      </aside>
      <main class="writer-editor">
        <div class="writer-editor-head">
          <div>
            <select id="writerType">${Object.entries(WRITER_TYPES).map(([k, v]) => `<option value="${k}" ${page.type === k ? "selected" : ""}>${v.label}</option>`).join("")}</select>
            <input id="writerTitle" value="${escapeHtml(page.title || "")}" placeholder="문서 제목" />
          </div>
          <div class="writer-actions">
            <span id="writerSaved" class="muted">저장됨</span>
            <button id="writerSendScene">장면 요청으로 보내기</button>
            <button id="writerDelete">삭제</button>
          </div>
        </div>
        <div class="writer-meta-grid">
          <label>상태
            <select id="writerStatus">
              ${["draft", "review", "canon", "done"].map((s) => `<option value="${s}" ${page.status === s ? "selected" : ""}>${writerStatusLabel(s)}</option>`).join("")}
            </select>
          </label>
          <label>태그
            <input id="writerTags" value="${escapeHtml((page.tags || []).join(", "))}" placeholder="쉼표로 구분" />
          </label>
          <label class="writer-summary">요약
            <textarea id="writerSummary" rows="2" placeholder="${escapeHtml(WRITER_TYPES[page.type || "note"].hint)}">${escapeHtml(page.summary || "")}</textarea>
          </label>
        </div>
        <textarea id="writerBodyText" class="writer-body-text" spellcheck="false" placeholder="${escapeHtml(writerPlaceholder(page.type))}">${escapeHtml(page.body || "")}</textarea>
      </main>
      <aside class="writer-side">
        <div class="content-card">
          <h3>책처럼 쓰기</h3>
          <p class="muted">왼쪽은 노션식 자료실, 가운데는 원고지입니다. 세계관과 캐릭터를 정리하다가 필요한 문서를 바로 장면 요청으로 보낼 수 있습니다.</p>
        </div>
        <div class="content-card writer-outline">
          <h3>문서 개요</h3>
          ${writerOutline(page)}
        </div>
      </aside>
    </div>`;

  wireWriterControls(page);
}

function writerGroupHtml(type, items) {
  const meta = WRITER_TYPES[type] || WRITER_TYPES.note;
  return `<section class="writer-group">
    <h3>${meta.label}</h3>
    ${items.map((p) => `
      <button class="writer-page ${p.id === writerActiveId ? "active" : ""}" data-page-id="${escapeHtml(p.id)}">
        <span>${escapeHtml(p.icon || meta.icon)}</span>
        <b>${escapeHtml(p.title || "제목 없음")}</b>
        <small>${escapeHtml(p.summary || meta.hint)}</small>
      </button>`).join("")}
  </section>`;
}

function writerGroupedPages(pages) {
  const out = { book: [], world: [], character: [], chapter: [], note: [] };
  for (const page of pages) {
    const type = out[page.type] ? page.type : "note";
    out[type].push(page);
  }
  return Object.fromEntries(Object.entries(out).filter(([, items]) => items.length));
}

function wireWriterControls(page) {
  document.querySelectorAll(".writer-page").forEach((b) => b.addEventListener("click", async () => {
    await flushWriterSave();
    writerActiveId = b.dataset.pageId;
    apiPost(`/api/writer/${NOS.campaign}/active`, { page_id: writerActiveId }).catch(() => {});
    renderWriterWorkspace();
  }));
  document.querySelectorAll("[data-new-type]").forEach((b) => b.addEventListener("click", () => addWriterPage(b.dataset.newType)));
  $("writerNewNote").addEventListener("click", () => addWriterPage("note"));

  ["writerType", "writerTitle", "writerStatus", "writerTags", "writerSummary", "writerBodyText"].forEach((id) => {
    const el = $(id);
    el.addEventListener("input", scheduleWriterSave);
    el.addEventListener("change", scheduleWriterSave);
  });
  $("writerSendScene").addEventListener("click", () => sendWriterPageToStory(collectWriterPage(page)));
  $("writerDelete").addEventListener("click", () => deleteWriterPage(page.id));
}

function collectWriterPage(oldPage) {
  const type = $("writerType").value || "note";
  const meta = WRITER_TYPES[type] || WRITER_TYPES.note;
  return {
    ...oldPage,
    type,
    icon: oldPage.icon || meta.icon,
    title: $("writerTitle").value.trim() || "제목 없음",
    status: $("writerStatus").value,
    tags: $("writerTags").value.split(",").map((s) => s.trim()).filter(Boolean),
    summary: $("writerSummary").value.trim(),
    body: $("writerBodyText").value,
  };
}

function scheduleWriterSave() {
  clearTimeout(writerSaveTimer);
  const saved = $("writerSaved");
  if (saved) saved.textContent = "저장 중...";
  writerSaveTimer = setTimeout(() => flushWriterSave(), 550);
}

async function flushWriterSave() {
  clearTimeout(writerSaveTimer);
  const oldPage = (writerWorkspace.pages || []).find((p) => p.id === writerActiveId);
  if (!oldPage || !$("writerTitle")) return;
  const page = collectWriterPage(oldPage);
  const result = await apiPost(`/api/writer/${NOS.campaign}/page`, { page });
  writerWorkspace = result.workspace;
  writerActiveId = result.page.id;
  const saved = $("writerSaved");
  if (saved) saved.textContent = "저장됨";
}

async function addWriterPage(type) {
  await flushWriterSave();
  const page = newWriterPage(type);
  const result = await apiPost(`/api/writer/${NOS.campaign}/page`, { page });
  writerWorkspace = result.workspace;
  writerActiveId = result.page.id;
  renderWriterWorkspace();
}

function newWriterPage(type) {
  const meta = WRITER_TYPES[type] || WRITER_TYPES.note;
  const n = Date.now().toString(36);
  const title = type === "chapter" ? "새 장" : type === "character" ? "새 캐릭터" : type === "world" ? "새 세계관 문서" : "새 문서";
  return {
    id: `${type || "note"}_${n}`,
    type: type || "note",
    title,
    icon: meta.icon,
    status: "draft",
    tags: [],
    summary: "",
    body: "",
  };
}

async function deleteWriterPage(pageId) {
  if (!confirm("이 문서를 삭제할까요?")) return;
  const res = await fetch(`/api/writer/${NOS.campaign}/page/${encodeURIComponent(pageId)}`, { method: "DELETE" });
  const data = await res.json().catch(() => null);
  if (!res.ok) return showBanner((data && data.error) || "삭제 실패");
  writerWorkspace = data.workspace;
  writerActiveId = writerWorkspace.active_page_id;
  renderWriterWorkspace();
}

function sendWriterPageToStory(page) {
  const input = $("input");
  const storyTab = document.querySelector('.ptab[data-ptab="story"]');
  if (!input || !storyTab) return;
  input.value = `[집필실: ${page.title}]\n${page.summary ? page.summary + "\n\n" : ""}${page.body || ""}\n\n위 설정을 반영해서 다음 장면을 소설처럼 이어 써줘.`;
  input.dispatchEvent(new Event("input"));
  storyTab.click();
  input.focus();
  showBanner("집필실 문서를 입력창에 옮겼습니다.");
}

function writerOutline(page) {
  const lines = String(page.body || "").split(/\r?\n/).filter((line) => /^#{1,3}\s+/.test(line));
  if (!lines.length) return `<p class="muted">본문에 # 제목을 쓰면 여기에 개요가 생깁니다.</p>`;
  return `<ol>${lines.slice(0, 12).map((line) => `<li>${escapeHtml(line.replace(/^#{1,3}\s+/, ""))}</li>`).join("")}</ol>`;
}

function writerPlaceholder(type) {
  if (type === "world") return "# 세계관\n\n## 핵심 규칙\n\n## 장소\n\n## 역사\n\n## 금기";
  if (type === "character") return "# 캐릭터 이름\n\n## 욕망\n\n## 결핍\n\n## 비밀\n\n## 말투\n\n## 관계";
  if (type === "chapter") return "# 1장\n\n장면을 소설처럼 써 내려가세요.\n\n## 다음 장면 메모";
  return "# 메모\n\n떠오른 것을 자유롭게 적어두세요.";
}

function writerStatusLabel(status) {
  return { draft: "초안", review: "검토", canon: "공식 설정", done: "완료" }[status] || status;
}
