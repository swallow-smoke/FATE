// Setup wizard — FORM-FIRST (PATCH B1). Every creation screen opens as an empty,
// directly-editable form; the AI never auto-fills anything. Each field (or field
// group) has an "AI 도움" button that suggests a value ONLY for that field, which
// the user may accept or ignore. Applies without exception to world, player, and
// NPCs. On "시작" everything goes through the Kernel canon.register pipeline.
"use strict";

// Genre presets prefill the free-text fields + fixed DNA (no AI call).
const GENRE_PRESETS = [
  { id: "fantasy", name: "판타지", desc: "습기 찬 항구도시가 있는 낮은 판타지 세계. 마법은 희귀하고 위험하며, 세력들이 물밑에서 다툰다.", dna: { tone: 3, emotion: 4, politics: 3, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 4 } },
  { id: "sf", name: "SF", desc: "궤도 정거장과 식민 행성으로 이루어진 근미래. 기업 연합이 통치하고, 오래된 신호가 심우주에서 돌아오고 있다.", dna: { tone: 2, emotion: 3, politics: 4, survival: 4, horror: 2, mystery: 4, romance: 1, exploration: 5 } },
  { id: "school", name: "학교물", desc: "언덕 위의 오래된 사립학교. 동아리와 소문, 옥상에서의 대화. 졸업이 다가올수록 각자의 비밀이 무거워진다.", dna: { tone: 4, emotion: 5, politics: 1, survival: 1, horror: 1, mystery: 3, romance: 4, exploration: 2 } },
  { id: "zombie", name: "좀비", desc: "감염 3주차의 도시. 물자와 신뢰가 동시에 바닥나고 있다. 생존자 무리마다 규칙이 다르다.", dna: { tone: 1, emotion: 4, politics: 2, survival: 5, horror: 4, mystery: 2, romance: 1, exploration: 3 } },
  { id: "modern", name: "현대", desc: "지금의 도시. 평범한 일상 아래 작은 균열이 자라고 있다 — 그 균열이 당신의 이야기를 시작하게 한다.", dna: { tone: 3, emotion: 4, politics: 2, survival: 2, horror: 1, mystery: 4, romance: 3, exploration: 2 } },
];

const REL_TYPES = ["안 정해짐", "친구", "낯선 사람", "라이벌", "가족", "스승"];
const EXTRA_ITEM_TYPES = [
  "Organization", "Item", "Property", "FamilyRelation", "Promise",
  "CalendarEvent", "WantedRecord", "RegionReputation", "HouseRule",
  "NarrativeArc", "Motif", "HiddenVariable", "Other",
];
const START_PRESETS = [
  { id: "arrival", name: "낯선 곳에 막 도착했다", desc: "새 장소, 첫 만남, 작은 불편함으로 시작" },
  { id: "letter", name: "오래된 편지를 받았다", desc: "과거의 인물이나 약속이 현재를 두드림" },
  { id: "rainy_reunion", name: "비 오는 날 재회했다", desc: "관계 중심, 말하지 못한 감정으로 시작" },
  { id: "missing", name: "누군가 사라졌다", desc: "조사와 소문, 불안한 일상으로 시작" },
  { id: "quiet_day", name: "평온한 하루에서 시작한다", desc: "일상, 대화, 작은 선택부터 천천히" },
];

// Form-first: wiz holds a fully-editable model from the very first render.
function blankWorld() { return { world_name: "", tone: "", background_description: "", regions: [], factions: [], notes: "" }; }
function blankPlayer() { return { birth_name: "", background: "", core_values: [], psychology: { core_fear: "", desire: "", trauma: "" }, notes: "" }; }
function blankChars() { return { player: blankPlayer(), npcs: [] }; }
function blankExtraItems() { return []; }
function blankNpc() {
  return {
    canon_id: "char_" + Date.now().toString(36) + Math.floor(Math.random() * 900 + 100),
    birth_name: "", species: "human", role: "npc", background: "", core_values: [],
    goal_current: "", current_location: "", affiliations: [], schedule_hint: "",
    psychology: { attachment_style: "secure", core_fear: "", desire: "", defense_mechanism: "", trauma: "" },
    relationship_to_player_type: "안 정해짐", no_player_connection: false,
  };
}

const wiz = { step: 1, world: blankWorld(), chars: blankChars(), extraItems: blankExtraItems(), freeWorld: "", preset: null, length: "normal", startPreset: "arrival" };

function worldDraftStats() {
  const text = [wiz.world.background_description, wiz.world.notes, wiz.freeWorld].filter(Boolean).join("\n\n");
  return {
    chars: text.length,
    lines: text ? text.split(/\r\n|\r|\n/).length : 0,
    regions: (wiz.world.regions || []).length,
    factions: (wiz.world.factions || []).length,
    imports: (wiz.extraItems || []).length,
  };
}

function renderWorldDraftStats() {
  const s = worldDraftStats();
  return `
    <div class="world-draft-stats" aria-label="world draft stats">
      <span><b>${s.chars.toLocaleString()}</b><small>chars</small></span>
      <span><b>${s.lines.toLocaleString()}</b><small>lines</small></span>
      <span><b>${s.regions}</b><small>places</small></span>
      <span><b>${s.factions}</b><small>factions</small></span>
      <span><b>${s.imports}</b><small>imports</small></span>
    </div>`;
}

function wizardDocRail(kind) {
  const items = kind === "characters"
    ? [["주인공", "wzPName"], ["배경", "wzPBg"], ["심리", "wzPFear"], ["NPC", "wzNpcs"]]
    : [["장르", "preset-row"], ["세계 이름", "wzWorldName"], ["본문 설정", "wzBackground"], ["지역", "wzRegions"], ["세력", "wzFactions"], ["세부 설정", "wzExtraItems"]];
  return `<aside class="wizard-doc-rail">
    <div class="wizard-doc-title">${kind === "characters" ? "Character Bible" : "World Bible"}</div>
    ${items.map(([label, id]) => `<button type="button" data-jump="${id}">${label}</button>`).join("")}
  </aside>`;
}

function bindWizardDocRail() {
  document.querySelectorAll(".wizard-doc-rail [data-jump]").forEach((b) => b.addEventListener("click", () => {
    const target = $(b.dataset.jump) || document.querySelector("." + b.dataset.jump);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
}

// --- draft autosave (Phase 7 Part B) ---------------------------------------
const DRAFT_KEY = "nos_wizard_draft";
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ step: wiz.step, world: wiz.world, chars: wiz.chars, extraItems: wiz.extraItems, freeWorld: wiz.freeWorld, preset: wiz.preset, length: wiz.length, startPreset: wiz.startPreset, at: Date.now() })); } catch (e) {}
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

// --- AI 도움 helper (B1) ----------------------------------------------------
// Renders an "AI 도움" button. On click: sync the current form into wiz, ask the
// server to suggest ONLY this field, apply the suggestion into wiz, re-render.
function aiBtn(field, extra) {
  return `<button type="button" class="ai-help" data-aifield="${field}"${extra ? ` ${extra}` : ""} title="이 항목만 AI가 제안합니다 (자동으로 채우지 않음)">✨ AI 도움</button>`;
}
async function askSuggest(field, context) {
  const r = await apiPost("/api/wizard/suggest", { field, context });
  return r && r.suggestion;
}
function wizContext() {
  return { worldText: wiz.freeWorld, world: wiz.world, charText: "", player: wiz.chars.player };
}

