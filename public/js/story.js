// 이야기 탭 — chat + Phase 5/6 controls. Phase 6 principle: every AI-touching
// action here is triggered by an explicit human action (button/command) —
// there is no automatic/background AI call in this file.
"use strict";

let inflightController = null;
let inputHistory = [];
let inputHistoryPos = -1;

// Phase 6 D/G — purely frontend prefs (localStorage), read fresh each time so
// the 설정 tab doesn't need cross-script variable wiring.
function isTypingEffectOn() { return localStorage.getItem("nos_typing_effect") === "1" && localStorage.getItem("nos_low_spec") !== "1"; }
function isLowSpec() {
  return localStorage.getItem("nos_low_spec") === "1"
    || localStorage.getItem("nos_reduce_motion") === "1"
    || localStorage.getItem("nos_theme") === "plain";
}

// ---------- chat log ----------
function addPlayer(text) {
  const d = document.createElement("div");
  d.className = "msg player";
  d.innerHTML = `<span class="badge">플레이어</span>${escapeHtml(text)}`;
  $("log").appendChild(d);
  animatePaperIn(d, 24);
  scrollLog();
}
function addGM(text, turn, date, emotion, intensity, opts) {
  const d = document.createElement("div");
  d.className = "msg gm";
  d.dataset.emotion = emotionTone(emotion || (NOS.emotion && NOS.emotion.name));
  const bookmarks = (window._bookmarkedTurns || []);
  const on = turn != null && bookmarks.includes(turn);
  const badge = `<span class="badge-text">턴 ${turn ?? "?"}${date ? " · " + escapeHtml(date) : ""}</span>
    ${turn != null ? `<button class="bookmark-btn ${on ? "on" : ""}" title="${on ? "북마크 해제" : "이 장면 북마크"}" data-turn="${turn}">★</button>` : ""}`;
  const long = text.length > 600;
  const body = long
    ? `<div class="gm-body collapsed">${renderNarrative(text)}</div><button class="fold-btn">더 보기</button>`
    : `<div class="gm-body">${renderNarrative(text)}</div>`;
  d.innerHTML = `<span class="badge">${badge}</span>${body}`;
  $("log").appendChild(d);
  animatePaperIn(d, 34);
  moveCurrentTurnMarker(d);
  scrollLog();

  const bm = d.querySelector(".bookmark-btn");
  if (bm) bm.addEventListener("click", () => toggleBookmark(Number(bm.dataset.turn), bm));
  const fold = d.querySelector(".fold-btn");
  if (fold) fold.addEventListener("click", () => {
    const body = d.querySelector(".gm-body");
    body.classList.toggle("collapsed");
    fold.textContent = body.classList.contains("collapsed") ? "더 보기" : "접기";
  });

  if (!(opts && opts.skipKinetic)) {
    animateKineticText(d.querySelector(".gm-body"), emotion || (NOS.emotion && NOS.emotion.name), intensity ?? (NOS.emotion && NOS.emotion.intensity));
  } else if (isTypingEffectOn()) playTypingEffect(d.querySelector(".gm-body"), text);
}
function addSystem(text) {
  const d = document.createElement("div");
  d.className = "msg system";
  d.textContent = text;
  $("log").appendChild(d);
  animatePaperIn(d, 18);
  scrollLog();
}
function addLegacyCard(ev) {
  const d = document.createElement("div");
  d.className = "legacy-card";
  d.innerHTML = `<div class="lc-title">✦ 세대 전환 — ${ev.generation}세대 시작</div>
    <div class="lc-body">이전 세대(${escapeHtml(ev.predecessor_ref)})의 이야기가 전설로 남았습니다.<br>
    계승자: <b>${escapeHtml(ev.successor_ref || "미정")}</b><br>
    물려받은 유산: ${escapeHtml((ev.legacy_traits || []).join(", ") || "없음")}</div>`;
  $("log").appendChild(d); scrollLog();
}
// Phase 4 B1 — dice badge: outcome word only, numbers live in the debug tab.
function addDiceBadge(check) {
  const d = document.createElement("div");
  d.className = "msg system dice " + check.outcome;
  const label = { success: "성공", partial: "부분 성공", fail: "실패" }[check.outcome] || check.outcome;
  d.innerHTML = `🎲 ${escapeHtml(check.crafting ? "조합" : check.skill)} 판정 — <b>${label}</b>`;
  $("log").appendChild(d); scrollLog();
}
function scrollLog() { const log = $("log"); log.scrollTop = log.scrollHeight; }

