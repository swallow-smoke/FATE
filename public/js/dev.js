// Developer slide panel — ported from the pre-Phase5 sidebar. Fully separate
// from the player tabs; internal numbers live ONLY here.
"use strict";

// slide toggle
function wireDevPanel() {
  $("devToggle").addEventListener("click", () => {
    const sidebar = $("sidebar");
    sidebar.classList.toggle("collapsed");
    if (!sidebar.classList.contains("collapsed") && !isLowSpec() && window.gsap) {
      gsap.fromTo(sidebar, { x: 420, rotate: 1.6 }, { x: 0, rotate: 0, duration: 0.72, ease: "elastic.out(1, 0.72)", clearProps: "x,rotate" });
    }
  });
  document.querySelectorAll("#sidebar .tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll("#sidebar .tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll("#sidebar .panel").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      $("panel-" + t.dataset.tab).classList.add("active");
    });
  });
}

// ---------- emotion ----------
const EMO_LEVEL = {
  calm: 0, small_warmth: 1, warmth: 1, quiet_relief: 1, relief: 1, quiet_hope: 2, new_hope: 2, hope: 2,
  unease: 2, tension: 3, quiet_resolve: 3, resolve: 3, anger: 4, fear: 4, grief: 4, sadness: 4, despair: 5, dread: 4,
};
function emoLevel(e) { return EMO_LEVEL[e] != null ? EMO_LEVEL[e] : 2; }

