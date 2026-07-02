// Phase 4 A2 (built now) + Phase 5 Wave 4 — 3-step setup wizard with genre
// presets. AI output is shown as editable forms; on "시작" everything goes
// through the Kernel canon.register pipeline server-side.
"use strict";

// Wave 4 — genre presets: prefill the free-text box + fixed DNA per preset.
const GENRE_PRESETS = [
  { id: "fantasy", name: "판타지", desc: "습기 찬 항구도시가 있는 낮은 판타지 세계. 마법은 희귀하고 위험하며, 세력들이 물밑에서 다툰다.", dna: { tone: 3, emotion: 4, politics: 3, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 4 } },
  { id: "sf", name: "SF", desc: "궤도 정거장과 식민 행성으로 이루어진 근미래. 기업 연합이 통치하고, 오래된 신호가 심우주에서 돌아오고 있다.", dna: { tone: 2, emotion: 3, politics: 4, survival: 4, horror: 2, mystery: 4, romance: 1, exploration: 5 } },
  { id: "school", name: "학교물", desc: "언덕 위의 오래된 사립학교. 동아리와 소문, 옥상에서의 대화. 졸업이 다가올수록 각자의 비밀이 무거워진다.", dna: { tone: 4, emotion: 5, politics: 1, survival: 1, horror: 1, mystery: 3, romance: 4, exploration: 2 } },
  { id: "zombie", name: "좀비", desc: "감염 3주차의 도시. 물자와 신뢰가 동시에 바닥나고 있다. 생존자 무리마다 규칙이 다르다.", dna: { tone: 1, emotion: 4, politics: 2, survival: 5, horror: 4, mystery: 2, romance: 1, exploration: 3 } },
  { id: "modern", name: "현대", desc: "지금의 도시. 평범한 일상 아래 작은 균열이 자라고 있다 — 그 균열이 당신의 이야기를 시작하게 한다.", dna: { tone: 3, emotion: 4, politics: 2, survival: 2, horror: 1, mystery: 4, romance: 3, exploration: 2 } },
];

const wiz = { step: 1, world: null, chars: null, freeWorld: "", freeChar: "", preset: null, length: "normal" };

// Phase 7 Part B — mid-wizard draft autosave. Persisted on every step so a
// closed/reopened wizard can offer "이어서 작성하기".
const DRAFT_KEY = "nos_wizard_draft";
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ step: wiz.step, world: wiz.world, chars: wiz.chars, freeWorld: wiz.freeWorld, freeChar: wiz.freeChar, preset: wiz.preset, length: wiz.length, at: Date.now() })); } catch (e) {}
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { return null; } }

function setWizStep(n) {
  wiz.step = n;
  document.querySelectorAll(".wstep").forEach((s) => s.classList.toggle("active", Number(s.dataset.step) === n));
  if (n === 1) renderWizStep1();
  else if (n === 2) renderWizStep2();
  else renderWizStep3();
  saveDraft();
}

// Phase 7 Part B — shared AI-failure UI: retry + manual-entry escape hatch.
function renderGenError(containerId, message, retryFn, manualFn) {
  const box = $(containerId);
  if (!box) return;
  box.innerHTML = `<div class="content-card" style="border-color:rgba(176,107,107,.5)">
      <p>생성에 실패했습니다: ${escapeHtml(message || "알 수 없는 오류")}</p>
      <p class="muted">쿼터 초과(429)라면 잠시 후 다시 시도하거나, 직접 입력해 이어갈 수 있습니다.</p>
      <div class="modal-actions"><button id="genRetry" class="primary">다시 시도</button><button id="genManual">직접 입력하기</button></div>
    </div>`;
  $("genRetry").addEventListener("click", retryFn);
  $("genManual").addEventListener("click", manualFn);
}