// --- step 1: 세계관 (empty form + per-field AI 도움) -------------------------
function renderWizStep1() {
  const w = wiz.world;
  const presets = GENRE_PRESETS.map((p) => `
    <button type="button" class="preset-card ${wiz.preset === p.id ? "sel" : ""}" data-preset="${p.id}"><b>${p.name}</b><span>${escapeHtml(p.desc.slice(0, 40))}…</span></button>`).join("");
  const regions = (w.regions || []).map((r, i) => `
    <div class="wz-entity" data-kind="region" data-i="${i}">
      <div class="wz-entity-head"><b>지역 ${i + 1}</b> <span>${aiBtn("region", `data-i="${i}"`)}<button type="button" class="wz-del" data-kind="region" data-i="${i}">✕ 삭제</button></span></div>
      <div class="wz-field"><label>이름</label><input class="rg" data-i="${i}" data-k="name" value="${escapeHtml(r.name || "")}" placeholder="지역명" /></div>
      <div class="wz-field"><label>설명</label><input class="rg" data-i="${i}" data-k="description" value="${escapeHtml(r.description || "")}" placeholder="한 줄 설명" /></div>
      <div class="wz-grid2">
        <div class="wz-field"><label>지형 <small>(선택)</small></label><input class="rg" data-i="${i}" data-k="terrain" value="${escapeHtml(r.terrain || "")}" placeholder="예: 갯벌/부두" /></div>
        <div class="wz-field"><label>기후 <small>(선택)</small></label><input class="rg" data-i="${i}" data-k="climate" value="${escapeHtml(r.climate || "")}" placeholder="예: 습하고 안개" /></div>
        <div class="wz-field"><label>치안 수준 <small>(선택)</small></label><input class="rg" data-i="${i}" data-k="security_level" value="${escapeHtml(r.security_level || "")}" placeholder="예: 불안정" /></div>
        <div class="wz-field"><label>주요 특징 <small>(; 구분)</small></label><input class="rg" data-i="${i}" data-k="notable_features" value="${escapeHtml((r.notable_features || []).join("; "))}" placeholder="특징1; 특징2" /></div>
      </div>
    </div>`).join("");
  const factions = (w.factions || []).map((f, i) => `
    <div class="wz-entity" data-kind="faction" data-i="${i}">
      <div class="wz-entity-head"><b>세력 ${i + 1}</b> <span>${aiBtn("faction", `data-i="${i}"`)}<button type="button" class="wz-del" data-kind="faction" data-i="${i}">✕ 삭제</button></span></div>
      <div class="wz-field"><label>이름</label><input class="fc" data-i="${i}" data-k="name" value="${escapeHtml(f.name || "")}" placeholder="세력명" /></div>
      <div class="wz-field"><label>설명</label><input class="fc" data-i="${i}" data-k="description" value="${escapeHtml(f.description || "")}" placeholder="한 줄 설명" /></div>
      <div class="wz-grid2">
        <div class="wz-field"><label>목표 <small>(선택)</small></label><input class="fc" data-i="${i}" data-k="goal" value="${escapeHtml(f.goal || "")}" placeholder="세력의 목표" /></div>
        <div class="wz-field"><label>주요 인물 <small>(선택)</small></label><input class="fc" data-i="${i}" data-k="key_people" value="${escapeHtml(f.key_people || "")}" placeholder="예: 노령의 갈" /></div>
        <div class="wz-field"><label>다른 세력과의 관계 <small>(선택)</small></label><input class="fc" data-i="${i}" data-k="faction_relations" value="${escapeHtml(f.faction_relations || "")}" placeholder="예: 상인 길드와 대립" /></div>
        <div class="wz-field"><label>영향력 범위 <small>(선택)</small></label><input class="fc" data-i="${i}" data-k="influence" value="${escapeHtml(f.influence || "")}" placeholder="예: 항구 일대" /></div>
      </div>
    </div>`).join("");

  $("wizardBody").innerHTML = `
    <div class="wiz-card">
      <h2>어떤 세계를 만들고 싶나요?</h2>
      <p class="muted">모든 칸은 직접 입력할 수 있습니다. 막히는 칸만 <b>✨ AI 도움</b>으로 제안을 받아 채우세요 — AI가 알아서 다 채우지 않습니다.</p>

      <div class="section-h">장르 프리셋 <small>(선택 — 톤/DNA 기본값만 채웁니다)</small></div>
      <div class="preset-row">${presets}</div>

      <div class="wz-field"><label>세계 이름 ${aiBtn("world_name")}</label><input id="wzWorldName" value="${escapeHtml(w.world_name || "")}" placeholder="예: 안개의 항구, 벨하르" /></div>
      <div class="wz-field"><label>톤/분위기 ${aiBtn("tone")}</label><input id="wzTone" value="${escapeHtml(w.tone || "")}" placeholder="예: 낮은 채도의, 젖은 돌과 안개" /></div>
      <div class="wz-field"><label>세계관 배경 설명 ${aiBtn("background_description")}</label>
        <textarea id="wzBackground" rows="5" placeholder="마법·기술·종교·역사 등을 강제로 나누지 말고 자유롭게 서술하세요. 진행 중 GM이 배경으로 참조합니다.">${escapeHtml(w.background_description || "")}</textarea></div>

      <div class="section-h">지역 <small>(선택, 원하는 만큼)</small></div>
      <div id="wzRegions">${regions || `<p class="muted">아직 지역이 없습니다.</p>`}</div>
      <button type="button" id="wzAddRegion">+ 지역 추가</button>

      <div class="section-h">세력 <small>(선택, 원하는 만큼)</small></div>
      <div id="wzFactions">${factions || `<p class="muted">아직 세력이 없습니다.</p>`}</div>
      <button type="button" id="wzAddFaction">+ 세력 추가</button>

      <div class="section-h">기타 <small>(자유 메모)</small></div>
      <div class="wz-field"><label>정해진 칸에 안 맞는 이야기를 자유롭게</label>
        <textarea id="wzWorldNotes" rows="3" placeholder="구조화하지 않고 그대로 저장됩니다. GM이 관련 시점에 참고합니다.">${escapeHtml(w.notes || "")}</textarea></div>

      <div class="section-h">세부 커스터마이징 <small>세계관 시작 전에 전부 수정</small></div>
      <p class="muted">MIO처럼 설정이 많은 문서는 여기서 조직, 아이템, 집, 가족관계, 약속, 일정, 수배, 평판, 하우스 룰, 아크, 모티프, 숨은 변수까지 직접 만들고 수정할 수 있습니다.</p>
      <div class="file-draft-tools">
        <select id="wzExtraType">
          ${EXTRA_ITEM_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}
        </select>
        <button type="button" id="wzAddExtra">+ 세부 설정 추가</button>
      </div>
      <div id="wzExtraItems">${renderExtraItemsEditor()}</div>

      <div class="modal-actions">
        <button type="button" id="wzQuickStart" title="선택한(없으면 첫) 프리셋의 기본 세계로 곧장 시작 — AI 없이">⚡ 빠른 시작</button>
        <button type="button" id="wzFromTemplate">📚 기존 세계관 템플릿</button>
        <button type="button" id="wzNotionImport" title="Notion 페이지 링크에서 세계관/캐릭터를 가져옵니다">📥 Notion에서 가져오기</button>
        <button type="button" id="wzFileImport" title=".md/.txt 파일을 올리면 AI가 분석해 세계관/캐릭터로 등록합니다">📄 파일에서 가져오기</button>
        <button type="button" id="wzToStep2" class="primary">다음 단계 →</button>
      </div>
      <div id="wzWorldResult"></div>
    </div>`;

  const card = document.querySelector("#wizardBody .wiz-card");
  if (card) {
    card.classList.add("wiz-card-wide", "world-builder-card", "wizard-doc-card");
    card.insertAdjacentHTML("afterbegin", wizardDocRail("world"));
    card.insertAdjacentHTML("afterbegin", `
      <section class="world-builder-hero">
        <div>
          <span class="eyebrow">World Bible</span>
          <h2>책 쓰듯이 세계관 만들기</h2>
          <p class="muted">큰 설정은 긴 문서처럼 쓰고, 아래의 세부 칸은 그대로 유지합니다. 지역, 세력, 아이템, 규칙까지 빠뜨리지 않고 정리할 수 있습니다.</p>
          <div class="world-builder-actions">
            <button type="button" id="wzTopFileImport" class="primary">파일 가져오기</button>
            <button type="button" id="wzTopNotionImport">Notion 가져오기</button>
            <button type="button" id="wzTopTemplate">템플릿</button>
          </div>
        </div>
        <div id="wzWorldStats">${renderWorldDraftStats()}</div>
      </section>`);
  }
  if ($("wzBackground")) $("wzBackground").rows = Math.max(Number($("wzBackground").rows || 0), 14);
  if ($("wzWorldNotes")) $("wzWorldNotes").rows = Math.max(Number($("wzWorldNotes").rows || 0), 8);
  const refreshWorldStats = () => {
    if ($("wzBackground")) wiz.world.background_description = $("wzBackground").value;
    if ($("wzWorldNotes")) wiz.world.notes = $("wzWorldNotes").value;
    if ($("wzWorldStats")) $("wzWorldStats").innerHTML = renderWorldDraftStats();
  };
  ["wzBackground", "wzWorldNotes"].forEach((id) => { if ($(id)) $(id).addEventListener("input", refreshWorldStats); });
  if ($("wzTopFileImport")) $("wzTopFileImport").addEventListener("click", () => {
    readStep1();
    openFileImport({ fillOnly: true, onItems: applyImportItemsToWizard });
  });
  if ($("wzTopNotionImport")) $("wzTopNotionImport").addEventListener("click", () => {
    readStep1();
    openNotionImport({ fillOnly: true, onItems: applyImportItemsToWizard });
  });
  if ($("wzTopTemplate")) $("wzTopTemplate").addEventListener("click", openTemplatePicker);

  // preset click: fills tone/background hint + DNA (no AI).
  document.querySelectorAll(".preset-card").forEach((b) =>
    b.addEventListener("click", () => {
      readStep1();
      wiz.preset = b.dataset.preset;
      const p = GENRE_PRESETS.find((x) => x.id === wiz.preset);
      if (p && !wiz.world.tone) wiz.world.tone = p.desc;
      if (p && !wiz.world.background_description) wiz.world.background_description = p.desc;
      wiz.world._presetDna = { ...p.dna };
      renderWizStep1();
    }));

  $("wzAddRegion").addEventListener("click", () => { readStep1(); wiz.world.regions.push({ canon_id: "loc_" + Date.now().toString(36), name: "", description: "", terrain: "", climate: "", security_level: "", notable_features: [] }); renderWizStep1(); });
  $("wzAddFaction").addEventListener("click", () => { readStep1(); wiz.world.factions.push({ canon_id: "faction_" + Date.now().toString(36), name: "", description: "", goal: "", key_people: "", faction_relations: "", influence: "", founding_principle: "" }); renderWizStep1(); });
  document.querySelectorAll('#wzRegions .wz-del, #wzFactions .wz-del').forEach((b) =>
    b.addEventListener("click", () => { readStep1(); (b.dataset.kind === "region" ? wiz.world.regions : wiz.world.factions).splice(Number(b.dataset.i), 1); renderWizStep1(); }));
  $("wzAddExtra").addEventListener("click", () => {
    readStep1();
    const type = $("wzExtraType").value || "Other";
    wiz.extraItems.push(newExtraItem(type));
    renderWizStep1();
  });
  bindExtraItemsControls(renderWizStep1);

  // per-field AI 도움
  bindAiButtons(() => readStep1(), (field, btn) => {
    if (field === "region") { const i = Number(btn.dataset.i); askAndFillEntity("region", i); }
    else if (field === "faction") { const i = Number(btn.dataset.i); askAndFillEntity("faction", i); }
    else askAndFillWorldScalar(field);
  });

  $("wzQuickStart").addEventListener("click", quickStart);
  $("wzFromTemplate").addEventListener("click", openTemplatePicker);
  $("wzNotionImport").addEventListener("click", () => {
    readStep1();
    openNotionImport({ fillOnly: true, onItems: applyImportItemsToWizard });
  });
  $("wzFileImport").addEventListener("click", () => {
    readStep1();
    openFileImport({ fillOnly: true, onItems: applyImportItemsToWizard });
  });
  $("wzToStep2").addEventListener("click", () => { readStep1(); setWizStep(2); });
  bindWizardDocRail();
}