function sparkline(history) {
  const h = (history || []).slice(-10);
  if (h.length < 2) return `<div class="muted">데이터가 쌓이면 감정 파동이 표시됩니다.</div>`;
  const W = 320, H = 90, pad = 10;
  const step = (W - pad * 2) / (h.length - 1);
  const y = (lvl) => H - pad - (lvl / 5) * (H - pad * 2);
  const pts = h.map((e, i) => `${pad + i * step},${y(emoLevel(e))}`).join(" ");
  const dots = h.map((e, i) => `<circle cx="${pad + i * step}" cy="${y(emoLevel(e))}" r="2.5" fill="#7aa2f7"><title>턴 -${h.length - 1 - i}: ${e}</title></circle>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="#7aa2f7" stroke-width="2"/>${dots}</svg>
    <div class="chart-caption">최근 ${h.length}턴 감정 파동 (위=고강도) · 마지막: ${escapeHtml(h[h.length - 1])}</div>`;
}

function resonanceRows(resonance) {
  const entries = Object.entries(resonance || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!entries.length) return `<div class="muted">아직 resonance_profile 데이터가 충분하지 않습니다.</div>`;
  return entries.map(([k, v]) => {
    const pct = Math.round(Number(v) * 100);
    return `<div class="row"><span class="name">${escapeHtml(k)}</span><div class="track"><div class="fill blue" style="width:${pct}%"></div></div><span>${pct}%</span></div>`;
  }).join("");
}

function renderEmotion(emo, resonance) {
  if (!emo) { $("panel-emotion").innerHTML = `<div class="muted">아직 턴이 진행되지 않았습니다.</div>`; return; }
  const inten = emo.intensity ?? 0;
  setEmotionalResonance(emo.primary_emotion || "calm", inten);
  const segs = [0, 1, 2, 3, 4, 5].map((i) => `<div class="seg ${i <= inten ? (inten >= 4 ? "hi" : "on") : ""}"></div>`).join("");
  const fatigue = emo.fatigue_tracker || {};
  const fatigueRows = Object.keys(fatigue).length
    ? Object.entries(fatigue).map(([k, v]) =>
        `<div class="row"><span class="name">${escapeHtml(k)}</span><div class="track"><div class="fill" style="width:${Math.min(100, v * 25)}%"></div></div><span>${v}</span></div>`).join("")
    : `<div class="muted">누적 없음</div>`;
  $("panel-emotion").innerHTML = `
    <div class="field"><h4>현재 감정 (primary)</h4><div class="big">${escapeHtml(emo.primary_emotion || "-")}</div></div>
    <div class="field"><h4>강도 (intensity) — ${inten}/5</h4><div class="gauge">${segs}</div></div>
    <div class="field"><h4>감정 피로 (fatigue tracker)</h4><div class="bars">${fatigueRows}</div></div>
    <div class="field"><h4>감정 파동</h4>${sparkline(emo.recent_history)}</div>
    <div class="field"><h4>Resonance Profile</h4><div class="bars">${resonanceRows(resonance)}</div></div>`;
}

// ---------- memory ----------
let showAllMemory = false;
function memCard(m) {
  const tags = (m.emotion_tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
  return `<div class="card"><div class="top"><span class="sum">${escapeHtml(m.summary || "")}</span>
    <span class="tier t${m.tier}">T${m.tier}</span></div><div>${tags}</div></div>`;
}
function renderMemoryThisTurn(list) {
  window._lastRetrieved = list || [];
  const box = $("panel-memory");
  const toggle = `<div class="toggle-row"><label><input type="checkbox" id="memAll" ${showAllMemory ? "checked" : ""}/> 전체 Memory DB 보기</label></div>`;
  if (showAllMemory) { box.innerHTML = toggle + `<div class="muted">불러오는 중…</div>`; wireMemToggle(); loadAllMemory(); return; }
  const items = (list || []).length ? list.map(memCard).join("") : `<div class="muted">이번 턴 인출된 기억 없음</div>`;
  box.innerHTML = toggle + `<div class="section-h">이번 턴 인출 (상위 ${(list || []).length})</div>` + items;
  wireMemToggle();
}
function wireMemToggle() {
  const c = $("memAll");
  if (c) c.onchange = () => { showAllMemory = c.checked; if (showAllMemory) loadAllMemory(); else renderMemoryThisTurn(window._lastRetrieved || []); };
}
async function loadAllMemory() {
  const d = await api("/api/memory/" + NOS.campaign);
  const box = $("panel-memory");
  const toggle = `<div class="toggle-row"><label><input type="checkbox" id="memAll" checked/> 전체 Memory DB 보기</label></div>`;
  const items = (d.memories || []).length ? d.memories.slice().reverse().map(memCard).join("") : `<div class="muted">기억 없음</div>`;
  box.innerHTML = toggle + `<div class="section-h">전체 Memory DB (${(d.memories || []).length})</div>` + items;
  wireMemToggle();
}

// ---------- canon / relationship ----------
async function refreshCanon() {
  const d = await api("/api/canon/" + NOS.campaign);
  const box = $("panel-canon");
  const relMap = {};
  (d.npcs || []).forEach((n) => { if (n.relationship_to_player) relMap[n.canon_ref] = n.relationship_to_player; });

  if (!(d.entities || []).length) { box.innerHTML = `<div class="muted">등록된 Canon 없음.</div>`; return; }
  const graphEdges = ((d.relationship_graph && d.relationship_graph.edges) || []);
  const graphHtml = graphEdges.length
    ? `<div class="section-h">NPC-NPC Relationship Graph</div>
      <div class="graph-list">${graphEdges.map((edge) => `
        <div class="graph-edge">
          <span class="node">${escapeHtml(edge.from)}</span><span class="arrow">→</span>
          <span class="node">${escapeHtml(edge.to)}</span>
          <span class="edge-type">${escapeHtml(edge.type || "relationship")}</span>
          <span class="edge-score">trust ${edge.trust ?? 0}</span>
          ${edge.affection != null ? `<span class="edge-score">affection ${edge.affection}</span>` : ""}
        </div>`).join("")}</div>`
    : `<div class="section-h">NPC-NPC Relationship Graph</div><div class="muted">등록된 NPC-NPC 관계 없음</div>`;

  const html = d.entities.map((e) => {
    const kv = (e.mutable_fields || []).map((f) =>
      `<div><span class="k">${escapeHtml(f)}:</span> ${escapeHtml(JSON.stringify(e.data[f] ?? "—"))}</div>`).join("");
    const rel = relMap[e.canon_id];
    const relHtml = rel ? `<div class="section-h">관계 (플레이어)</div>` +
      Object.entries(rel).filter(([k, v]) => typeof v === "number").map(([k, v]) =>
        `<div class="rel"><span class="n">${escapeHtml(k)}</span><span class="v">${v}</span></div>`).join("") : "";
    return `<div class="card entity"><div class="top"><div><span class="type">${e.type}</span><br><b>${escapeHtml(e.canon_id)}</b></div></div>
      <div class="kv">${kv || '<div class="muted">mutable 필드 없음</div>'}${relHtml}</div></div>`;
  }).join("");
  box.innerHTML = `<div class="muted" style="margin-bottom:10px">엔티티를 클릭하면 mutable 필드 값이 펼쳐집니다.</div>${graphHtml}${html}`;
  box.querySelectorAll(".entity").forEach((c) => c.addEventListener("click", () => c.classList.toggle("open")));
}

// ---------- trace ----------
function renderTrace(trace) {
  const box = $("panel-trace");
  if (!trace) { box.innerHTML = `<div class="muted">상단 "디버그" 체크박스를 켜면 이번 턴의 프롬프트·추출 결과가 여기 표시됩니다.</div>`; return; }
  const view = {
    scene_spec: trace.scene_spec,
    skill_check: trace.skill_check,
    ending_check: trace.ending_check,
    emotion_directive: trace.emotion_directive,
    story_directive: trace.story_directive,
    retrieved_memories: trace.retrieved_memories,
    canon_used: trace.canon_used,
    applied: trace.applied,
    extracted_facts: trace.extraction,
  };
  const debate = trace.debate
    ? `<div class="section-h">Director Debate 로그</div>
       <pre class="trace">${escapeHtml((trace.debate.log || []).join("\n"))}</pre>
       <div class="muted">${escapeHtml(trace.debate.reasoning_log || "")}</div>`
    : `<div class="section-h">Director Debate 로그</div><div class="muted">이번 턴 협의 없음</div>`;
  const reflection = trace.self_reflection
    ? `<div class="section-h">AI 자기평가</div><pre class="trace">${escapeHtml(JSON.stringify(trace.self_reflection, null, 2))}</pre>` : "";
  box.innerHTML = `${debate}${reflection}
    <div class="section-h">턴 트레이스</div><pre class="trace">${escapeHtml(JSON.stringify(view, null, 2))}</pre>
    <div class="section-h">조립된 시스템 프롬프트</div><pre class="trace">${escapeHtml(trace.system_prompt || "")}</pre>`;
}

// ---------- health ----------
function metricBar(label, value) {
  const display = value == null ? "N/A" : `${value}%`;
  const width = value == null ? 0 : Math.max(0, Math.min(100, value));
  return `<div class="metric">
    <div class="metric-top"><span>${escapeHtml(label)}</span><b>${display}</b></div>
    <div class="track"><div class="fill ${width >= 60 ? "green" : width >= 30 ? "blue" : "warn"}" style="width:${width}%"></div></div>
  </div>`;
}

function renderHealth(metrics, world, trace) {
  const box = $("panel-health");
  if (!box) return;
  const m = metrics || {};
  const worldInfo = world || {};
  const self = trace && trace.self_reflection;
  const resonance = trace && trace.resonance;
  const legacy = trace && trace.legacy_event;
  box.innerHTML = `
    <div class="muted" style="margin-bottom:10px">개발자/작가용 Campaign Health Dashboard입니다. 플레이어에게 노출하지 않습니다.</div>
    ${metricBar("감정 다양성", m.emotion_diversity_pct)}
    ${metricBar("복선 회수율", m.foreshadow_resolution_pct)}
    ${metricBar("NPC 활용도", m.npc_utilization_pct)}
    ${metricBar("세계 변화율", m.world_change_pct)}
    ${metricBar("선택 영향력", m.choice_impact_pct)}
    <div class="section-h">World / Quest Tick</div>
    <div class="card compact">
      <div><span class="k">generated_event:</span> ${escapeHtml(worldInfo.generated_event || "-")}</div>
      <div><span class="k">spawned_quest:</span> ${escapeHtml(worldInfo.spawned_quest || "-")}</div>
      <div><span class="k">spawned_rumor:</span> ${escapeHtml(worldInfo.spawned_rumor || "-")}</div>
      <div><span class="k">resolved_events:</span> ${escapeHtml((worldInfo.resolved_events || []).join(", ") || "-")}</div>
      <div><span class="k">relationship_changes:</span> ${(worldInfo.relationship_changes || []).length}</div>
      <div><span class="k">living_npc_changes:</span> ${(worldInfo.living_npc_changes || []).length}</div>
      <div><span class="k">reputation_changes:</span> ${escapeHtml(JSON.stringify(worldInfo.reputation_changes || []))}</div>
    </div>
    <div class="section-h">AI 자기평가</div>
    <div class="card compact">${self ? `
      <div><span class="k">note:</span> ${escapeHtml(self.note || "-")}</div>
      <div><span class="k">emotion_skew:</span> ${escapeHtml(self.emotion_skew || "-")}</div>
    ` : `<div class="muted">아직 자기평가 없음</div>`}</div>
    <div class="section-h">Resonance Recompute</div>
    <div class="card compact">${resonance ? `<pre class="mini-json">${escapeHtml(JSON.stringify(resonance, null, 2))}</pre>` : `<div class="muted">이번 턴에는 재계산 주기가 아니었습니다.</div>`}</div>
    <div class="section-h">Legacy</div>
    <div class="card compact">${legacy ? `<pre class="mini-json">${escapeHtml(JSON.stringify(legacy, null, 2))}</pre>` : `<div class="muted">이번 턴 세대 전환 없음</div>`}</div>`;
}

async function refreshHealth() {
  try {
    const d = await api("/api/health/" + NOS.campaign);
    renderHealth(d.metrics, null, { self_reflection: null });
  } catch (e) { /* observational */ }
}