// ---------- step 1: 세계관 ----------
function renderWizStep1() {
  const presets = GENRE_PRESETS.map((p) => `
    <button class="preset-card ${wiz.preset === p.id ? "sel" : ""}" data-preset="${p.id}"><b>${p.name}</b><span>${p.desc.slice(0, 40)}…</span></button>`).join("");
  $("wizardBody").innerHTML = `
    <div class="wiz-card">
      <h2>어떤 세계를 만들고 싶나요?</h2>
      <div class="preset-row">${presets}</div>
      <textarea id="wzWorldText" rows="4" placeholder="예: 습기 찬 항구도시, 낮은 판타지, 마법은 희귀하고 위험하다">${escapeHtml(wiz.freeWorld)}</textarea>
      <div class="modal-actions">
        <button id="wzGenWorld" class="primary">AI로 세계관 생성</button>
        <button id="wzQuickStart" title="기본 세계로 3단계를 건너뛰고 바로 시작">⚡ 빠른 시작</button>
      </div>
      <p class="muted">빠른 시작: 선택한(없으면 첫) 프리셋의 기본 세계로 곧장 캠페인을 만듭니다 — AI 생성 없이.</p>
      <div class="modal-actions"><button id="wzFromTemplate">📚 기존 세계관 템플릿으로 시작 (앤솔로지)</button></div>
      <div id="wzWorldResult"></div>
    </div>`;
  $("wzQuickStart").addEventListener("click", quickStart);
  $("wzFromTemplate").addEventListener("click", openTemplatePicker);
  document.querySelectorAll(".preset-card").forEach((b) =>
    b.addEventListener("click", () => {
      wiz.preset = b.dataset.preset;
      const p = GENRE_PRESETS.find((x) => x.id === wiz.preset);
      $("wzWorldText").value = p.desc;
      document.querySelectorAll(".preset-card").forEach((x) => x.classList.toggle("sel", x === b));
    }));
  $("wzGenWorld").addEventListener("click", async () => {
    wiz.freeWorld = $("wzWorldText").value.trim();
    if (!wiz.freeWorld) return showBanner("세계에 대해 한 줄이라도 적어주세요.");
    $("wzWorldResult").innerHTML = `<div class="muted">세계를 빚는 중…</div>`;
    try {
      wiz.world = await apiPost("/api/wizard/world", { text: wiz.freeWorld });
      const preset = GENRE_PRESETS.find((x) => x.id === wiz.preset);
      if (preset) wiz.world.narrative_dna = { ...preset.dna }; // preset DNA wins
      renderWorldForm();
    } catch (e) {
      // Phase 7 Part B — retry, or fall back to an empty manual form.
      renderGenError("wzWorldResult", e.message, () => $("wzGenWorld").click(), () => {
        const preset = GENRE_PRESETS.find((x) => x.id === wiz.preset);
        wiz.world = { world_name: "", tone: "", regions: [{ canon_id: "loc_new_" + Date.now().toString(36), name: "", notable_features: [] }], factions: [], magic_or_tech: "", narrative_dna: preset ? { ...preset.dna } : undefined, era: "fantasy" };
        renderWorldForm();
      });
    }
  });
  if (wiz.world) renderWorldForm();
}

// Phase 8 B2 — anthology mode: start a new campaign from a saved world template
// (World/Faction canon only; fresh state/memory — no shared history).
async function openTemplatePicker() {
  let data;
  try { data = await api("/api/templates"); } catch (e) { return showBanner("템플릿 목록을 불러오지 못했습니다."); }
  const templates = (data && data.templates) || [];
  if (!templates.length) return showBanner("저장된 세계관 템플릿이 없습니다. 진행 중 캠페인의 설정 탭에서 먼저 저장하세요.");
  const rows = templates.map((t) => `
    <div class="rep-row"><b>${escapeHtml(t.name)}</b>
      <button class="tmpl-use primary" data-tid="${escapeHtml(t.template_id)}" data-name="${escapeHtml(t.world_name || t.name)}">이 세계로 시작</button></div>`).join("");
  openModal(`<h3>기존 세계관 템플릿</h3>
    <p class="muted">세계(지역/세력)만 공유합니다 — 역사와 인물은 새로 시작합니다. (Legacy 세대계승과는 다른, "다른 캠페인 · 같은 세계")</p>
    ${rows}<div class="modal-actions"><button onclick="closeModal()">취소</button></div>`);
  document.querySelectorAll(".tmpl-use").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        const d = await apiPost("/api/campaign/from-template", { template_id: b.dataset.tid, campaign_id: "camp_" + Date.now().toString(36), world_name: b.dataset.name });
        clearDraft(); closeModal();
        location.hash = "#/c/" + d.campaign_id;
      } catch (e) { showBanner("템플릿으로 시작 실패: " + e.message); }
    }));
}

