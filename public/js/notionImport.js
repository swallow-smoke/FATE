// PATCH Notion Import — 프론트 플로우 (§3 선택 · §6 일괄 리뷰 · §8 비용 안내).
//
// 자기완결 모달 플로우. 어디서든 openNotionImport({ campaignId | ensureCampaign, onDone })
// 로 실행한다. 규모가 커져도 B1 원칙(사람 확인 후 확정) 그대로 — 가져온 항목은
// 전부 편집 가능한 폼으로 뜨고, 사람이 선택·확정해야만 등록된다.
"use strict";

const NOTION_TYPE_LABEL = {
  Character: "캐릭터", World: "세계/장소", Faction: "세력", Item: "아이템",
  Organization: "조직", Property: "집/재산", FamilyRelation: "가족관계",
  Promise: "약속", CalendarEvent: "일정", WantedRecord: "수배",
  RegionReputation: "지역 평판", HouseRule: "하우스 룰",
  NarrativeArc: "Narrative Arc", Motif: "Motif", HiddenVariable: "숨은 변수", Other: "기타",
};
const NOTION_TYPE_ORDER = [
  "Character", "World", "Faction", "Organization", "Item", "Property",
  "FamilyRelation", "Promise", "CalendarEvent", "WantedRecord",
  "RegionReputation", "HouseRule", "NarrativeArc", "Motif",
  "HiddenVariable", "Other",
];
const NOTION_BATCH = 8; // §8 — 페이지가 많으면 배치로 나눠 진행률 표시

function openNotionImport(opts) {
  const ctx = {
    campaignId: (opts && opts.campaignId) || null,
    ensureCampaign: opts && opts.ensureCampaign,
    onDone: (opts && opts.onDone) || (() => {}),
    onItems: opts && opts.onItems,
    fillOnly: !!(opts && opts.fillOnly),
    source: "notion",
    pages: [],
    items: [],
  };
  // 소스별 배치 분석 함수(리뷰·비용·등록 단계는 공유).
  ctx.analyzeChunk = (chunk) =>
    apiPost("/api/notion/analyze", { campaign_id: ctx.campaignId || undefined, pages: chunk.map((p) => ({ id: p.id, title: p.title })) })
      .then((r) => r.items || []);
  renderNotionUrlStep(ctx);
}

// --- 1단계: 링크 입력 -------------------------------------------------------
async function renderNotionUrlStep(ctx) {
  let cfg = { connected: false };
  try { cfg = await api("/api/notion/config"); } catch (e) {}
  const depth = cfg.default_depth || 2;
  openModal(`
    <h3>📥 Notion에서 가져오기</h3>
    <p class="muted">페이지 링크 하나를 주면 하위 페이지까지 재귀적으로 읽어 Canon/Arc/Motif로 자동 분류합니다. ${cfg.connected ? `연동됨 <span class="tag">${escapeHtml(cfg.token_hint || "")}</span>` : `<b>연동 토큰이 없습니다</b> — 설정 › Notion 연동에서 먼저 등록하세요. (지금은 <span class="tag">mock 샘플</span>로 흐름만 확인됩니다.)`}</p>
    <div class="wz-field"><label>Notion 페이지 링크</label>
      <input id="notionUrl" placeholder="https://www.notion.so/…" /></div>
    <div class="set-row"><span>재귀 깊이 <small>(워크스페이스 전체 방지)</small></span>
      <select id="notionDepth">
        <option value="1" ${depth === 1 ? "selected" : ""}>1단계</option>
        <option value="2" ${depth === 2 ? "selected" : ""}>2단계 (기본)</option>
        <option value="3" ${depth === 3 ? "selected" : ""}>3단계</option>
      </select></div>
    <div id="notionUrlStatus" class="muted"></div>
    <div class="modal-actions">
      <button onclick="closeModal()">취소</button>
      <button id="notionDiscoverBtn" class="primary">페이지 찾기</button>
    </div>`);
  $("notionDiscoverBtn").addEventListener("click", async () => {
    const url = $("notionUrl").value.trim();
    if (!url) return ($("notionUrlStatus").textContent = "링크를 입력하세요.");
    $("notionUrlStatus").textContent = "페이지를 탐색하는 중…";
    try {
      const r = await apiPost("/api/notion/discover", { url, max_depth: Number($("notionDepth").value) });
      ctx.pages = r.pages || [];
      ctx.mock = r.mock;
      if (!ctx.pages.length) return ($("notionUrlStatus").textContent = "가져올 페이지를 찾지 못했습니다.");
      renderNotionSelectStep(ctx);
    } catch (e) { $("notionUrlStatus").textContent = "탐색 실패: " + e.message; }
  });
}