function readStep1() {
  const w = wiz.world;
  if ($("wzWorldName")) w.world_name = $("wzWorldName").value;
  if ($("wzTone")) w.tone = $("wzTone").value;
  if ($("wzBackground")) w.background_description = $("wzBackground").value;
  if ($("wzWorldNotes")) w.notes = $("wzWorldNotes").value;
  readExtraItemsFromStep3();
  document.querySelectorAll("#wzRegions .rg").forEach((inp) => {
    const r = w.regions[Number(inp.dataset.i)]; if (!r) return;
    if (inp.dataset.k === "notable_features") r.notable_features = inp.value.split(";").map((s) => s.trim()).filter(Boolean);
    else r[inp.dataset.k] = inp.value;
  });
  document.querySelectorAll("#wzFactions .fc").forEach((inp) => {
    const f = w.factions[Number(inp.dataset.i)]; if (!f) return;
    f[inp.dataset.k] = inp.value;
  });
  saveDraft();
}
async function askAndFillWorldScalar(field) {
  try {
    const s = await askSuggest(field, wizContext());
    if (s == null) return;
    if (field === "world_name") wiz.world.world_name = s;
    else if (field === "tone") wiz.world.tone = s;
    else if (field === "background_description") wiz.world.background_description = s;
    renderWizStep1();
  } catch (e) { showBanner("AI 제안 실패: " + e.message); }
}
async function askAndFillEntity(kind, i) {
  try {
    const s = await askSuggest(kind, wizContext());
    if (!s) return;
    const arr = kind === "region" ? wiz.world.regions : wiz.world.factions;
    if (!arr[i]) return;
    arr[i] = { ...arr[i], ...s };
    if (kind === "region" && typeof s.notable_features === "string") arr[i].notable_features = s.notable_features.split(";").map((x) => x.trim()).filter(Boolean);
    renderWizStep1();
  } catch (e) { showBanner("AI 제안 실패: " + e.message); }
}

