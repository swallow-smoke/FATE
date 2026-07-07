// Phase 7 Part D — Advanced panel. A single read-only view of every internal
// variable (emotion / hidden vars / 10-dim relationships / memory / canon /
// story structure / difficulty / world / clues+chains / health / director log).
// Default OFF (gated by settings.advanced_mode); opened from the top-bar button.
// Never editable this phase. A global search filters rows across all sub-tabs.
"use strict";

const ADV = { data: null, tab: "emotion", q: "" };

function pct(v) { return v == null ? "—" : Math.round(Number(v) * 100) + "%"; }
function j(v) { return typeof v === "string" ? v : JSON.stringify(v); }

// Each sub-tab becomes a list of {label, text} rows so one search can span all.
function buildRows(tab, d) {
  const rows = [];
  const push = (label, text) => rows.push({ label, text: String(text) });
  if (tab === "emotion") {
    const e = d.emotion || {};
    const w = e.current_wave || {};
    push("현재 파동", `${w.primary_emotion || "-"} / 강도 ${w.intensity ?? "-"} (${w.turns_at_current_intensity ?? 0}턴 유지)`);
    Object.entries(e.fatigue_tracker || {}).forEach(([k, v]) => push(`피로: ${k}`, pct(v)));
    (e.recent_history || []).forEach((h) => push(`이력 ${h.turn ?? ""}턴`, `${h.primary_emotion || j(h)}`));
    Object.entries(e.resonance_profile || {}).forEach(([k, v]) => push(`공명: ${k}`, j(v)));
  } else if (tab === "psychology") {
    const hv = (d.psychology || {}).hidden_variables || {};
    Object.entries(hv).forEach(([k, v]) => push(`Hidden: ${k}`, pct(v)));
    (d.psychology.hidden_variable_log || []).slice(-12).forEach((l) => push(`HV log ${l.turn}턴`, `${l.primary_emotion || "-"} (강도 ${l.intensity ?? "-"})`));
    Object.entries((d.psychology.npc_brain_log) || {}).forEach(([k, v]) => push(`NPCBrain: ${k}`, `마지막 능동 ${v}턴`));
    (d.psychology.dynamic_traits || []).forEach((t) => push(`특성: ${t.name}`, `${pct(t.value)} (${t.trend}) · ${t.category}${t.visible_to_player ? "" : " · 숨김"} — ${t.player_facing_description || ""}`));
    (d.psychology.active_hidden_directives || []).forEach((l, i) => push(`활성 내면지시 #${i + 1}`, l)); // Phase 11 S
  } else if (tab === "relationships") {
    (d.relationships.player_edges || []).forEach((e) => push(`나 → ${e.canon_ref}`, Object.entries(e.rel || {}).filter(([k]) => !["from", "to", "change_history", "last_changed_turn"].includes(k)).map(([k, v]) => `${k} ${pct(v)}`).join(" · ")));
    (d.relationships.npc_edges || []).forEach((e) => push(`${e.from} ↔ ${e.to}`, Object.entries(e).filter(([k]) => !["from", "to", "type", "change_history", "last_changed_turn"].includes(k)).map(([k, v]) => `${k} ${typeof v === "number" ? pct(v) : j(v)}`).join(" · ")));
  } else if (tab === "memory") {
    (d.memory || []).forEach((m) => push(`[T${m.tier}] ${m.timestamp ? m.timestamp.campaign_turn + "턴" : ""}`, `${m.summary} ${(m.emotion_tags || []).length ? "(" + m.emotion_tags.join(", ") + ")" : ""}`));
  } else if (tab === "canon") {
    (d.canon || []).forEach((c) => push(`[${c.type}] ${c.canon_id}`, j(c.data && (c.data.birth_name || c.data.region || c.data.leader) || "")));
  } else if (tab === "structure") {
    const s = d.story_structure || {}, p = d.campaign_planner || {};
    push("현재 단계", `${s.current_stage} (${pct(s.stage_progress)}) · ${s.stage_entered_turn}턴 진입`);
    push("단계 순서", (s.stages || []).join(" → "));
    push("Planner", `예상 길이 ${p.expected_length} · 판단: ${p.hint || "안정"}`);
  } else if (tab === "difficulty") {
    const dd = d.difficulty || {};
    push("Director 힌트", dd.hint || "중립");
    (dd.recent_checks || []).forEach((c, i) => push(`판정 #${i + 1} (${c.turn ?? ""}턴)`, `${c.skill || ""} → ${c.outcome}`));
  } else if (tab === "world") {
    const wx = (d.world || {}).weather || {};
    push("날씨", `${wx.current_season} · ${wx.current_weather} (${wx.changed_turn}턴)`);
    (d.world.active_events || []).forEach((e) => push(`이벤트 ${e.world_event_id || ""}`, `${e.summary} [${e.category || ""}]`));
    (d.world.rumors || []).forEach((r) => push(`소문 ${r.canon_id || ""}`, j((r.data && r.data.content) || r.content || "")));
    (d.scheduled_actions || []).forEach((a) => push(`예약행동 ${a.trigger_turn}턴`, `${a.status} · ${j(a.summary || a)}`));
  } else if (tab === "clues") {
    (d.clues_chains.mysteries || []).forEach((m) => push(`미스터리 ${m.mystery_id}`, `${m.question} — 단서 ${(m.clues || []).filter((c) => c.revealed).length}/${(m.clues || []).length}${m.resolvable ? " (해결가능)" : ""}`));
    (d.clues_chains.consequence_chains || []).forEach((c) => push(`체인 ${c.chain_id}`, `${c.origin_flag} (${c.origin_turn}턴) → 연결 ${c.linked_events.length}`));
  } else if (tab === "health") {
    Object.entries(d.campaign_health || {}).forEach(([k, v]) => push(k, j(v)));
    const integ = d.integrity || {};
    (integ.log || d.integrity_log || []).slice(-12).forEach((l) => push(`무결성 ${l.turn}턴`, `[${l.severity}] ${l.message} (${l.source || ""})`));
    if (integ.extraction_failure_streak) push("추출 연속 실패", `${integ.extraction_failure_streak}회`);
    (integ.hallucination_candidates || []).forEach((c) => push(`Canon 후보: ${c.name}`, `${c.kind} · ${c.suggested_turn}턴 (검토 대기)`)); // W2
  } else if (tab === "director") {
    (d.director_log || []).slice(-30).forEach((l, i) => push(`로그 #${i + 1}`, j(l)));
  } else if (tab === "prompt") {
    // Phase 14 X1 — Prompt Viewer (+ V1/V3 profile). Full text shown verbatim.
    const p = d.prompt || {};
    const pp = p.prompt_profile || {};
    push("프롬프트 버전", pp.prompt_version || "-");
    const b = pp.last_token_budget;
    if (b) push("토큰 예산", `사용 ~${b.used} / 예산 ${b.total_budget} (${(b.trimmed || []).length ? "블록 일부 잘림" : "여유"})`);
    const cc = p.context_cache || {};
    push("컨텍스트 캐시", cc.cached ? `key ${cc.key} · 적중 ${cc.hits}회 · ${cc.has_handle ? "핸들 있음" : "핸들 없음(mock)"}` : "미등록");
    if (p.last_prompt) {
      push(`서사 생성 프롬프트 (${p.last_prompt.turn}턴)`, p.last_prompt.system_prompt);
      if (p.last_prompt.extraction_prompt) push("후처리 추출 프롬프트", p.last_prompt.extraction_prompt);
      push("플레이어 입력", p.last_prompt.player_input);
    }
  } else if (tab === "registry") {
    const r = d.registry || {};
    (r.dimensions || []).forEach((x) => push(`내면 변수: ${x.label || x.id}`, `${x.id}${x.archived ? " · 숨김" : ""} — ${x.description || ""}`));
    (r.emotion_vocab || []).forEach((x) => push(`감정: ${x.label || x.id}`, `${x.id}${x.archived ? " · 숨김" : ""} — ${x.description || ""}`));
    (r.themes || []).forEach((x) => push(`주제: ${x.label || x.id}`, `${x.id}${x.archived ? " · 숨김" : ""} — ${x.description || ""}`));
    (r.scene_types || []).forEach((x) => push(`장면: ${x.label || x.id}`, `${x.id}${x.archived ? " · 숨김" : ""} — ${x.tone_notes || x.description || ""}`));
  } else if (tab === "feedback") {
    (d.feedback || []).slice().reverse().forEach((f) => push(`${f.turn}턴 · ${f.reason || "피드백"}`, `${f.note || ""} · ${f.created_at}`));
  } else if (tab === "performance") {
    // Phase 14 X2 — AI Profiler: per-turn stage timing.
    (d.performance || []).slice(-15).reverse().forEach((r) => push(`${r.turn}턴`, `서사 ${r.narrative_ms}ms · 추출 ${r.extraction_ms}ms · 총 ${r.total_ms}ms · 기억 ${r.memory_count} · Canon ${r.canon_count}`));
  }
  return rows;
}