// --- 2단계: 페이지 선택 (전체선택 기본, 중복/아카이브 처리) ------------------
function renderNotionSelectStep(ctx) {
  const groups = {}; // group_id → [pages]
  const singles = [];
  for (const p of ctx.pages) {
    if (p.group_id) (groups[p.group_id] = groups[p.group_id] || []).push(p);
    else singles.push(p);
  }
  const rowHtml = (p) => `
    <label class="rep-row" style="align-items:flex-start;gap:8px">
      <input type="checkbox" class="notion-pick" data-id="${escapeHtml(p.id)}" ${p.default_selected ? "checked" : ""}/>
      <span style="flex:1">
        <b>${escapeHtml(p.title)}</b>
        ${p.in_archive_folder ? `<span class="tag">아카이브</span>` : ""}
        ${p.stale ? `<span class="tag">이전 버전</span>` : ""}
        <br><small class="muted">${escapeHtml(p.parent_title || (ctx.source === "files" ? "파일" : "루트"))} · 수정 ${p.last_edited_time ? fmtDate(p.last_edited_time) : "?"}${p.depth != null ? " · 깊이 " + p.depth : ""}</small>
      </span>
    </label>`;
  let body = "";
  for (const p of singles) body += rowHtml(p);
  for (const gid of Object.keys(groups)) {
    const members = groups[gid];
    const rec = members.find((m) => m.recommended) || members[0];
    const others = members.filter((m) => m !== rec);
    body += `<div class="content-card" style="padding:8px;margin:6px 0">
      <div class="muted" style="font-size:12px">중복 그룹 · 최신본 추천</div>
      ${rowHtml(rec)}
      <details style="margin-top:4px"><summary class="muted" style="cursor:pointer">이전 버전 ${others.length}개 (참고용, 기본 제외)</summary>
        ${others.map(rowHtml).join("")}</details>
    </div>`;
  }
  openModal(`
    <h3>가져올 ${ctx.source === "files" ? "파일" : "페이지"} 선택 <small class="muted">${ctx.pages.length}개${ctx.mock ? " · mock" : ""}</small></h3>
    <p class="muted">전체 선택이 기본입니다. 제외할 항목은 체크를 해제하세요. 이름이 같거나 비슷하면 중복으로 묶어 최신본만 기본 선택됩니다${ctx.source === "files" ? "." : ', "Duplicate/Archive" 폴더 페이지는 기본 제외됩니다.'}</p>
    <div style="max-height:46vh;overflow:auto;margin:8px 0">${body}</div>
    <div id="notionSelStatus" class="muted"></div>
    <div class="modal-actions">
      <button onclick="closeModal()">취소</button>
      <button id="notionSelAll">전체 선택/해제</button>
      <button id="notionToAnalyze" class="primary">다음: 분석 →</button>
    </div>`);
  $("notionSelAll").addEventListener("click", () => {
    const boxes = [...document.querySelectorAll(".notion-pick")];
    const anyOff = boxes.some((b) => !b.checked);
    boxes.forEach((b) => (b.checked = anyOff));
  });
  $("notionToAnalyze").addEventListener("click", () => {
    const picked = [...document.querySelectorAll(".notion-pick:checked")].map((b) => b.dataset.id);
    const sel = ctx.pages.filter((p) => picked.includes(p.id));
    if (!sel.length) return ($("notionSelStatus").textContent = "최소 한 페이지는 선택하세요.");
    ctx.selected = sel;
    renderNotionCostStep(ctx);
  });
}