// --- step 2: 캐릭터 (empty form + per-field AI 도움, unlimited NPCs) ---------
function renderWizStep2() {
  const c = wiz.chars;
  const p = c.player;
  const npcs = (c.npcs || []).map((n, i) => npcCardHtml(n, i)).join("");
  $("wizardBody").innerHTML = `
    <div class="wiz-card">
      <h2>당신은 이 세계의 누구인가요?</h2>
      <p class="muted">직접 입력하거나, 칸마다 <b>✨ AI 도움</b>으로 제안을 받으세요.</p>

      <div class="section-h">플레이어 캐릭터</div>
      <div class="wz-field"><label>이름</label><input id="wzPName" value="${escapeHtml(p.birth_name || "")}" placeholder="이름" /></div>
      <div class="wz-field"><label>배경 ${aiBtn("player_background")}</label><textarea id="wzPBg" rows="8" placeholder="태어난 곳, 잃어버린 것, 지금 숨기는 것, 이 세계와 맺은 약속을 소설 설정처럼 길게 써도 됩니다.">${escapeHtml(p.background || "")}</textarea></div>
      <div class="wz-field"><label>가치관 <small>(쉼표 구분)</small> ${aiBtn("player_core_values")}</label><input id="wzPValues" value="${escapeHtml((p.core_values || []).join(", "))}" placeholder="예: 생존, 의리" /></div>
      <div class="wz-grid2">
        <div class="wz-field"><label>두려움 ${aiBtn("player_fear")}</label><input id="wzPFear" value="${escapeHtml((p.psychology || {}).core_fear || "")}" /></div>
        <div class="wz-field"><label>욕망 ${aiBtn("player_desire")}</label><input id="wzPDesire" value="${escapeHtml((p.psychology || {}).desire || "")}" /></div>
        <div class="wz-field"><label>트라우마 ${aiBtn("player_trauma")}</label><input id="wzPTrauma" value="${escapeHtml((p.psychology || {}).trauma || "")}" /></div>
      </div>
      <div class="wz-field"><label>기타 <small>(자유 메모)</small></label><textarea id="wzPNotes" rows="2" placeholder="정해진 칸에 안 맞는 이야기 — 그대로 저장, GM이 참고">${escapeHtml(p.notes || "")}</textarea></div>

      <div class="section-h">NPC <small>(선택, 원하는 만큼)</small></div>
      <div id="wzNpcs">${npcs || `<p class="muted">아직 NPC가 없습니다.</p>`}</div>
      <button type="button" id="wzAddNpc">+ NPC 추가</button>

      <div class="modal-actions"><button type="button" onclick="setWizStep(1)">← 이전</button><button type="button" id="wzToStep3" class="primary">다음 단계 →</button></div>
    </div>`;

  const card = document.querySelector("#wizardBody .wiz-card");
  if (card) {
    card.classList.add("wiz-card-wide", "wizard-doc-card", "character-builder-card");
    card.insertAdjacentHTML("afterbegin", wizardDocRail("characters"));
    card.insertAdjacentHTML("afterbegin", `
      <section class="world-builder-hero">
        <div>
          <span class="eyebrow">Character Bible</span>
          <h2>책 속 인물처럼 캐릭터 만들기</h2>
          <p class="muted">주인공과 NPC를 노션 문서처럼 정리합니다. 기존의 가치관, 심리, 관계, 위치, 소속 세부 설정은 그대로 유지됩니다.</p>
        </div>
        <div class="world-draft-stats">
          <span><b>${(c.npcs || []).length}</b><small>NPC</small></span>
          <span><b>${p.birth_name ? 1 : 0}</b><small>hero</small></span>
          <span><b>${(p.background || "").length.toLocaleString()}</b><small>chars</small></span>
        </div>
      </section>`);
  }

  $("wzAddNpc").addEventListener("click", () => { readStep2(); wiz.chars.npcs.push(blankNpc()); renderWizStep2(); });
  document.querySelectorAll("#wzNpcs .wz-del").forEach((b) =>
    b.addEventListener("click", () => { readStep2(); wiz.chars.npcs.splice(Number(b.dataset.i), 1); renderWizStep2(); }));
  // no-connection checkbox toggles the relationship dropdown live
  document.querySelectorAll(".npc-noconn").forEach((cb) =>
    cb.addEventListener("change", () => { readStep2(); renderWizStep2(); }));

  bindAiButtons(() => readStep2(), (field, btn) => {
    if (field === "npc") askAndFillNpc(Number(btn.dataset.i));
    else askAndFillPlayerScalar(field);
  });

  $("wzToStep3").addEventListener("click", () => { readStep2(); setWizStep(3); });
  bindWizardDocRail();
}

function npcCardHtml(n, i) {
  const psy = n.psychology || {};
  const noConn = !!n.no_player_connection;
  const relOptions = REL_TYPES.map((t) => `<option ${((n.relationship_to_player_type || "안 정해짐") === t) ? "selected" : ""}>${t}</option>`).join("");
  const locOptions = ['<option value="">(지역 선택 안 함)</option>']
    .concat((wiz.world.regions || []).map((r) => `<option value="${escapeHtml(r.canon_id)}" ${n.current_location === r.canon_id ? "selected" : ""}>${escapeHtml(r.name || r.canon_id)}</option>`)).join("");
  const affOptions = (wiz.world.factions || []).map((f) => `<label class="chip"><input type="checkbox" class="npc-aff" data-i="${i}" value="${escapeHtml(f.canon_id)}" ${(n.affiliations || []).includes(f.canon_id) ? "checked" : ""}/> ${escapeHtml(f.name || f.canon_id)}</label>`).join("") || `<span class="muted">등록된 세력 없음</span>`;
  return `
    <div class="wz-entity" data-kind="npc" data-i="${i}">
      <div class="wz-entity-head"><b>NPC ${i + 1}</b> <span>${aiBtn("npc", `data-i="${i}"`)}<button type="button" class="wz-del" data-i="${i}">✕ 삭제</button></span></div>
      <div class="wz-field"><label>이름</label><input class="np" data-i="${i}" data-k="birth_name" value="${escapeHtml(n.birth_name || "")}" placeholder="이름" /></div>
      <div class="wz-field"><label>배경</label><textarea class="np" data-i="${i}" data-k="background" rows="5" placeholder="이 인물이 원하는 것, 감추는 것, 주인공과 부딪힐 이유를 문서처럼 적어두세요.">${escapeHtml(n.background || "")}</textarea></div>
      <div class="wz-grid2">
        <div class="wz-field"><label>가치관 <small>(쉼표)</small></label><input class="np" data-i="${i}" data-k="core_values" value="${escapeHtml((n.core_values || []).join(", "))}" /></div>
        <div class="wz-field"><label>현재 목표</label><input class="np" data-i="${i}" data-k="goal_current" value="${escapeHtml(n.goal_current || "")}" /></div>
        <div class="wz-field"><label>주 활동/일과</label><input class="np" data-i="${i}" data-k="schedule_hint" value="${escapeHtml(n.schedule_hint || "")}" /></div>
        <div class="wz-field"><label>위치</label><select class="np-loc" data-i="${i}">${locOptions}</select></div>
      </div>
      <div class="wz-grid2">
        <div class="wz-field"><label>애착 유형</label><select class="np-att" data-i="${i}">
          ${["secure", "anxious", "avoidant", "fearful"].map((a) => `<option ${psy.attachment_style === a ? "selected" : ""}>${a}</option>`).join("")}</select></div>
        <div class="wz-field"><label>두려움</label><input class="npp" data-i="${i}" data-k="core_fear" value="${escapeHtml(psy.core_fear || "")}" /></div>
        <div class="wz-field"><label>욕망</label><input class="npp" data-i="${i}" data-k="desire" value="${escapeHtml(psy.desire || "")}" /></div>
        <div class="wz-field"><label>방어기제</label><input class="npp" data-i="${i}" data-k="defense_mechanism" value="${escapeHtml(psy.defense_mechanism || "")}" /></div>
        <div class="wz-field"><label>트라우마</label><input class="npp" data-i="${i}" data-k="trauma" value="${escapeHtml(psy.trauma || "")}" /></div>
      </div>
      <div class="wz-field"><label>소속 세력 <small>(선택)</small></label><div class="chip-row">${affOptions}</div></div>
      <div class="wz-field npc-rel ${noConn ? "off" : ""}"><label>플레이어와의 관계</label>
        <select class="np-rel" data-i="${i}" ${noConn ? "disabled" : ""}>${relOptions}</select>
        <p class="muted">이 값이 초기 관계 수치의 씨앗이 됩니다 (예: 친구=신뢰·호감 높게, 라이벌=낮게).</p></div>
      <label class="set-row"><input type="checkbox" class="npc-noconn" data-i="${i}" ${noConn ? "checked" : ""}/> 플레이어와 연결 없음 <small>(순수 세계관 인물 — 관계 데이터 없이 존재만, 먼저 연락해오지 않음)</small></label>
    </div>`;
}