// Phase 6 G — narrative typing effect (opt-in, off by default).
function playTypingEffect(el, text) {
  const plain = renderNarrative(text);
  el.innerHTML = "";
  const tmp = document.createElement("div");
  tmp.innerHTML = plain;
  const full = tmp.textContent;
  let i = 0;
  el.classList.add("typing");
  const step = () => {
    i += 3;
    el.textContent = full.slice(0, i);
    if (i < full.length) requestAnimationFrame(step);
    else { el.innerHTML = plain; el.classList.remove("typing"); }
  };
  requestAnimationFrame(step);
}

// ---------- choices (Wave 1, default OFF) ----------
function parseChoices(narrative) {
  const lines = narrative.split("\n").map((l) => l.trim());
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < 4; i--) {
    const m = lines[i].match(/^[—\-·•]\s*(.{2,80})$/);
    if (m) out.unshift(m[1]);
    else if (lines[i] && out.length) break;
  }
  return out.length >= 2 ? out : [];
}
function renderChoices(narrative) {
  const box = $("choices");
  const on = NOS.settingsCache && NOS.settingsCache.choices_ui;
  if (!on) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const choices = parseChoices(narrative || "");
  if (!choices.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  // Phase 10 H — attach a qualitative weight hint (유리함/보통/불리함) from the
  // player's stats/traits. A hint only, never a probability; real checks stand.
  box.innerHTML = choices.map((c) => {
    const w = choiceWeightHint(c);
    return `<button class="choice-btn">${escapeHtml(c)}${w ? `<span class="choice-weight w-${w.tier}">${w.label}</span>` : ""}</button>`;
  }).join("");
  box.classList.remove("hidden");
  if (!isLowSpec() && window.gsap) gsap.fromTo(".choice-btn", { y: 10, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.055, duration: 0.32, ease: "back.out(1.4)" });
  box.querySelectorAll(".choice-btn").forEach((b) =>
    b.addEventListener("click", () => { addPlayer(b.textContent); runTurn(b.textContent); }));
}

// Phase 10 H — map a choice's referenced stat to a coarse advantage tier.
const CHOICE_STAT_KEYWORDS = [
  { stat: "전투", re: /(싸우|공격|베|맞서|정면|제압|전투|힘)/ },
  { stat: "설득", re: /(설득|협상|구슬|회유|담판|말로)/ },
  { stat: "은신", re: /(숨|몰래|잠입|미행|훔치|은밀)/ },
  { stat: "지식", re: /(조사|해독|분석|알아내|연구|기억)/ },
  { stat: "직감", re: /(직감|느낌|눈치|간파|살핀)/ },
];
function choiceWeightHint(text) {
  const stats = (NOS.playerStats) || {};
  const hit = CHOICE_STAT_KEYWORDS.find((k) => k.re.test(text));
  if (!hit) return null;
  const v = Number(stats[hit.stat] || 0);
  if (v >= 2) return { tier: "hi", label: "유리함" };
  if (v <= 0) return { tier: "lo", label: "불리함" };
  return { tier: "mid", label: "보통" };
}

// Phase 10 J2 — "그날의 정리" card, inserted inline as an in-world day ends.
function addDailyCard(daily) {
  if (!daily || !daily.summary) return;
  const card = document.createElement("div");
  card.className = "daily-card";
  card.innerHTML = `<div class="daily-head">— ${escapeHtml(String(daily.day))}일차의 정리 —</div><div class="daily-body">${renderNarrative(daily.summary)}</div>`;
  $("log").appendChild(card);
  animatePaperIn(card, 16);
}

// Phase 10 O — countdown badges for events the player already knows about.
function renderCountdowns(countdowns) {
  let bar = $("countdownBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "countdownBar";
    bar.className = "countdown-bar";
    $("chatpane").insertBefore(bar, $("log"));
  }
  const items = countdowns || [];
  if (!items.length) { bar.innerHTML = ""; bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  bar.innerHTML = items.map((c) => `<span class="cd-badge" title="${escapeHtml(c.label)}">D-${c.turns_left} · ${escapeHtml(c.label)}</span>`).join("");
}

// ---------- Phase 6 D: progress bar (story_structure) ----------
function renderProgress(structure) {
  let bar = $("actProgress");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "actProgress";
    bar.className = "act-progress";
    $("chatpane").insertBefore(bar, $("log"));
  }
  if (!structure) { bar.innerHTML = ""; return; }
  const pct = Math.round((structure.act_progress || 0) * 100);
  bar.innerHTML = `<span class="act-label">${escapeHtml(structure.current_act || "")}</span>
    <div class="act-track"><div class="act-fill" style="width:${pct}%"></div></div>`;
}

// ---------- Phase 6 C: offline queue ----------
const offlineQueue = [];
function flagOffline(isOffline) {
  let tag = $("offlineTag");
  if (!tag) {
    tag = document.createElement("span");
    tag.id = "offlineTag";
    tag.className = "offline-tag hidden";
    tag.textContent = "오프라인 — 재연결 시 자동 전송";
    $("composer").prepend(tag);
  }
  tag.classList.toggle("hidden", !isOffline);
}
window.addEventListener("offline", () => flagOffline(true));
window.addEventListener("online", () => {
  flagOffline(false);
  if (offlineQueue.length) {
    const next = offlineQueue.shift();
    addSystem("재연결됨 — 대기 중이던 입력을 전송합니다.");
    runTurn(next);
  }
});

// ---------- turn ----------
async function runTurn(text, timeSkip) {
  if (!navigator.onLine) {
    offlineQueue.push(text);
    addSystem("오프라인 상태입니다 — 재연결되면 자동으로 전송됩니다.");
    return;
  }
  $("send").disabled = true;
  $("choices").classList.add("hidden");
  const thinking = document.createElement("div");
  thinking.className = "msg system";
  thinking.textContent = "GM이 장면을 조립하는 중…";
  $("log").appendChild(thinking); scrollLog();
  inflightController = new AbortController();
  $("cancelSend").classList.remove("hidden");
  try {
    const res = await fetch("/api/turn", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaign_id: NOS.campaign, player_input: text, debug: $("debug").checked, time_skip: timeSkip || null }),
      signal: inflightController.signal,
    });
    const data = await res.json();
    thinking.remove();
    if (!res.ok || data.error) {
      if (res.status === 429 || res.status >= 500) showBanner("서버/AI 응답이 지연되고 있습니다 — 잠시 후 다시 시도해주세요.");
      addSystem("장면을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (data.note_saved) { addSystem(`메모 저장됨: "${data.note.text}"`); return; }
    const liveEmotion = data.panels && data.panels.emotion;
    const liveEmotionName = liveEmotion && liveEmotion.primary_emotion;
    const liveIntensity = liveEmotion && liveEmotion.intensity;
    if (liveEmotion) setEmotionalResonance(liveEmotionName, liveIntensity);
    if (data.check) addDiceBadge(data.check);
    addGM(data.narrative, data.turn, data.in_world_date, liveEmotionName, liveIntensity);
    if (data.legacy_event) addLegacyCard(data.legacy_event);
    if (data.ending) showEndingScreen(data.ending);
    if (data.pending_transition) showTransitionConfirm(data.pending_transition); // Phase 8 C2
    if (data.daily_summary) addDailyCard(data.daily_summary); // Phase 10 J2
    renderCountdowns(data.countdowns); // Phase 10 O
    renderChoices(data.narrative);
    renderProgress(data.story_structure);
    $("undoBtn").disabled = !data.undo_available;
    $("regenBtn").disabled = !data.undo_available;
    $("campSub").textContent = `턴 ${data.turn} · ${data.in_world_date || ""}`;
    if (data.panels) {
      renderEmotion(data.panels.emotion, data.panels.resonance);
      renderMemoryThisTurn(data.panels.retrieved_memories);
      renderHealth(data.panels.campaign_health, data.panels.world, data.trace);
    }
    NOS.lastTrace = data.trace;
    renderTrace(NOS.lastTrace);
    refreshCanon();
    flashAutosaved();
  } catch (e) {
    thinking.remove();
    if (e.name !== "AbortError") addSystem("장면을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
    else addSystem("전송을 취소했습니다.");
  } finally {
    $("send").disabled = false; $("cancelSend").classList.add("hidden");
    inflightController = null;
    $("input").focus();
  }
}

// Phase 6 C — autosave indicator (every successful turn IS the autosave).
let autosaveTimer = null;
function flashAutosaved() {
  const tag = $("autosaveTag");
  tag.classList.remove("hidden");
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => tag.classList.add("hidden"), 2000);
}