// --- 3단계: 비용 안내 + 분석(배치 진행률) -----------------------------------
function renderNotionCostStep(ctx) {
  const n = ctx.selected.length;
  openModal(`
    <h3>분석 예정</h3>
    <div class="content-card">
      <p><b>페이지 ${n}개 분석 예정</b> · Gemini 호출 약 <b>${n}회</b></p>
      <p class="muted">각 페이지 본문을 구조화 분류 프롬프트에 넣습니다(서사 생성과 분리). 사용량은 "notion_import" 카테고리로 기록됩니다.${ctx.mock ? " 현재 mock 모드 — 실제 호출 없음." : ""}</p>
      ${n > NOTION_BATCH ? `<p class="muted">${NOTION_BATCH}개씩 배치로 나눠 진행합니다.</p>` : ""}
    </div>
    <div id="notionProgress" class="muted"></div>
    <div class="modal-actions">
      <button id="notionBackToSel">← 선택으로</button>
      <button id="notionRunAnalyze" class="primary">분석 시작</button>
    </div>`);
  $("notionBackToSel").addEventListener("click", () => renderNotionSelectStep(ctx));
  $("notionRunAnalyze").addEventListener("click", async () => {
    $("notionRunAnalyze").disabled = true;
    ctx.items = [];
    const chunks = [];
    for (let i = 0; i < ctx.selected.length; i += NOTION_BATCH) chunks.push(ctx.selected.slice(i, i + NOTION_BATCH));
    let done = 0;
    try {
      for (const chunk of chunks) {
        $("notionProgress").textContent = `분석 중… ${done}/${ctx.selected.length}`;
        const items = await ctx.analyzeChunk(chunk);
        ctx.items.push(...items);
        done += chunk.length;
        $("notionProgress").textContent = `분석 중… ${done}/${ctx.selected.length}`;
      }
      renderNotionReviewStep(ctx);
    } catch (e) {
      $("notionProgress").textContent = "분석 실패: " + e.message;
      $("notionRunAnalyze").disabled = false;
    }
  });
}

// --- 4단계: 일괄 리뷰 (타입별 · 카드 · 편집 폼) -----------------------------
function renderNotionReviewStep(ctx) {
  ctx.items.forEach((it, i) => { it._idx = i; if (it._selected === undefined) it._selected = it.type !== "Other" || (it.confidence || 0) >= 0.5; });
  const byType = {};
  for (const it of ctx.items) (byType[it.type] = byType[it.type] || []).push(it);
  let body = "";
  for (const type of NOTION_TYPE_ORDER) {
    const list = byType[type];
    if (!list || !list.length) continue;
    body += `<div class="section-h">${NOTION_TYPE_LABEL[type]} <small>${list.length}개</small></div>`;
    body += list.map((it) => notionItemCard(it)).join("");
  }
  openModal(`
    <h3>가져올 항목 검토</h3>
    <p class="muted">${ctx.fillOnly ? "각 항목을 펼쳐 수정할 수 있습니다. 체크된 항목은 캠페인 생성 칸에 채워지며, 아직 이야기는 시작되지 않습니다." : "각 항목을 펼쳐 수정할 수 있습니다. 체크된 항목만 등록됩니다. Notion에서 왔어도 정식 검증(Kernel/Registry)을 거칩니다."}</p>
    <div style="max-height:52vh;overflow:auto;margin:8px 0">${body || '<p class="muted">추출된 항목이 없습니다.</p>'}</div>
    <div id="notionImportStatus" class="muted"></div>
    <div class="modal-actions">
      <button onclick="closeModal()">취소</button>
      <button id="notionDoImport" class="primary">${ctx.fillOnly ? "선택한 항목을 생성 칸에 채우기" : "선택한 항목 가져오기"}</button>
    </div>`);
  // 펼침 토글
  document.querySelectorAll(".notion-card-head").forEach((h) =>
    h.addEventListener("click", (e) => {
      if (e.target.classList.contains("notion-item-pick")) return;
      const form = h.parentElement.querySelector(".notion-card-form");
      if (form) form.classList.toggle("hidden");
    }));
  $("notionDoImport").addEventListener("click", () => doNotionImport(ctx));
}

function notionItemCard(it) {
  const d = it.data || {};
  const conf = Math.round((it.confidence || 0) * 100);
  return `
    <div class="wz-entity" data-idx="${it._idx}">
      <div class="wz-entity-head notion-card-head" style="cursor:pointer">
        <label style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" class="notion-item-pick" data-idx="${it._idx}" ${it._selected ? "checked" : ""}/>
          <b>${escapeHtml(it.page_title || d.name || d.birth_name || d.title || d.label || "(제목 없음)")}</b>
        </label>
        <span><span class="tag">${NOTION_TYPE_LABEL[it.type]}</span> <small class="muted">확신 ${conf}%${it._mock ? " · mock" : ""}</small> ▾</span>
      </div>
      <div class="notion-card-form hidden" style="margin-top:6px">${notionEditFields(it)}</div>
    </div>`;
}