function readStep2() {
  const c = wiz.chars, p = c.player;
  if ($("wzPName")) p.birth_name = $("wzPName").value;
  if ($("wzPBg")) p.background = $("wzPBg").value;
  if ($("wzPValues")) p.core_values = $("wzPValues").value.split(",").map((s) => s.trim()).filter(Boolean);
  p.psychology = p.psychology || {};
  if ($("wzPFear")) p.psychology.core_fear = $("wzPFear").value;
  if ($("wzPDesire")) p.psychology.desire = $("wzPDesire").value;
  if ($("wzPTrauma")) p.psychology.trauma = $("wzPTrauma").value;
  if ($("wzPNotes")) p.notes = $("wzPNotes").value;
  document.querySelectorAll("#wzNpcs .np").forEach((inp) => {
    const n = c.npcs[Number(inp.dataset.i)]; if (!n) return;
    if (inp.dataset.k === "core_values") n.core_values = inp.value.split(",").map((s) => s.trim()).filter(Boolean);
    else n[inp.dataset.k] = inp.value;
  });
  document.querySelectorAll("#wzNpcs .npp").forEach((inp) => {
    const n = c.npcs[Number(inp.dataset.i)]; if (!n) return;
    n.psychology = n.psychology || {}; n.psychology[inp.dataset.k] = inp.value;
  });
  document.querySelectorAll("#wzNpcs .np-att").forEach((s) => { const n = c.npcs[Number(s.dataset.i)]; if (n) { n.psychology = n.psychology || {}; n.psychology.attachment_style = s.value; } });
  document.querySelectorAll("#wzNpcs .np-loc").forEach((s) => { const n = c.npcs[Number(s.dataset.i)]; if (n) n.current_location = s.value; });
  document.querySelectorAll("#wzNpcs .np-rel").forEach((s) => { const n = c.npcs[Number(s.dataset.i)]; if (n) n.relationship_to_player_type = s.value; });
  document.querySelectorAll("#wzNpcs .npc-noconn").forEach((cb) => { const n = c.npcs[Number(cb.dataset.i)]; if (n) n.no_player_connection = cb.checked; });
  c.npcs.forEach((n, i) => {
    n.affiliations = [...document.querySelectorAll(`#wzNpcs .npc-aff[data-i="${i}"]:checked`)].map((x) => x.value);
  });
  saveDraft();
}
async function askAndFillPlayerScalar(field) {
  try {
    const s = await askSuggest(field, wizContext());
    if (s == null) return;
    const p = wiz.chars.player; p.psychology = p.psychology || {};
    if (field === "player_background") p.background = s;
    else if (field === "player_core_values") p.core_values = Array.isArray(s) ? s : String(s).split(",").map((x) => x.trim()).filter(Boolean);
    else if (field === "player_fear") p.psychology.core_fear = s;
    else if (field === "player_desire") p.psychology.desire = s;
    else if (field === "player_trauma") p.psychology.trauma = s;
    renderWizStep2();
  } catch (e) { showBanner("AI 제안 실패: " + e.message); }
}
async function askAndFillNpc(i) {
  try {
    const s = await askSuggest("npc", wizContext());
    const n = wiz.chars.npcs[i];
    if (!s || !n) return;
    // Preserve user-chosen relationship + connection settings + canon_id.
    const keep = { canon_id: n.canon_id, relationship_to_player_type: n.relationship_to_player_type, no_player_connection: n.no_player_connection };
    wiz.chars.npcs[i] = { ...blankNpc(), ...n, ...s, ...keep, psychology: { ...(n.psychology || {}), ...(s.psychology || {}) } };
    renderWizStep2();
  } catch (e) { showBanner("AI 제안 실패: " + e.message); }
}

// Generic AI-button binder: sync form → wiz first, then run the handler.
function bindAiButtons(syncFn, handler) {
  document.querySelectorAll(".ai-help").forEach((btn) =>
    btn.addEventListener("click", async () => {
      syncFn();
      const old = btn.textContent; btn.textContent = "…"; btn.disabled = true;
      try { await handler(btn.dataset.aifield, btn); }
      finally { btn.textContent = old; btn.disabled = false; }
    }));
}

