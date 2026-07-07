// Phase 16+ · Dynamic Title
//
// Titles are earned epithets the world hangs on the player — 북부의 영웅 /
// 용 사냥꾼 / 왕의 벗 / 지명수배범 / 배신자. They are the top layer of "how the
// world sees you"; the Nickname system CONSUMES them (a distant, respectful NPC
// addresses you by your title, an enemy by 배신자). System-first: titles are
// DERIVED from state (flags, reputation, wanted status, org rank), then the AI
// merely uses them.
//
// Deed titles are permanent once earned; contextual titles (지명수배범) toggle
// `active` as the underlying state changes. Different NPCs/regions can prefer a
// different title via pickForContext().

"use strict";

// Known deed flags → title. Matched loosely against story_flags[].flag_id.
const FLAG_TITLES = [
  [/dragon|용.?사냥|용.?처치|slay.?dragon/i, "용 사냥꾼"],
  [/save.?(town|village|city)|구원|마을.?구|도시.?구/i, "구원자"],
  [/betray|배신|배반/i, "배신자"],
  [/hero|영웅/i, "영웅"],
  [/king.?friend|왕.?벗|왕.?친구/i, "왕의 벗"],
  [/rebel|반란|혁명/i, "반역자"],
  [/thief|도둑|절도/i, "그림자 손"],
];

function makeTitle(title, source, opts = {}) {
  return { id: `title_${source}_${title}`.replace(/\s+/g, "_"), title, source, scope_id: opts.scope_id || null, reason: opts.reason || null, earned_turn: opts.turn, active: true };
}

// Recompute the player's titles from current state. Adds newly-earned ones and
// flips `active` on contextual ones. Returns { added:[], toggled:[] }.
function recompute(state, canonDb) {
  const turn = state.turn_number;
  state.player = state.player || {};
  const titles = state.player.titles = state.player.titles || [];
  const byId = new Map(titles.map((t) => [t.id, t]));
  const derived = new Map(); // id -> {title, source, scope_id, reason}

  const add = (t, source, opts) => { const m = makeTitle(t, source, { ...opts, turn }); derived.set(m.id, m); };

  // 1) Deed flags.
  for (const f of state.story_flags || []) {
    if (f.value === false) continue;
    const id = f.flag_id || f.id || "";
    for (const [re, title] of FLAG_TITLES) if (re.test(id)) add(title, "deed", { reason: id });
  }
  // 2) Reputation extremes (region/faction/org scopes).
  for (const r of state.region_reputation || []) {
    const name = r.name || r.scope_id;
    if ((r.standing || 0) >= 60) add(`${name}의 영웅`, "reputation", { scope_id: r.scope_id, reason: r.label });
    else if ((r.standing || 0) <= -60) add(`${name}의 적`, "reputation", { scope_id: r.scope_id, reason: r.label });
  }
  // 3) Organization rank.
  for (const o of state.organizations || []) {
    if (o.member && o.member.rank) add(`${o.name}의 ${o.member.rank}`, "org", { scope_id: o.id });
  }
  // 4) Wanted status (contextual — active only while wanted/jailed).
  const activeWanted = (state.wanted || []).some((w) => w.status === "wanted" || w.status === "jailed");
  if (activeWanted) add("지명수배범", "wanted", { reason: "현상 수배 중" });
  // 5) Identity milestone trait as a soft title.
  const im = (state.player.identity_milestones || []).slice(-1)[0];
  if (im && im.to_trait) add(im.to_trait, "identity", { reason: im.trigger_summary });

  const added = [], toggled = [];
  // Add new / reactivate.
  for (const [id, m] of derived) {
    const existing = byId.get(id);
    if (!existing) { titles.push(m); added.push(m); }
    else if (!existing.active) { existing.active = true; toggled.push({ id, active: true }); }
  }
  // Deactivate contextual titles no longer derived (deed/identity persist).
  for (const t of titles) {
    if ((t.source === "wanted" || t.source === "reputation" || t.source === "org") && !derived.has(t.id) && t.active) {
      t.active = false; toggled.push({ id: t.id, active: false });
    }
  }
  return { added, toggled };
}

function active(state) {
  return ((state.player && state.player.titles) || []).filter((t) => t.active);
}

// Which title should THIS addresser use? An org/region member prefers the title
// tied to their scope; otherwise the most recently earned deed title; else null.
function pickForContext(state, ctx = {}) {
  const act = active(state);
  if (!act.length) return null;
  const scopes = [ctx.org_id, ctx.faction, ctx.region].filter(Boolean);
  const scoped = act.find((t) => t.scope_id && scopes.includes(t.scope_id));
  if (scoped) return scoped.title;
  // wanted is what a lawful stranger would call you
  const wanted = act.find((t) => t.source === "wanted");
  if (wanted && ctx.lawful) return wanted.title;
  const deed = act.filter((t) => t.source === "deed" || t.source === "identity").slice(-1)[0];
  return deed ? deed.title : act[act.length - 1].title;
}

function playerVisible(state) {
  return active(state).map((t) => ({ title: t.title, source: t.source, reason: t.reason, earned_turn: t.earned_turn }));
}

module.exports = { recompute, active, pickForContext, playerVisible, FLAG_TITLES };