// 타입별 편집 필드. import 시 DOM에서 값을 읽어 data를 재구성한다.
function notionEditFields(it) {
  const d = it.data || {};
  const F = (label, k, val, ph) => `<div class="wz-field"><label>${label}</label><input class="nf" data-idx="${it._idx}" data-k="${k}" value="${escapeHtml(val || "")}" placeholder="${ph || ""}"/></div>`;
  const TA = (label, k, val) => `<div class="wz-field"><label>${label}</label><textarea class="nf" data-idx="${it._idx}" data-k="${k}" rows="2">${escapeHtml(val || "")}</textarea></div>`;
  if (it.type === "Character") {
    return F("canon_id", "canon_id", it.canon_id)
      + F("이름", "birth_name", d.birth_name || d.name)
      + F("배경", "background", d.background)
      + F("가치관 (쉼표)", "core_values", (d.core_values || []).join(", "))
      + F("현재 목표", "goal_current", d.goal_current)
      + F("현재 위치", "current_location", d.current_location)
      + F("소속 (쉼표)", "affiliations", (d.affiliations || []).join(", "))
      + F("플레이어와 관계", "relationship_to_player_type", d.relationship_to_player_type)
      + F("공개 정보", "secrets.public", (d.secrets || {}).public)
      + F("숨긴 비밀", "secrets.hidden", (d.secrets || {}).hidden)
      + F("잠긴 비밀", "secrets.locked", (d.secrets || {}).locked)
      + F("두려움", "psychology.core_fear", (d.psychology || {}).core_fear)
      + F("욕망", "psychology.desire", (d.psychology || {}).desire);
  }
  if (it.type === "World") {
    return F("canon_id", "canon_id", it.canon_id)
      + F("이름", "name", d.name) + TA("설명", "description", d.description)
      + F("지형", "terrain", d.terrain) + F("기후", "climate", d.climate)
      + F("장소 종류", "place_kind", d.place_kind)
      + F("현재 상태", "condition", d.condition)
      + F("주요 특징 (; 구분)", "notable_features", (d.notable_features || []).join("; "));
  }
  if (it.type === "Faction") {
    return F("canon_id", "canon_id", it.canon_id)
      + F("이름", "name", d.name) + TA("설명", "description", d.description)
      + F("창립 원칙", "founding_principle", d.founding_principle)
      + F("목표", "goal", d.goal) + F("지도자", "leader", d.leader);
  }
  if (it.type === "Organization") {
    return F("id", "canon_id", it.canon_id)
      + F("이름", "name", d.name) + F("본부", "hq", d.hq)
      + F("계급 (쉼표)", "ranks", (d.ranks || []).join(", "))
      + F("규칙 (쉼표)", "rules", (d.rules || []).join(", "))
      + F("자금", "funds", d.funds)
      + F("적대 조직 (쉼표)", "rivals", (d.rivals || []).join(", "));
  }
  if (it.type === "Item") {
    return F("canon_id", "canon_id", it.canon_id)
      + F("이름", "name", d.name) + TA("설명", "description", d.description)
      + F("태그 (쉼표)", "tags", (d.tags || []).join(", "))
      + F("상태", "condition", d.condition)
      + F("소유자", "owner", d.owner);
  }
  if (it.type === "Property") {
    return F("id", "canon_id", it.canon_id)
      + F("이름", "name", d.name) + F("종류", "kind", d.kind)
      + F("지역", "region", d.region) + F("레벨", "level", d.level)
      + F("보관물 (쉼표)", "contents", (d.contents || []).join(", "))
      + TA("추억 (줄바꿈)", "memories", (d.memories || []).join("\n"));
  }
  if (it.type === "FamilyRelation") return F("from", "from", d.from) + F("to", "to", d.to) + F("관계", "type", d.type);
  if (it.type === "Promise") return F("NPC", "npc_ref", d.npc_ref) + TA("약속 내용", "summary", d.summary) + F("마감일(day)", "due_day", d.due_day);
  if (it.type === "CalendarEvent") return F("제목", "title", d.title) + F("종류", "kind", d.kind) + F("날짜(day)", "day", d.day) + TA("메모", "note", d.note);
  if (it.type === "WantedRecord") return F("지역/세력 id", "scope_id", d.scope_id) + F("표시명", "scope_label", d.scope_label) + F("단계", "level", d.level) + F("현상금", "bounty", d.bounty) + TA("사유", "reason", d.reason);
  if (it.type === "RegionReputation") return F("범위", "scope", d.scope) + F("id", "scope_id", d.scope_id) + F("이름", "name", d.name) + F("평판(-100~100)", "standing", d.standing) + TA("이유", "reason", d.reason);
  if (it.type === "HouseRule") return TA("규칙", "text", d.text || d.note);
  if (it.type === "NarrativeArc") {
    return F("제목", "title", d.title) + TA("요약", "summary", d.summary)
      + F("단계 (setup/rising/climax/resolution)", "stage", d.stage)
      + TA("비트 (줄바꿈 구분)", "beats", (d.beats || []).join("\n"));
  }
  if (it.type === "Motif") return F("라벨", "label", d.label) + TA("설명", "description", d.description);
  if (it.type === "HiddenVariable") {
    return F("라벨", "label", d.label) + TA("설명", "description", d.description)
      + F("기본값 (0~1)", "default_value", d.default_value != null ? String(d.default_value) : "0.5")
      + F("높을 때 연출", "high_directive", d.high_directive) + F("낮을 때 연출", "low_directive", d.low_directive);
  }
  return TA("메모", "note", d.note);
}