// --- step 3: 확인 및 시작 ---------------------------------------------------
function renderWizStep3() {
  const w = wiz.world, c = wiz.chars;
  const presetDna = w._presetDna || (GENRE_PRESETS.find((x) => x.id === wiz.preset) || {}).dna;
  const dna = w.narrative_dna || presetDna || { tone: 3, emotion: 3, politics: 3, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 };
  const sliders = DNA_KEYS.map((k) => `
    <div class="dna-row"><label>${DNA_LABEL[k]}</label>
      <input type="range" min="1" max="5" step="1" value="${dna[k] || 3}" data-dna="${k}" />
      <span class="dna-val">${dna[k] || 3}</span></div>`).join("");
  const npcSummary = (c.npcs || []).map((n) => `${escapeHtml(n.birth_name || "(이름 미정)")}${n.no_player_connection ? " · 연결없음" : " · " + escapeHtml(n.relationship_to_player_type || "안 정해짐")}`).join(", ") || "없음";
  const extraSummary = summarizeExtraItems(wiz.extraItems || []);
  const extraEditor = renderExtraItemsEditor();
  $("wizardBody").innerHTML = `
    <div class="wiz-card">
      <h2>${escapeHtml(w.world_name || "이름 없는 세계")}</h2>
      <p class="muted">${escapeHtml(w.tone || "")} · 지역 ${(w.regions || []).length} · 세력 ${(w.factions || []).length}</p>
      <p><b>${escapeHtml((c.player && c.player.birth_name) || "플레이어")}</b>${c.player && c.player.background ? ` — ${escapeHtml(c.player.background)}` : ""}</p>
      <p class="muted">NPC: ${npcSummary}</p>
      <p class="muted">세부 커스터마이징: ${escapeHtml(extraSummary || "없음")}</p>
      <div class="section-h">예상 캠페인 길이</div>
      <div class="modal-row"><label>페이싱 기준</label>
        <select id="wzLength">
          <option value="short" ${wiz.length === "short" ? "selected" : ""}>짧게 (약 80턴)</option>
          <option value="normal" ${wiz.length === "normal" ? "selected" : ""}>보통 (약 180턴)</option>
          <option value="long" ${wiz.length === "long" ? "selected" : ""}>길게 (약 320턴)</option>
        </select></div>
      <div class="section-h">시작 시나리오</div>
      <div class="modal-row"><label>첫 장면 훅</label>
        <select id="wzStartPreset">
          ${START_PRESETS.map((p) => `<option value="${p.id}" ${wiz.startPreset === p.id ? "selected" : ""}>${p.name} — ${p.desc}</option>`).join("")}
        </select></div>
      <div class="section-h">콘텐츠 수위 확인</div>
      <p class="muted">폭력/공포/로맨스/감정 묘사는 설정 탭에서 언제든 문장으로 조정할 수 있습니다. 기본은 과장하지 않는 보통 수위입니다.</p>
      <div class="section-h">Narrative DNA</div>${sliders}
      <div class="section-h">세부 커스터마이징 <small>조직·아이템·집·약속·일정·수배·평판·규칙·변수</small></div>
      ${extraEditor}
      <div class="modal-actions">
        <button type="button" onclick="setWizStep(2)">← 이전</button>
        <button type="button" id="wzCreate" class="primary">캠페인 시작</button></div>
      <div id="wzCreateStatus"></div>
    </div>`;
  const reviewCard = document.querySelector("#wizardBody .wiz-card");
  if (reviewCard) {
    reviewCard.classList.add("wiz-card-wide");
    reviewCard.insertAdjacentHTML("afterbegin", `
      <section class="world-review-strip">
        <div>
          <span class="eyebrow">Review</span>
          <b>World source size</b>
        </div>
        ${renderWorldDraftStats()}
      </section>`);
  }
  $("wzLength").addEventListener("change", (e) => { wiz.length = e.target.value; saveDraft(); });
  $("wzStartPreset").addEventListener("change", (e) => { wiz.startPreset = e.target.value; saveDraft(); });
  bindExtraItemsControls(renderWizStep3);
  document.querySelectorAll('input[type="range"][data-dna]').forEach((r) =>
    r.addEventListener("input", () => { r.nextElementSibling.textContent = r.value; }));
  $("wzCreate").addEventListener("click", async () => {
    const dnaOut = {};
    document.querySelectorAll("[data-dna]").forEach((r) => (dnaOut[r.dataset.dna] = Number(r.value)));
    $("wzCreateStatus").innerHTML = `<div class="muted">세계를 등록하는 중… (Kernel 검증 경유)</div>`;
    try {
      readExtraItemsFromStep3();
      const era = (GENRE_PRESETS.find((x) => x.id === wiz.preset) || {}).id || "fantasy";
      const d = await apiPost("/api/wizard/create", {
        campaign_id: "camp_" + Date.now().toString(36),
        world_name: w.world_name, era, genre_preset: wiz.preset,
        background_description: w.background_description, world_notes: w.notes, // C1/C2
        regions: w.regions, factions: w.factions,
        player: {
          birth_name: c.player.birth_name, species: "human", background: c.player.background,
          core_values: c.player.core_values, psychology: c.player.psychology, notes: c.player.notes, // C2
        },
        npcs: c.npcs, // C3 — each carries relationship_to_player_type + no_player_connection
        narrative_dna: dnaOut,
        expected_campaign_length: wiz.length,
        scenario_preset: wiz.startPreset,
        import_items: wiz.extraItems || [],
      });
      if (d.failed && d.failed.length) console.warn("canon.register rejects:", d.failed);
      clearDraft();
      wiz.world = blankWorld(); wiz.chars = blankChars(); wiz.extraItems = blankExtraItems(); wiz.step = 1; wiz.preset = null;
      location.hash = "#/c/" + d.campaign_id;
    } catch (e) { $("wzCreateStatus").innerHTML = renderWizardCreateError(e); }
  });
}

function renderWizardCreateError(e) {
  const data = e && e.data;
  if (data && data.error === "content_guardrail") {
    const problems = Array.isArray(data.problems) ? data.problems : [];
    const rows = problems.length
      ? problems.map((p) => `<li>${escapeHtml(p)}</li>`).join("")
      : "<li>미성년 설정과 로맨스 관계가 함께 감지되었습니다.</li>";
    return `<div class="content-card error-card">
      <h3>생성 전에 수정이 필요합니다</h3>
      <p class="muted">안전 규칙상 미성년/아동/중학생/10대 초반 설정은 로맨스·연인·연애·결혼 관계와 함께 시작할 수 없습니다.</p>
      <ul>${rows}</ul>
      <p class="muted">해결: 해당 인물의 나이를 성인으로 명확히 하거나, 관계/배경에서 로맨스 표현을 빼고 친구·동료·보호자 같은 관계로 바꿔주세요.</p>
    </div>`;
  }
  return `<div class="muted">생성 실패: ${escapeHtml((e && e.message) || "알 수 없는 오류")}</div>`;
}

function renderExtraItemsEditor() {
  const items = wiz.extraItems || [];
  if (!items.length) return `<p class="muted">아직 세부 항목이 없습니다. MIO 문서나 md/txt를 가져오면 여기서 조직, 아이템, 집, 약속, 일정, 수배, 평판, 규칙, 변수까지 직접 고칠 수 있습니다.</p>`;
  return `<div class="wz-extra-list">
    ${items.map((it, i) => {
      const title = extraItemTitle(it);
      return `<div class="wz-entity wz-extra-item">
        <div class="wz-entity-head">
          <b>${escapeHtml(title)}</b>
          <span><span class="tag">${escapeHtml(it.type || "Other")}</span> <button type="button" class="wz-extra-remove" data-i="${i}">삭제</button></span>
        </div>
        <div class="wz-grid2">
          <div class="wz-field"><label>타입</label><input class="wz-extra-type" data-i="${i}" value="${escapeHtml(it.type || "Other")}" /></div>
          <div class="wz-field"><label>ID</label><input class="wz-extra-id" data-i="${i}" value="${escapeHtml(it.canon_id || "")}" /></div>
        </div>
        <div class="wz-field"><label>데이터 JSON</label><textarea class="wz-extra-json" data-i="${i}" rows="5" spellcheck="false">${escapeHtml(JSON.stringify(it.data || {}, null, 2))}</textarea></div>
      </div>`;
    }).join("")}
  </div>`;
}

