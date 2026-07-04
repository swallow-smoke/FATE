// Phase 5 Wave 2-3 — player-facing content tabs (캐릭터/세계/관계/인벤토리/설정).
// Internal numbers are NEVER rendered here — qualitative labels only.
"use strict";

// ---------- tab switching ----------
function wirePlayerTabs() {
  document.querySelectorAll(".ptab").forEach((t) => {
    t.addEventListener("click", () => {
      const nextPage = $("ppage-" + t.dataset.ptab);
      const wasActive = nextPage && nextPage.classList.contains("active");
      document.querySelectorAll(".ptab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".ppage").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      nextPage.classList.add("active");
      if (!wasActive && !isLowSpec() && window.gsap) {
        const paper = nextPage.querySelector(".page-scroll, #chatpane") || nextPage;
        gsap.fromTo(paper,
          { y: 38, x: 18, opacity: 0, rotate: -0.45, filter: "drop-shadow(0 36px 48px rgba(0,0,0,.24))" },
          { y: 0, x: 0, opacity: 1, rotate: 0, filter: "drop-shadow(0 0 0 rgba(0,0,0,0))", duration: 0.58, ease: "power3.out", clearProps: "filter" });
      }
      const loaders = { character: loadCharacterTab, world: loadWorldTab, relations: loadRelationsTab, inventory: loadInventoryTab, settings: loadSettingsTab };
      if (loaders[t.dataset.ptab]) loaders[t.dataset.ptab]();
    });
  });
  document.querySelectorAll("#worldSubtabs .stab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll("#worldSubtabs .stab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      loadWorldTab();
    });
  });
}