// DOM → item.data 재구성.
function readNotionCard(it) {
  const data = {};
  document.querySelectorAll(`.nf[data-idx="${it._idx}"]`).forEach((inp) => {
    const k = inp.dataset.k;
    let v = inp.value;
    if (k === "canon_id") { it.canon_id = v.trim() || it.canon_id; return; }
    if (["core_values", "affiliations", "ranks", "rules", "rivals", "tags", "contents"].includes(k)) v = v.split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "notable_features") v = v.split(";").map((s) => s.trim()).filter(Boolean);
    else if (k === "memories") v = v.split("\n").map((s) => s.trim()).filter(Boolean);
    else if (k === "beats") v = v.split("\n").map((s) => s.trim()).filter(Boolean);
    else if (["default_value", "funds", "level", "due_day", "day", "bounty", "standing"].includes(k)) v = v === "" ? null : Number(v);
    if (k.startsWith("psychology.")) { data.psychology = data.psychology || {}; data.psychology[k.slice("psychology.".length)] = v; }
    else if (k.startsWith("secrets.")) { data.secrets = data.secrets || {}; data.secrets[k.slice("secrets.".length)] = v; }
    else data[k] = v;
  });
  it.data = { ...it.data, ...data };
}

// --- 5단계: 등록 -----------------------------------------------------------
async function doNotionImport(ctx) {
  const picks = ctx.items.filter((it) => document.querySelector(`.notion-item-pick[data-idx="${it._idx}"]`)?.checked);
  if (!picks.length) return ($("notionImportStatus").textContent = "가져올 항목을 하나 이상 선택하세요.");
  picks.forEach(readNotionCard);
  const items = picks.map((it) => ({ type: it.type, canon_id: it.canon_id, data: it.data, page_title: it.page_title || "" }));
  if (ctx.fillOnly && typeof ctx.onItems === "function") {
    ctx.onItems(items);
    closeModal();
    return;
  }
  $("notionImportStatus").textContent = "등록하는 중… (Kernel/Registry 검증 경유)";
  $("notionDoImport").disabled = true;
  try {
    // 위저드 경로: 아직 캠페인이 없으면 지금 만든다.
    if (!ctx.campaignId && ctx.ensureCampaign) ctx.campaignId = await ctx.ensureCampaign();
    if (!ctx.campaignId) throw new Error("대상 캠페인이 없습니다.");
    const r = await apiPost("/api/notion/import", { campaign_id: ctx.campaignId, items });
    const failed = (r.failed || []).length;
    openModal(`
      <h3>가져오기 완료</h3>
      <p><b>${r.imported}개</b> 항목이 등록되었습니다.${failed ? ` <span class="muted">${failed}개 실패</span>` : ""}</p>
      ${failed ? `<div class="muted" style="font-size:12px">${r.failed.map((f) => `${escapeHtml(f.type)} — ${escapeHtml(f.reason || "실패")}`).join("<br>")}</div>` : ""}
      <div class="modal-actions"><button class="primary" onclick="closeModal()">닫기</button></div>`);
    showBanner(`Notion에서 ${r.imported}개 항목을 가져왔습니다.`);
    ctx.onDone(ctx.campaignId);
  } catch (e) {
    $("notionImportStatus").textContent = "등록 실패: " + e.message;
    $("notionDoImport").disabled = false;
  }
}