// Phase 7 Part B — quick start: build a minimal world from a preset (no LLM),
// register it, and jump straight into the campaign.
async function quickStart() {
  const preset = GENRE_PRESETS.find((x) => x.id === wiz.preset) || GENRE_PRESETS[0];
  $("wzWorldResult").innerHTML = `<div class="muted">기본 세계로 시작하는 중…</div>`;
  try {
    const d = await apiPost("/api/wizard/create", {
      campaign_id: "camp_" + Date.now().toString(36),
      world_name: preset.name + " 세계", era: preset.id, genre_preset: preset.id,
      expected_campaign_length: "normal",
      regions: [{ canon_id: "loc_start", name: "출발지", notable_features: [preset.desc.slice(0, 40)] }],
      factions: [],
      player: { birth_name: "이름 없는 모험가", species: "human", background: preset.desc.slice(0, 60), core_values: [], psychology: {} },
      npcs: [], narrative_dna: { ...preset.dna },
    });
    clearDraft();
    wiz.world = wiz.chars = null; wiz.step = 1;
    location.hash = "#/c/" + d.campaign_id;
  } catch (e) {
    renderGenError("wzWorldResult", e.message, quickStart, () => { wiz.world = { world_name: "", tone: "", regions: [], factions: [], narrative_dna: { ...preset.dna }, era: preset.id }; renderWorldForm(); });
  }
}

function renderWorldForm() {
  const w = wiz.world;
  const regions = (w.regions || []).map((r, i) => `
    <div class="wz-row" data-kind="region" data-i="${i}">
      <input class="wr-name" value="${escapeHtml(r.name || "")}" placeholder="지역명" />
      <input class="wr-feat" value="${escapeHtml((r.notable_features || []).join("; "))}" placeholder="특징" />
      <button class="wz-del">✕</button></div>`).join("");
  const factions = (w.factions || []).map((f, i) => `
    <div class="wz-row" data-kind="faction" data-i="${i}">
      <input class="wf-name" value="${escapeHtml(f.name || "")}" placeholder="세력명" />
      <input class="wf-desc" value="${escapeHtml(f.founding_principle || "")}" placeholder="설립 원칙" />
      <button class="wz-del">✕</button></div>`).join("");
  $("wzWorldResult").innerHTML = `
    ${w._mock ? `<div class="muted">※ API 키가 없어 목업 생성 결과입니다.</div>` : ""}
    <div class="wz-field"><label>세계 이름</label><input id="wzWorldName" value="${escapeHtml(w.world_name || "")}" /></div>
    <div class="wz-field"><label>톤/분위기</label><input id="wzTone" value="${escapeHtml(w.tone || "")}" /></div>
    <div class="wz-field"><label>지역</label>${regions}<button id="wzAddRegion">+ 지역 추가</button></div>
    <div class="wz-field"><label>세력</label>${factions}<button id="wzAddFaction">+ 세력 추가</button></div>
    <div class="wz-field"><label>마법/기술 체계</label><input id="wzMagic" value="${escapeHtml(w.magic_or_tech || "")}" /></div>
    <div class="modal-actions">
      <button onclick="setWizStep(1)">다시 생성</button>
      <button id="wzToStep2" class="primary">다음 단계 →</button></div>`;
  const syncWorld = () => {
    w.world_name = $("wzWorldName").value;
    w.tone = $("wzTone").value;
    w.magic_or_tech = $("wzMagic").value;
    document.querySelectorAll('[data-kind="region"]').forEach((row) => {
      const r = w.regions[Number(row.dataset.i)];
      if (r) { r.name = row.querySelector(".wr-name").value; r.notable_features = row.querySelector(".wr-feat").value.split(";").map((s) => s.trim()).filter(Boolean); }
    });
    document.querySelectorAll('[data-kind="faction"]').forEach((row) => {
      const f = w.factions[Number(row.dataset.i)];
      if (f) { f.name = row.querySelector(".wf-name").value; f.founding_principle = row.querySelector(".wf-desc").value; }
    });
  };
  document.querySelectorAll(".wz-del").forEach((b) =>
    b.addEventListener("click", () => {
      const row = b.parentElement;
      const arr = row.dataset.kind === "region" ? w.regions : w.factions;
      arr.splice(Number(row.dataset.i), 1);
      renderWorldForm();
    }));
  $("wzAddRegion").addEventListener("click", () => { syncWorld(); w.regions.push({ canon_id: "loc_new_" + Date.now().toString(36), name: "", notable_features: [] }); renderWorldForm(); });
  $("wzAddFaction").addEventListener("click", () => { syncWorld(); w.factions.push({ canon_id: "faction_new_" + Date.now().toString(36), name: "", founding_principle: "" }); renderWorldForm(); });
  $("wzToStep2").addEventListener("click", () => { syncWorld(); setWizStep(2); });
}