// ---------- input: textarea autosize + Enter/Shift+Enter + history + @/slash ----------
function autosizeInput() {
  const el = $("input");
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

async function updateMentionCandidates() {
  if (!NOS.campaign) return;
  try {
    const d = await api("/api/canon/" + NOS.campaign);
    window._mentionCandidates = (d.entities || [])
      .filter((e) => e.type === "Character" && e.data && e.data.discovered_by_player)
      .map((e) => e.data.birth_name || e.canon_id);
  } catch (e) { window._mentionCandidates = []; }
}

function handleComposerInput() {
  autosizeInput();
  const el = $("input");
  const v = el.value;
  const caret = el.selectionStart;

  // slash-command hint
  if (/^\/[가-힣]*$/.test(v)) {
    const cmds = [
      { c: "/판정", d: "행동에 대해 강제로 판정을 굴립니다" },
      { c: "/휴식", d: "잠시 휴식을 취합니다" },
      { c: "/메모", d: "GM에게 보이지 않는 개인 메모를 남깁니다" },
    ].filter((x) => x.c.startsWith(v));
    if (cmds.length) {
      $("slashHint").innerHTML = cmds.map((x) => `<div class="hint-row" data-cmd="${x.c}"><b>${x.c}</b><span>${x.d}</span></div>`).join("");
      $("slashHint").classList.remove("hidden");
      $("slashHint").querySelectorAll(".hint-row").forEach((r) =>
        r.addEventListener("click", () => { el.value = r.dataset.cmd + " "; $("slashHint").classList.add("hidden"); el.focus(); }));
    } else $("slashHint").classList.add("hidden");
  } else $("slashHint").classList.add("hidden");

  // @NPC autocomplete
  const before = v.slice(0, caret);
  const m = before.match(/@([가-힣a-zA-Z]*)$/);
  if (m && window._mentionCandidates && window._mentionCandidates.length) {
    const partial = m[1];
    const hits = window._mentionCandidates.filter((n) => n.includes(partial)).slice(0, 6);
    if (hits.length) {
      $("mentionHint").innerHTML = hits.map((n) => `<div class="hint-row" data-name="${escapeHtml(n)}">${escapeHtml(n)}</div>`).join("");
      $("mentionHint").classList.remove("hidden");
      $("mentionHint").querySelectorAll(".hint-row").forEach((r) =>
        r.addEventListener("click", () => {
          el.value = before.slice(0, before.length - m[0].length) + "@" + r.dataset.name + " " + v.slice(caret);
          $("mentionHint").classList.add("hidden"); el.focus();
        }));
    } else $("mentionHint").classList.add("hidden");
  } else $("mentionHint").classList.add("hidden");
}

function submitComposer() {
  const text = $("input").value.trim();
  if (!text) return;
  addPlayer(text);
  $("input").value = ""; autosizeInput();
  inputHistory.push(text); inputHistoryPos = inputHistory.length;
  runTurn(text);
}

// ---------- controls ----------
function wireStoryControls() {
  $("composer").addEventListener("submit", (e) => { e.preventDefault(); submitComposer(); });
  $("input").addEventListener("input", handleComposerInput);
  $("input").addEventListener("keydown", (e) => {
    // Enter sends, Shift+Enter newlines (A)
    if (e.key === "Enter" && !e.shiftKey && $("slashHint").classList.contains("hidden") && $("mentionHint").classList.contains("hidden")) {
      e.preventDefault(); submitComposer(); return;
    }
    // input history via arrow keys, only when the caret is at an edge (A)
    if (e.key === "ArrowUp" && $("input").selectionStart === 0) {
      if (inputHistoryPos > 0) { inputHistoryPos--; $("input").value = inputHistory[inputHistoryPos]; autosizeInput(); e.preventDefault(); }
    } else if (e.key === "ArrowDown" && $("input").selectionStart === $("input").value.length) {
      if (inputHistoryPos < inputHistory.length - 1) { inputHistoryPos++; $("input").value = inputHistory[inputHistoryPos]; autosizeInput(); e.preventDefault(); }
      else if (inputHistoryPos === inputHistory.length - 1) { inputHistoryPos++; $("input").value = ""; autosizeInput(); }
    }
    if (e.key === "Escape") { $("slashHint").classList.add("hidden"); $("mentionHint").classList.add("hidden"); }
  });

  // A — 전송 취소: aborts the in-flight request.
  $("cancelSend").addEventListener("click", () => { if (inflightController) inflightController.abort(); });

  // time skip dialog → narration-style player_input + calendar advance
  $("timeSkipBtn").addEventListener("click", () => {
    openModal(`
      <h3>시간 스킵</h3>
      <p class="muted">얼마나 건너뛸까요?</p>
      <div class="modal-row">
        <input type="number" id="tsAmount" value="3" min="1" max="100" />
        <select id="tsUnit"><option>시간</option><option selected>일</option><option>주</option><option>년</option></select>
      </div>
      <div class="modal-actions"><button id="tsGo" class="primary">건너뛰기</button><button onclick="closeModal()">취소</button></div>`);
    $("tsGo").addEventListener("click", () => {
      const amount = Number($("tsAmount").value) || 1;
      const unit = $("tsUnit").value;
      closeModal();
      const text = `${amount}${unit} 후로 넘어가주세요.`;
      addPlayer(text);
      runTurn(text, { amount, unit });
    });
  });

  // undo — single-depth rollback of state+memory+canon
  $("undoBtn").addEventListener("click", async () => {
    if (!confirm("직전 턴 이전 상태로 되돌립니다. 이번 턴의 기억/Canon 기록도 함께 사라집니다.")) return;
    try {
      const d = await apiPost(`/api/campaign/${NOS.campaign}/undo`);
      addSystem(`턴 ${d.turn} 시점으로 되돌렸습니다.`);
      enterCampaign(NOS.campaign); // full reload
    } catch (e) { addSystem("되돌리기 실패: " + e.message); }
  });

  // Phase 6 A — 응답 재생성: human presses it, AI just re-rolls the same turn.
  $("regenBtn").addEventListener("click", async () => {
    if (!confirm("마지막 응답을 다른 결과로 다시 생성합니다. 지금 화면의 마지막 응답은 사라집니다.")) return;
    try {
      addSystem("마지막 응답을 다시 생성하는 중…");
      await apiPost("/api/turn/regenerate", { campaign_id: NOS.campaign });
      enterCampaign(NOS.campaign);
    } catch (e) { addSystem("재생성 실패: " + e.message); }
  });

  // branch save — duplicate everything under a new id, register in launcher
  $("branchBtn").addEventListener("click", async () => {
    const to = (prompt("분기 세이브 ID:", NOS.campaign + "_branch") || "").trim();
    if (!to) return;
    try {
      await apiPost("/api/campaign/saveas", { from: NOS.campaign, to });
      addSystem(`분기 세이브 생성됨: "${to}" — 런처에 별도 카드로 등록되었습니다.`);
    } catch (e) { addSystem("분기 세이브 실패: " + e.message); }
  });

  // Phase 6 E — "사건 필요해": human explicitly asks for a beat next turn.
  $("forceEventBtn").addEventListener("click", async () => {
    await apiPost(`/api/campaign/${NOS.campaign}/force-event`);
    addSystem("다음 장면에 사건이 강하게 반영되도록 요청했습니다.");
  });

  // Phase 6 E — 동전던지기/운세뽑기: pure client randomness, no State/AI touch.
  $("funBtn").addEventListener("click", () => {
    openModal(`
      <h3>재미로 한 번</h3>
      <p class="muted">이야기에는 영향을 주지 않는 순수한 장난입니다.</p>
      <div class="modal-actions">
        <button id="coinFlip">🪙 동전 던지기</button>
        <button id="fortune">🔮 오늘의 운세</button>
      </div>
      <div id="funResult" class="fun-result"></div>`);
    $("coinFlip").addEventListener("click", () => {
      $("funResult").textContent = Math.random() < 0.5 ? "앞면" : "뒷면";
    });
    const FORTUNES = ["오늘은 낯선 이의 말에 귀 기울여보세요.", "작은 결정이 큰 흐름을 바꿉니다.", "잠시 멈추는 것도 나아가는 방법입니다.", "예상치 못한 곳에서 실마리를 찾습니다.", "오늘은 평온함이 함께합니다.", "누군가 당신을 기다리고 있을지도 모릅니다."];
    $("fortune").addEventListener("click", () => {
      $("funResult").textContent = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
    });
  });

  $("debug").addEventListener("change", () => { if (!$("debug").checked) { NOS.lastTrace = null; renderTrace(null); } });

  wireHistoryPanel();
  updateMentionCandidates();
  flagOffline(!navigator.onLine);
}

// ---------- session recap (Wave 1) + Phase 6 F next-session goal reminder ----------
async function maybeShowRecap() {
  try {
    const [recapD, goalD] = await Promise.all([
      api(`/api/recap/${NOS.campaign}`).catch(() => null),
      api(`/api/notes/${NOS.campaign}`).catch(() => null),
    ]);
    const goal = goalD && goalD.next_session_goal;
    if (recapD && recapD.recap) {
      openModal(`
        <h3>지난 이야기</h3>
        <p class="recap-text">${renderNarrative(recapD.recap)}</p>
        ${goal ? `<h4>지난 번에 남겨둔 다음 목표</h4><p class="recap-text">${escapeHtml(goal.text)}</p>` : ""}
        <div class="modal-actions"><button class="primary" onclick="closeModal()">이어서 하기</button></div>`);
    } else if (goal) {
      openModal(`
        <h3>지난 번에 남겨둔 다음 목표</h3>
        <p class="recap-text">${escapeHtml(goal.text)}</p>
        <div class="modal-actions"><button class="primary" onclick="closeModal()">이어서 하기</button></div>`);
    }
  } catch (e) { /* recap is optional */ }
}

// ---------- Phase 8 C2 — player death/retirement confirmation ----------
// Never auto-confirmed: a generation turnover is costly to undo, so the player
// must explicitly confirm (or cancel and keep playing).
function showTransitionConfirm(pending) {
  const isRetire = pending.trigger_flag === "player_retired";
  const reasonKo = { explicit: "당신이 직접 선언했습니다", narrative: "이야기가 그렇게 흘러갔습니다", fatal_check: "생사가 걸린 판정에 실패했습니다" }[pending.reason] || "";
  openModal(`
    <h3>${isRetire ? "여정을 마치시겠습니까?" : "이대로 죽음을 맞이하시겠습니까?"}</h3>
    <p class="muted">${escapeHtml(reasonKo)}. 확정하면 <b>세대 전환</b>이 일어납니다 — 이 인물의 이야기는 여기서 끝나고, 세계는 그대로 이어져 다음 세대가 시작됩니다. 되돌리기(Undo)로는 복구할 수 없습니다.</p>
    <div class="modal-actions">
      <button id="txConfirm" class="primary danger">${isRetire ? "은퇴를 확정한다" : "죽음을 받아들인다"}</button>
      <button id="txCancel">아직은 아니다 (계속 플레이)</button></div>`);
  $("txConfirm").addEventListener("click", async () => {
    try {
      const r = await apiPost(`/api/campaign/${NOS.campaign}/confirm-transition`, { confirm: true });
      closeModal();
      if (r.legacy_event) addLegacyCard(r.legacy_event);
      addSystem(`세대가 바뀌었습니다 — 제 ${r.legacy_event ? r.legacy_event.generation : ""}세대의 이야기가 시작됩니다.`);
      enterCampaign(NOS.campaign);
    } catch (e) { addSystem("세대 전환 실패: " + e.message); }
  });
  $("txCancel").addEventListener("click", async () => {
    await apiPost(`/api/campaign/${NOS.campaign}/confirm-transition`, { confirm: false });
    closeModal();
    addSystem("전환을 취소했습니다. 이야기는 계속됩니다.");
  });
}

// ---------- ending screen (Phase 4 B2 + Phase 6 E final health recap) ----------
function showEndingScreen(ending) {
  const rels = (ending.relations || []).map((r) => `<li>${escapeHtml(r.canon_ref)}</li>`).join("");
  const choices = (ending.key_choices || []).map((c) => `<li>${escapeHtml(c)}</li>`).join("");
  const health = ending.health || {};
  const healthRows = Object.entries(health).filter(([, v]) => v != null).map(([k, v]) =>
    `<div class="rep-row"><span>${escapeHtml(healthLabel(k))}</span><span class="rep-label">${v}%</span></div>`).join("");
  openModal(`
    <h3>✦ 캠페인 완료 — ${escapeHtml(ending.label || "")}</h3>
    <div class="ending-body">
      <p class="muted">${ending.turn}턴에 걸친 이야기가 막을 내렸습니다.</p>
      ${choices ? `<h4>주요 선택</h4><ul>${choices}</ul>` : ""}
      ${rels ? `<h4>함께한 사람들</h4><ul>${rels}</ul>` : ""}
      ${healthRows ? `<h4>이 여정의 기록</h4>${healthRows}` : ""}
    </div>
    <div class="modal-actions">
      <button class="primary" onclick="location.hash='#/'; closeModal()">런처로 돌아가기</button>
      <button onclick="closeModal()">이 세계에 남기</button>
    </div>`);
}
function healthLabel(k) {
  return { emotion_diversity_pct: "감정의 폭", foreshadow_resolution_pct: "복선 회수", npc_utilization_pct: "인연의 깊이", world_change_pct: "세계의 변화", choice_impact_pct: "선택의 무게" }[k] || k;
}