// ==========================================================================
// 파일(.md/.txt)에서 가져오기 — Notion과 동일한 분류/중복/리뷰/등록 파이프라인을
// 재사용하고, 수집 단계만 "링크 재귀 탐색" 대신 "로컬 파일 업로드"로 바꾼다.
// 수십 개 파일도 배치로 분석한다.
// ==========================================================================
function openFileImport(opts) {
  const ctx = {
    campaignId: (opts && opts.campaignId) || null,
    ensureCampaign: opts && opts.ensureCampaign,
    onDone: (opts && opts.onDone) || (() => {}),
    onItems: opts && opts.onItems,
    fillOnly: !!(opts && opts.fillOnly),
    source: "files",
    pages: [],
    items: [],
  };
  // 파일 본문은 이미 클라이언트에 있으므로, 배치마다 텍스트를 함께 보낸다
  // (분류는 서버에서 앞부분을 중심으로 쓰며, 요청 크기 방어로 파일당 50000자까지만 전송).
  ctx.analyzeChunk = (chunk) =>
    apiPost("/api/import/analyze-text", {
      campaign_id: ctx.campaignId || undefined,
      docs: chunk.map((d) => ({ id: d.id, title: d.title, text: String(d._text || "").slice(0, 50000) })),
    }).then((r) => r.items || []);
  renderFilePickStep(ctx);
}

function renderFilePickStep(ctx) {
  openModal(`
    <h3>📄 파일에서 가져오기 (.md / .txt)</h3>
    <p class="muted">마크다운·텍스트 파일을 여러 개(수십 개 가능) 선택하면 AI가 각 파일을 분석해 캐릭터·세계·세력·Arc·Motif로 자동 분류합니다. 확정 전 리뷰·편집할 수 있고, 정식 검증(Kernel/Registry)을 거쳐 등록됩니다.</p>
    <div class="wz-field"><label>파일 선택 <small>(여러 개 가능)</small></label>
      <input type="file" id="fileImportInput" accept=".md,.markdown,.txt,text/plain,text/markdown" multiple /></div>
    <div id="fileImportStatus" class="muted" style="margin-top:6px"></div>
    <div class="modal-actions">
      <button onclick="closeModal()">취소</button>
      <button id="fileImportNext" class="primary" disabled>다음: 선택 →</button>
    </div>`);
  let docs = [];
  $("fileImportInput").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    $("fileImportStatus").textContent = `${files.length}개 파일 읽는 중…`;
    try {
      docs = await readImportFiles(files);
      const kb = Math.round(docs.reduce((s, d) => s + (d.size || 0), 0) / 1024);
      $("fileImportStatus").textContent = `${docs.length}개 파일 준비됨 · 총 ${kb.toLocaleString()}KB`;
      $("fileImportNext").disabled = false;
    } catch (err) { $("fileImportStatus").textContent = "파일 읽기 실패: " + err.message; }
  });
  $("fileImportNext").addEventListener("click", () => {
    if (!docs.length) return;
    renderFileEditStep(ctx, docs);
  });
}

async function readImportFiles(files) {
  const out = [];
  for (const f of files) {
    const text = await f.text();
    out.push({
      id: "file_" + out.length + "_" + f.name,
      title: f.name,
      original_title: f.name,
      _text: text,
      last_edited_time: f.lastModified || Date.now(),
      size: f.size,
      parent_title: "",
      _selected: true,
    });
  }
  return out;
}