// ---------- step 2: 캐릭터 ----------
function renderWizStep2() {
  $("wizardBody").innerHTML = `
    <div class="wiz-card">
      <h2>당신은 이 세계의 누구인가요?</h2>
      <textarea id="wzCharText" rows="3" placeholder="예: 과거를 숨긴 채 항구에 흘러들어온 전직 용병">${escapeHtml(wiz.freeChar)}</textarea>
      <div class="modal-row"><label>추천 NPC 수</label>
        <select id="wzNpcCount"><option>0</option><option>1</option><option>2</option><option selected>3</option><option>4</option><option>5</option></select></div>
      <div class="modal-actions"><button id="wzGenChar" class="primary">AI로 생성</button><button onclick="setWizStep(1)">← 이전</button></div>
      <div id="wzCharResult"></div>
    </div>`;
  $("wzGenChar").addEventListener("click", async () => {
    wiz.freeChar = $("wzCharText").value.trim();
    if (!wiz.freeChar) return showBanner("캐릭터에 대해 한 줄이라도 적어주세요.");
    $("wzCharResult").innerHTML = `<div class="muted">인물을 빚는 중…</div>`;
    try {
      wiz.chars = await apiPost("/api/wizard/characters", { text: wiz.freeChar, world: wiz.world, npc_count: Number($("wzNpcCount").value) });
      wiz.chars.npcs = (wiz.chars.npcs || []).map((n) => ({ ...n, _selected: true }));
      renderCharForm();
    } catch (e) {
      renderGenError("wzCharResult", e.message, () => $("wzGenChar").click(), () => {
        wiz.chars = { player: { birth_name: "", species: "human", background: "", core_values: [], psychology: {} }, npcs: [] };
        renderCharForm();
      });
    }
  });
  if (wiz.chars) renderCharForm();
}

function renderCharForm() {
  const c = wiz.chars;
  const p = c.player || {};
  const psy = p.psychology || {};
  const npcs = (c.npcs || []).map((n, i) => `
    <div class="wz-npc ${n._selected ? "" : "off"}" data-i="${i}">
      <label class="npc-check"><input type="checkbox" class="npc-sel" data-i="${i}" ${n._selected ? "checked" : ""}/> <b>${escapeHtml(n.birth_name || n.canon_id)}</b></label>
      <div class="wz-field"><label>목표</label><input class="npc-goal" data-i="${i}" value="${escapeHtml(n.goal_current || "")}" /></div>
      <div class="muted">${escapeHtml((n.psychology && n.psychology.defense_mechanism) || "")}</div>
    </div>`).join("");
  $("wzCharResult").innerHTML = `
    ${c._mock ? `<div class="muted">※ API 키가 없어 목업 생성 결과입니다.</div>` : ""}
    <div class="wz-field"><label>이름</label><input id="wzPName" value="${escapeHtml(p.birth_name || "")}" /></div>
    <div class="wz-field"><label>배경</label><input id="wzPBg" value="${escapeHtml(p.background || "")}" /></div>
    <div class="wz-field"><label>가치관 (쉼표 구분)</label><input id="wzPValues" value="${escapeHtml((p.core_values || []).join(", "))}" /></div>
    <div class="wz-field"><label>두려움</label><input id="wzPFear" value="${escapeHtml(psy.core_fear || "")}" /></div>
    <div class="wz-field"><label>트라우마</label><input id="wzPTrauma" value="${escapeHtml(psy.trauma || "")}" /></div>
    <div class="section-h">주요 NPC (선택)</div>${npcs || `<div class="muted">추천 NPC 없음</div>`}
    <div class="modal-actions"><button id="wzToStep3" class="primary">다음 단계 →</button></div>`;
  document.querySelectorAll(".npc-sel").forEach((cb) =>
    cb.addEventListener("change", () => { c.npcs[Number(cb.dataset.i)]._selected = cb.checked; cb.closest(".wz-npc").classList.toggle("off", !cb.checked); }));
  $("wzToStep3").addEventListener("click", () => {
    c.player = {
      birth_name: $("wzPName").value, species: p.species || "human", background: $("wzPBg").value,
      core_values: $("wzPValues").value.split(",").map((s) => s.trim()).filter(Boolean),
      psychology: { ...psy, core_fear: $("wzPFear").value, trauma: $("wzPTrauma").value },
    };
    document.querySelectorAll(".npc-goal").forEach((inp) => { c.npcs[Number(inp.dataset.i)].goal_current = inp.value; });
    setWizStep(3);
  });
}

