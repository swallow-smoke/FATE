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

// Form-first: wiz holds a fully-editable model from the very first render.
function blankWorld() { return { world_name: "", tone: "", background_description: "", regions: [], factions: [], notes: "" }; }
function blankPlayer() { return { birth_name: "", background: "", core_values: [], psychology: { core_fear: "", desire: "", trauma: "" }, notes: "" }; }
function blankChars() { return { player: blankPlayer(), npcs: [] }; }
function blankNpc() {
  return {
    canon_id: "char_" + Date.now().toString(36) + Math.floor(Math.random() * 900 + 100),
    birth_name: "", species: "human", role: "npc", background: "", core_values: [],
    goal_current: "", current_location: "", affiliations: [], schedule_hint: "",
    psychology: { attachment_style: "secure", core_fear: "", desire: "", defense_mechanism: "", trauma: "" },
    relationship_to_player_type: "안 정해짐", no_player_connection: false,
  };
}

const wiz = { step: 1, world: blankWorld(), chars: blankChars(), freeWorld: "", preset: null, length: "normal" };

// --- draft autosave (Phase 7 Part B) ---------------------------------------
const DRAFT_KEY = "nos_wizard_draft";
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ step: wiz.step, world: wiz.world, chars: wiz.chars, freeWorld: wiz.freeWorld, preset: wiz.preset, length: wiz.length, at: Date.now() })); } catch (e) {}
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

      <div class="modal-actions">
        <button type="button" id="wzQuickStart" title="선택한(없으면 첫) 프리셋의 기본 세계로 곧장 시작 — AI 없이">⚡ 빠른 시작</button>
        <button type="button" id="wzFromTemplate">📚 기존 세계관 템플릿</button>
        <button type="button" id="wzToStep2" class="primary">다음 단계 →</button>
      </div>
      <div id="wzWorldResult"></div>
    </div>`;

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

  // per-field AI 도움
  bindAiButtons(() => readStep1(), (field, btn) => {
    if (field === "region") { const i = Number(btn.dataset.i); askAndFillEntity("region", i); }
    else if (field === "faction") { const i = Number(btn.dataset.i); askAndFillEntity("faction", i); }
    else askAndFillWorldScalar(field);
  });

  $("wzQuickStart").addEventListener("click", quickStart);
  $("wzFromTemplate").addEventListener("click", openTemplatePicker);
  $("wzToStep2").addEventListener("click", () => { readStep1(); setWizStep(2); });
}

function readStep1() {
  const w = wiz.world;
  if ($("wzWorldName")) w.world_name = $("wzWorldName").value;
  if ($("wzTone")) w.tone = $("wzTone").value;
  if ($("wzBackground")) w.background_description = $("wzBackground").value;
  if ($("wzWorldNotes")) w.notes = $("wzWorldNotes").value;
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
      <div class="wz-field"><label>배경 ${aiBtn("player_background")}</label><input id="wzPBg" value="${escapeHtml(p.background || "")}" placeholder="예: 과거를 숨긴 전직 용병" /></div>
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
      <div class="wz-field"><label>배경</label><input class="np" data-i="${i}" data-k="background" value="${escapeHtml(n.background || "")}" placeholder="한 줄 배경" /></div>
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
  $("wizardBody").innerHTML = `
    <div class="wiz-card">
      <h2>${escapeHtml(w.world_name || "이름 없는 세계")}</h2>
      <p class="muted">${escapeHtml(w.tone || "")} · 지역 ${(w.regions || []).length} · 세력 ${(w.factions || []).length}</p>
      <p><b>${escapeHtml((c.player && c.player.birth_name) || "플레이어")}</b>${c.player && c.player.background ? ` — ${escapeHtml(c.player.background)}` : ""}</p>
      <p class="muted">NPC: ${npcSummary}</p>
      <div class="section-h">예상 캠페인 길이</div>
      <div class="modal-row"><label>페이싱 기준</label>
        <select id="wzLength">
          <option value="short" ${wiz.length === "short" ? "selected" : ""}>짧게 (약 80턴)</option>
          <option value="normal" ${wiz.length === "normal" ? "selected" : ""}>보통 (약 180턴)</option>
          <option value="long" ${wiz.length === "long" ? "selected" : ""}>길게 (약 320턴)</option>
        </select></div>
      <div class="section-h">Narrative DNA</div>${sliders}
      <div class="modal-actions">
        <button type="button" onclick="setWizStep(2)">← 이전</button>
        <button type="button" id="wzCreate" class="primary">캠페인 시작</button></div>
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
      });
      if (d.failed && d.failed.length) console.warn("canon.register rejects:", d.failed);
      clearDraft();
      wiz.world = blankWorld(); wiz.chars = blankChars(); wiz.step = 1; wiz.preset = null;
      location.hash = "#/c/" + d.campaign_id;
    } catch (e) { $("wzCreateStatus").innerHTML = `<div class="muted">생성 실패: ${escapeHtml(e.message)}</div>`; }
  });
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
    wiz.world = blankWorld(); wiz.chars = blankChars(); wiz.step = 1;
    location.hash = "#/c/" + d.campaign_id;
  } catch (e) {
    $("wzWorldResult").innerHTML = `<div class="muted">빠른 시작 실패: ${escapeHtml(e.message)}</div>`;
  }
}

// draft resume
function maybeResumeWizardDraft() {
  const d = loadDraft();
  if (!d || (!(d.world && (d.world.world_name || (d.world.regions || []).length)) && !(d.chars && (d.chars.npcs || []).length) && !d.freeWorld)) return false;
  const when = d.at ? new Date(d.at).toLocaleString() : "";
  if (!confirm(`작성하던 세계가 있습니다${when ? ` (${when})` : ""}. 이어서 작성할까요?\n(취소하면 새로 시작합니다.)`)) { clearDraft(); wiz.world = blankWorld(); wiz.chars = blankChars(); wiz.step = 1; wiz.preset = null; return false; }
  wiz.world = { ...blankWorld(), ...(d.world || {}) };
  wiz.chars = { ...blankChars(), ...(d.chars || {}) };
  wiz.freeWorld = d.freeWorld || ""; wiz.preset = d.preset || null; wiz.length = d.length || "normal";
  setWizStep(d.step || 1);
  return true;
}

function wireWizard() {
  $("wizBack").addEventListener("click", () => { location.hash = "#/"; });
}
