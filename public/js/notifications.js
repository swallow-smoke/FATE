// C5/C6/C7 — player-facing notifications + communication.
//   C5  toast     : bottom-right pop when an NPC contacts the player.
//   C6  sidebar   : left slide-in list aggregating everything the player should
//                   know (messages, revealed world events, rumors, imminent
//                   countdowns). Completely separate from the right-side dev
//                   Advanced panel.
//   C7  comm modal: messenger/letter-style overlay (left thread list + right
//                   conversation), opened from a toast, the 🔔/💬 buttons, or a
//                   notification click.
// No realtime server push exists; async messages only arrive on turns/time
// skips, so notifications refresh after each turn and on campaign enter.
"use strict";

const NOTIF = {
  items: [],            // unified notification items
  senderNames: {},      // canon_ref → display name
  booted: false,
};

function seenKey() { return "nos_notif_seen_" + (NOS.campaign || "_"); }
function loadSeen() { try { return new Set(JSON.parse(localStorage.getItem(seenKey()) || "[]")); } catch (e) { return new Set(); } }
function saveSeen(set) { try { localStorage.setItem(seenKey(), JSON.stringify([...set])); } catch (e) {} }

// ---------- data refresh ----------
// Builds the unified notification list from /api/comm (+ world reveals). Detects
// which items are new since last time to drive toasts (C5) and unread state (C6).
async function refreshNotifications(opts) {
  if (!NOS.campaign) return;
  let comm, world;
  try {
    [comm, world] = await Promise.all([
      api("/api/comm/" + NOS.campaign).catch(() => null),
      api("/api/worldtab/" + NOS.campaign).catch(() => null),
    ]);
  } catch (e) { return; }
  const seen = loadSeen();
  NOTIF.senderNames = {};
  (comm && comm.recipients || []).forEach((r) => { NOTIF.senderNames[r.canon_ref] = r.name; });

  const items = [];
  const freshToasts = [];

  // NPC messages (server owns unread state).
  (comm && comm.incoming || []).slice().reverse().forEach((m) => {
    const name = NOTIF.senderNames[m.sender] || m.sender;
    const id = "msg_" + m.action_id;
    items.push({ id, type: "message", icon: "✉️", title: `${name}의 메시지`, body: m.content_summary, turn: m.created_turn, unread: !!m.unread, target: { kind: "message", sender: m.sender } });
    if (m.unread && !seen.has(id)) freshToasts.push({ id, name, body: m.content_summary, sender: m.sender });
  });

  // Imminent countdowns the player already knows about (D-3 or sooner).
  (world && world.countdowns || []).filter((c) => c.turns_left != null && c.turns_left <= 3).forEach((c) => {
    const id = "cd_" + (c.label || "") + "_" + c.turns_left;
    items.push({ id, type: "world", icon: "⏳", title: `임박: ${c.label}`, body: `D-${c.turns_left}`, unread: !seen.has(id), target: { kind: "world", stab: "timeline" } });
  });
  // Newly visible rumors.
  (world && world.rumors || []).forEach((r, i) => {
    const text = r.content_summary || r.summary || r.text || (typeof r === "string" ? r : "");
    if (!text) return;
    const id = "rumor_" + (r.id || i + "_" + text.slice(0, 12));
    items.push({ id, type: "world", icon: "🗣️", title: "새로운 소문", body: text, unread: !seen.has(id), target: { kind: "world", stab: "rumor" } });
  });
  // Newly revealed clues.
  (world && world.mysteries || []).forEach((m) => (m.clues || []).forEach((c) => {
    const id = "clue_" + (c.content_summary || "").slice(0, 20) + "_" + (c.revealed_turn || "");
    items.push({ id, type: "world", icon: "🔍", title: "단서 발견", body: c.content_summary, unread: !seen.has(id), target: { kind: "world", stab: "clues" } });
  }));
  // PATCH 관계 전환 — relationship milestones. Toast/sidebar stay non-spoiler
  // (they don't name the new label); the full from→to is shown only in the
  // relations tab's "관계 변화 이력". Click → relations tab.
  const milestones = [];
  (world && world.relationship_milestones || []).slice().reverse().forEach((m) => {
    const id = "rel_" + m.milestone_id;
    const name = m.npc_name || m.npc_ref;
    items.push({ id, type: "relationship", icon: "💞", title: `${name}와(과)의 관계가 달라졌습니다`, body: m.trigger_summary || "관계 탭에서 확인하세요.", unread: !seen.has(id), target: { kind: "relations" } });
    if (!seen.has(id)) milestones.push({ id, name, body: m.trigger_summary });
  });

  NOTIF.items = items;
  renderNotifBadge();
  if (isNotifOpen()) renderNotifList();

  // C5 — toasts for genuinely new items (skip on the silent first load of an
  // existing campaign to avoid a burst of stale toasts).
  if (!opts || !opts.silent) {
    freshToasts.forEach((t) => showToast({ icon: "✉️", title: t.name, body: t.body, onClick: () => openCommModal(t.sender) }));
    milestones.forEach((m) => showToast({ icon: "💞", title: `${m.name}와(과)의 관계가 달라졌습니다`, body: m.body || "관계 탭에서 확인하세요.", onClick: () => onNotifClick({ target: { kind: "relations" } }) }));
  }
  // Each item toasts once. Mark world items + relationship milestones + toasted
  // messages as "seen"; the badge/sidebar unread state for messages still comes
  // from the server's authoritative unread flag.
  items.forEach((it) => { if (it.type === "world" || it.type === "relationship") seen.add(it.id); });
  freshToasts.forEach((t) => seen.add(t.id));
  milestones.forEach((m) => seen.add(m.id));
  // On a silent load (campaign enter) don't re-toast old unread messages later.
  if (opts && opts.silent) items.forEach((it) => { if (it.type === "message") seen.add(it.id); });
  saveSeen(seen);
}