// ---------- 캐릭터 탭 ----------
async function loadCharacterTab() {
  const box = $("characterBody");
  box.innerHTML = `<div class="muted">불러오는 중…</div>`;
  const d = await api("/api/player/" + NOS.campaign);
  const milestones = (d.identity_milestones || []).map((m) => `
    <div class="tl-item"><span class="tl-turn">${m.turn}턴</span>
      <div class="tl-body">${m.from_trait ? `<b>${escapeHtml(m.from_trait)}</b> → ` : ""}<b>${escapeHtml(m.to_trait)}</b>
      <div class="muted">${escapeHtml(m.trigger_summary || "")}</div></div></div>`).join("");
  const flags = (d.highlight_flags || []).map((f) => `<li>${escapeHtml(prettifyFlag(f.flag_id))} <span class="muted">(${f.set_at_turn}턴)</span></li>`).join("");
  // Phase 9 F4 — dynamic traits: player_facing_description only, NEVER the value.
  const traits = (d.dynamic_traits || []).map((t) => `
    <div class="trait-row"><b>${escapeHtml(t.name)}</b>
      <span class="muted">${escapeHtml(t.player_facing_description || "")}</span>
      ${t.trend === "fading" ? '<span class="tag">옅어지는 중</span>' : t.trend === "growing" ? '<span class="tag">자라나는 중</span>' : ""}</div>`).join("");
  const traitNotice = d.new_trait_notice ? `<div class="trait-new">✦ 새로운 특성이 생겨났습니다: <b>${escapeHtml(d.new_trait_notice.name)}</b></div>` : "";
  if (d.new_trait_notice) apiPost(`/api/player/${NOS.campaign}/ack-trait`).catch(() => {}); // quiet ack
  box.innerHTML = `
    <div class="content-card">
      <h2>${escapeHtml(d.name)}</h2>
      ${d.generation > 1 ? `<div class="tag">제 ${d.generation}세대</div>` : ""}
      ${d.background ? `<p>${escapeHtml(d.background)}</p>` : `<p class="muted">아직 기록된 배경이 없습니다.</p>`}
      ${(d.traits || []).length ? `<div>${d.traits.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
    </div>
    <div class="content-card"><h3>특성</h3>${traitNotice}
      ${traits || `<p class="muted">삶의 사건이 아직 뚜렷한 특성을 남기지 않았습니다.</p>`}
      <button id="traitAddBtn">+ 특성 직접 추가</button></div>
    <div class="content-card"><h3>성장 궤적</h3>
      ${milestones || `<p class="muted">아직 뚜렷한 정체성 변화가 기록되지 않았습니다. 이야기가 당신을 바꿔갈 것입니다.</p>`}</div>
    <div class="content-card"><h3>주요 선택</h3>
      ${flags ? `<ul>${flags}</ul>` : `<p class="muted">이야기에 남은 선택이 아직 없습니다.</p>`}</div>
    <div class="content-card"><h3>여정 (선택의 흐름)</h3>
      ${(d.decision_points || []).length ? (d.decision_points || []).map((dp, i) => `
        <div class="journey-node"><span class="jn-turn">${dp.turn}턴</span>
          <div class="jn-body"><b>${escapeHtml(dp.choice_summary)}</b>${dp.stage_at_time ? ` <span class="tag">${escapeHtml(dp.stage_at_time)}</span>` : ""}</div>
          ${i < (d.decision_points.length - 1) ? '<div class="jn-line"></div>' : ""}</div>`).join("")
        : `<p class="muted">아직 이야기에 뚜렷이 남은 갈림길이 없습니다.</p>`}</div>
    <div class="content-card"><h3>소지품</h3>
      <p>${d.item_count}개의 물건을 지니고 있습니다. <a href="#" id="gotoInv">인벤토리 보기 →</a></p></div>`;
  const a = $("gotoInv");
  if (a) a.addEventListener("click", (e) => { e.preventDefault(); document.querySelector('.ptab[data-ptab="inventory"]').click(); });
  // Phase 10 M2 — manual trait add (rate-limit exempt server-side).
  const tb = $("traitAddBtn");
  if (tb) tb.addEventListener("click", () => {
    openModal(`<h3>특성 직접 추가</h3>
      <div class="wz-row"><input id="ntName" placeholder="특성 이름 (예: 손재주)" /></div>
      <textarea id="ntDesc" rows="2" placeholder="한 줄 설명 (선택)"></textarea>
      <div class="modal-actions"><button id="ntSave" class="primary">추가</button><button onclick="closeModal()">취소</button></div>`);
    $("ntSave").addEventListener("click", async () => {
      const name = $("ntName").value.trim();
      if (!name) return;
      try { await apiPost(`/api/player/${NOS.campaign}/trait`, { name, description: $("ntDesc").value.trim() }); closeModal(); loadCharacterTab(); }
      catch (e) { showBanner("추가 실패: " + e.message); }
    });
  });
}
function prettifyFlag(id) { return String(id).replace(/_/g, " "); }

// ---------- 세계 탭 (하위 5개) ----------
async function loadWorldTab() {
  const box = $("worldBody");
  const active = document.querySelector("#worldSubtabs .stab.active").dataset.stab;
  if (active === "wiki") return loadWiki();
  if (active === "comm") return loadCommTab();
  box.innerHTML = `<div class="muted">불러오는 중…</div>`;
  const d = await api("/api/worldtab/" + NOS.campaign);
  // Phase 7 A5 — weather/season widget, shown above every world subtab.
  const wx = d.weather ? weatherWidget(d.weather) : "";
  if (active === "clues") {
    const mysteries = (d.mysteries || []).map((m) => {
      const clues = (m.clues || []).map((c) => `<li>${escapeHtml(c.content_summary)} <span class="muted">(${c.revealed_turn}턴)</span></li>`).join("");
      const status = m.resolved ? "✓ 해결됨" : m.resolvable ? "◔ 해결 가능" : "◌ 조사 중";
      return `<div class="content-card"><div class="muted">${status}${m.hidden_count ? ` · 아직 밝혀지지 않은 단서 ${m.hidden_count}개` : ""}</div>
        <h3>${escapeHtml(m.question)}</h3>${clues ? `<ul>${clues}</ul>` : `<p class="muted">아직 밝혀낸 단서가 없습니다.</p>`}</div>`;
    }).join("");
    const chains = (d.consequence_chains || []).map((c) => {
      const links = (c.linked_events || []).map((e) => `<div class="tl-item"><span class="tl-turn">${e.turn}턴</span><div class="tl-body">→ ${escapeHtml(e.summary || "")}</div></div>`).join("");
      return `<div class="content-card"><div class="muted">${c.origin_turn}턴의 선택</div>
        <h3>${escapeHtml(prettifyFlag(c.origin_flag))}</h3>${links || `<p class="muted">아직 이 선택의 여파가 드러나지 않았습니다.</p>`}</div>`;
    }).join("");
    box.innerHTML = wx
      + `<div class="content-card"><h3>단서 (미스터리)</h3><p class="muted">당신이 능동적으로 풀어가는 수수께끼입니다.</p></div>${mysteries || `<div class="content-card"><p class="muted">아직 좇고 있는 수수께끼가 없습니다.</p></div>`}`
      + `<div class="content-card"><h3>선택의 결과 (인과 사슬)</h3><p class="muted">당신의 선택이 세계에 남긴 파문입니다.</p></div>${chains || `<div class="content-card"><p class="muted">아직 뚜렷한 인과의 사슬이 없습니다.</p></div>`}`;
    return;
  }
  if (active === "timeline") {
    const items = (d.timeline || []).slice().reverse().map((t) => `
      <div class="tl-item"><span class="tl-turn">${t.turn}턴</span><div class="tl-body">${escapeHtml(t.summary)}</div></div>`).join("");
    box.innerHTML = `<div class="content-card"><h3>연대기</h3>${items || `<p class="muted">아직 역사에 기록될 만한 사건이 없습니다.</p>`}</div>`;
  } else if (active === "foreshadow") {
    const items = (d.foreshadow || []).map((f) => `
      <div class="fs-item ${f.resolved ? "resolved" : ""}">
        <span>${f.resolved ? "✓ 회수됨" : "◌ 미회수"}</span>
        <span class="muted">${f.planted_turn}턴에 심어진 실마리</span></div>`).join("");
    box.innerHTML = `<div class="content-card"><h3>복선</h3>${items || `<p class="muted">지금 이야기에 걸려 있는 실마리가 없습니다.</p>`}</div>`;
  } else if (active === "rumor") {
    const items = (d.rumors || []).map((r) => `
      <div class="content-card rumor"><p>"${escapeHtml(r.content)}"</p>
        <div class="muted">${escapeHtml(r.origin_region || "어딘가")}에서 시작된 이야기 · ${r.heard_turn != null ? r.heard_turn + "턴에 들음" : ""}</div></div>`).join("");
    box.innerHTML = items || `<div class="content-card"><p class="muted">아직 들은 소문이 없습니다. 사람들이 모이는 곳에 가보세요.</p></div>`;
  } else if (active === "reputation") {
    const items = (d.reputation || []).map((r) => `
      <div class="rep-row"><b>${escapeHtml(r.name)}</b><span class="rep-label">${escapeHtml(r.label)}</span></div>`).join("");
    box.innerHTML = `<div class="content-card"><h3>세력 평판</h3>${items || `<p class="muted">아직 어느 세력도 당신을 특별히 기억하지 않습니다.</p>`}</div>`;
  }
  if (wx) box.insertAdjacentHTML("afterbegin", wx); // A5 — weather above the subtab
}

// Phase 7 A5 — compact weather/season widget (icon + text, no dashboard).
function weatherWidget(w) {
  const seasonKo = { spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" }[w.current_season] || w.current_season;
  const icons = { "soft rain": "🌧", "clear wind": "🌤", "mist": "🌫", "humid heat": "🥵", "sun glare": "☀️", "sudden shower": "🌦", "dry wind": "🍂", "cloudy sky": "☁️", "cold drizzle": "🌧", "frost": "❄️", "still cold": "🌫", "snow": "🌨" };
  const weatherKo = { "soft rain": "보슬비", "clear wind": "맑은 바람", "mist": "옅은 안개", "humid heat": "무더위", "sun glare": "쨍한 햇살", "sudden shower": "소나기", "dry wind": "건조한 바람", "cloudy sky": "흐린 하늘", "cold drizzle": "차가운 이슬비", "frost": "서리", "still cold": "고요한 추위", "snow": "눈" };
  return `<div class="weather-widget">${icons[w.current_weather] || "🌡"} <b>${seasonKo}</b> · ${weatherKo[w.current_weather] || escapeHtml(w.current_weather)}</div>`;
}

// ---------- 통신 탭 (Phase 9 E4 — 시대별 통신: 편지) ----------
async function loadCommTab() {
  const box = $("worldBody");
  box.innerHTML = `<div class="muted">불러오는 중…</div>`;
  const d = await api("/api/comm/" + NOS.campaign);
  const techKo = { modern: "현대", industrial: "산업화", medieval: "중세", ancient: "고대", fantasy_low: "낮은 판타지", fantasy_high: "높은 판타지", sci_fi: "SF" }[d.tech_level] || d.tech_level;
  const options = (d.recipients || []).map((r) => `<option value="${escapeHtml(r.canon_ref)}">${escapeHtml(r.name)}</option>`).join("");
  const statusKo = { pending: "전달 중", delivered: "전달됨", intercepted: "가로채임" };
  const letters = (d.letters || []).slice().reverse().map((l) => `
    <div class="rep-row"><span>→ ${escapeHtml(l.recipient)} · ${escapeHtml(l.content_summary.slice(0, 30))}…</span>
      <span class="rep-label">${statusKo[l.status] || l.status}${l.status === "pending" ? ` (${l.trigger_turn}턴 도착 예정)` : ""}</span></div>`).join("");
  // Phase 11 P — NPC-initiated incoming messages.
  const incoming = (d.incoming || []).slice().reverse().map((m) => `
    <div class="rep-row ${m.unread ? "unread-msg" : ""}"><span>${m.unread ? "● " : ""}${escapeHtml(m.content_summary)}</span>
      <span class="rep-label">${m.created_turn}턴</span></div>`).join("");
  if (d.unread_count) apiPost(`/api/comm/${NOS.campaign}/read`).catch(() => {}); // opening the tab reads them
  box.innerHTML = `
    ${incoming ? `<div class="content-card"><h3>받은 연락${d.unread_count ? ` <span class="tag">${d.unread_count} 새 소식</span>` : ""}</h3>${incoming}</div>` : ""}`;
  box.innerHTML += `
    <div class="content-card"><h3>편지 쓰기</h3>
      <p class="muted">이 세계의 기술 수준: <b>${escapeHtml(techKo)}</b> — 편지는 거리에 따라 며칠(턴) 뒤 도착합니다. 사이가 험하거나 먼 곳으로 가는 편지는 도중에 가로채일 수 있습니다.</p>
      ${d.recipients && d.recipients.length ? `
        <div class="wz-row"><select id="letterTo">${options}</select></div>
        <textarea id="letterBody" rows="4" placeholder="편지 내용을 적으세요…"></textarea>
        <button id="letterSend" class="primary">편지 보내기</button>` : `<p class="muted">아직 편지를 보낼 만큼 알게 된 사람이 없습니다.</p>`}
      <div id="letterResult" class="muted"></div></div>
    <div class="content-card"><h3>주고받은 편지</h3>${letters || `<p class="muted">아직 편지가 없습니다.</p>`}</div>`;
  if ($("letterSend")) $("letterSend").addEventListener("click", async () => {
    const recipient = $("letterTo").value, content = $("letterBody").value.trim();
    if (!content) return;
    try {
      const r = await apiPost(`/api/campaign/${NOS.campaign}/letter`, { recipient, content });
      showBanner(`편지를 보냈습니다 — 약 ${r.eta_turns}턴 뒤 도착 예정.`);
      loadCommTab(); // refresh the in-flight list
    } catch (e) { $("letterResult").textContent = "전송 실패: " + e.message; }
  });
}

// ---------- 백과사전 (링크형 위키, 뒤/앞 네비게이션 + 검색) ----------
const wikiNav = { history: [], pos: -1, pages: null, undiscovered: [] };
async function loadWiki(pushId) {
  const box = $("worldBody");
  if (!wikiNav.pages || pushId === undefined) {
    const d = await api("/api/wiki/" + NOS.campaign);
    wikiNav.pages = {};
    (d.pages || []).forEach((p) => (wikiNav.pages[p.canon_id] = p));
    wikiNav.undiscovered = d.undiscovered_ids || [];
  }
  if (pushId && wikiNav.pages[pushId]) {
    wikiNav.history = wikiNav.history.slice(0, wikiNav.pos + 1);
    wikiNav.history.push(pushId);
    wikiNav.pos = wikiNav.history.length - 1;
  }
  const current = wikiNav.pos >= 0 ? wikiNav.history[wikiNav.pos] : null;
  const bar = `
    <div class="wiki-bar">
      <button id="wkBack" ${wikiNav.pos <= 0 ? "disabled" : ""}>←</button>
      <button id="wkFwd" ${wikiNav.pos >= wikiNav.history.length - 1 ? "disabled" : ""}>→</button>
      <button id="wkHome">목차</button>
      <input id="wkSearch" placeholder="위키 검색…" />
    </div>`;
  let body;
  if (current && wikiNav.pages[current]) {
    const p = wikiNav.pages[current];
    const related = (p.related_memories || []).map((m) => `<li>${escapeHtml(m.summary)} <span class="muted">(${m.turn}턴)</span></li>`).join("");
    body = `<div class="content-card wiki-page">
      <div class="muted">${escapeHtml(p.type)}</div><h2>${escapeHtml(p.title)}</h2>
      <div class="wiki-body">${wikiLinkify(p.body)}</div>
      ${related ? `<h3>관련 기억</h3><ul>${related}</ul>` : ""}</div>`;
  } else {
    const groups = {};
    Object.values(wikiNav.pages).forEach((p) => { (groups[p.type] = groups[p.type] || []).push(p); });
    const typeName = { Character: "인물", World: "지역", Faction: "세력", Item: "물건", Quest: "일", Rumor: "소문" };
    body = Object.entries(groups).map(([type, pages]) => `
      <div class="content-card"><h3>${typeName[type] || type}</h3>
        ${pages.map((p) => `<a href="#" class="wiki-link" data-wiki="${escapeHtml(p.canon_id)}">${escapeHtml(p.title)}</a>`).join(" · ")}</div>`).join("")
      || `<div class="content-card"><p class="muted">아직 발견한 것이 없습니다. 세계를 돌아다녀 보세요.</p></div>`;
  }
  box.innerHTML = bar + `<div id="wikiContent">${body}</div>`;
  wireWiki();
}
// [[canon_id]] → link (discovered) or inert text (undiscovered — no page).
function wikiLinkify(md) {
  let html = inlineMd(escapeHtml(md));
  html = html.replace(/\[\[([\w-]+)\]\]/g, (_, id) => {
    const p = wikiNav.pages[id];
    if (p) return `<a href="#" class="wiki-link" data-wiki="${id}">${escapeHtml(p.title)}</a>`;
    return `<span class="wiki-unknown" title="아직 알지 못하는 존재입니다">???</span>`;
  });
  return html;
}
function wireWiki() {
  document.querySelectorAll(".wiki-link").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); loadWiki(a.dataset.wiki); }));
  const back = $("wkBack"), fwd = $("wkFwd"), home = $("wkHome"), search = $("wkSearch");
  if (back) back.onclick = () => { if (wikiNav.pos > 0) { wikiNav.pos--; loadWiki(null); } };
  if (fwd) fwd.onclick = () => { if (wikiNav.pos < wikiNav.history.length - 1) { wikiNav.pos++; loadWiki(null); } };
  if (home) home.onclick = () => { wikiNav.pos = -1; wikiNav.history = []; loadWiki(null); };
  if (search) search.onchange = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    const hits = Object.values(wikiNav.pages).filter((p) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q));
    $("wikiContent").innerHTML = `<div class="content-card"><h3>"${escapeHtml(q)}" 검색 결과 (${hits.length})</h3>
      ${hits.map((p) => `<div><a href="#" class="wiki-link" data-wiki="${escapeHtml(p.canon_id)}">${escapeHtml(p.title)}</a></div>`).join("") || `<p class="muted">결과 없음</p>`}</div>`;
    wireWiki();
  };
}

// ---------- 관계 탭 ----------
// Phase 7 C3: 10-dimension label mapping. The extra dims (hatred/guilt/obsession/
// jealousy/dependency) mostly sit at 0 and only fire on specific events, so they
// take priority when present — a betrayal reads as hatred, not "서먹함". Still
// qualitative only: never a number reaches the player.
function relLabel(rel) {
  if (!rel) return "아는 사이";
  const {
    trust = 0, affection = 0, fear = 0, respect = 0, obligation = 0,
    hatred = 0, guilt = 0, obsession = 0, jealousy = 0, dependency = 0,
  } = rel;
  // Rare, event-driven dimensions dominate the reading when they light up.
  if (hatred > 0.6) return affection > 0.4 ? "애증이 뒤엉킨 사이" : "적의를 품은 사이";
  if (obsession > 0.6) return "집착에 가까운 사이";
  if (guilt > 0.5) return "죄책감이 남은 사이";
  if (jealousy > 0.6) return "질투가 스민 사이";
  if (dependency > 0.6) return "깊이 의존하는 사이";
  // Core five (Phase 5 behavior preserved).
  if (trust > 0.7 && affection > 0.6) return "깊이 신뢰하는 사이";
  if (affection > 0.7) return "애틋한 사이";
  if (trust < 0.3 && fear > 0.5) return "두려워하며 경계하는 사이";
  if (fear > 0.5) return "두려워하는 사이";
  if (trust < 0.2 && affection < 0.2) return "서먹한 사이";
  if (respect > 0.6) return "존중하는 사이";
  if (obligation > 0.5) return "빚이 있는 사이";
  if (trust > 0.5) return "믿음이 쌓여가는 사이";
  return "지켜보는 사이";
}
async function loadRelationsTab() {
  const box = $("relationsBody");
  box.innerHTML = `<div class="muted">불러오는 중…</div>`;
  const d = await api("/api/relations/" + NOS.campaign);
  const edges = d.player_edges || [];
  if (!edges.length && !(d.npc_edges || []).length) {
    box.innerHTML = `<div class="content-card"><p class="muted">아직 관계라 부를 만한 인연이 없습니다.</p></div>`;
    return;
  }
  // simple radial SVG: player center, met NPCs around.
  const W = 640, H = 420, cx = W / 2, cy = H / 2, R = 150;
  const nodes = edges.map((e, i) => {
    const a = (i / Math.max(edges.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return { ...e, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });
  const svgEdges = nodes.map((n) => `
    <line x1="${cx}" y1="${cy}" x2="${n.x}" y2="${n.y}" stroke="rgba(214,181,109,.35)" stroke-width="1.5"/>
    <text x="${(cx + n.x) / 2}" y="${(cy + n.y) / 2 - 6}" class="svg-label">${escapeHtml(relLabel(n.rel))}</text>`).join("");
  const svgNodes = nodes.map((n) => `
    <circle cx="${n.x}" cy="${n.y}" r="26" fill="#20231f" stroke="rgba(238,224,198,.3)"/>
    <text x="${n.x}" y="${n.y + 4}" class="svg-node">${escapeHtml(n.name)}</text>`).join("");
  const npcEdgeList = (d.npc_edges || []).map((e) => `
    <div class="rep-row"><span>${escapeHtml(e.from)} ↔ ${escapeHtml(e.to)}</span>
      <span class="rep-label">${escapeHtml(e.type || relLabel(e))}</span></div>`).join("");
  // PATCH 관계 전환 — "관계 변화 이력" (성장 궤적과 같은 타임라인 UI 패턴 재사용).
  // 여기서만 from→to 라벨을 온전히 보여준다 (토스트/사이드바는 스포일러 방지).
  const relMilestones = (d.relationship_milestones || []).slice().reverse().map((m) => `
    <div class="tl-item"><span class="tl-turn">${m.turn}턴</span>
      <div class="tl-body"><b>${escapeHtml(m.npc_name || m.npc_ref)}</b> — ${m.from_label ? `<span class="muted">${escapeHtml(m.from_label)}</span> → ` : ""}<b>${escapeHtml(m.to_label)}</b>
      ${m.trigger_summary ? `<div class="muted">${escapeHtml(m.trigger_summary)}</div>` : ""}</div></div>`).join("");
  box.innerHTML = `
    <div class="content-card"><h3>관계도</h3>
      <svg class="rel-graph" viewBox="0 0 ${W} ${H}">
        ${svgEdges}
        <circle cx="${cx}" cy="${cy}" r="30" fill="url(#pg)" stroke="rgba(214,181,109,.8)"/>
        <defs><radialGradient id="pg"><stop offset="0%" stop-color="#d6b56d"/><stop offset="100%" stop-color="#79b69c"/></radialGradient></defs>
        <text x="${cx}" y="${cy + 4}" class="svg-node dark">나</text>
        ${svgNodes}
      </svg></div>
    ${edges.map((e) => `<div class="rep-row"><b>${escapeHtml(e.name)}</b><span class="rep-label">${escapeHtml(relLabel(e.rel))}</span></div>${e.schedule_hint ? `<div class="sched-hint muted">🕑 ${escapeHtml(e.schedule_hint)}</div>` : ""}`).join("")}
    ${relMilestones ? `<div class="content-card"><h3>관계 변화 이력</h3><div class="timeline">${relMilestones}</div></div>` : ""}
    ${npcEdgeList ? `<div class="content-card"><h3>그들 사이의 이야기</h3>${npcEdgeList}</div>` : ""}`;
}

// ---------- 인벤토리 탭 ----------
async function loadInventoryTab() {
  const box = $("inventoryBody");
  box.innerHTML = `<div class="muted">불러오는 중…</div>`;
  const d = await api("/api/inventory/" + NOS.campaign);
  const items = (d.items || []).map((it) => `
    <div class="content-card item">
      <div class="item-top"><b>${escapeHtml(it.name)}</b>${it.quantity > 1 ? `<span class="tag">×${it.quantity}</span>` : ""}</div>
      <div class="muted">${it.acquired_turn}턴에 획득${(it.tags || []).length ? " · " + it.tags.map(escapeHtml).join(", ") : ""}</div>
    </div>`).join("");
  box.innerHTML = `
    <div class="content-card"><h3>인벤토리</h3>
      <p class="muted">아이템을 조합하고 싶다면 이야기 탭에서 자유롭게 서술하세요 — 예: "낡은 등불과 밧줄을 엮어본다". 결과는 이야기가 판정합니다.</p></div>
    ${items || `<div class="content-card"><p class="muted">아직 지닌 것이 없습니다.</p></div>`}`;
}

// ---------- 설정 탭 (Wave 3) ----------
const DNA_KEYS = ["tone", "emotion", "politics", "survival", "horror", "mystery", "romance", "exploration"];
const DNA_LABEL = { tone: "밝음/어두움", emotion: "감정 밀도", politics: "정치/음모", survival: "생존 압박", horror: "공포", mystery: "미스터리", romance: "로맨스", exploration: "탐험" };
async function loadSettingsTab() {
  const box = $("settingsBody");
  box.innerHTML = `<div class="muted">불러오는 중…</div>`;
  const state = await api("/api/state/" + NOS.campaign);
  NOS.settingsCache = state.settings;
  const dna = state.narrative_dna || {};
  const sliders = DNA_KEYS.map((k) => `
    <div class="dna-row"><label>${DNA_LABEL[k]}</label>
      <input type="range" min="1" max="5" step="1" value="${dna[k] || 3}" data-dna="${k}" />
      <span class="dna-val">${dna[k] || 3}</span></div>`).join("");
  const rules = (state.house_rules || []).map((r, i) => `
    <div class="hr-row"><input class="hr-input" data-i="${i}" value="${escapeHtml(r)}" /><button class="hr-del" data-i="${i}">✕</button></div>`).join("");

  const [notesData, playstats, autosaveSlots, snapData] = await Promise.all([
    api("/api/notes/" + NOS.campaign), api("/api/playstats/" + NOS.campaign), api("/api/autosave/" + NOS.campaign),
    api("/api/snapshots/" + NOS.campaign),
  ]);
  // Phase 13 V8 — long-range snapshots (every 100 turns; destructive restore).
  const snapRows = (snapData.snapshots || []).map((s) => `
    <div class="rep-row"><span>${s.turn}턴 스냅샷</span>
      <button class="snap-restore" data-turn="${s.turn}">이 시점으로 되돌리기</button></div>`).join("");
  const noteRows = (notesData.notes || []).slice().reverse().map((n) => `
    <div class="note-row"><div class="note-text">${escapeHtml(n.text)}</div>
      <div class="note-meta">${fmtDate(n.created_at)} <button class="note-del" data-id="${n.id}">삭제</button></div></div>`).join("");
  const slotRows = (autosaveSlots.slots || []).slice().reverse().map((s) => `
    <div class="rep-row"><span>턴 ${s.turn} · ${fmtDate(s.taken_at)}</span>
      <button class="slot-restore" data-turn="${s.turn}">이 시점으로</button></div>`).join("");

  box.innerHTML = `
    <div class="content-card"><h3>캠페인 이름 / 아이콘</h3>
      <div class="wz-row"><input id="setDisplayName" value="${escapeHtml((state.meta && state.meta.display_name) || "")}" placeholder="${escapeHtml((state.meta && state.meta.world_name) || NOS.campaign)}" />
        <input id="setIcon" value="${escapeHtml((state.meta && state.meta.icon) || "📖")}" maxlength="4" style="width:56px;text-align:center" /></div>
      <button id="metaSave" class="primary">이름 저장</button></div>

    <div class="content-card"><h3>Narrative DNA 재조정</h3>
      <p class="muted">변경하면 다음 턴부터 이야기의 결이 서서히 달라집니다.</p>${sliders}
      <button id="dnaSave" class="primary">DNA 적용</button></div>

    <div class="content-card"><h3>플레이 설정</h3>
      <label class="set-row"><input type="checkbox" id="setChoices" ${state.settings.choices_ui ? "checked" : ""}/> 선택지 버튼 표시 (기본 꺼짐 — 자유 서술 우선)</label>
      <label class="set-row"><input type="checkbox" id="setAgencyLock" ${state.settings.player_agency_lock !== false ? "checked" : ""}/> 플레이어 캐릭터 행동은 항상 플레이어가 결정 (기본 켜짐)</label>
      <p class="muted">켜면 AI는 상황과 NPC 반응까지만 서술하고, 당신 캐릭터의 행동·대사·선택은 당신 입력을 기다립니다. 끄면 시간 스킵 등에서 AI가 당신 캐릭터의 사소한 반응까지 서술할 수 있습니다. (NPC 행동에는 영향 없음)</p>
      <div class="set-row"><span>묘사 수위</span>
        <select id="setIntensity">
          <option value="low" ${state.settings.content_intensity === "low" ? "selected" : ""}>낮음</option>
          <option value="medium" ${state.settings.content_intensity === "medium" ? "selected" : ""}>보통</option>
          <option value="high" ${state.settings.content_intensity === "high" ? "selected" : ""}>높음</option>
        </select></div>
      <div class="set-row"><span>응답 길이</span>
        <select id="setLength">
          <option value="short" ${state.settings.response_length === "short" ? "selected" : ""}>짧게</option>
          <option value="normal" ${(state.settings.response_length || "normal") === "normal" ? "selected" : ""}>보통</option>
          <option value="long" ${state.settings.response_length === "long" ? "selected" : ""}>길게</option>
        </select></div></div>

    <div class="content-card"><h3>House Rules</h3>
      <p class="muted">GM에게 항상 전달되는 규칙입니다. 단, 시스템의 절대 원칙(내부 수치 비노출 등)은 덮어쓸 수 없습니다.</p>
      <div id="hrList">${rules}</div>
      <button id="hrAdd">+ 규칙 추가</button> <button id="hrSave" class="primary">규칙 저장</button></div>

    <div class="content-card"><h3>개인 메모장</h3>
      <p class="muted">GM(AI)은 이 메모를 절대 보지 않습니다 — 완전히 분리된 저장 공간입니다. 이야기 탭에서 <code>/메모 내용</code>으로도 남길 수 있습니다.</p>
      <div class="wz-row"><input id="noteInput" placeholder="여기에만 남는 메모…" /><button id="noteAdd">추가</button></div>
      <div id="noteList">${noteRows || `<p class="muted">아직 메모가 없습니다.</p>`}</div></div>

    <div class="content-card"><h3>다음 세션 목표</h3>
      <p class="muted">직접 적어두는 다음 목표입니다 — 다음에 이어할 때 리캡과 함께 보여드립니다.</p>
      <div class="wz-row"><input id="goalInput" value="${escapeHtml((notesData.next_session_goal && notesData.next_session_goal.text) || "")}" placeholder="예: 리아와의 오해를 풀어보기" /><button id="goalSave" class="primary">저장</button></div></div>

    <div class="content-card"><h3>세션 하이라이트</h3>
      <p class="muted">버튼을 눌러야만 AI가 이번 세션을 요약합니다 — 자동으로 실행되지 않습니다. 북마크해둔 장면이 있으면 그것을 우선 사용합니다.</p>
      <button id="highlightBtn">이번 세션 하이라이트 만들기</button>
      <div id="highlightResult" class="recap-text"></div></div>

    <div class="content-card"><h3>플레이 기록</h3>
      <p>총 턴 수: <b>${playstats.total_turns || 0}</b> · 첫 플레이: ${playstats.first_played_at ? fmtDate(playstats.first_played_at) : "-"}</p>
      <p>누적 플레이 시간: <b>${fmtDuration(playstats.total_playtime_seconds || 0)}</b></p></div>

    <div class="content-card"><h3>자동저장 (최근 ${autosaveSlots.slots ? autosaveSlots.slots.length : 0}개)</h3>
      <p class="muted">턴마다 자동 저장됩니다. 필요하면 최근 시점 중 하나로 돌아갈 수 있습니다.</p>
      ${slotRows || `<p class="muted">아직 자동저장이 없습니다.</p>`}</div>

    <div class="content-card"><h3>장기 스냅샷 (100턴 주기)</h3>
      <p class="muted">100턴마다 전체 상태를 통째로 저장합니다 (최근 3개 유지). "100턴 전으로" 같은 큰 되돌리기용입니다 — <b>되돌리면 이후 진행이 사라집니다.</b></p>
      ${snapRows || `<p class="muted">아직 장기 스냅샷이 없습니다 (100턴 이상 진행 시 생성).</p>`}</div>

    <div class="content-card"><h3>저토큰 모드</h3>
      <label class="set-row"><input type="checkbox" id="setLowToken" ${state.settings.low_token_mode ? "checked" : ""}/> 저토큰 모드 (무료 한도 걱정될 때만)</label>
      <p class="muted">켜면 선택적 AI 호출이 줄어듭니다: Director 토론·NPC 배경 서술·일일 정리·세션 리캡/하이라이트 비활성화, NPC 선제 연락 빈도 축소. 서사 생성과 후처리(핵심 2콜)는 그대로 유지됩니다.</p></div>

    <div class="content-card"><h3>백업 / 내보내기</h3>
      <p class="muted">JSON 백업이 곧 백업 파일입니다 — 런처의 "파일에서 불러오기"로 복원하거나 다른 사람과 공유할 수 있습니다.</p>
      <div class="modal-actions">
        <button id="expJson">JSON 백업 내보내기</button>
        <button id="expStory">서사 내보내기 (.md)</button></div>
      <p id="expNote" class="muted hidden">내려받은 JSON 파일로 언제든 이어할 수 있습니다 — 런처의 "파일에서 불러오기"에 그대로 사용하세요.</p></div>

    <div class="content-card"><h3>세계관 템플릿</h3>
      <p class="muted">지금 세계(지역/세력)만 템플릿으로 저장합니다 — 인물·진행 상황은 제외됩니다. 새 캠페인 마법사에서 "기존 세계관 템플릿으로 시작"으로 재사용할 수 있습니다 (앤솔로지).</p>
      <button id="saveTemplateBtn">현재 세계관을 템플릿으로 저장</button>
      <div id="saveTemplateResult" class="muted"></div></div>

    <div class="content-card"><h3>고급 (작가/개발자용)</h3>
      <label class="set-row"><input type="checkbox" id="setAdvanced" ${state.settings.advanced_mode ? "checked" : ""}/> Advanced 모드 — 모든 내부 변수(감정·관계·Hidden·난이도·구조 등)를 볼 수 있는 패널을 켭니다</label>
      <p class="muted">기본 꺼짐. 켜면 상단에 <b>Advanced</b> 버튼이 나타납니다. 플레이어에게 보여주면 몰입이 깨지니 본인이 쓸 때만 켜세요. (읽기 전용)</p></div>

    <div class="content-card"><h3>화면·앱 설정은 런처로 이동했습니다</h3>
      <p class="muted">테마·글자·채팅 스타일 같은 <b>꾸미기</b> 설정과 커스텀 테마·API 키·플러그인·전체 사용량은 이제 런처의 <b>⚙ 설정</b>에서 관리합니다. 이 탭에는 이야기에 직접 영향을 주는 설정만 남겼습니다.</p>
      <button id="gotoLauncherSettings">런처 설정 열기 →</button></div>`;

  // wiring
  box.querySelectorAll('input[type="range"][data-dna]').forEach((r) =>
    r.addEventListener("input", () => { r.nextElementSibling.textContent = r.value; }));
  $("dnaSave").addEventListener("click", async () => {
    const dnaPatch = {};
    box.querySelectorAll("[data-dna]").forEach((r) => (dnaPatch[r.dataset.dna] = Number(r.value)));
    await apiPost(`/api/state/${NOS.campaign}/settings`, { narrative_dna: dnaPatch });
    showBanner("Narrative DNA가 적용되었습니다 — 다음 턴부터 반영됩니다.");
  });
  $("setChoices").addEventListener("change", async (e) => {
    await apiPost(`/api/state/${NOS.campaign}/settings`, { settings: { choices_ui: e.target.checked } });
    NOS.settingsCache.choices_ui = e.target.checked;
  });
  // C9 — player-agency lock (story-affecting → injected into the GM prompt).
  $("setAgencyLock").addEventListener("change", async (e) => {
    await apiPost(`/api/state/${NOS.campaign}/settings`, { settings: { player_agency_lock: e.target.checked } });
    NOS.settingsCache.player_agency_lock = e.target.checked;
    showBanner(e.target.checked ? "이제 당신 캐릭터의 행동은 항상 당신이 결정합니다." : "AI가 당신 캐릭터의 사소한 반응까지 서술할 수 있습니다.");
  });
  $("setIntensity").addEventListener("change", async (e) => {
    await apiPost(`/api/state/${NOS.campaign}/settings`, { settings: { content_intensity: e.target.value } });
  });
  $("setLength").addEventListener("change", async (e) => {
    await apiPost(`/api/state/${NOS.campaign}/settings`, { settings: { response_length: e.target.value } });
  });
  // Phase 7 Part D — Advanced 모드 toggle (persisted server-side; reveals button).
  $("setAdvanced").addEventListener("change", async (e) => {
    await apiPost(`/api/state/${NOS.campaign}/advanced-mode`, { enabled: e.target.checked });
    NOS.settingsCache.advanced_mode = e.target.checked;
    refreshAdvancedButton(e.target.checked);
    showBanner(e.target.checked ? "Advanced 모드 켜짐 — 상단 Advanced 버튼을 확인하세요." : "Advanced 모드 꺼짐.");
  });
  $("metaSave").addEventListener("click", async () => {
    await apiPost(`/api/state/${NOS.campaign}/settings`, { meta: { display_name: $("setDisplayName").value.trim(), icon: $("setIcon").value.trim() || "📖" } });
    const s = await api("/api/state/" + NOS.campaign);
    $("campTitle").textContent = `${s.meta.icon} ${s.meta.display_name || s.meta.world_name || NOS.campaign}`;
    showBanner("캠페인 이름이 저장되었습니다.");
  });
  $("hrAdd").addEventListener("click", () => {
    const div = document.createElement("div");
    div.className = "hr-row";
    div.innerHTML = `<input class="hr-input" value="" placeholder="예: 전투 묘사는 짧고 굵게" /><button class="hr-del">✕</button>`;
    $("hrList").appendChild(div);
    div.querySelector(".hr-del").addEventListener("click", () => div.remove());
  });
  box.querySelectorAll(".hr-del").forEach((b) => b.addEventListener("click", () => b.parentElement.remove()));
  $("hrSave").addEventListener("click", async () => {
    const rules = [...box.querySelectorAll(".hr-input")].map((i) => i.value.trim()).filter(Boolean);
    await apiPost(`/api/state/${NOS.campaign}/settings`, { house_rules: rules });
    showBanner("House Rules가 저장되었습니다.");
  });
  // App-wide cosmetic/accessibility/theme/key/plugin/usage controls moved to the
  // launcher settings view (#/settings, launcherSettings.js). This tab keeps only
  // story-affecting settings.
  $("gotoLauncherSettings").addEventListener("click", () => { location.hash = "#/settings"; });

  // Phase 12 U3 — low-token mode (per-campaign, affects AI call volume).
  if ($("setLowToken")) $("setLowToken").addEventListener("change", async (e) => {
    await apiPost(`/api/state/${NOS.campaign}/settings`, { settings: { low_token_mode: e.target.checked } });
    NOS.settingsCache.low_token_mode = e.target.checked;
    showBanner(e.target.checked ? "저토큰 모드 켜짐 — 선택적 AI 호출이 줄어듭니다." : "저토큰 모드 꺼짐.");
  });

  // Phase 8 B1 — save current world as a reusable template.
  $("saveTemplateBtn").addEventListener("click", async () => {
    try {
      const r = await apiPost(`/api/campaign/${NOS.campaign}/save-template`, {});
      $("saveTemplateResult").textContent = `저장됨: "${r.template.name}" (${(r.template.canon_snapshot || []).length}개 세계/세력 항목)`;
      showBanner("세계관 템플릿이 저장되었습니다.");
    } catch (e) { $("saveTemplateResult").textContent = "저장 실패: " + e.message; }
  });

  // Phase 6 D — personal notebook (never reaches the prompt; separate store).
  $("noteAdd").addEventListener("click", async () => {
    const text = $("noteInput").value.trim();
    if (!text) return;
    await apiPost(`/api/notes/${NOS.campaign}`, { text });
    $("noteInput").value = "";
    loadSettingsTab();
  });
  box.querySelectorAll(".note-del").forEach((b) =>
    b.addEventListener("click", async () => { await fetch(`/api/notes/${NOS.campaign}/${b.dataset.id}`, { method: "DELETE" }); loadSettingsTab(); }));

  // Phase 6 F — next-session goal (manual, separate store).
  $("goalSave").addEventListener("click", async () => {
    await apiPost(`/api/goal/${NOS.campaign}`, { text: $("goalInput").value.trim() });
    showBanner("다음 목표가 저장되었습니다.");
  });

  // Phase 6 E — session highlight: human-triggered AI assist, not automatic.
  $("highlightBtn").addEventListener("click", async () => {
    $("highlightResult").textContent = "이번 세션을 돌아보는 중…";
    try {
      const r = await apiPost(`/api/highlights/${NOS.campaign}`);
      $("highlightResult").innerHTML = r.summary ? renderNarrative(r.summary) : `<span class="muted">요약할 만한 세션 기록이 아직 없습니다.</span>`;
    } catch (e) { $("highlightResult").innerHTML = `<span class="muted">하이라이트 생성 실패: ${escapeHtml(e.message)}</span>`; }
  });

  // Phase 6 C — autosave rotation slots.
  box.querySelectorAll(".slot-restore").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm(`턴 ${b.dataset.turn} 시점으로 되돌립니다. 계속할까요?`)) return;
      await apiPost(`/api/autosave/${NOS.campaign}/restore`, { turn: Number(b.dataset.turn) });
      enterCampaign(NOS.campaign);
    }));

  // Phase 13 V8 — long-range snapshot restore (destructive; extra confirm).
  box.querySelectorAll(".snap-restore").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm(`${b.dataset.turn}턴 스냅샷으로 되돌립니다. 그 이후의 모든 진행이 사라집니다. 계속할까요?`)) return;
      await apiPost(`/api/snapshots/${NOS.campaign}/restore`, { turn: Number(b.dataset.turn) });
      enterCampaign(NOS.campaign);
    }));

  $("expJson").addEventListener("click", async () => {
    const bundle = await api("/api/export/" + NOS.campaign);
    download(`${NOS.campaign}_backup.json`, JSON.stringify(bundle, null, 2));
    $("expNote").classList.remove("hidden"); // Phase 6 F — "이어하기" 안내 문구
  });
  $("expStory").addEventListener("click", async () => {
    const res = await fetch(`/api/export/${NOS.campaign}/narrative`);
    download(`${NOS.campaign}_story.md`, await res.text(), "text/markdown");
  });
}

// Phase 12 U2 — category usage bar chart (proportional, no external lib).
const CAT_LABEL = { narrative: "서사 생성", extraction: "후처리 추출", director_debate: "Director 토론", internet_search: "인터넷 검색", npc_background: "NPC 배경", daily_digest: "일일 정리", session_recap: "세션 리캡", session_highlight: "세션 하이라이트", npc_proactive: "NPC 선제연락", wizard_generation: "마법사 생성", other: "기타" };
function usageBars(byCat) {
  const entries = Object.entries(byCat).map(([k, v]) => [k, v.calls || 0]).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<p class="muted">아직 호출 기록이 없습니다.</p>`;
  const max = Math.max(...entries.map(([, c]) => c));
  return `<div class="usage-bars">${entries.map(([k, c]) => `
    <div class="ub-row"><span class="ub-label">${escapeHtml(CAT_LABEL[k] || k)}</span>
      <div class="ub-track"><div class="ub-fill" style="width:${Math.round((c / max) * 100)}%"></div></div>
      <span class="ub-val">${c}</span></div>`).join("")}</div>`;
}

function fmtDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분`;
  return `${sec}초`;
}

// Phase 6 D — DNA-tone-based UI color (horror/tone -> CSS accent hue). Pure
// color mapping, no images. Off switch: nos_dna_color=0.
function applyDnaTheme(dna) {
  const theme = localStorage.getItem("nos_theme") || "dark";
  if (theme === "mono" || theme === "plain" || !dna || localStorage.getItem("nos_dna_color") === "0") {
    document.documentElement.style.removeProperty("--gold");
    document.documentElement.style.removeProperty("--jade");
    return;
  }
  const dark = (dna.tone || 3) <= 2;
  const horror = (dna.horror || 0) >= 4;
  const romance = (dna.romance || 0) >= 4;
  const root = document.documentElement.style;
  if (horror) { root.setProperty("--gold", "#b06b6b"); root.setProperty("--jade", "#5d7a6e"); }
  else if (romance) { root.setProperty("--gold", "#d99bb0"); root.setProperty("--jade", "#c9a6d6"); }
  else if (dark) { root.setProperty("--gold", "#9a8d6a"); root.setProperty("--jade", "#5f7a6d"); }
  else { root.removeProperty("--gold"); root.removeProperty("--jade"); }
}

function applyAccessibility() {
  const theme = localStorage.getItem("nos_theme") || "dark";
  document.body.style.fontSize = (localStorage.getItem("nos_font") || "14") + "px";
  document.body.classList.toggle("colorblind", localStorage.getItem("nos_colorblind") === "1");
  document.body.classList.toggle("theme-light", theme === "light");
  document.body.classList.toggle("theme-mono", theme === "mono");
  document.body.classList.toggle("theme-plain", theme === "plain");
  document.body.classList.toggle("chat-novel", localStorage.getItem("nos_chat_style") === "novel");
  document.body.classList.toggle("low-spec", localStorage.getItem("nos_low_spec") === "1");
  document.body.classList.toggle("font-serif", localStorage.getItem("nos_font_family") === "serif");
  document.body.classList.toggle("font-mono", localStorage.getItem("nos_font_family") === "mono");
  document.body.classList.toggle("reduce-motion", localStorage.getItem("nos_reduce_motion") === "1");
  // Phase 15 BB — reapply a saved custom theme's CSS variable tokens.
  try { const saved = localStorage.getItem("nos_custom_theme"); if (saved) applyThemeTokens(JSON.parse(saved)); } catch (_) {}
}

// Phase 15 BB — set validated CSS custom-property tokens on :root.
function applyThemeTokens(tokens) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens || {})) {
    if (typeof k === "string" && k.startsWith("--")) root.style.setProperty(k, v);
  }
}