function bindExtraItemsControls(refreshFn) {
  document.querySelectorAll(".wz-extra-remove").forEach((b) => b.addEventListener("click", () => {
    readExtraItemsFromStep3();
    wiz.extraItems.splice(Number(b.dataset.i), 1);
    refreshFn();
  }));
}

function newExtraItem(type) {
  const idPrefix = {
    Organization: "org_", Item: "item_", Property: "prop_", FamilyRelation: "fam_",
    Promise: "promise_", CalendarEvent: "cal_", WantedRecord: "wanted_",
    RegionReputation: "rep_", HouseRule: "rule_", NarrativeArc: "arc_",
    Motif: "motif_", HiddenVariable: "var_", Other: "note_",
  }[type] || "item_";
  const data = {
    Organization: { name: "", hq: "", ranks: [], rules: [], funds: 0, rivals: [], member: false },
    Item: { name: "", description: "", tags: [], condition: "", owner: "" },
    Property: { name: "", kind: "house", region: "", level: 1, contents: [], memories: [] },
    FamilyRelation: { from: "", to: "", type: "sibling" },
    Promise: { npc_ref: "", summary: "", due_day: null },
    CalendarEvent: { title: "", kind: "event", day: null, note: "" },
    WantedRecord: { scope_id: "", scope_label: "", level: 1, bounty: 0, reason: "" },
    RegionReputation: { scope: "city", scope_id: "", name: "", standing: 0, reason: "" },
    HouseRule: { text: "" },
    NarrativeArc: { title: "", summary: "", stage: "setup", beats: [] },
    Motif: { label: "", description: "" },
    HiddenVariable: { label: "", description: "", default_value: 0.5, high_directive: "", low_directive: "" },
    Other: { note: "" },
  }[type] || { note: "" };
  return { type, canon_id: idPrefix + Date.now().toString(36), data };
}

function readExtraItemsFromStep3() {
  if (!document.querySelector(".wz-extra-json")) return;
  const next = [];
  document.querySelectorAll(".wz-extra-json").forEach((ta) => {
    const i = Number(ta.dataset.i);
    const old = (wiz.extraItems || [])[i] || {};
    let data = old.data || {};
    try { data = JSON.parse(ta.value || "{}"); }
    catch (e) { data = { note: ta.value || "" }; }
    const typeEl = document.querySelector(`.wz-extra-type[data-i="${i}"]`);
    const idEl = document.querySelector(`.wz-extra-id[data-i="${i}"]`);
    next.push({
      type: (typeEl && typeEl.value.trim()) || old.type || "Other",
      canon_id: (idEl && idEl.value.trim()) || old.canon_id || "",
      data,
    });
  });
  wiz.extraItems = next;
  saveDraft();
}

function summarizeExtraItems(items) {
  const counts = {};
  for (const it of items || []) counts[it.type || "Other"] = (counts[it.type || "Other"] || 0) + 1;
  return Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ");
}

function extraItemTitle(it) {
  const d = (it && it.data) || {};
  return d.name || d.title || d.label || d.summary || d.text || d.note || it.canon_id || it.type || "세부 항목";
}

