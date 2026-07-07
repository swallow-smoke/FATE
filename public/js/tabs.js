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
      const loaders = { writer: loadWriterTab, character: loadCharacterTab, world: loadWorldTab, relations: loadRelationsTab, inventory: loadInventoryTab, settings: loadSettingsTab };
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
  } else if (active === "news") {
    // Phase 16 · World News — 신문/게시판/공고/소문. 미열람이면 읽음 처리.
    const kindIcon = { "신문": "📰", "게시판": "📌", "공고": "📜", "소문": "💬" };
    const items = (d.news || []).map((n) => `
      <div class="content-card news-item">
        <div class="muted">${kindIcon[n.kind] || "📰"} ${escapeHtml(n.kind || "")}${n.in_world_date ? " · " + escapeHtml(n.in_world_date) : ""}${n.seen_by_player ? "" : " · <b>NEW</b>"}</div>
        <h3>${escapeHtml(n.headline)}</h3>
        ${n.body ? `<p>${escapeHtml(n.body)}</p>` : ""}
        ${n.source ? `<div class="muted">— ${escapeHtml(n.source)}</div>` : ""}</div>`).join("");
    box.innerHTML = `<div class="content-card"><h3>세계 소식</h3><p class="muted">당신이 자리를 비운 동안에도 세계는 계속 움직입니다.</p></div>${items || `<div class="content-card"><p class="muted">아직 전해진 소식이 없습니다.</p></div>`}`;
    if (d.news_unseen) { try { await apiPost(`/api/worldtab/${NOS.campaign}/news-seen`, {}); } catch (_) {} }
  } else if (active === "places") {
    // Phase 16 · Living Places — 발견한 장소들의 현재 상태 + 변천사.
    const stageIcon = { "번영": "🌟", "안정": "🏙", "쇠락": "🍂", "황폐": "🥀", "폐허": "🪨" };
    const trendKo = { rising: "↑ 회복 중", declining: "↓ 쇠퇴 중", stable: "→ 안정적" };
    const items = (d.places || []).map((p) => {
      const hist = (p.history || []).map((h) => `<div class="tl-item"><span class="tl-turn">${h.in_world_date || h.turn + "턴"}</span><div class="tl-body">${escapeHtml(h.from_stage)} → <b>${escapeHtml(h.to_stage)}</b> · ${escapeHtml(h.summary || "")}</div></div>`).join("");
      return `<div class="content-card">
        <div class="muted">${trendKo[p.trend] || ""}${p.region ? " · " + escapeHtml(p.region) : ""}</div>
        <h3>${stageIcon[p.stage] || "📍"} ${escapeHtml(p.name)} <span class="muted">(${escapeHtml(p.stage || "?")})</span></h3>
        ${hist || `<p class="muted">아직 큰 변화가 없습니다.</p>`}</div>`;
    }).join("");
    box.innerHTML = `<div class="content-card"><h3>장소의 변천</h3><p class="muted">시간이 흐르며 세계의 장소들도 변합니다.</p></div>${items || `<div class="content-card"><p class="muted">아직 기억에 남은 장소가 없습니다.</p></div>`}`;
  } else if (active === "calendar") {
    const cal = await api("/api/calendar/" + NOS.campaign);
    const rows = (cal.upcoming || []).map((e) => `
      <div class="rep-row"><span><b>${escapeHtml(e.title)}</b> <span class="muted">${escapeHtml(e.kind_label || e.kind || "")}</span></span>
        <span class="rep-label">${e.in_days === 0 ? "today" : e.in_days + "d"}</span></div>`).join("");
    box.innerHTML = `<div class="content-card"><h3>Personal Calendar</h3>
      <div class="wz-row"><input id="calTitle" placeholder="새 일정" /><input id="calDay" type="number" min="1" placeholder="day" /><button id="calAdd">추가</button></div></div>
      <div class="content-card">${rows || `<p class="muted">아직 예정된 일정이 없습니다.</p>`}</div>`;
    $("calAdd").addEventListener("click", async () => {
      const title = $("calTitle").value.trim();
      const day = Number($("calDay").value);
      if (!title || !day) return;
      await apiPost(`/api/calendar/${NOS.campaign}`, { title, kind: "reservation", day });
      loadWorldTab();
    });
  } else if (active === "property") {
    const prop = await api("/api/property/" + NOS.campaign);
    const rows = (prop.properties || []).map((p) => {
      const keepsakes = (p.contents || []).map((c) => `<li>${escapeHtml(c.type_label || c.type)}${c.note ? ": " + escapeHtml(c.note) : ""}</li>`).join("");
      const upgrades = (p.upgrades || []).map((u) => `<span class="tag">${escapeHtml(u.name || "")}</span>`).join("");
      return `<div class="content-card"><div class="muted">${escapeHtml(p.kind_label || p.kind)}${p.region ? " · " + escapeHtml(p.region) : ""}</div>
        <h3>${escapeHtml(p.name)} <span class="muted">Lv.${p.level || 1}</span></h3>
        ${upgrades || ""}${keepsakes ? `<ul>${keepsakes}</ul>` : `<p class="muted">아직 보관된 추억이나 장식품이 없습니다.</p>`}</div>`;
    }).join("");
    box.innerHTML = rows || `<div class="content-card"><h3>Home / Property</h3><p class="muted">아직 소유한 집이나 건물이 없습니다.</p></div>`;
  } else if (active === "inspector") {
    const wiki = await api("/api/wiki/" + NOS.campaign);
    const options = (wiki.pages || []).map((p) => `<option value="${escapeHtml(p.canon_id)}">${escapeHtml(p.name || p.canon_id)} (${escapeHtml(p.type || "")})</option>`).join("");
    box.innerHTML = `<div class="content-card"><h3>Entity Inspector</h3>
      <div class="wz-row"><select id="inspectPick">${options}</select><button id="inspectGo">조회</button></div>
      <div id="inspectBody" class="inspector-body"><p class="muted">NPC, 장소, 아이템, 조직, 사건을 한 화면에서 조회합니다.</p></div></div>`;
    const renderInspect = async () => {
      const id = $("inspectPick").value;
      if (!id) return;
      const x = await api(`/api/inspect/${NOS.campaign}/${encodeURIComponent(id)}`);
      const rel = (x.related || []).map((r) => `<span class="tag">${escapeHtml(r.name)}</span>`).join("");
      const apps = (x.appearances || []).slice().reverse().map((a) => `<div class="tl-item"><span class="tl-turn">${a.turn}</span><div class="tl-body">${escapeHtml(a.summary)}</div></div>`).join("");
      const news = (x.news || []).map((n) => `<li>${escapeHtml(n.kind || "")}: ${escapeHtml(n.headline || "")}</li>`).join("");
      $("inspectBody").innerHTML = `<h3>${escapeHtml((x.basic && x.basic.name) || id)}</h3>
        <div class="muted">${escapeHtml((x.basic && x.basic.type) || "")}</div>
        ${x.goal ? `<p><b>Goal</b>: ${escapeHtml(x.goal.goal)} (${x.goal.progress}%, ${escapeHtml(x.goal.status)})</p>` : ""}
        ${rel ? `<div>${rel}</div>` : ""}
        ${news ? `<h4>News</h4><ul>${news}</ul>` : ""}
        ${apps ? `<h4>Appearances</h4><div class="timeline">${apps}</div>` : `<p class="muted">등장 기록이 없습니다.</p>`}`;
    };
    $("inspectGo").addEventListener("click", renderInspect);
    if (options) renderInspect();
  } else if (active === "history") {
    // Phase 16 · World History Book — 자동 편찬된 세계 연대기.
    const h = d.history || {};
    const kindIcon = { "사건": "⚔", "세계": "🌍", "장소": "🏛", "인물": "👤", "세대": "⏳" };
    const rows = (h.chronicle || []).map((e) => `<div class="tl-item"><span class="tl-turn">${escapeHtml(e.date || (e.turn + "턴"))}</span><div class="tl-body">${kindIcon[e.kind] || "·"} ${escapeHtml(e.text)}</div></div>`).join("");
    box.innerHTML = `<div class="content-card"><h3>📖 ${escapeHtml(h.world_name || "세계")}의 역사서</h3>
      <p class="muted">플레이가 길어질수록 한 권의 역사가 됩니다. ${h.total ? `기록된 사건 ${h.total}건` : ""}</p></div>
      ${rows ? `<div class="content-card"><div class="timeline">${rows}</div></div>` : `<div class="content-card"><p class="muted">아직 역사서에 남길 만한 사건이 없습니다.</p></div>`}`;
  } else if (active === "dreams") {
    // Phase 16 · Dream System — 수면 시 생성된 꿈.
    const typeIcon = { "악몽": "😱", "예지몽": "🔮", "회상몽": "💭" };
    const items = (d.dreams || []).map((dr) => `
      <div class="content-card dream-item">
        <div class="muted">${typeIcon[dr.type] || "🌙"} ${escapeHtml(dr.type || "꿈")}${dr.in_world_date ? " · " + escapeHtml(dr.in_world_date) : ""}</div>
        <p>${escapeHtml(dr.text || "")}</p></div>`).join("");
    box.innerHTML = `<div class="content-card"><h3>꿈</h3><p class="muted">잠든 사이 스쳐간 악몽과 예지몽, 그리고 오래된 회상입니다.</p></div>${items || `<div class="content-card"><p class="muted">아직 기억에 남은 꿈이 없습니다.</p></div>`}`;
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
  if (!edges.length && !(d.npc_edges || []).length && !(d.titles || []).length && !(d.promises || []).length && !(d.family || []).length) {
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
  // Phase 16 · Relationship History — 수치가 아니라 "왜 그렇게 되었는가" 로그.
  const dimKo = { trust: "신뢰", affection: "애정", fear: "두려움", respect: "존중", obligation: "의무", hatred: "증오", guilt: "죄책감", obsession: "집착", jealousy: "질투", dependency: "의존" };
  const relHistory = edges.map((e) => {
    const hist = ((e.rel && e.rel.change_history) || []).slice().reverse().filter((h) => h.summary || h.dimension);
    if (!hist.length) return "";
    const rows = hist.map((h) => `<div class="tl-item"><span class="tl-turn">${escapeHtml(h.in_world_date || (h.turn + "턴"))}</span>
      <div class="tl-body">${h.summary ? escapeHtml(h.summary) : "<span class=\"muted\">교류가 있었다</span>"} ${h.dimension ? `<span class="muted">→ ${dimKo[h.dimension] || h.dimension} ${h.direction === "up" ? "▲" : "▼"}</span>` : ""}</div></div>`).join("");
    return `<div class="content-card"><h3>${escapeHtml(e.name)}와(과)의 발자취</h3><div class="timeline">${rows}</div></div>`;
  }).join("");
  // Phase 16 · NPC Goal System — 각 NPC가 좇는 장기 목표 + 진행도.
  const goalStatusKo = { active: "진행 중", achieved: "달성", failed: "좌절" };
  const goals = (d.npc_goals || []).map((g) => `
    <div class="rep-row"><span><b>${escapeHtml(g.name)}</b> · ${escapeHtml(g.goal)}</span>
      <span class="rep-label">${goalStatusKo[g.status] || g.status}${g.status === "active" ? ` (${g.progress}%)` : ""}</span></div>`).join("");
  const goalsBlock = goals ? `<div class="content-card"><h3>그들이 좇는 것</h3><p class="muted">플레이어가 없어도 각자의 목표를 향해 나아갑니다.</p>${goals}</div>` : "";
  // Phase 16 · Nickname System — 그들이 나를 부르는 방식.
  const nicks = (d.nicknames || []).map((n) => `<div class="rep-row"><span>${escapeHtml(n.name)}</span><span class="rep-label">"${escapeHtml(n.nickname)}"</span></div>`).join("");
  const nicksBlock = nicks ? `<div class="content-card"><h3>그들이 부르는 나</h3>${nicks}</div>` : "";
  const titleRows = (d.titles || []).map((t) => `<span class="tag">${escapeHtml(t.title)}${t.source ? " · " + escapeHtml(t.source) : ""}</span>`).join("");
  const titlesBlock = titleRows ? `<div class="content-card"><h3>Dynamic Titles</h3>${titleRows}</div>` : "";
  const promiseRows = (d.promises || []).map((p) => `<div class="rep-row"><span>${escapeHtml(p.summary || "")}${p.npc_name ? " · " + escapeHtml(p.npc_name) : ""}</span><span class="rep-label">${escapeHtml(p.status || "")}${p.due_day ? " D" + p.due_day : ""}</span></div>`).join("");
  const promisesBlock = promiseRows ? `<div class="content-card"><h3>Promises</h3>${promiseRows}</div>` : "";
  const familyRows = (d.family || []).map((tree) => {
    const rel = ["parents", "spouse", "siblings", "children", "heirs"].map((k) => {
      const names = (tree[k] || []).map((x) => escapeHtml(x.name)).join(", ");
      return names ? `<div class="rep-row"><span>${k}</span><span class="rep-label">${names}</span></div>` : "";
    }).join("");
    return `<div class="content-card"><h3>${escapeHtml(tree.root.name)}</h3>${rel}</div>`;
  }).join("");
  const familyBlock = familyRows ? `<div class="content-card"><h3>Family Tree</h3><p class="muted">자동 연결된 가족/후계 관계입니다.</p></div>${familyRows}` : "";
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
    ${titlesBlock}
    ${promisesBlock}
    ${familyBlock}
    ${nicksBlock}
    ${goalsBlock}
    ${relHistory}
    ${npcEdgeList ? `<div class="content-card"><h3>그들 사이의 이야기</h3>${npcEdgeList}</div>` : ""}`;
}

// ---------- 인벤토리 탭 ----------
async function loadInventoryTab() {
  const box = $("inventoryBody");
  box.innerHTML = `<div class="muted">불러오는 중…</div>`;
  const d = await api("/api/inventory/" + NOS.campaign);
  const items = (d.items || []).map((it) => {
    const living = it.living;
    const hist = living && (living.history || []).length
      ? `<div class="timeline">${living.history.map((h) => `<div class="tl-item"><span class="tl-turn">${h.turn}</span><div class="tl-body">${escapeHtml(h.stage || "")}${h.note ? " · " + escapeHtml(h.note) : ""}</div></div>`).join("")}</div>`
      : "";
    return `
    <div class="content-card item">
      <div class="item-top"><b>${escapeHtml(it.name)}</b>${it.quantity > 1 ? `<span class="tag">×${it.quantity}</span>` : ""}</div>
      <div class="muted">${it.acquired_turn}턴에 획득${(it.tags || []).length ? " · " + it.tags.map(escapeHtml).join(", ") : ""}</div>
      ${living ? `<div class="rep-row"><span>Living Object</span><span class="rep-label">${escapeHtml(living.condition || "")}</span></div>${hist}` : ""}
    </div>`;
  }).join("");
  box.innerHTML = `
    <div class="content-card"><h3>인벤토리</h3>
      <p class="muted">아이템을 조합하고 싶다면 이야기 탭에서 자유롭게 서술하세요 — 예: "낡은 등불과 밧줄을 엮어본다". 결과는 이야기가 판정합니다.</p></div>
    ${items || `<div class="content-card"><p class="muted">아직 지닌 것이 없습니다.</p></div>`}`;
}

// ---------- 설정 탭 (Wave 3) ----------
const DNA_KEYS = ["tone", "emotion", "politics", "survival", "horror", "mystery", "romance", "exploration"];
const DNA_LABEL = { tone: "밝음/어두움", emotion: "감정 밀도", politics: "정치/음모", survival: "생존 압박", horror: "공포", mystery: "미스터리", romance: "로맨스", exploration: "탐험" };
function registryRows(items, kind) {
  return (items || []).map((x) => `
    <div class="rep-row ${x.archived ? "archived" : ""}">
      <span><b>${escapeHtml(x.label || x.id)}</b> <small class="muted">${escapeHtml(x.id)}</small><br><span class="muted">${escapeHtml(x.description || x.tone_notes || "")}</span></span>
      <button class="reg-archive" data-kind="${kind}" data-id="${escapeHtml(x.id)}">${x.archived ? "되살리기" : "숨김"}</button>
    </div>`).join("") || `<p class="muted">아직 항목이 없습니다.</p>`;
}
function renderPromptSettingsCard(promptData) {
  const groups = { story: "이야기", core: "핵심", import: "가져오기", wizard: "마법사", summary: "요약/연출", tools: "도구" };
  const prompts = (promptData && promptData.prompts) || [];
  const first = prompts[0] || {};
  const list = prompts.map((p) => `
    <button class="prompt-pick ${p.key === first.key ? "active" : ""}" data-key="${escapeHtml(p.key)}">
      <span><b>${escapeHtml(p.label)}</b><small>${escapeHtml(groups[p.group] || p.group)} · ${escapeHtml(p.mode)}${p.customized ? " · 수정됨" : ""}</small></span>
      ${p.dangerous ? '<em>주의</em>' : ""}
    </button>`).join("");
  return `
    <div class="content-card prompt-settings-card"><h3>프롬프트 설정</h3>
      <p class="muted">Gemini에 실제로 들어가는 프롬프트 항목들을 캠페인별로 편집합니다. 비활성/빈 값이면 앱 기본 프롬프트를 사용합니다.</p>
      <label class="set-row"><input type="checkbox" id="promptSettingsEnabled" ${promptData && promptData.enabled !== false ? "checked" : ""}/> 이 캠페인의 커스텀 프롬프트 사용</label>
      <div class="prompt-settings-grid">
        <aside class="prompt-pick-list">${list}</aside>
        <section class="prompt-edit-pane">
          <div class="prompt-edit-head">
            <div><b id="promptEditTitle">${escapeHtml(first.label || "")}</b><p id="promptEditDesc" class="muted">${escapeHtml(first.description || "")}</p></div>
            <span id="promptEditMeta" class="tag">${escapeHtml(first.key || "")}</span>
          </div>
          <label class="set-row"><input type="checkbox" id="promptItemEnabled" ${first.enabled ? "checked" : ""}/> 이 항목 덮어쓰기</label>
          <div class="wz-field"><label>커스텀 프롬프트</label><textarea id="promptItemText" rows="12" placeholder="비워두면 기본값을 사용합니다.">${escapeHtml(first.text || "")}</textarea></div>
          <details class="prompt-default-box"><summary>기본 프롬프트 보기</summary><textarea id="promptDefaultText" rows="10" readonly>${escapeHtml(first.default_text || "")}</textarea></details>
          <div id="promptEditStatus" class="muted"></div>
          <div class="modal-actions">
            <button id="promptItemSave" class="primary">이 항목 저장</button>
            <button id="promptItemReset">기본값으로 되돌리기</button>
            <button id="promptLastView">마지막 실제 프롬프트 보기</button>
          </div>
        </section>
      </div>
    </div>`;
}

function wirePromptSettings(promptData) {
  const prompts = (promptData && promptData.prompts) || [];
  if (!prompts.length || !$("promptItemText")) return;
  let activeKey = prompts[0].key;
  const byKey = Object.fromEntries(prompts.map((p) => [p.key, p]));
  const loadPrompt = (key) => {
    activeKey = key;
    const p = byKey[key] || prompts[0];
    document.querySelectorAll(".prompt-pick").forEach((b) => b.classList.toggle("active", b.dataset.key === key));
    $("promptEditTitle").textContent = p.label || key;
    $("promptEditDesc").textContent = p.description || "";
    $("promptEditMeta").textContent = `${p.key} · ${p.mode}${p.dangerous ? " · 주의" : ""}`;
    $("promptItemEnabled").checked = !!p.enabled;
    $("promptItemText").value = p.text || "";
    $("promptDefaultText").value = p.default_text || "";
    $("promptItemText").maxLength = p.max || 24000;
    $("promptEditStatus").textContent = p.customized ? "이 항목은 커스텀 프롬프트를 사용 중입니다." : "현재 기본 프롬프트를 사용 중입니다.";
  };
  document.querySelectorAll(".prompt-pick").forEach((b) => b.addEventListener("click", () => loadPrompt(b.dataset.key)));
  $("promptSettingsEnabled").addEventListener("change", async (e) => {
    await apiPost(`/api/prompts/${NOS.campaign}`, { enabled: e.target.checked });
    showBanner(e.target.checked ? "커스텀 프롬프트가 활성화되었습니다." : "커스텀 프롬프트가 비활성화되었습니다.");
  });
  $("promptItemSave").addEventListener("click", async () => {
    await apiPost(`/api/prompts/${NOS.campaign}/${encodeURIComponent(activeKey)}`, {
      enabled: $("promptItemEnabled").checked,
      text: $("promptItemText").value,
    });
    showBanner("프롬프트 항목이 저장되었습니다.");
    loadSettingsTab();
  });
  $("promptItemReset").addEventListener("click", async () => {
    await apiPost(`/api/prompts/${NOS.campaign}/${encodeURIComponent(activeKey)}`, { reset: true });
    showBanner("기본 프롬프트로 되돌렸습니다.");
    loadSettingsTab();
  });
}
async function loadSettingsTab() {
  const box = $("settingsBody");
  box.innerHTML = `<div class="muted">불러오는 중…</div>`;
  const state = await api("/api/state/" + NOS.campaign);
  NOS.settingsCache = state.settings;
  const dna = state.narrative_dna || {};
  const reg = state.custom_registry || {};
  const intensityNotes = (state.settings && state.settings.content_intensity_notes) || (reg.intensity_guides || {});
  const promptOverrides = state.prompt_overrides || {};
  const sliders = DNA_KEYS.map((k) => `
    <div class="dna-row"><label>${DNA_LABEL[k]}</label>
      <input type="range" min="1" max="5" step="1" value="${dna[k] || 3}" data-dna="${k}" />
      <span class="dna-val">${dna[k] || 3}</span></div>`).join("");
  const rules = (state.house_rules || []).map((r, i) => `
    <div class="hr-row"><input class="hr-input" data-i="${i}" value="${escapeHtml(r)}" /><button class="hr-del" data-i="${i}">✕</button></div>`).join("");

  const [notesData, playstats, autosaveSlots, snapData, promptData, arcsData, canonData] = await Promise.all([
    api("/api/notes/" + NOS.campaign), api("/api/playstats/" + NOS.campaign), api("/api/autosave/" + NOS.campaign),
    api("/api/snapshots/" + NOS.campaign), api("/api/prompts/" + NOS.campaign),
    // Phase 2 커스터마이징 카드용 read-model (실패해도 설정 탭은 뜨도록 방어).
    api("/api/story-arcs/" + NOS.campaign).catch(() => ({})),
    api("/api/canon/" + NOS.campaign).catch(() => ({ entities: [] })),
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

    <div class="content-card"><h3>📥 외부에서 가져오기</h3>
      <p class="muted">Notion 페이지 링크 또는 <b>.md/.txt 파일(여러 개)</b>에서 캐릭터·세계·세력·아크·모티프를 가져와 이 캠페인에 등록합니다. AI가 자동 분류하고, 리뷰·편집 후 확정되며 정식 검증(Kernel/Registry)을 거칩니다. Notion 토큰은 설정 › Notion 연동에서 등록하세요(없어도 mock 흐름 확인 가능).</p>
      <button id="notionImportOpen">📥 Notion에서 가져오기</button>
      <button id="fileImportOpen">📄 파일에서 가져오기 (.md/.txt)</button></div>

    <div class="content-card"><h3>Narrative DNA 재조정</h3>
      <p class="muted">변경하면 다음 턴부터 이야기의 결이 서서히 달라집니다.</p>${sliders}
      <button id="dnaSave" class="primary">DNA 적용</button></div>

    <div class="content-card"><h3>플레이 설정</h3>
      <label class="set-row"><input type="checkbox" id="setChoices" ${state.settings.choices_ui ? "checked" : ""}/> 선택지 버튼 표시 (기본 꺼짐 — 자유 서술 우선)</label>
      <label class="set-row"><input type="checkbox" id="setAgencyLock" ${state.settings.player_agency_lock !== false ? "checked" : ""}/> 플레이어 캐릭터 행동은 항상 플레이어가 결정 (기본 켜짐)</label>
      <p class="muted">켜면 AI는 상황과 NPC 반응까지만 서술하고, 당신 캐릭터의 행동·대사·선택은 당신 입력을 기다립니다. 끄면 시간 스킵 등에서 AI가 당신 캐릭터의 사소한 반응까지 서술할 수 있습니다. (NPC 행동에는 영향 없음)</p>
      <label class="set-row"><input type="checkbox" id="setCalm" ${state.settings.calm_mode ? "checked" : ""}/> 잔잔한 관계 중심 모드 (기본 꺼짐)</label>
      <p class="muted">켜면 AI가 억지로 갈등·돌발 사건을 만들거나 NPC가 먼저 들이대지 않습니다. 세계 사건 생성·NPC 선제 연락이 멈추고, 관계·연애의 흐름에 집중합니다. 사건이 필요하면 직접 요청하거나 '사건 필요해' 버튼을 쓰면 됩니다.</p>
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
        </select></div>
      <div class="wz-grid2">
        <div class="wz-field"><label>낮은 수위 묘사</label><textarea id="intLow" rows="3">${escapeHtml(intensityNotes.low || "")}</textarea></div>
        <div class="wz-field"><label>보통 수위 묘사</label><textarea id="intMedium" rows="3">${escapeHtml(intensityNotes.medium || "")}</textarea></div>
        <div class="wz-field"><label>높은 수위 묘사</label><textarea id="intHigh" rows="3">${escapeHtml(intensityNotes.high || "")}</textarea></div>
      </div>
      <button id="intensityNoteSave">수위 묘사 저장</button></div>

    <div class="content-card"><h3>Custom Dimension Registry</h3>
      <p class="muted">감정, 내면 변수, 주제, 장면 타입을 이 캠페인만의 어휘로 확장합니다. 숨김은 삭제가 아니라 비활성화라 기존 기억이 깨지지 않습니다.</p>
      <div class="wz-grid2">
        <div class="wz-field"><label>종류</label><select id="regKind"><option value="dimension">내면 변수</option><option value="emotion">감정 어휘</option><option value="theme">주제</option><option value="scene">장면 타입</option></select></div>
        <div class="wz-field"><label>이름</label><input id="regLabel" placeholder="예: 고향에 대한 그리움" /></div>
        <div class="wz-field"><label>ID <small>(비워도 자동)</small></label><input id="regId" placeholder="homesickness" /></div>
        <div class="wz-field"><label>설명/톤</label><input id="regDesc" placeholder="이 항목이 서사에서 어떤 결로 드러나는지" /></div>
      </div>
      <div class="wz-grid2" id="regHiddenFields">
        <div class="wz-field"><label>기본값 0~1</label><input id="regDefault" type="number" min="0" max="1" step="0.05" value="0.5" /></div>
        <div class="wz-field"><label>높을 때 묘사 지시</label><input id="regHigh" placeholder="높을 때 자연스럽게 반영할 경향" /></div>
        <div class="wz-field"><label>낮을 때 묘사 지시</label><input id="regLow" placeholder="낮을 때 자연스럽게 반영할 경향" /></div>
      </div>
      <button id="regAdd" class="primary">Registry 항목 추가</button>
      <div class="section-h">내면 변수</div>${registryRows(reg.dimensions, "dimension")}
      <div class="section-h">감정 어휘</div>${registryRows(reg.emotion_vocab, "emotion")}
      <div class="section-h">주제</div>${registryRows(reg.themes, "theme")}
      <div class="section-h">장면 타입</div>${registryRows(reg.scene_types, "scene")}</div>

    ${renderPromptSettingsCard(promptData)}

    <div class="content-card hidden"><h3>Gemini Prompt Editor</h3>
      <p class="muted">여기 적은 내용은 다음 턴부터 실제 Gemini 호출 프롬프트에 추가됩니다. 기본 시스템 원칙과 JSON 스키마를 깨는 지시는 무시될 수 있습니다.</p>
      <label class="set-row"><input type="checkbox" id="promptOverrideEnabled" ${promptOverrides.enabled ? "checked" : ""}/> 캠페인별 추가 프롬프트 사용</label>
      <div class="wz-field"><label>서사 생성용 추가 프롬프트</label>
        <textarea id="promptSystemAdd" rows="8" placeholder="예: 모든 장면은 2인칭 체험형 소설 문체로, UI/게임 용어 없이 쓴다.">${escapeHtml(promptOverrides.system_addendum || "")}</textarea></div>
      <div class="wz-field"><label>후처리 JSON 추출용 추가 프롬프트</label>
        <textarea id="promptExtractAdd" rows="6" placeholder="예: 관계 변화는 명확한 행동 변화가 있을 때만 기록한다.">${escapeHtml(promptOverrides.extraction_addendum || "")}</textarea></div>
      <div class="modal-actions">
        <button id="promptOverrideSave" class="primary">프롬프트 저장</button>
        <button id="promptLastView">마지막 실제 프롬프트 보기</button>
      </div></div>

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

  // Phase 1 — 평면 카드 목록을 카테고리 서브탭으로 재배치 + Phase 2 신규 카드 삽입.
  groupSettingsCards(box, { settings: state.settings || {}, arcs: arcsData || {}, canon: canonData || {} });
  wireSettingsCustom(box, { settings: state.settings || {}, arcs: arcsData || {}, canon: canonData || {} });

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
  // 잔잔한 관계 중심 모드 (story-affecting → GM 프롬프트 + 세계/ NPC 시뮬레이션에 반영).
  $("setCalm").addEventListener("change", async (e) => {
    await apiPost(`/api/state/${NOS.campaign}/settings`, { settings: { calm_mode: e.target.checked } });
    NOS.settingsCache.calm_mode = e.target.checked;
    showBanner(e.target.checked ? "잔잔한 관계 중심 모드 켜짐 — 억지 사건·NPC 선제 연락이 멈춥니다." : "잔잔한 관계 중심 모드 꺼짐 — 세계가 다시 능동적으로 움직입니다.");
  });
  $("setIntensity").addEventListener("change", async (e) => {
    await apiPost(`/api/state/${NOS.campaign}/settings`, { settings: { content_intensity: e.target.value } });
  });
  $("setLength").addEventListener("change", async (e) => {
    await apiPost(`/api/state/${NOS.campaign}/settings`, { settings: { response_length: e.target.value } });
  });
  $("intensityNoteSave").addEventListener("click", async () => {
    await apiPost(`/api/state/${NOS.campaign}/settings`, { settings: { content_intensity_notes: { low: $("intLow").value, medium: $("intMedium").value, high: $("intHigh").value } } });
    showBanner("수위 묘사 문장을 저장했습니다.");
  });
  const syncRegFields = () => $("regHiddenFields").classList.toggle("hidden", $("regKind").value !== "dimension");
  $("regKind").addEventListener("change", syncRegFields);
  syncRegFields();
  $("regAdd").addEventListener("click", async () => {
    const kind = $("regKind").value;
    const item = {
      id: $("regId").value.trim(),
      label: $("regLabel").value.trim(),
      description: $("regDesc").value.trim(),
      tone_notes: $("regDesc").value.trim(),
    };
    if (!item.label) return showBanner("이름을 먼저 적어주세요.");
    if (kind === "dimension") {
      item.kind = "hidden";
      item.default_value = Number($("regDefault").value);
      item.high_directive = $("regHigh").value.trim();
      item.low_directive = $("regLow").value.trim();
    }
    await apiPost(`/api/registry/${NOS.campaign}/${kind}`, item);
    showBanner("Registry 항목을 저장했습니다.");
    loadSettingsTab();
  });
  box.querySelectorAll(".reg-archive").forEach((b) =>
    b.addEventListener("click", async () => {
      await apiPost(`/api/registry/${NOS.campaign}/${b.dataset.kind}/${b.dataset.id}/archive`, { archived: b.textContent !== "되살리기" });
      loadSettingsTab();
    }));
  wirePromptSettings(promptData);
  $("promptOverrideSave").addEventListener("click", async () => {
    await apiPost(`/api/state/${NOS.campaign}/settings`, {
      prompt_overrides: {
        enabled: $("promptOverrideEnabled").checked,
        system_addendum: $("promptSystemAdd").value,
        extraction_addendum: $("promptExtractAdd").value,
      },
    });
    showBanner("Gemini 추가 프롬프트가 저장되었습니다. 다음 턴부터 반영됩니다.");
  });
  $("promptLastView").addEventListener("click", async () => {
    const fresh = await api("/api/state/" + NOS.campaign);
    const lp = fresh.last_prompt || {};
    openModal(`<h3>마지막 실제 프롬프트</h3>
      <p class="muted">마지막 턴에 Gemini로 전달된 프롬프트입니다. 아직 턴을 진행하지 않았다면 비어 있을 수 있습니다.</p>
      <div class="wz-field"><label>서사 생성 system prompt</label><textarea rows="12" readonly>${escapeHtml(lp.system_prompt || "(아직 없음)")}</textarea></div>
      <div class="wz-field"><label>후처리 추출 system prompt</label><textarea rows="10" readonly>${escapeHtml(lp.extraction_prompt || "(아직 없음)")}</textarea></div>
      <div class="wz-field"><label>player input</label><textarea rows="3" readonly>${escapeHtml(lp.player_input || "")}</textarea></div>
      <div class="modal-actions"><button onclick="closeModal()">닫기</button></div>`);
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
  $("notionImportOpen").addEventListener("click", () => openNotionImport({ campaignId: NOS.campaign, onDone: () => loadSettingsTab() }));
  $("fileImportOpen").addEventListener("click", () => openFileImport({ campaignId: NOS.campaign, onDone: () => loadSettingsTab() }));
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

// ==========================================================================
// Settings tab — Phase 1 category subtabs + Phase 2 customization cards.
// The flat card list rendered by loadSettingsTab is kept intact; here we move
// those cards into category groups (by their fixed render index) and inject the
// new customization cards. All new game-like toggles default OFF (pure-narrative
// first) to match the engine defaults.
// ==========================================================================
const SETTINGS_SUBTABS = [
  ["basic", "기본"], ["tone", "서사 톤"], ["world", "세계·진행"],
  ["game", "게임 요소"], ["prompt", "프롬프트·어휘"], ["tools", "기록·도구"],
];
const SETTINGS_INTRO = {
  basic: "캠페인 이름과 아이콘, 외부 자료 가져오기, 백업·세계관 템플릿.",
  tone: "이야기의 결을 정하는 설정 — 다음 턴부터 서서히 반영됩니다.",
  world: "세계가 스스로 움직이는 속도(자율 진행 주기)와 토큰 절약.",
  game: "TRPG·게임적 요소. 기본은 모두 꺼진 순수 서사 — 원하는 것만 켜세요.",
  prompt: "AI에 실제로 들어가는 프롬프트와 이 캠페인만의 어휘를 직접 편집합니다.",
  tools: "메모·목표·하이라이트와 되돌리기, 개발자용 Advanced 패널.",
};
// index → group, matching the fixed flat render order in loadSettingsTab.
const SETTINGS_CARD_GROUPS = [
  "basic", "basic", "tone", "tone", "prompt", "prompt", "prompt", "tone",
  "tools", "tools", "tools", "tools", "tools", "tools", "world", "basic",
  "basic", "tools", "basic", // 마지막(런처 설정 안내)은 기본 탭에서 바로 보이도록 basic.
];
const STATUS_WINDOW_LABEL = { off: "끄기(순수 서사)", litrpg: "LitRPG 상태창", minimal: "최소" };
const CANON_LEVEL_LABEL = { core: "핵심(보호)", campaign: "캠페인(기본)", speculative: "잠정" };
const TRICK_KIND_LABEL = {
  unreliable_narrator: "신뢰할 수 없는 화자", planted_reversal: "복선 반전",
  concealed_identity: "정체 은폐", faked_death: "거짓 죽음", misdirection: "오도",
};

function groupSettingsCards(box, ctx) {
  const cards = [...box.querySelectorAll(":scope > .content-card")];
  const nav = document.createElement("nav");
  nav.className = "subtabs set-subtabs";
  nav.id = "setSubtabs";
  nav.innerHTML = SETTINGS_SUBTABS.map(([g, label], i) =>
    `<button class="stab ${i === 0 ? "active" : ""}" data-sgroup="${g}">${label}</button>`).join("");
  const groups = {};
  const wrap = document.createDocumentFragment();
  SETTINGS_SUBTABS.forEach(([g], i) => {
    const div = document.createElement("div");
    div.className = "set-group" + (i === 0 ? " active" : "");
    div.dataset.sgroup = g;
    div.innerHTML = `<p class="set-group-intro">${SETTINGS_INTRO[g]}</p>`;
    groups[g] = div;
    wrap.appendChild(div);
  });
  cards.forEach((card, i) => groups[SETTINGS_CARD_GROUPS[i] || "tools"].appendChild(card));
  // Phase 2 — inject new cards. World autonomy periods go above 저토큰 모드.
  const lowTokenCard = groups.world.querySelector(".content-card");
  if (lowTokenCard) lowTokenCard.insertAdjacentHTML("beforebegin", worldPeriodsCardHtml(ctx.settings));
  else groups.world.insertAdjacentHTML("beforeend", worldPeriodsCardHtml(ctx.settings));
  groups.game.insertAdjacentHTML("beforeend", gameCustomCardsHtml(ctx));
  box.appendChild(nav);
  box.appendChild(wrap);
  nav.querySelectorAll(".stab").forEach((b) => b.addEventListener("click", () => {
    nav.querySelectorAll(".stab").forEach((x) => x.classList.toggle("active", x === b));
    box.querySelectorAll(".set-group").forEach((g) => g.classList.toggle("active", g.dataset.sgroup === b.dataset.sgroup));
  }));
}

function worldPeriodsCardHtml(s) {
  s = s || {};
  const f = (k, d) => Number(s[k] != null ? s[k] : d);
  const rows = [
    ["world_event_period", "세계 사건", 15], ["place_tick_period", "장소 변화", 12],
    ["npc_goal_period", "NPC 목표 진행", 8], ["news_period", "세계 뉴스", 6],
    ["wanted_tick_period", "수배/추적", 10], ["living_object_period", "살아있는 사물", 14],
    ["living_npc_period", "NPC 자율 생활", 100], ["resonance_period", "공명/회상", 30],
  ];
  return `<div class="content-card"><h3>세계 자율 진행 주기</h3>
    <p class="muted">숫자가 작을수록 세계가 자주 스스로 움직입니다(턴 단위). '잔잔한 관계 중심 모드'가 켜져 있으면 이 자율 진행들은 멈추거나 최소화됩니다.</p>
    <div class="wz-row" style="gap:6px;flex-wrap:wrap">
      <button class="period-preset" data-preset="calm">잔잔하게</button>
      <button class="period-preset" data-preset="normal">보통</button>
      <button class="period-preset" data-preset="lively">역동적으로</button></div>
    <div class="period-grid">${rows.map(([k, label, d]) =>
      `<div class="set-row"><span>${label}</span><input type="number" min="1" max="500" data-period="${k}" value="${f(k, d)}" style="width:80px"/></div>`).join("")}</div>
    <button id="periodSave" class="primary">주기 저장</button></div>`;
}

function storyArcViewHtml(arcs) {
  arcs = arcs || {};
  const list = arcs.narrative_arcs || [], motifs = arcs.motifs || [], echoes = arcs.echoes || [];
  const arcRows = list.length ? list.map((a) => {
    const hits = (a.milestones_hit || []).map((m) => `<li>${escapeHtml(m.label)}</li>`).join("");
    return `<div class="arc-item"><b>${escapeHtml(a.title || a.goal || "")}</b> <small class="muted">${escapeHtml(a.status || "")} · ${Math.round((a.progress || 0) * 100)}%</small>
      ${a.goal && a.goal !== a.title ? `<div class="muted">${escapeHtml(a.goal)}</div>` : ""}
      ${(a.canon_names || []).length ? `<div class="muted">관련: ${a.canon_names.map(escapeHtml).join(", ")}</div>` : ""}
      ${hits ? `<ul class="arc-milestones">${hits}</ul>` : ""}</div>`;
  }).join("") : `<span class="muted">진행 중인 성장 아크가 없습니다.</span>`;
  const motifRow = motifs.length ? `<div class="section-h">반복 모티프</div>` + motifs.slice(0, 12).map((m) => `<span class="tag">${escapeHtml(m.label || m.name || m.phrase || "")}${m.occurrences ? ` ×${m.occurrences}` : ""}</span>`).join(" ") : "";
  const echoRow = echoes.length ? `<div class="section-h">잔향 (떠난 이들)</div>` + echoes.map((e) => `<span class="tag">${escapeHtml(e.name)}</span>`).join(" ") : "";
  return `<div class="content-card"><h3>스토리 아크 <small class="muted">(읽기 전용)</small></h3>
    <p class="muted">여러 턴에 걸친 성장 목표와 그 이정표, 반복 모티프를 한눈에 봅니다.</p>
    ${arcRows}${motifRow}${echoRow}</div>`;
}

function gameCustomCardsHtml(ctx) {
  const s = ctx.settings || {}, arcs = ctx.arcs || {};
  const entities = (ctx.canon && ctx.canon.entities) || [];
  const chars = entities.filter((e) => e.type === "Character");
  const swMode = s.status_window_mode || "off";
  const fp = s.fixed_protagonist || { enabled: false };
  const metaStrict = !!s.meta_knowledge_strict;
  const softGoals = arcs.soft_goals || [], dicePools = arcs.dice_pools || [], tricks = arcs.narrative_tricks || [];

  const statusCard = `<div class="content-card"><h3>상태창 모드</h3>
    <p class="muted">기본은 <b>끄기</b>(순수 서사, 수치 비노출). LitRPG/최소 모드를 켜면 지정된 수치를 상태창처럼 노출합니다.</p>
    <div class="set-row"><span>표시 방식</span>
      <select id="setStatusWindow">${Object.entries(STATUS_WINDOW_LABEL).map(([v, l]) => `<option value="${v}" ${swMode === v ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>`;

  const poolRows = dicePools.length ? dicePools.map((p) => `
    <div class="rep-row"><span>${escapeHtml(p.name)} <small class="muted">${p.count}d${p.faces}${p.modifier ? (p.modifier > 0 ? "+" + p.modifier : p.modifier) : ""} · DC ${p.dc}</small></span>
      <span><button class="pool-roll" data-id="${escapeHtml(p.pool_id)}">굴리기</button> <button class="pool-del" data-id="${escapeHtml(p.pool_id)}">삭제</button></span></div>`).join("") : `<span class="muted">정의된 주사위 풀이 없습니다.</span>`;
  const diceCard = `<div class="content-card"><h3>주사위 풀 (이름있는 판정)</h3>
    <p class="muted">여러 개의 이름있는 주사위를 정의해 명시적으로 굴립니다. 서사에는 결과(성공/부분/실패)만 반영되고 원시 수치는 노출되지 않습니다.</p>
    <div class="wz-grid2">
      <div class="wz-field"><label>이름</label><input id="poolName" placeholder="예: 마력"/></div>
      <div class="wz-field"><label>주사위 수 (1~20)</label><input id="poolCount" type="number" min="1" max="20" value="1"/></div>
      <div class="wz-field"><label>면 수 (2~100)</label><input id="poolFaces" type="number" min="2" max="100" value="6"/></div>
      <div class="wz-field"><label>보정치</label><input id="poolMod" type="number" value="0"/></div>
      <div class="wz-field"><label>난이도 DC</label><input id="poolDc" type="number" value="12"/></div></div>
    <button id="poolDefine" class="primary">풀 정의/수정</button>
    <div id="poolRollResult" class="muted" style="margin-top:6px"></div>
    <div class="section-h">정의된 풀</div>${poolRows}</div>`;

  const goalRows = softGoals.length ? softGoals.map((g) => `
    <div class="rep-row"><label style="display:flex;gap:8px;align-items:center;margin:0">
      <input type="checkbox" class="sg-toggle" data-id="${escapeHtml(g.goal_id)}" ${g.done ? "checked" : ""}/>
      <span style="${g.done ? "text-decoration:line-through;opacity:.6" : ""}">${escapeHtml(g.text)}</span></label>
      <button class="sg-del" data-id="${escapeHtml(g.goal_id)}">삭제</button></div>`).join("") : `<span class="muted">아직 목표가 없습니다.</span>`;
  const softCard = `<div class="content-card"><h3>소프트 목표 체크리스트</h3>
    <p class="muted">강제되지 않는 느슨한 목표입니다. 이야기가 자연스럽게 흐르도록 방향만 잡아둡니다.</p>
    <div class="wz-row"><input id="sgInput" placeholder="예: 리아의 과거를 알아내기"/><button id="sgAdd">추가</button></div>
    <div style="margin-top:8px">${goalRows}</div></div>`;

  const fpCard = `<div class="content-card"><h3>고정 주인공 (IP 캠페인)</h3>
    <p class="muted">특정 캐논 캐릭터를 플레이어 주인공으로 고정합니다. 기본 꺼짐.</p>
    <label class="set-row"><input type="checkbox" id="fpEnabled" ${fp.enabled ? "checked" : ""}/> 고정 주인공 사용</label>
    <div class="set-row"><span>주인공 캐릭터</span>
      <select id="fpCanon" ${fp.enabled ? "" : "disabled"}><option value="">— 선택 —</option>${chars.map((c) => `<option value="${escapeHtml(c.canon_id)}" ${fp.canon_ref === c.canon_id ? "selected" : ""}>${escapeHtml((c.data && c.data.birth_name) || c.canon_id)}</option>`).join("")}</select></div></div>`;

  const metaCard = `<div class="content-card"><h3>메타지식 엄격 모드</h3>
    <p class="muted">캐릭터가 원작·미래 지식을 아는 것처럼 행동하지 못하게 엄격히 제한합니다. 기본 꺼짐.</p>
    <label class="set-row"><input type="checkbox" id="metaStrict" ${metaStrict ? "checked" : ""}/> 메타지식 엄격 모드</label></div>`;

  const trickRows = tricks.length ? tricks.map((t) => `<div class="rep-row"><span>${escapeHtml(TRICK_KIND_LABEL[t.kind] || t.kind)} <small class="muted">${escapeHtml(t.description || "")}</small></span></div>`).join("") : `<span class="muted">등록된 서술 트릭이 없습니다.</span>`;
  const trickCard = `<div class="content-card"><h3>서술 트릭 사전 등록 <small class="muted">(고급)</small></h3>
    <p class="muted">신뢰할 수 없는 화자·거짓 죽음 같은 의도된 서술 장치를 <b>미리</b> 등록하면, 무결성 감시(Watchdog)가 이를 모순이 아닌 의도로 취급합니다.</p>
    <div class="wz-grid2">
      <div class="wz-field"><label>종류</label><select id="trickKind">${Object.entries(TRICK_KIND_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
      <div class="wz-field"><label>설명</label><input id="trickDesc" placeholder="어떤 장치인지 간단히"/></div></div>
    <button id="trickAdd" class="primary">트릭 등록</button>
    <div class="section-h">등록된 트릭</div>${trickRows}</div>`;

  const clRows = entities.length ? entities.map((e) => `<div class="rep-row"><span>${escapeHtml((e.data && e.data.birth_name) || e.canon_id)} <small class="muted">${escapeHtml(e.type || "")}</small></span>
    <select class="cl-select" data-id="${escapeHtml(e.canon_id)}">${Object.entries(CANON_LEVEL_LABEL).map(([v, l]) => `<option value="${v}" ${(e.canon_level || "campaign") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>`).join("") : `<span class="muted">캐논 항목이 없습니다.</span>`;
  const clCard = `<div class="content-card"><h3>Canon Level <small class="muted">(고급)</small></h3>
    <p class="muted">사실의 보호 등급입니다. <b>핵심</b>으로 올리면 모순 시 높은 심각도로 처리됩니다. 기본은 캠페인.</p>
    ${clRows}</div>`;

  return statusCard + diceCard + softCard + fpCard + metaCard + trickCard + clCard + storyArcViewHtml(arcs);
}

function wireSettingsCustom(box, ctx) {
  const cid = NOS.campaign;
  const PERIOD_PRESETS = {
    calm: { world_event_period: 40, place_tick_period: 30, npc_goal_period: 20, news_period: 16, wanted_tick_period: 24, living_object_period: 30, living_npc_period: 150, resonance_period: 60 },
    normal: { world_event_period: 15, place_tick_period: 12, npc_goal_period: 8, news_period: 6, wanted_tick_period: 10, living_object_period: 14, living_npc_period: 100, resonance_period: 30 },
    lively: { world_event_period: 8, place_tick_period: 6, npc_goal_period: 4, news_period: 3, wanted_tick_period: 5, living_object_period: 7, living_npc_period: 50, resonance_period: 15 },
  };
  box.querySelectorAll(".period-preset").forEach((b) => b.addEventListener("click", () => {
    const preset = PERIOD_PRESETS[b.dataset.preset] || {};
    box.querySelectorAll("[data-period]").forEach((inp) => { if (preset[inp.dataset.period] != null) inp.value = preset[inp.dataset.period]; });
  }));
  if ($("periodSave")) $("periodSave").addEventListener("click", async () => {
    const settings = {};
    box.querySelectorAll("[data-period]").forEach((inp) => { const n = Number(inp.value); if (Number.isFinite(n) && n >= 1) settings[inp.dataset.period] = n; });
    await apiPost(`/api/state/${cid}/settings`, { settings });
    showBanner("세계 자율 진행 주기를 저장했습니다.");
  });

  if ($("setStatusWindow")) $("setStatusWindow").addEventListener("change", async (e) => {
    try { await apiPost(`/api/state/${cid}/status-window-mode`, { mode: e.target.value }); showBanner("상태창 모드를 변경했습니다."); }
    catch (err) { showBanner("변경 실패: " + err.message); }
  });

  if ($("metaStrict")) $("metaStrict").addEventListener("change", async (e) => {
    await apiPost(`/api/state/${cid}/meta-knowledge-strict`, { enabled: e.target.checked });
    showBanner(e.target.checked ? "메타지식 엄격 모드 켜짐." : "메타지식 엄격 모드 꺼짐.");
  });

  const fpSave = async () => {
    const enabled = $("fpEnabled").checked;
    const canon_ref = $("fpCanon").value || null;
    $("fpCanon").disabled = !enabled;
    try { await apiPost(`/api/state/${cid}/fixed-protagonist`, { enabled, canon_ref }); showBanner(enabled ? "고정 주인공을 설정했습니다." : "고정 주인공을 해제했습니다."); }
    catch (err) { showBanner("설정 실패: " + err.message); }
  };
  if ($("fpEnabled")) $("fpEnabled").addEventListener("change", fpSave);
  if ($("fpCanon")) $("fpCanon").addEventListener("change", () => { if ($("fpEnabled").checked) fpSave(); });

  if ($("sgAdd")) $("sgAdd").addEventListener("click", async () => {
    const text = $("sgInput").value.trim(); if (!text) return;
    await apiPost(`/api/soft-goals/${cid}`, { action: "add", text }); loadSettingsTab();
  });
  box.querySelectorAll(".sg-toggle").forEach((b) => b.addEventListener("change", async () => {
    await apiPost(`/api/soft-goals/${cid}`, { action: "toggle", goal_id: b.dataset.id, done: b.checked });
  }));
  box.querySelectorAll(".sg-del").forEach((b) => b.addEventListener("click", async () => {
    await apiPost(`/api/soft-goals/${cid}`, { action: "remove", goal_id: b.dataset.id }); loadSettingsTab();
  }));

  if ($("poolDefine")) $("poolDefine").addEventListener("click", async () => {
    const body = { action: "define", name: $("poolName").value.trim(), faces: Number($("poolFaces").value), count: Number($("poolCount").value), modifier: Number($("poolMod").value) || 0, dc: Number($("poolDc").value) };
    try { await apiPost(`/api/dice-pools/${cid}`, body); showBanner("주사위 풀을 저장했습니다."); loadSettingsTab(); }
    catch (err) { showBanner("저장 실패: " + err.message); }
  });
  box.querySelectorAll(".pool-roll").forEach((b) => b.addEventListener("click", async () => {
    try {
      const r = await apiPost(`/api/dice-pools/${cid}`, { action: "roll", pool_id: b.dataset.id });
      const OUT = { success: "성공", partial: "부분 성공", fail: "실패" };
      $("poolRollResult").textContent = `${r.name}: ${(r.dice || []).join(", ")} → 합 ${r.total} (DC ${r.dc}) · ${OUT[r.outcome] || r.outcome}`;
    } catch (err) { $("poolRollResult").textContent = "굴리기 실패: " + err.message; }
  }));
  box.querySelectorAll(".pool-del").forEach((b) => b.addEventListener("click", async () => {
    await apiPost(`/api/dice-pools/${cid}`, { action: "remove", pool_id: b.dataset.id }); loadSettingsTab();
  }));

  if ($("trickAdd")) $("trickAdd").addEventListener("click", async () => {
    try { await apiPost(`/api/campaign/${cid}/narrative-trick`, { kind: $("trickKind").value, description: $("trickDesc").value.trim() }); showBanner("서술 트릭을 등록했습니다."); loadSettingsTab(); }
    catch (err) { showBanner("등록 실패: " + err.message); }
  });

  box.querySelectorAll(".cl-select").forEach((sel) => sel.addEventListener("change", async () => {
    try { await apiPost(`/api/canon/${cid}/level`, { canon_id: sel.dataset.id, level: sel.value }); showBanner("Canon Level을 변경했습니다."); }
    catch (err) { showBanner("변경 실패: " + err.message); }
  }));
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
  const fontFamily = localStorage.getItem("nos_font_family") || "system";
  const fxMode = localStorage.getItem("nos_fx") || "standard";
  const layoutMode = localStorage.getItem("nos_layout_mode") || "desktop";
  document.body.style.fontSize = (localStorage.getItem("nos_font") || "14") + "px";
  document.body.classList.toggle("colorblind", localStorage.getItem("nos_colorblind") === "1");
  document.body.classList.toggle("theme-light", theme === "light");
  document.body.classList.toggle("theme-midnight", theme === "midnight");
  document.body.classList.toggle("theme-parchment", theme === "parchment");
  document.body.classList.toggle("theme-aurora", theme === "aurora");
  document.body.classList.toggle("theme-forest", theme === "forest");
  document.body.classList.toggle("theme-ember", theme === "ember");
  document.body.classList.toggle("theme-noir", theme === "noir");
  document.body.classList.toggle("theme-mono", theme === "mono");
  document.body.classList.toggle("theme-plain", theme === "plain");
  document.body.classList.toggle("chat-novel", localStorage.getItem("nos_chat_style") === "novel");
  document.body.classList.toggle("low-spec", localStorage.getItem("nos_low_spec") === "1");
  [
    "font-serif", "font-mono", "font-noto-sans", "font-nanum-gothic", "font-ibm",
    "font-gowun-dodum", "font-hahmlet", "font-nanum-myeongjo", "font-gowun-batang",
    "font-song", "font-dohyeon", "font-jua", "font-black-han", "font-orbit",
    "font-noto-serif", "font-nanum-pen", "font-east-sea", "font-yeon-sung",
    "font-single-day", "font-poor-story",
  ].forEach((c) => document.body.classList.remove(c));
  const fontClass = {
    serif: "font-serif",
    mono: "font-mono",
    "noto-sans": "font-noto-sans",
    "nanum-gothic": "font-nanum-gothic",
    ibm: "font-ibm",
    "gowun-dodum": "font-gowun-dodum",
    hahmlet: "font-hahmlet",
    "nanum-myeongjo": "font-nanum-myeongjo",
    "noto-serif": "font-noto-serif",
    "gowun-batang": "font-gowun-batang",
    song: "font-song",
    dohyeon: "font-dohyeon",
    jua: "font-jua",
    "black-han": "font-black-han",
    orbit: "font-orbit",
    "nanum-pen": "font-nanum-pen",
    "east-sea": "font-east-sea",
    "yeon-sung": "font-yeon-sung",
    "single-day": "font-single-day",
    "poor-story": "font-poor-story",
  }[fontFamily];
  if (fontClass) document.body.classList.add(fontClass);
  document.body.classList.toggle("fx-rich", fxMode === "rich");
  document.body.classList.toggle("fx-quiet", fxMode === "quiet");
  document.body.classList.toggle("fx-none", fxMode === "none");
  document.body.classList.toggle("reduce-motion", localStorage.getItem("nos_reduce_motion") === "1");
  document.body.classList.toggle("layout-mobile", layoutMode === "mobile");
  document.body.classList.toggle("layout-desktop", layoutMode !== "mobile");
  updateLayoutToggle();
  // Phase 15 BB — reapply a saved custom theme's CSS variable tokens.
  try { const saved = localStorage.getItem("nos_custom_theme"); if (saved) applyThemeTokens(JSON.parse(saved)); } catch (_) {}
}

function updateLayoutToggle() {
  const b = $("layoutToggle");
  const mode = localStorage.getItem("nos_layout_mode") || "desktop";
  if (!b) return;
  b.textContent = mode === "mobile" ? "Mobile" : "Desktop";
  b.classList.toggle("active", mode === "mobile");
  b.title = mode === "mobile" ? "현재 Mobile UI · 클릭하면 Desktop UI" : "현재 Desktop UI · 클릭하면 Mobile UI";
}

function setLayoutMode(mode) {
  localStorage.setItem("nos_layout_mode", mode === "mobile" ? "mobile" : "desktop");
  applyAccessibility();
}

function toggleLayoutMode() {
  setLayoutMode((localStorage.getItem("nos_layout_mode") || "desktop") === "mobile" ? "desktop" : "mobile");
}

// Phase 15 BB — set validated CSS custom-property tokens on :root.
function applyThemeTokens(tokens) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens || {})) {
    if (typeof k === "string" && k.startsWith("--")) root.style.setProperty(k, v);
  }
}
