// App-wide settings view (#/settings), reached from the launcher's ⚙ button.
// Everything here is GLOBAL (localStorage or non-campaign API endpoints) and
// purely cosmetic / operational — screen dressing, accessibility, custom themes,
// API keys, plugins, and an aggregate usage dashboard across all campaigns.
//
// Story-affecting settings (Narrative DNA, play settings, house rules, low-token
// mode, backups, notes, autosave…) intentionally stay in the per-campaign
// settings tab (tabs.js: loadSettingsTab) — they need a campaign to act on.
"use strict";

const BUILTIN_THEMES = [
  { id: "dark", label: "작업실", note: "기본 다크 UI", swatches: ["#0f1110", "#63b394", "#d29a55"] },
  { id: "light", label: "라이트", note: "밝고 선명한 화면", swatches: ["#f4f6f1", "#63b394", "#d29a55"] },
  { id: "midnight", label: "미드나잇", note: "차가운 밤색 계열", swatches: ["#0d1118", "#5fa9c8", "#d7a45f"] },
  { id: "parchment", label: "양피지", note: "따뜻한 종이 톤", swatches: ["#e9dfcc", "#3f7f8d", "#a96f34"] },
  { id: "aurora", label: "오로라", note: "청록빛 판타지", swatches: ["#10151b", "#66b7ad", "#d6a458"] },
  { id: "forest", label: "숲의 기록", note: "초록과 목재감", swatches: ["#101710", "#6aa57a", "#c59651"] },
  { id: "ember", label: "불씨", note: "짙은 회색과 주황", swatches: ["#14110f", "#d0834f", "#f0b15e"] },
  { id: "noir", label: "느와르", note: "고대비 흑백", swatches: ["#0b0c0d", "#aeb7bd", "#d8b36d"] },
  { id: "mono", label: "단색", note: "집중용 모노 톤", swatches: ["#111111", "#d0d0d0", "#888888"] },
  { id: "plain", label: "심플", note: "효과 최소화", swatches: ["#161616", "#bdbdbd", "#777777"] },
];

const FONT_OPTIONS = [
  { id: "system", label: "기본 UI", family: '"Pretendard", system-ui, sans-serif', sample: "읽기 좋은 기본 화면" },
  { id: "noto-sans", label: "Noto Sans KR", family: '"Noto Sans KR", sans-serif', sample: "단정한 산세리프" },
  { id: "nanum-gothic", label: "나눔고딕", family: '"Nanum Gothic", sans-serif', sample: "익숙한 고딕체" },
  { id: "ibm", label: "IBM Plex Sans KR", family: '"IBM Plex Sans KR", sans-serif', sample: "현대적인 UI 폰트" },
  { id: "gowun-dodum", label: "고운돋움", family: '"Gowun Dodum", sans-serif', sample: "부드러운 돋움" },
  { id: "hahmlet", label: "함렛", family: '"Hahmlet", serif', sample: "서사적인 제목감" },
  { id: "serif", label: "세리프", family: 'Georgia, "Noto Serif KR", serif', sample: "긴 글에 어울리는 결" },
  { id: "noto-serif", label: "Noto Serif KR", family: '"Noto Serif KR", serif', sample: "차분한 명조 문장" },
  { id: "nanum-myeongjo", label: "나눔명조", family: '"Nanum Myeongjo", serif', sample: "고전적인 문학 톤" },
  { id: "gowun-batang", label: "고운바탕", family: '"Gowun Batang", serif', sample: "부드러운 바탕체" },
  { id: "song", label: "송명", family: '"Song Myung", serif', sample: "굵은 명조의 맛" },
  { id: "dohyeon", label: "도현", family: '"Do Hyeon", sans-serif', sample: "강한 제목과 버튼" },
  { id: "jua", label: "주아", family: '"Jua", sans-serif', sample: "둥글고 캐주얼한 톤" },
  { id: "black-han", label: "검은고딕", family: '"Black Han Sans", sans-serif', sample: "아주 굵은 제목" },
  { id: "orbit", label: "오비트", family: '"Orbit", sans-serif', sample: "디지털 감각" },
  { id: "nanum-pen", label: "나눔펜", family: '"Nanum Pen Script", cursive', sample: "손글씨 메모 느낌" },
  { id: "east-sea", label: "동해독도", family: '"East Sea Dokdo", cursive', sample: "거친 붓글씨" },
  { id: "yeon-sung", label: "연성", family: '"Yeon Sung", cursive', sample: "옛 일기장 같은 글" },
  { id: "single-day", label: "싱글데이", family: '"Single Day", cursive', sample: "가벼운 일상 대화" },
  { id: "poor-story", label: "푸어스토리", family: '"Poor Story", cursive', sample: "손맛 있는 서사" },
  { id: "mono", label: "고정폭", family: '"Cascadia Code", "Consolas", monospace', sample: "LOG_012 / status" },
];