function renderAdvBody() {
  const body = $("advBody");
  if (!ADV.data) { body.innerHTML = `<div class="muted" style="padding:24px">불러오는 중…</div>`; return; }
  const q = ADV.q.trim().toLowerCase();
  if (q) {
    // Search spans every sub-tab; show matches grouped by tab.
    const tabNames = { emotion: "감정", psychology: "심리", relationships: "관계", memory: "기억", canon: "Canon", structure: "스토리 구조", difficulty: "난이도", world: "세계", clues: "단서/체인", health: "건강도", director: "Director", prompt: "프롬프트", registry: "Registry", feedback: "피드백", performance: "성능" };
    let html = "";
    for (const t of Object.keys(tabNames)) {
      const hits = buildRows(t, ADV.data).filter((r) => (r.label + " " + r.text).toLowerCase().includes(q));
      if (hits.length) html += `<div class="adv-group"><h4>${tabNames[t]} (${hits.length})</h4>${hits.map(rowHtml).join("")}</div>`;
    }
    body.innerHTML = html || `<div class="muted" style="padding:24px">"${escapeHtml(q)}" 에 대한 결과가 없습니다.</div>`;
    return;
  }
  const rows = buildRows(ADV.tab, ADV.data);
  body.innerHTML = rows.length ? rows.map(rowHtml).join("") : `<div class="muted" style="padding:24px">표시할 데이터가 없습니다.</div>`;
}
function rowHtml(r) {
  return `<div class="adv-row"><div class="adv-label">${escapeHtml(r.label)}</div><div class="adv-val">${escapeHtml(r.text)}</div></div>`;
}

async function openAdvanced() {
  $("advancedPanel").classList.remove("hidden");
  ADV.data = null; renderAdvBody();
  try { ADV.data = await api("/api/advanced/" + NOS.campaign); } catch (e) { ADV.data = null; }
  renderAdvBody();
}

function wireAdvanced() {
  const btn = $("advancedBtn");
  if (btn) btn.addEventListener("click", openAdvanced);
  $("advClose").addEventListener("click", () => $("advancedPanel").classList.add("hidden"));
  document.querySelectorAll("#advTabs .atab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll("#advTabs .atab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      ADV.tab = t.dataset.atab; ADV.q = ""; $("advSearch").value = "";
      renderAdvBody();
    }));
  $("advSearch").addEventListener("input", (e) => { ADV.q = e.target.value; renderAdvBody(); });
}

// Called from enterCampaign: reveal the button only when advanced_mode is on.
function refreshAdvancedButton(advancedMode) {
  const btn = $("advancedBtn");
  if (btn) btn.classList.toggle("hidden", !advancedMode);
  if (!advancedMode) $("advancedPanel").classList.add("hidden");
}