// ---------- step 3: 확인 및 시작 ----------
function renderWizStep3() {
  const w = wiz.world || {}, c = wiz.chars || {};
  const dna = w.narrative_dna || { tone: 3, emotion: 3, politics: 3, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 };
  const sliders = DNA_KEYS.map((k) => `
    <div class="dna-row"><label>${DNA_LABEL[k]}</label>
      <input type="range" min="1" max="5" step="1" value="${dna[k] || 3}" data-dna="${k}" />
      <span class="dna-val">${dna[k] || 3}</span></div>`).join("");
  const selNpcs = (c.npcs || []).filter((n) => n._selected);
  $("wizardBody").innerHTML = `
    <div class="wiz-card">
      <h2>${escapeHtml(w.world_name || "이름 없는 세계")}</h2>
      <p class="muted">${escapeHtml(w.tone || "")} · 지역 ${(w.regions || []).length} · 세력 ${(w.factions || []).length}</p>
      <p><b>${escapeHtml((c.player && c.player.birth_name) || "플레이어")}</b>${c.player && c.player.background ? ` — ${escapeHtml(c.player.background)}` : ""}</p>
      <p class="muted">동행할 인물: ${selNpcs.map((n) => escapeHtml(n.birth_name)).join(", ") || "없음"}</p>
      <div class="section-h">예상 캠페인 길이</div>
      <div class="modal-row"><label>페이싱 기준</label>
        <select id="wzLength">
          <option value="short" ${wiz.length === "short" ? "selected" : ""}>짧게 (약 80턴)</option>
          <option value="normal" ${wiz.length === "normal" ? "selected" : ""}>보통 (약 180턴)</option>
          <option value="long" ${wiz.length === "long" ? "selected" : ""}>길게 (약 320턴)</option>
        </select></div>
      <p class="muted">Campaign Planner가 이 길이를 기준으로 각 단계의 호흡을 조절합니다. 나중에 설정에서 바꿀 수 있습니다.</p>
      <div class="section-h">Narrative DNA</div>${sliders}
      <div class="modal-actions">
        <button onclick="setWizStep(2)">← 이전</button>
        <button id="wzCreate" class="primary">캠페인 시작</button></div>
      <div id="wzCreateStatus"></div>
    </div>`;
  $("wzLength").addEventListener("change", (e) => { wiz.length = e.target.value; saveDraft(); });
  document.querySelectorAll('input[type="range"][data-dna]').forEach((r) =>
    r.addEventListener("input", () => { r.nextElementSibling.textContent = r.value; }));
  $("wzCreate").addEventListener("click", async () => {
    const dnaOut = {};
    document.querySelectorAll("[data-dna]").forEach((r) => (dnaOut[r.dataset.dna] = Number(r.value)));
    $("wzCreateStatus").innerHTML = `<div class="muted">세계를 등록하는 중… (Kernel 검증 경유)</div>`;
    try {
      const d = await apiPost("/api/wizard/create", {
        campaign_id: "camp_" + Date.now().toString(36),
        world_name: w.world_name, era: w.era, genre_preset: wiz.preset,
        regions: w.regions, factions: w.factions,
        player: c.player, npcs: selNpcs,
        narrative_dna: dnaOut,
        expected_campaign_length: wiz.length, // Phase 7 A3
      });
      if (d.failed && d.failed.length) console.warn("canon.register rejects:", d.failed);
      clearDraft();
      wiz.world = wiz.chars = null; wiz.step = 1;
      location.hash = "#/c/" + d.campaign_id;
    } catch (e) { $("wzCreateStatus").innerHTML = `<div class="muted">생성 실패: ${escapeHtml(e.message)}</div>`; }
  });
}

// Phase 7 Part B — on entering the wizard, offer to resume a saved draft.
// Returns true if a draft was resumed (caller then skips the fresh step 1).
function maybeResumeWizardDraft() {
  if (wiz.world || wiz.chars) return false; // already mid-session
  const d = loadDraft();
  if (!d || (!d.world && !d.chars && !d.freeWorld)) return false;
  const when = d.at ? new Date(d.at).toLocaleString() : "";
  if (!confirm(`작성하던 세계가 있습니다${when ? ` (${when})` : ""}. 이어서 작성할까요?\n(취소하면 새로 시작합니다.)`)) { clearDraft(); return false; }
  wiz.world = d.world; wiz.chars = d.chars; wiz.freeWorld = d.freeWorld || ""; wiz.freeChar = d.freeChar || "";
  wiz.preset = d.preset || null; wiz.length = d.length || "normal";
  setWizStep(d.step || 1);
  return true;
}

function wireWizard() {
  $("wizBack").addEventListener("click", () => { location.hash = "#/"; });
}