function themeCardsHtml(active) {
  return `<div class="theme-preset-grid">${BUILTIN_THEMES.map((t) => `
    <button type="button" class="theme-preset ${active === t.id ? "active" : ""}" data-theme="${t.id}">
      <span class="theme-swatches">${t.swatches.map((c) => `<i style="background:${c}"></i>`).join("")}</span>
      <b>${t.label}</b>
      <small>${t.note}</small>
    </button>`).join("")}</div>`;
}

function fontCardsHtml(active) {
  return `<div class="font-preset-grid">${FONT_OPTIONS.map((f) => `
    <button type="button" class="font-preset ${active === f.id ? "active" : ""}" data-font="${f.id}" style="font-family:${escapeHtml(f.family)}">
      <b>${f.label}</b>
      <span>${f.sample}</span>
    </button>`).join("")}</div>`;
}

async function renderLauncherSettings() {
  const box = $("launcherSettingsBody");
  box.innerHTML = `<div class="muted">불러오는 중…</div>`;

  const fontSize = localStorage.getItem("nos_font") || "14";
  const fontFamily = localStorage.getItem("nos_font_family") || "system";
  const colorblind = localStorage.getItem("nos_colorblind") === "1";
  const theme = localStorage.getItem("nos_theme") || "dark";
  const chatStyle = localStorage.getItem("nos_chat_style") || "bubble";
  const layoutMode = localStorage.getItem("nos_layout_mode") || "desktop";
  const typingFx = localStorage.getItem("nos_typing_effect") === "1";
  const lowSpec = localStorage.getItem("nos_low_spec") === "1";
  const fxMode = localStorage.getItem("nos_fx") || "standard";

  let usage;
  try { usage = await api("/api/usage"); } catch { usage = { calls: 0, prompt_tokens: 0, output_tokens: 0, by_category: {}, estimated_cost_usd: 0, today_calls: 0, campaign_count: 0 }; }

  box.innerHTML = `
    <div class="content-card"><h3>개인화</h3>
      <div class="set-row"><span>테마</span>
        <select id="setTheme">
          ${BUILTIN_THEMES.map((t) => `<option value="${t.id}" ${theme === t.id ? "selected" : ""}>${t.label}</option>`).join("")}
        </select></div>
      ${themeCardsHtml(theme)}
      <div class="set-row"><span>채팅 스타일</span>
        <select id="setChatStyle"><option value="bubble" ${chatStyle === "bubble" ? "selected" : ""}>말풍선형</option><option value="novel" ${chatStyle === "novel" ? "selected" : ""}>소설체</option></select></div>
      <div class="set-row"><span>UI 레이아웃</span>
        <select id="setLayoutMode"><option value="desktop" ${layoutMode !== "mobile" ? "selected" : ""}>데스크탑용</option><option value="mobile" ${layoutMode === "mobile" ? "selected" : ""}>모바일용</option></select></div>
      <label class="set-row"><input type="checkbox" id="setDnaColor" ${localStorage.getItem("nos_dna_color") !== "0" ? "checked" : ""}/> 세계관 톤에 맞춰 화면 색조 자동 반영</label></div>

    <div class="content-card"><h3>접근성</h3>
      <div class="set-row"><span>글자 크기</span>
        <select id="setFont"><option value="13" ${fontSize === "13" ? "selected" : ""}>작게</option><option value="14" ${fontSize === "14" ? "selected" : ""}>보통</option><option value="16" ${fontSize === "16" ? "selected" : ""}>크게</option><option value="18" ${fontSize === "18" ? "selected" : ""}>아주 크게</option></select></div>
      <div class="set-row"><span>폰트</span>
        <select id="setFontFamily">
          ${FONT_OPTIONS.map((f) => `<option value="${f.id}" ${fontFamily === f.id ? "selected" : ""}>${f.label}</option>`).join("")}
        </select></div>
      ${fontCardsHtml(fontFamily)}
      <div class="set-row"><span>플레이 연출</span>
        <select id="setFx">
          <option value="standard" ${fxMode === "standard" ? "selected" : ""}>기본</option>
          <option value="rich" ${fxMode === "rich" ? "selected" : ""}>풍부하게</option>
          <option value="quiet" ${fxMode === "quiet" ? "selected" : ""}>잔잔하게</option>
          <option value="none" ${fxMode === "none" ? "selected" : ""}>끄기</option>
        </select></div>
      <label class="set-row"><input type="checkbox" id="setColorblind" ${colorblind ? "checked" : ""}/> 색맹 친화 모드</label>
      <label class="set-row"><input type="checkbox" id="setTypingFx" ${typingFx ? "checked" : ""}/> 서사 타이핑 효과</label>
      <label class="set-row"><input type="checkbox" id="setLowSpec" ${lowSpec ? "checked" : ""}/> 저사양 모드 (애니메이션·그래프 효과 최소화)</label></div>

    <div class="content-card"><h3>커스텀 테마 (AI 생성)</h3>
      <p class="muted">원하는 분위기를 자유롭게 적으면 AI가 색·폰트 토큰을 채웁니다. 검증(화이트리스트/외부리소스 차단)을 통과한 값만 적용됩니다. <b>미리보기 후 적용</b>합니다.</p>
      <div class="wz-row"><input id="themeDesc" placeholder="예: 습기 찬 항구도시, 짙은 청록과 낡은 종이" /><button id="themeGen">AI로 테마 생성</button></div>
      <div id="themePreview" class="muted"></div>
      <div id="themeList" style="margin-top:8px"></div></div>

    <div class="content-card"><h3>사용량 대시보드 (전체 캠페인 합산)</h3>
      <p class="muted">무료 티어 RPD(하루 요청 수) 소진 추적용입니다 — 실제 결제 여부와는 별개입니다. 모든 캠페인을 합산한 값입니다.</p>
      <p>누적 AI 호출: <b>${usage.calls}회</b> · 입력 ${(usage.prompt_tokens || 0).toLocaleString()} / 출력 ${(usage.output_tokens || 0).toLocaleString()} 토큰 · 예상 $${usage.estimated_cost_usd}</p>
      <p class="muted">캠페인 ${usage.campaign_count || 0}개 · 오늘 전체 호출 <b>${usage.today_calls || 0}</b>회</p>
      ${usageBars(usage.by_category || {})}</div>

    <div class="content-card"><h3>API 키 / 모델</h3>
      <p class="muted">여기 입력한 키는 <code>.env</code>보다 우선 적용되고 런타임에 저장됩니다(재시작해도 유지). 비워두면 환경변수(<code>GEMINI_API_KEYS</code>, <code>GEMINI_API_KEY…</code>)를 사용합니다. 여러 개는 줄바꿈 또는 쉼표로 구분 — 429(쿼터 초과) 시 자동으로 다음 키로 전환합니다. 저장된 키 값은 다시 표시되지 않습니다.</p>
      <div class="wz-field"><label>GEMINI API 키 (여러 개 가능)</label>
        <textarea id="apiKeys" rows="3" placeholder="키1&#10;키2&#10;키3"></textarea></div>
      <div class="set-row"><span>서사 생성 모델</span><select id="narrModel"></select></div>
      <div class="set-row"><span>추출/보조 모델</span><select id="extractModel"></select></div>
      <div class="modal-actions"><button id="apiSaveBtn" class="primary">API 설정 저장</button><button id="keyReloadBtn">환경변수에서 다시 읽기</button></div>
      <div id="keyStatus" class="muted" style="margin-top:6px">불러오는 중…</div></div>

    <div class="content-card"><h3>Notion 연동</h3>
      <p class="muted">Notion Integration 토큰을 등록하면 페이지 링크에서 세계관/캐릭터를 가져올 수 있습니다(설정 마법사·캠페인 설정 탭). 토큰은 <b>암호화되어</b> 로컬(<code>data/</code>, gitignore)에만 저장되고, 저장 후 값은 다시 표시되지 않습니다(마스킹 힌트만). Notion에서 Internal Integration을 만들고, 가져올 페이지를 그 Integration에 <b>연결(Share)</b>해야 합니다.</p>
      <div class="wz-field"><label>Notion Integration 토큰</label>
        <input id="notionToken" type="password" placeholder="ntn_… 또는 secret_…" /></div>
      <div class="set-row"><span>기본 재귀 깊이</span>
        <select id="notionDepthDefault"><option value="1">1단계</option><option value="2">2단계 (기본)</option><option value="3">3단계</option></select></div>
      <div class="modal-actions"><button id="notionSaveBtn" class="primary">저장</button><button id="notionClearBtn">연결 해제</button></div>
      <div id="notionCfgStatus" class="muted" style="margin-top:6px">불러오는 중…</div></div>

    <div class="content-card"><h3>플러그인 (선언적 확장)</h3>
      <p class="muted">정해진 5개 확장 지점(장면 타입·장르 특성·통신 채널·하우스 룰 묶음·Advanced 위젯)에 값만 추가합니다. 코드는 생성/실행하지 않습니다. <b>미리보기 후 등록</b>합니다. 여기서 등록·활성화한 플러그인은 모든 캠페인에 적용됩니다.</p>
      <div class="wz-row"><input id="pluginDesc" placeholder="예: 네온 가득한 근미래 도시, 기업이 국가를 대체한 세계" /><button id="pluginGen">AI로 플러그인 생성</button></div>
      <div id="pluginPreview" class="muted"></div>
      <div id="pluginList" style="margin-top:8px"></div></div>`;

  // ---- group the flat cards into category subtabs (동일한 .set-subtabs 패턴) ----
  // 카드 렌더 순서: 개인화 / 접근성 / 커스텀테마 / 사용량 / API / Notion / 플러그인.
  groupLauncherCards(box, [
    ["screen", "화면·개인화", [0, 1, 2]],
    ["account", "계정·연동", [4, 5, 6]],
    ["usage", "사용량", [3]],
  ]);

  // ---- personalization / accessibility (localStorage, global) ----
  $("setFont").addEventListener("change", (e) => { localStorage.setItem("nos_font", e.target.value); applyAccessibility(); });
  $("setFontFamily").addEventListener("change", (e) => { localStorage.setItem("nos_font_family", e.target.value); applyAccessibility(); });
  $("setFx").addEventListener("change", (e) => { localStorage.setItem("nos_fx", e.target.value); applyAccessibility(); });
  $("setColorblind").addEventListener("change", (e) => { localStorage.setItem("nos_colorblind", e.target.checked ? "1" : "0"); applyAccessibility(); });
  $("setTypingFx").addEventListener("change", (e) => localStorage.setItem("nos_typing_effect", e.target.checked ? "1" : "0"));
  $("setLowSpec").addEventListener("change", (e) => { localStorage.setItem("nos_low_spec", e.target.checked ? "1" : "0"); applyAccessibility(); });
  $("setTheme").addEventListener("change", (e) => {
    localStorage.setItem("nos_theme", e.target.value);
    localStorage.removeItem("nos_custom_theme");
    applyAccessibility();
  });
  box.querySelectorAll(".theme-preset").forEach((b) => b.addEventListener("click", () => {
    localStorage.setItem("nos_theme", b.dataset.theme);
    localStorage.removeItem("nos_custom_theme");
    $("setTheme").value = b.dataset.theme;
    box.querySelectorAll(".theme-preset").forEach((x) => x.classList.toggle("active", x === b));
    applyAccessibility();
  }));
  box.querySelectorAll(".font-preset").forEach((b) => b.addEventListener("click", () => {
    localStorage.setItem("nos_font_family", b.dataset.font);
    $("setFontFamily").value = b.dataset.font;
    box.querySelectorAll(".font-preset").forEach((x) => x.classList.toggle("active", x === b));
    applyAccessibility();
  }));
  $("setChatStyle").addEventListener("change", (e) => { localStorage.setItem("nos_chat_style", e.target.value); applyAccessibility(); });
  $("setLayoutMode").addEventListener("change", (e) => setLayoutMode(e.target.value));
  // No campaign here, so we can't live-recolor from DNA — just persist the pref
  // and clear any stale override. It re-applies when a campaign is opened.
  $("setDnaColor").addEventListener("change", (e) => {
    localStorage.setItem("nos_dna_color", e.target.checked ? "1" : "0");
    applyDnaTheme(null);
  });

  // ---- custom themes (generate → preview → apply/save) ----
  let pendingTheme = null;
  async function refreshThemes() {
    try {
      const { themes } = await api("/api/themes");
      $("themeList").innerHTML = (themes || []).length
        ? `<div class="muted" style="margin-bottom:4px">저장된 테마</div>` + themes.map((t) => `<div class="rep-row"><span>${escapeHtml(t.name)}</span><span><button class="theme-apply" data-id="${t.theme_id}">적용</button> <button class="theme-del" data-id="${t.theme_id}">삭제</button></span></div>`).join("")
        : `<span class="muted">저장된 커스텀 테마가 없습니다.</span>`;
      box.querySelectorAll(".theme-apply").forEach((b) => b.addEventListener("click", async () => {
        const t = (await api("/api/themes")).themes.find((x) => x.theme_id === b.dataset.id);
        if (t) { applyThemeTokens(t.tokens); localStorage.setItem("nos_custom_theme", JSON.stringify(t.tokens)); showBanner(`테마 "${t.name}" 적용됨.`); }
      }));
      box.querySelectorAll(".theme-del").forEach((b) => b.addEventListener("click", async () => { await fetch(`/api/themes/${b.dataset.id}`, { method: "DELETE" }); refreshThemes(); }));
    } catch (e) {}
  }
  $("themeGen").addEventListener("click", async () => {
    $("themePreview").textContent = "테마를 생성하는 중…";
    try {
      const r = await apiPost("/api/themes/generate", { description: $("themeDesc").value.trim() });
      pendingTheme = r.tokens;
      $("themePreview").innerHTML = `<div>${escapeHtml(r.preview)}${r.mock ? " <span class='tag'>mock 샘플</span>" : ""}</div>`
        + `<pre style="white-space:pre-wrap;font-size:12px">${escapeHtml(JSON.stringify(r.tokens, null, 1))}</pre>`
        + `<button id="themeApplyPreview">미리보기 적용</button> <input id="themeSaveName" placeholder="테마 이름" style="width:120px"/> <button id="themeSave" class="primary">저장</button>`
        + ((r.rejected || []).length ? `<div class="muted">거부됨: ${r.rejected.map((x) => x.key).join(", ")}</div>` : "");
      $("themeApplyPreview").addEventListener("click", () => { applyThemeTokens(pendingTheme); showBanner("미리보기 적용됨 (저장 전)."); });
      $("themeSave").addEventListener("click", async () => {
        try { await apiPost("/api/themes", { name: $("themeSaveName").value.trim() || $("themeDesc").value.trim() || "커스텀 테마", tokens: pendingTheme, description: $("themeDesc").value.trim() }); showBanner("테마가 저장되었습니다."); refreshThemes(); }
        catch (e) { showBanner("저장 실패: " + e.message); }
      });
    } catch (e) { $("themePreview").textContent = "생성 실패: " + e.message; }
  });
  refreshThemes();

  // ---- C4: API keys + models (runtime config, overrides .env) ----
  const modelOpts = (list, sel) => (list || []).map((m) => `<option ${m === sel ? "selected" : ""}>${escapeHtml(m)}</option>`).join("");
  const renderKeyStatus = async () => {
    try {
      const cfg = await api("/api/runtime-config");
      const k = cfg.keys || { total: 0, available: 0, keys: [] };
      $("narrModel").innerHTML = modelOpts(cfg.available_models, cfg.narrative_model);
      $("extractModel").innerHTML = modelOpts(cfg.available_models, cfg.extract_model);
      $("keyStatus").innerHTML =
        (cfg.ui_key_count ? `앱에 입력된 키 ${cfg.ui_key_count}개 사용 중 · ` : "환경변수 키 사용 · ")
        + (k.total === 0 ? "등록된 키 없음 — MOCK 모드로 동작합니다."
          : `총 ${k.total}개 · 사용 가능 ${k.available}개` + (k.keys || []).map((x) => ` · ${x.exhausted ? "⛔" : "✓"}`).join(""));
    } catch (e) { $("keyStatus").textContent = "상태를 불러오지 못했습니다."; }
  };
  renderKeyStatus();
  $("apiSaveBtn").addEventListener("click", async () => {
    const body = { narrative_model: $("narrModel").value, extract_model: $("extractModel").value };
    const keysRaw = $("apiKeys").value.trim();
    if (keysRaw) body.keys = keysRaw; // only replace keys when the user typed some
    try {
      await apiPost("/api/runtime-config", body);
      $("apiKeys").value = "";
      showBanner("API 설정이 저장되었습니다 (다음 호출부터 적용).");
      renderKeyStatus();
    } catch (e) { showBanner("저장 실패: " + e.message); }
  });
  $("keyReloadBtn").addEventListener("click", async () => { await apiPost("/api/keys/reload", {}); renderKeyStatus(); showBanner("환경변수에서 키를 다시 읽었습니다."); });

  // ---- Notion 연동 (토큰 저장/해제 — 값은 암호화 저장, 다시 표시 안 함) ----
  const renderNotionCfg = async () => {
    try {
      const cfg = await api("/api/notion/config");
      if ($("notionDepthDefault")) $("notionDepthDefault").value = String(cfg.default_depth || 2);
      $("notionCfgStatus").innerHTML = cfg.connected
        ? `연동됨 · 토큰 <code>${escapeHtml(cfg.token_hint || "")}</code>${cfg.updated_at ? ` · ${fmtDate(cfg.updated_at)}` : ""}`
        : "연동된 토큰이 없습니다. (토큰 없이도 mock 샘플로 가져오기 흐름을 확인할 수 있습니다.)";
    } catch (e) { $("notionCfgStatus").textContent = "상태를 불러오지 못했습니다."; }
  };
  renderNotionCfg();
  $("notionSaveBtn").addEventListener("click", async () => {
    const token = $("notionToken").value.trim();
    const default_depth = Number($("notionDepthDefault").value);
    try {
      await apiPost("/api/notion/config", token ? { token, default_depth } : { default_depth });
      $("notionToken").value = "";
      showBanner("Notion 설정이 저장되었습니다.");
      renderNotionCfg();
    } catch (e) { showBanner("저장 실패: " + e.message); }
  });
  $("notionClearBtn").addEventListener("click", async () => {
    if (!confirm("Notion 연결을 해제할까요? 저장된 토큰이 삭제됩니다.")) return;
    await fetch("/api/notion/config", { method: "DELETE" });
    showBanner("Notion 연결이 해제되었습니다.");
    renderNotionCfg();
  });

  // ---- plugins (generate → preview → register → toggle/delete). The
  // per-campaign "apply house-rule bundle" action stays in the campaign tab. ----
  let pendingPlugin = null;
  async function refreshPlugins() {
    try {
      const { plugins } = await api("/api/plugins");
      $("pluginList").innerHTML = (plugins || []).length
        ? `<div class="muted" style="margin-bottom:4px">등록된 플러그인</div>` + plugins.map((p) => `<div class="rep-row"><span>${escapeHtml(p.name)} ${p.enabled ? "" : "<span class='muted'>(꺼짐)</span>"}</span><span><label style="font-size:12px"><input type="checkbox" class="plugin-toggle" data-id="${p.plugin_id}" ${p.enabled ? "checked" : ""}/> 사용</label> <button class="plugin-del" data-id="${p.plugin_id}">삭제</button></span></div>`).join("")
        : `<span class="muted">등록된 플러그인이 없습니다.</span>`;
      box.querySelectorAll(".plugin-toggle").forEach((b) => b.addEventListener("change", async () => { await apiPost(`/api/plugins/${b.dataset.id}/toggle`, { enabled: b.checked }); }));
      box.querySelectorAll(".plugin-del").forEach((b) => b.addEventListener("click", async () => { await fetch(`/api/plugins/${b.dataset.id}`, { method: "DELETE" }); refreshPlugins(); }));
    } catch (e) {}
  }
  $("pluginGen").addEventListener("click", async () => {
    $("pluginPreview").textContent = "플러그인을 생성하는 중…";
    try {
      const r = await apiPost("/api/plugins/generate", { description: $("pluginDesc").value.trim() });
      if (!r.valid) { $("pluginPreview").innerHTML = `<span class="muted">유효한 확장을 만들지 못했습니다: ${escapeHtml(r.reason || "")}</span>`; return; }
      pendingPlugin = r.manifest;
      $("pluginPreview").innerHTML = `<ul style="margin:4px 0 8px 16px">${(r.preview || []).map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>${r.mock ? "<span class='tag'>mock 샘플</span> " : ""}<button id="pluginRegister" class="primary">등록</button>`;
      $("pluginRegister").addEventListener("click", async () => {
        try { await apiPost("/api/plugins", { manifest: pendingPlugin }); showBanner("플러그인이 등록되었습니다."); $("pluginPreview").textContent = ""; refreshPlugins(); }
        catch (e) { showBanner("등록 실패: " + e.message); }
      });
    } catch (e) { $("pluginPreview").textContent = "생성 실패: " + e.message; }
  });
  refreshPlugins();
}