function unreadCount() { return NOTIF.items.filter((it) => it.unread).length; }
function renderNotifBadge() {
  const n = unreadCount();
  const b = $("notifBadge");
  if (!b) return;
  b.textContent = n > 99 ? "99+" : String(n);
  b.classList.toggle("hidden", n === 0);
}

// ---------- C5: toast ----------
// showToast({ icon, title, body, onClick }) — generic bottom-right toast.
function showToast(t) {
  const host = $("toastHost");
  if (!host) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<div class="toast-icon">${t.icon || "✉️"}</div>
    <div class="toast-copy"><b>${escapeHtml(t.title || "")}</b><span>${escapeHtml(String(t.body || "").slice(0, 60))}</span></div>`;
  el.addEventListener("click", () => { if (t.onClick) t.onClick(); dismissToast(el); });
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => dismissToast(el), 6000);
}
function dismissToast(el) {
  if (!el || !el.parentNode) return;
  el.classList.remove("show");
  setTimeout(() => el.remove(), 300);
}

// ---------- C6: left sidebar ----------
function isNotifOpen() { return !$("notifSidebar").classList.contains("hidden"); }
function openNotifSidebar() {
  refreshNotifications({ silent: true });
  $("notifSidebar").classList.remove("hidden");
  $("notifBackdrop").classList.remove("hidden");
  requestAnimationFrame(() => $("notifSidebar").classList.add("open"));
  renderNotifList();
}
function closeNotifSidebar() {
  $("notifSidebar").classList.remove("open");
  $("notifBackdrop").classList.add("hidden");
  setTimeout(() => $("notifSidebar").classList.add("hidden"), 220);
}
function renderNotifList() {
  const box = $("notifList");
  if (!box) return;
  if (!NOTIF.items.length) { box.innerHTML = `<p class="notif-empty">새로운 알림이 없습니다.</p>`; return; }
  box.innerHTML = NOTIF.items.map((it, i) => `
    <button class="notif-item ${it.unread ? "unread" : ""}" data-i="${i}">
      <span class="notif-ic">${it.icon}</span>
      <span class="notif-copy"><b>${escapeHtml(it.title)}</b><span>${escapeHtml(String(it.body || "").slice(0, 80))}</span></span>
      ${it.unread ? '<span class="notif-dot"></span>' : ""}
    </button>`).join("");
  box.querySelectorAll(".notif-item").forEach((b) =>
    b.addEventListener("click", () => onNotifClick(NOTIF.items[Number(b.dataset.i)])));
}
function onNotifClick(it) {
  if (!it) return;
  if (it.target.kind === "message") { closeNotifSidebar(); openCommModal(it.target.sender); }
  else if (it.target.kind === "relations") {
    closeNotifSidebar();
    document.querySelector('.ptab[data-ptab="relations"]').click();
  } else if (it.target.kind === "world") {
    closeNotifSidebar();
    document.querySelector('.ptab[data-ptab="world"]').click();
    const stab = document.querySelector(`.stab[data-stab="${it.target.stab}"]`);
    if (stab) stab.click();
  }
}
async function markAllNotifRead() {
  try { await apiPost(`/api/comm/${NOS.campaign}/read`); } catch (e) {}
  const seen = loadSeen();
  NOTIF.items.forEach((it) => { it.unread = false; seen.add(it.id); });
  saveSeen(seen);
  renderNotifBadge(); renderNotifList();
}

// ---------- C7: comm modal (messenger / letter skin) ----------
const COMM = { data: null, active: null };
async function openCommModal(focusSender) {
  const modal = $("commModal");
  modal.classList.remove("hidden");
  requestAnimationFrame(() => modal.classList.add("open"));
  await loadCommData(focusSender);
}
function closeCommModal() {
  const modal = $("commModal");
  modal.classList.remove("open");
  setTimeout(() => modal.classList.add("hidden"), 200);
}
async function loadCommData(focusSender) {
  let d;
  try { d = await api("/api/comm/" + NOS.campaign); } catch (e) { $("commThread").innerHTML = `<p class="muted">불러오지 못했습니다.</p>`; return; }
  COMM.data = d;
  // letter skin for pre-modern worlds, messenger skin otherwise.
  const letterSkin = /ancient|medieval/.test(d.tech_level || "");
  $("commModal").querySelector(".comm-box").classList.toggle("letter-skin", letterSkin);
  $("commTitle").textContent = letterSkin ? "편지함" : "메시지";
  // Build a conversation per known NPC (recipients ∪ senders of incoming).
  const byRef = {};
  (d.recipients || []).forEach((r) => { byRef[r.canon_ref] = { ref: r.canon_ref, name: r.name, items: [] }; });
  (d.incoming || []).forEach((m) => {
    byRef[m.sender] = byRef[m.sender] || { ref: m.sender, name: (m.sender || "누군가"), items: [] };
    byRef[m.sender].items.push({ dir: "in", body: m.content_summary, turn: m.created_turn, unread: m.unread });
  });
  (d.letters || []).forEach((l) => {
    const ref = l.recipient;
    byRef[ref] = byRef[ref] || { ref, name: ref, items: [] };
    byRef[ref].items.push({ dir: "out", body: l.content_summary, turn: l.created_turn, status: l.status });
  });
  COMM.convos = Object.values(byRef).map((c) => { c.items.sort((a, b) => (a.turn || 0) - (b.turn || 0)); c.unread = c.items.some((x) => x.unread); return c; });
  const target = focusSender || (COMM.active) || (COMM.convos.find((c) => c.unread) || COMM.convos[0] || {}).ref;
  renderCommList();
  if (target) openConversation(target);
  else $("commThread").innerHTML = `<p class="muted">아직 주고받은 통신이 없습니다.</p>`;
}
function renderCommList() {
  const box = $("commList");
  box.innerHTML = (COMM.convos || []).map((c) => `
    <button class="comm-convo ${c.ref === COMM.active ? "active" : ""} ${c.unread ? "unread" : ""}" data-ref="${escapeHtml(c.ref)}">
      <span class="comm-avatar">${escapeHtml((c.name || "?").slice(0, 1))}</span>
      <span class="comm-convo-copy"><b>${escapeHtml(c.name)}</b><span>${escapeHtml(String((c.items.slice(-1)[0] || {}).body || "").slice(0, 24))}</span></span>
      ${c.unread ? '<span class="notif-dot"></span>' : ""}
    </button>`).join("") || `<p class="muted" style="padding:10px">대화 없음</p>`;
  box.querySelectorAll(".comm-convo").forEach((b) => b.addEventListener("click", () => openConversation(b.dataset.ref)));
}
async function openConversation(ref) {
  COMM.active = ref;
  const c = (COMM.convos || []).find((x) => x.ref === ref);
  if (!c) return;
  // mark this sender's incoming messages read
  if (c.unread) { try { await apiPost(`/api/comm/${NOS.campaign}/read`, { sender: ref }); } catch (e) {} c.unread = false; c.items.forEach((x) => x.unread = false); refreshNotifications({ silent: true }); }
  const bubbles = c.items.map((m) => `
    <div class="comm-msg ${m.dir === "out" ? "out" : "in"}">
      <div class="comm-bubble">${escapeHtml(m.body || "")}</div>
      <div class="comm-meta">${m.turn != null ? `${m.turn}턴` : ""}${m.status ? " · " + ({ pending: "전달 중", delivered: "전달됨", intercepted: "가로채임" }[m.status] || m.status) : ""}</div>
    </div>`).join("") || `<p class="muted">대화 내용이 없습니다.</p>`;
  const canWrite = (COMM.data.recipients || []).some((r) => r.canon_ref === ref);
  $("commThread").innerHTML = `
    <div class="comm-thread-head">${escapeHtml(c.name)}</div>
    <div class="comm-msgs">${bubbles}</div>
    ${canWrite ? `<div class="comm-compose">
      <textarea id="commInput" rows="2" placeholder="메시지를 적으세요…"></textarea>
      <button id="commSend" class="primary">보내기</button></div>` : `<p class="muted comm-noreply">이 상대에게는 지금 통신을 보낼 수 없습니다.</p>`}`;
  const msgs = $("commThread").querySelector(".comm-msgs");
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
  renderCommList();
  if ($("commSend")) $("commSend").addEventListener("click", async () => {
    const content = $("commInput").value.trim();
    if (!content) return;
    try {
      const r = await apiPost(`/api/campaign/${NOS.campaign}/letter`, { recipient: ref, content });
      showBanner(`전송했습니다 — 약 ${r.eta_turns}턴 뒤 도착 예정.`);
      await loadCommData(ref);
    } catch (e) { showBanner("전송 실패: " + e.message); }
  });
}

// ---------- wiring ----------
function wireNotifications() {
  $("notifBtn").addEventListener("click", () => (isNotifOpen() ? closeNotifSidebar() : openNotifSidebar()));
  $("notifClose").addEventListener("click", closeNotifSidebar);
  $("notifBackdrop").addEventListener("click", closeNotifSidebar);
  $("notifReadAll").addEventListener("click", markAllNotifRead);
  $("commBtn").addEventListener("click", () => openCommModal());
  $("commClose").addEventListener("click", closeCommModal);
  $("commModal").addEventListener("click", (e) => { if (e.target && e.target.id === "commModal") closeCommModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("commModal").classList.contains("hidden")) closeCommModal();
    else if (isNotifOpen()) closeNotifSidebar();
  });
}