// --- anthology templates (Phase 8 B2) --------------------------------------
async function openTemplatePicker() {
  let data;
  try { data = await api("/api/templates"); } catch (e) { return showBanner("템플릿 목록을 불러오지 못했습니다."); }
  const templates = (data && data.templates) || [];
  if (!templates.length) return showBanner("저장된 세계관 템플릿이 없습니다. 진행 중 캠페인의 설정 탭에서 먼저 저장하세요.");
  const rows = templates.map((t) => `
    <div class="rep-row"><b>${escapeHtml(t.name)}</b>
      <button class="tmpl-use primary" data-tid="${escapeHtml(t.template_id)}" data-name="${escapeHtml(t.world_name || t.name)}">이 세계로 시작</button></div>`).join("");
  openModal(`<h3>기존 세계관 템플릿</h3>
    <p class="muted">세계(지역/세력)만 공유합니다 — 역사와 인물은 새로 시작합니다.</p>
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

// quick start: minimal world from a preset (no LLM), straight into the campaign.
async function quickStart() {
  const preset = GENRE_PRESETS.find((x) => x.id === wiz.preset) || GENRE_PRESETS[0];
  $("wzWorldResult").innerHTML = `<div class="muted">기본 세계로 시작하는 중…</div>`;
  try {
    const d = await apiPost("/api/wizard/create", {
      campaign_id: "camp_" + Date.now().toString(36),
      world_name: preset.name + " 세계", era: preset.id, genre_preset: preset.id,
      expected_campaign_length: "normal",
      background_description: preset.desc,
      regions: [{ canon_id: "loc_start", name: "출발지", notable_features: [preset.desc.slice(0, 40)] }],
      factions: [],
      player: { birth_name: "이름 없는 모험가", species: "human", background: preset.desc.slice(0, 60), core_values: [], psychology: {} },
      npcs: [], narrative_dna: { ...preset.dna },
    });
    clearDraft();
    wiz.world = blankWorld(); wiz.chars = blankChars(); wiz.extraItems = blankExtraItems(); wiz.step = 1;
    location.hash = "#/c/" + d.campaign_id;
  } catch (e) {
    $("wzWorldResult").innerHTML = `<div class="muted">빠른 시작 실패: ${escapeHtml(e.message)}</div>`;
  }
}

// Import 분석 결과를 바로 등록하지 않고, 기존 세계관/캐릭터 생성 칸에 채운다.
function applyImportItemsToWizard(items) {
  const list = Array.isArray(items) ? items : [];
  let worldCount = 0, factionCount = 0, playerFilled = false, npcCount = 0, noteCount = 0;
  readStep1();
  if ($("wzPName")) readStep2();

  for (const it of list) {
    const d = it.data || {};
    if (it.type === "World") {
      if (!wiz.world.world_name && d.world_name) wiz.world.world_name = d.world_name;
      if (!wiz.world.world_name && worldCount === 0 && d.name) wiz.world.world_name = d.name;
      if (d.description) wiz.world.background_description = appendText(wiz.world.background_description, d.description);
      wiz.world.regions = wiz.world.regions || [];
      if (d.name || d.description || d.terrain || d.climate) {
        wiz.world.regions.push({
          canon_id: cleanImportId(it.canon_id, "loc_", d.name),
          name: d.name || it.page_title || "",
          description: d.description || "",
          terrain: d.terrain || "",
          climate: d.climate || "",
          security_level: d.security_level || "",
          notable_features: arrayOf(d.notable_features),
        });
        worldCount++;
      }
    } else if (it.type === "Faction") {
      wiz.world.factions = wiz.world.factions || [];
      wiz.world.factions.push({
        canon_id: cleanImportId(it.canon_id, "faction_", d.name),
        name: d.name || it.page_title || "",
        description: d.description || "",
        founding_principle: d.founding_principle || "",
        goal: d.goal || "",
        leader: d.leader || "",
        key_people: d.key_people || "",
        faction_relations: d.faction_relations || "",
        influence: d.influence || "",
        stance: d.stance || "",
      });
      factionCount++;
    } else if (it.type === "Character") {
      const playerLike = isPlayerImportCandidate(d);
      if ((playerLike || !wiz.chars.player.birth_name) && !playerFilled) {
        fillWizardPlayer(d);
        playerFilled = true;
      } else {
        wiz.chars.npcs = wiz.chars.npcs || [];
        wiz.chars.npcs.push(importNpcToWizard(it, d));
        npcCount++;
      }
    } else if (isExtraImportType(it.type)) {
      wiz.extraItems = wiz.extraItems || [];
      wiz.extraItems.push({
        type: it.type || "Other",
        canon_id: it.canon_id || cleanImportId("", "item_", extraItemTitle(it)),
        data: d,
      });
      if (it.type === "Other") wiz.world.notes = appendText(wiz.world.notes, importItemNote(it));
      noteCount++;
    }
  }

  saveDraft();
  setWizStep(1);
  showBanner(`분석 결과를 생성 칸에 채웠습니다. 장소 ${worldCount}개, 세력 ${factionCount}개, 주인공 ${playerFilled ? 1 : 0}명, NPC ${npcCount}명${noteCount ? `, 세부 설정 ${noteCount}개` : ""}.`);
}

function fillWizardPlayer(d) {
  const p = wiz.chars.player = { ...blankPlayer(), ...wiz.chars.player };
  p.birth_name = d.birth_name || d.name || p.birth_name;
  p.background = d.background || d.description || p.background;
  p.core_values = arrayOf(d.core_values).length ? arrayOf(d.core_values) : p.core_values;
  p.psychology = { ...(p.psychology || {}), ...(d.psychology || {}) };
  if (d.goal_current) p.notes = appendText(p.notes, `목표: ${d.goal_current}`);
  if (d.secrets) p.notes = appendText(p.notes, secretsNote(d.secrets));
}

function importNpcToWizard(it, d) {
  return {
    ...blankNpc(),
    canon_id: cleanImportId(it.canon_id, "char_", d.birth_name || d.name),
    birth_name: d.birth_name || d.name || it.page_title || "",
    species: d.species || "human",
    role: d.role || "npc",
    background: d.background || d.description || "",
    core_values: arrayOf(d.core_values),
    goal_current: d.goal_current || "",
    current_location: d.current_location || "",
    affiliations: arrayOf(d.affiliations),
    schedule_hint: d.schedule_hint || "",
    psychology: { ...blankNpc().psychology, ...(d.psychology || {}) },
    relationship_to_player_type: d.relationship_to_player_type || "안 정해짐",
    no_player_connection: !d.relationship_to_player_type && !!d.no_player_connection,
  };
}

function isExtraImportType(type) {
  return [
    "Organization", "Item", "Property", "FamilyRelation", "Promise",
    "CalendarEvent", "WantedRecord", "RegionReputation", "HouseRule",
    "NarrativeArc", "Motif", "HiddenVariable", "Other",
  ].includes(type || "Other");
}

function isPlayerImportCandidate(d) {
  const s = `${d.role || ""} ${d.birth_name || ""} ${d.name || ""} ${d.description || ""}`;
  return /(player|protagonist|main character|주인공|플레이어|主人公)/i.test(s);
}

function cleanImportId(id, prefix, fallback) {
  const raw = String(id || fallback || Date.now().toString(36)).normalize("NFC");
  if (raw.startsWith(prefix)) return raw;
  const safe = raw.toLowerCase().replace(/[^a-z0-9가-힣_-]+/g, "_").replace(/^_+|_+$/g, "");
  return prefix + (safe || Date.now().toString(36));
}

function arrayOf(v) {
  if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
  if (!v) return [];
  return String(v).split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}

function appendText(base, add) {
  const a = String(add || "").trim();
  if (!a) return base || "";
  const b = String(base || "").trim();
  if (!b) return a;
  if (b.includes(a)) return b;
  return `${b}\n\n${a}`;
}

function secretsNote(secrets) {
  if (!secrets || typeof secrets !== "object") return "";
  return [
    secrets.public ? `공개 정보: ${secrets.public}` : "",
    secrets.hidden ? `숨긴 비밀: ${secrets.hidden}` : "",
    secrets.locked ? `잠긴 비밀: ${secrets.locked}` : "",
  ].filter(Boolean).join("\n");
}

function importItemNote(it) {
  const d = it.data || {};
  const title = d.name || d.title || d.label || d.summary || d.text || d.note || it.page_title || it.type;
  const desc = d.description || d.reason || d.note || "";
  return `[${it.type}] ${title}${desc && desc !== title ? `: ${desc}` : ""}`;
}

// Notion 가져오기(위저드 경로): 현재 세계관 폼으로 캠페인을 만들고 그 id를 반환.
// 가져온 항목은 이 캠페인의 Canon/Registry로 등록된다.
async function notionWizEnsureCampaign() {
  const w = wiz.world, c = wiz.chars;
  const presetDna = w._presetDna || (GENRE_PRESETS.find((x) => x.id === wiz.preset) || {}).dna;
  const era = (GENRE_PRESETS.find((x) => x.id === wiz.preset) || {}).id || "fantasy";
  const d = await apiPost("/api/wizard/create", {
    campaign_id: "camp_" + Date.now().toString(36),
    world_name: w.world_name || "Notion 가져온 세계", era, genre_preset: wiz.preset,
    background_description: w.background_description, world_notes: w.notes,
    regions: w.regions, factions: w.factions,
    player: c.player && c.player.birth_name ? {
      birth_name: c.player.birth_name, species: "human", background: c.player.background,
      core_values: c.player.core_values, psychology: c.player.psychology, notes: c.player.notes,
    } : undefined,
    npcs: c.npcs || [],
    narrative_dna: presetDna || undefined,
    expected_campaign_length: wiz.length,
    scenario_preset: wiz.startPreset,
  });
  return d.campaign_id;
}

// draft resume
function maybeResumeWizardDraft() {
  const d = loadDraft();
  if (!d || (!(d.world && (d.world.world_name || (d.world.regions || []).length)) && !(d.chars && (d.chars.npcs || []).length) && !(d.extraItems || []).length && !d.freeWorld)) return false;
  const when = d.at ? new Date(d.at).toLocaleString() : "";
  if (!confirm(`작성하던 세계가 있습니다${when ? ` (${when})` : ""}. 이어서 작성할까요?\n(취소하면 새로 시작합니다.)`)) { clearDraft(); wiz.world = blankWorld(); wiz.chars = blankChars(); wiz.extraItems = blankExtraItems(); wiz.step = 1; wiz.preset = null; return false; }
  wiz.world = { ...blankWorld(), ...(d.world || {}) };
  wiz.chars = { ...blankChars(), ...(d.chars || {}) };
  wiz.extraItems = Array.isArray(d.extraItems) ? d.extraItems : blankExtraItems();
  wiz.freeWorld = d.freeWorld || ""; wiz.preset = d.preset || null; wiz.length = d.length || "normal"; wiz.startPreset = d.startPreset || "arrival";
  setWizStep(d.step || 1);
  return true;
}

function wireWizard() {
  $("wizBack").addEventListener("click", () => { location.hash = "#/"; });
}