// Move the flat launcher-settings cards into category subtabs (same look as the
// campaign settings tab). defs: [ [groupId, label, [cardIndex,...]], ... ].
function groupLauncherCards(box, defs) {
  const cards = [...box.querySelectorAll(":scope > .content-card")];
  const nav = document.createElement("nav");
  nav.className = "subtabs set-subtabs";
  nav.innerHTML = defs.map((d, i) => `<button class="stab ${i === 0 ? "active" : ""}" data-sgroup="${d[0]}">${d[1]}</button>`).join("");
  const wrap = document.createDocumentFragment();
  const groups = {};
  defs.forEach((d, i) => {
    const div = document.createElement("div");
    div.className = "set-group" + (i === 0 ? " active" : "");
    div.dataset.sgroup = d[0];
    groups[d[0]] = div;
    wrap.appendChild(div);
    d[2].forEach((idx) => { if (cards[idx]) div.appendChild(cards[idx]); });
  });
  // any card not assigned falls into the first group (defensive).
  cards.forEach((c) => { if (!c.parentElement || c.parentElement === box) groups[defs[0][0]].appendChild(c); });
  box.appendChild(nav);
  box.appendChild(wrap);
  nav.querySelectorAll(".stab").forEach((b) => b.addEventListener("click", () => {
    nav.querySelectorAll(".stab").forEach((x) => x.classList.toggle("active", x === b));
    box.querySelectorAll(".set-group").forEach((g) => g.classList.toggle("active", g.dataset.sgroup === b.dataset.sgroup));
  }));
}
