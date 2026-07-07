// PATCH_CHAPTER_CHECKLIST · Chapter unit + required-Canon / foreshadow checklist
//
// A Chapter is a mid-level unit above the scene and below the whole campaign.
// Each chapter carries a *checklist* of things that must land before it closes:
//   · required_canon    — canon entities that MUST appear / be paid attention to
//                          (these become "pinned" canon: force-included in the
//                          prompt so the GM can't forget the chapter's spine)
//   · required_foreshadow — planted foreshadows that MUST be resolved (복선회수)
// The engine marks items done as their canon appears in a scene or their
// foreshadow resolves, and signals when a chapter is ready to close. This is the
// structural backbone the Notion/MD importer's "Chapter-to-Canon Map" feeds.
//
// Builds on PATCH_NARRATIVE_ACCUMULATION_GAPS: an arc can be scoped to a chapter
// (arc.chapter === chapter_id). System-first, mock-safe, numbers never exposed.

"use strict";

function ensure(state) {
  if (!Array.isArray(state.chapters)) state.chapters = [];
  return state.chapters;
}

function activeChapter(state) {
  return ensure(state).find((c) => c.status === "active") || null;
}

function nextId(state) {
  return "ch_" + String(ensure(state).length + 1).padStart(3, "0");
}

// Open a chapter (closing any currently-active one is the caller's choice; we
// allow only one active at a time — opening a new one auto-completes the old).
function open(state, { title, required_canon, required_foreshadow, arc_refs }, turn) {
  const chapters = ensure(state);
  const prev = activeChapter(state);
  if (prev) { prev.status = "complete"; prev.closed_turn = turn; prev.auto_closed = true; }
  const checklist = [];
  for (const ref of required_canon || []) checklist.push({ kind: "canon", ref, done: false, done_turn: null });
  for (const fid of required_foreshadow || []) checklist.push({ kind: "foreshadow", ref: fid, done: false, done_turn: null });
  const ch = {
    chapter_id: nextId(state),
    index: chapters.length + 1,
    title: String(title || `${chapters.length + 1}장`).trim(),
    status: "active",
    opened_turn: turn,
    closed_turn: null,
    checklist,
    arc_refs: Array.isArray(arc_refs) ? arc_refs.slice(0, 8) : [],
  };
  chapters.push(ch);
  return ch;
}

function addRequirement(state, { kind, ref }) {
  const ch = activeChapter(state);
  if (!ch || !ref) return null;
  if (ch.checklist.some((i) => i.kind === kind && i.ref === ref)) return null;
  const item = { kind: kind === "foreshadow" ? "foreshadow" : "canon", ref, done: false, done_turn: null };
  ch.checklist.push(item);
  return item;
}

// The canon refs that MUST be kept in context for the active chapter (pinned).
function pinnedCanonRefs(state) {
  const ch = activeChapter(state);
  if (!ch) return [];
  return ch.checklist.filter((i) => i.kind === "canon" && !i.done).map((i) => i.ref);
}

// Tick each turn: mark checklist items done when their canon appeared in this
// scene (participants/refs) or their foreshadow is now resolved. Returns
// { completed:[...], ready:boolean } — ready = every item done.
function tick(state, canonDb, sceneSpec) {
  const ch = activeChapter(state);
  if (!ch) return { completed: [], ready: false };
  const turn = state.turn_number;
  const appeared = new Set([...(sceneSpec.participants || []), ...(sceneSpec.canon_refs || []), ...((state.scene_history || []).slice(-1)[0] || {}).participants || []]);
  const resolvedForeshadow = new Set((state.foreshadow_pool || []).filter((f) => f.resolved).map((f) => f.id));
  const completed = [];
  for (const item of ch.checklist) {
    if (item.done) continue;
    if (item.kind === "canon" && appeared.has(item.ref)) { item.done = true; item.done_turn = turn; completed.push(item); }
    else if (item.kind === "foreshadow" && resolvedForeshadow.has(item.ref)) { item.done = true; item.done_turn = turn; completed.push(item); }
  }
  const ready = ch.checklist.length > 0 && ch.checklist.every((i) => i.done);
  ch.ready_to_close = ready;
  return { completed, ready };
}

// Explicitly close the active chapter (e.g. the GM/extraction signals a chapter
// break). Returns the closed chapter or null.
function close(state, turn) {
  const ch = activeChapter(state);
  if (!ch) return null;
  ch.status = "complete";
  ch.closed_turn = turn;
  return ch;
}

// Extraction application. Shape:
// { open:{ title, required_canon, required_foreshadow }, add_requirements:[{kind,ref}], close:true }
function applyExtraction(state, changes, turn) {
  const out = { opened: null, added: [], closed: null };
  if (!changes) return out;
  if (changes.open && (changes.open.title || (changes.open.required_canon || []).length)) {
    const ch = open(state, changes.open, turn);
    out.opened = ch && ch.chapter_id;
  }
  for (const r of changes.add_requirements || []) {
    const item = addRequirement(state, r);
    if (item) out.added.push(item.ref);
  }
  if (changes.close) { const ch = close(state, turn); out.closed = ch && ch.chapter_id; }
  return out;
}

// Soft directive naming the chapter's still-open spine (pinned canon not yet
// touched, foreshadows not yet paid off). One quiet reminder, never a checklist.
function directive(state, canonDb) {
  const ch = activeChapter(state);
  if (!ch) return null;
  const open = ch.checklist.filter((i) => !i.done);
  if (!open.length) {
    return `이 장(${ch.title})에서 벼려온 실들이 거의 다 회수되었다. 매듭을 향해 장면의 무게를 조금씩 실어도 좋다.`;
  }
  const canonNames = open.filter((i) => i.kind === "canon").map((i) => { const e = canonDb && canonDb.get(i.ref); return (e && e.data && e.data.birth_name) || i.ref; });
  const foreshadow = open.filter((i) => i.kind === "foreshadow").map((i) => { const f = (state.foreshadow_pool || []).find((x) => x.id === i.ref); return (f && (f.summary || f.hint)) || i.ref; });
  const bits = [];
  if (canonNames.length) bits.push(`아직 이 장에서 제대로 다뤄지지 않은 축: ${canonNames.join(", ")}`);
  if (foreshadow.length) bits.push(`아직 회수되지 않은 복선: ${foreshadow.join(", ")}`);
  if (!bits.length) return null;
  return `[장 구조 참고 · ${ch.title}] ${bits.join(" / ")}. 이번 장면에서 억지로 몰아넣지는 말되, 자연스러운 순간이 오면 이 실들을 향해 조금씩 다가가라.`;
}

module.exports = {
  ensure, activeChapter, open, close, addRequirement, pinnedCanonRefs, tick,
  applyExtraction, directive,
};