function renderFileEditStep(ctx, docs) {
  ctx.fileDrafts = docs.map((d, i) => ({ ...d, _selected: d._selected !== false, _order: i }));
  let activeId = ctx.fileDrafts[0] && ctx.fileDrafts[0].id;

  const saveActive = () => {
    const active = ctx.fileDrafts.find((d) => d.id === activeId);
    if (!active || !$("fileDraftTitle") || !$("fileDraftText")) return;
    active.title = $("fileDraftTitle").value.trim() || active.original_title || active.title;
    active._text = $("fileDraftText").value;
    active.size = new Blob([active._text || ""]).size;
  };

  const docStats = (d) => {
    const text = String((d && d._text) || "");
    const chars = text.length;
    const lines = text ? text.split(/\r\n|\r|\n/).length : 0;
    const kb = Math.max(1, Math.round(new Blob([text]).size / 1024));
    return { chars, lines, kb, analyzed: Math.min(chars, 50000), truncated: chars > 50000 };
  };

  const updateFooter = () => {
    if (!$("fileDraftFooter")) return;
    saveActive();
    const picked = ctx.fileDrafts.filter((d) => d._selected && String(d._text || "").trim());
    const chars = picked.reduce((n, d) => n + String(d._text || "").length, 0);
    const analyzed = picked.reduce((n, d) => n + Math.min(String(d._text || "").length, 50000), 0);
    $("fileDraftFooter").innerHTML = `${picked.length}개 선택 · 원문 ${chars.toLocaleString()}자 · 분석 입력 ${analyzed.toLocaleString()}자`
      + (picked.some((d) => String(d._text || "").length > 50000) ? ` <span class="tag">긴 파일은 앞 50,000자 분석</span>` : "");
  };

  const renderList = () => {
    const q = ($("fileDraftSearch") ? $("fileDraftSearch").value : "").trim().toLowerCase();
    const rows = ctx.fileDrafts
      .filter((d) => !q || String(d.title || "").toLowerCase().includes(q) || String(d._text || "").toLowerCase().includes(q))
      .map((d) => {
        const st = docStats(d);
        return `<div class="file-draft-row${d.id === activeId ? " active" : ""}" data-id="${escapeHtml(d.id)}">
          <label class="file-draft-check">
            <input type="checkbox" class="file-draft-pick" data-id="${escapeHtml(d.id)}" ${d._selected ? "checked" : ""}/>
          </label>
          <button type="button" class="file-draft-open" data-id="${escapeHtml(d.id)}">
            <b>${escapeHtml(d.title || d.original_title || "Untitled")}</b>
            <small>${st.kb.toLocaleString()}KB · ${st.lines.toLocaleString()}줄${st.truncated ? " · 2만자만 분석" : ""}</small>
          </button>
        </div>`;
      }).join("");
    $("fileDraftList").innerHTML = rows || `<p class="muted" style="padding:10px">검색 결과가 없습니다.</p>`;
    document.querySelectorAll(".file-draft-open").forEach((b) => b.addEventListener("click", () => {
      saveActive();
      activeId = b.dataset.id;
      renderEditor();
      renderList();
    }));
    document.querySelectorAll(".file-draft-pick").forEach((b) => b.addEventListener("change", () => {
      const d = ctx.fileDrafts.find((x) => x.id === b.dataset.id);
      if (d) d._selected = b.checked;
      updateFooter();
    }));
  };

  const renderEditor = () => {
    const d = ctx.fileDrafts.find((x) => x.id === activeId) || ctx.fileDrafts[0];
    if (!d) return;
    activeId = d.id;
    const st = docStats(d);
    $("fileDraftEditor").innerHTML = `
      <div class="wz-field">
        <label>문서 제목 <small>분석 전에 마지막으로 바꿀 수 있습니다</small></label>
        <input id="fileDraftTitle" value="${escapeHtml(d.title || "")}" placeholder="문서 제목" />
      </div>
      <div class="file-draft-meta">
        <span>${escapeHtml(d.original_title || d.title || "file")}</span>
        <span>${st.chars.toLocaleString()}자</span>
        <span>${st.lines.toLocaleString()}줄</span>
        <span>${st.kb.toLocaleString()}KB</span>
        ${st.truncated ? `<span class="tag">AI 분석은 앞 ${st.analyzed.toLocaleString()}자</span>` : ""}
      </div>
      <div class="wz-field file-draft-text-field">
        <label>본문</label>
        <textarea id="fileDraftText" spellcheck="false">${escapeHtml(d._text || "")}</textarea>
      </div>`;
    $("fileDraftTitle").addEventListener("input", () => {
      saveActive();
      renderList();
      updateFooter();
    });
    $("fileDraftText").addEventListener("input", updateFooter);
    updateFooter();
  };

  openModal(`
    <h3>가져오기 전 마지막 확인</h3>
    <p class="muted">아직 이야기는 시작되지 않습니다. 파일 제목과 본문을 다듬고, 실제로 세계관에 넣을 문서만 선택한 뒤 분석을 진행하세요.</p>
    <div class="file-draft-tools">
      <input id="fileDraftSearch" placeholder="파일명/본문 검색" />
      <button id="fileDraftSelectAll">전체 선택</button>
      <button id="fileDraftSelectNone">전체 해제</button>
      <button id="fileDraftUseH1">첫 # 제목으로 정리</button>
      <button id="fileDraftTrim">앞뒤 공백 정리</button>
    </div>
    <div class="file-draft-workbench">
      <aside id="fileDraftList" class="file-draft-list"></aside>
      <section id="fileDraftEditor" class="file-draft-editor"></section>
    </div>
    <div id="fileDraftFooter" class="muted"></div>
    <div id="fileDraftStatus" class="muted"></div>
    <div class="modal-actions">
      <button id="fileDraftBack">← 파일 다시 선택</button>
      <button onclick="closeModal()">취소</button>
      <button id="fileDraftContinue" class="primary">수정 완료 · 분석으로 →</button>
    </div>`);

  $("fileDraftSearch").addEventListener("input", renderList);
  $("fileDraftBack").addEventListener("click", () => renderFilePickStep(ctx));
  $("fileDraftSelectAll").addEventListener("click", () => {
    ctx.fileDrafts.forEach((d) => (d._selected = true));
    renderList();
    updateFooter();
  });
  $("fileDraftSelectNone").addEventListener("click", () => {
    ctx.fileDrafts.forEach((d) => (d._selected = false));
    renderList();
    updateFooter();
  });
  $("fileDraftUseH1").addEventListener("click", () => {
    saveActive();
    ctx.fileDrafts.forEach((d) => {
      const h1 = String(d._text || "").split(/\r\n|\r|\n/).find((line) => /^#\s+/.test(line));
      if (h1) d.title = h1.replace(/^#\s+/, "").trim() || d.title;
    });
    renderEditor();
    renderList();
  });
  $("fileDraftTrim").addEventListener("click", () => {
    saveActive();
    ctx.fileDrafts.forEach((d) => { d._text = String(d._text || "").trim(); });
    renderEditor();
    renderList();
    updateFooter();
  });
  $("fileDraftContinue").addEventListener("click", () => {
    saveActive();
    const selected = ctx.fileDrafts
      .filter((d) => d._selected && String(d._text || "").trim())
      .map((d) => ({ ...d, title: d.title || d.original_title || "Untitled", _text: String(d._text || "").trim() }));
    if (!selected.length) return ($("fileDraftStatus").textContent = "분석할 문서를 하나 이상 선택하세요.");
    ctx.pages = dedupImportDocs(selected);
    renderNotionSelectStep(ctx);
  });
  renderEditor();
  renderList();
}

// 서버 groupDuplicates의 클라이언트 미러(파일명 기준). 확장자·(버전)·old/copy 등을
// 제거해 정규화, 그룹 내 최신 수정본을 추천으로. 자동 삭제 없음(추천만).
function normFileTitle(t) {
  return String(t || "").toLowerCase()
    .replace(/\.(md|markdown|txt)$/i, "")
    .replace(/\(.*?\)/g, "")
    .replace(/(old|copy|사본|구버전|백업|v?\d+)/gi, "")
    .replace(/[^\w가-힣]+/g, "").trim();
}
function dedupImportDocs(docs) {
  const groups = {};
  for (const p of docs) { const key = normFileTitle(p.title) || p.id; (groups[key] = groups[key] || []).push(p); }
  const out = []; let gi = 0;
  for (const k of Object.keys(groups)) {
    const members = groups[k];
    const isDup = members.length > 1;
    const gid = isDup ? "grp_" + gi++ : null;
    const sorted = members.slice().sort((a, b) => (b.last_edited_time || 0) - (a.last_edited_time || 0));
    const newest = sorted[0].id;
    for (const p of members) {
      const rec = !isDup || p.id === newest;
      out.push({ ...p, group_id: gid, is_duplicate: isDup, recommended: rec, default_selected: rec, stale: isDup && p.id !== newest, in_archive_folder: false });
    }
  }
  const order = new Map(docs.map((p, i) => [p.id, i]));
  return out.sort((a, b) => order.get(a.id) - order.get(b.id));
}
