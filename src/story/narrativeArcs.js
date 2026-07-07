// PATCH_NARRATIVE_ACCUMULATION_GAPS · Narrative Arcs
//
// A narrative_arc groups a *growth goal* that spans many turns — "겁을 이겨낸
// 다", "동생을 용서한다", "이 도시를 떠날 용기를 낸다". Unlike a Dynamic Quest
// (an external objective with steps) an arc tracks an internal/relational
// through-line: it opens, accumulates progress as scenes touch it, hits soft
// milestones, and finally resolves or is abandoned. The point is memory: the
// engine keeps a slow-burning thread alive so the GM can pay it off instead of
// the story amnesia-ing every session.
//
// System-first & mock-safe: arcs open/advance/resolve from the extraction call
// (arc_changes) but every write is rule-checked here; the active arc surfaces to
// the GM only as a soft directive line (never a checklist, never numbers).
// Downstream patches (CHAPTER_CHECKLIST, WEBNOVEL_TECHNIQUES npc_arc) reuse this
// same {progress, milestones, chapter} shape.

"use strict";

const KINDS = new Set(["growth", "relationship", "world", "mystery"]);
const MAX_ACTIVE = 6; // don't let the GM open an unbounded pile of arcs

// Generic, rule-based milestone labels (LLM prose can enrich the payoff scene).
const MILESTONES = [
  { at: 0.34, label: "첫 실마리를 잡았다" },
  { at: 0.67, label: "결정적 전환점을 지났다" },
  { at: 1.0, label: "마침내 매듭지었다" },
];

function ensure(state) {
  if (!Array.isArray(state.narrative_arcs)) state.narrative_arcs = [];
  return state.narrative_arcs;
}

function activeArcs(state) {
  return ensure(state).filter((a) => a.status === "active");
}

function nextId(state) {
  return "arc_" + String(ensure(state).length + 1).padStart(4, "0");
}

function open(state, { title, kind, goal, canon_refs, chapter }, turn) {
  const arcs = ensure(state);
  const k = KINDS.has(kind) ? kind : "growth";
  const t = String(title || goal || "").trim();
  if (!t) return null;
  // Dedup: same title already active.
  if (arcs.some((a) => a.status === "active" && a.title === t)) return null;
  if (activeArcs(state).length >= MAX_ACTIVE) return null;
  const arc = {
    arc_id: nextId(state),
    title: t,
    kind: k,
    goal: String(goal || t).trim(),
    status: "active",
    progress: 0,
    opened_turn: turn,
    closed_turn: null,
    chapter: chapter || null,
    canon_refs: Array.isArray(canon_refs) ? canon_refs.slice(0, 8) : [],
    milestones_hit: [], // { at, label, turn }
    resolution: null,
  };
  arcs.push(arc);
  return arc;
}

function find(state, arcId) {
  return ensure(state).find((a) => a.arc_id === arcId) || null;
}

// Advance an arc's progress; crossing a milestone records it (for a payoff beat).
function advance(state, arcId, delta, turn) {
  const arc = find(state, arcId);
  if (!arc || arc.status !== "active") return null;
  const before = arc.progress;
  arc.progress = Math.max(0, Math.min(1, arc.progress + (Number(delta) || 0)));
  const crossed = [];
  for (const m of MILESTONES) {
    if (before < m.at && arc.progress >= m.at && !arc.milestones_hit.some((h) => h.at === m.at)) {
      const hit = { at: m.at, label: m.label, turn };
      arc.milestones_hit.push(hit);
      crossed.push({ arc_id: arc.arc_id, title: arc.title, ...hit });
    }
  }
  return { arc, crossed };
}

function resolve(state, arcId, resolution, turn) {
  const arc = find(state, arcId);
  if (!arc || arc.status !== "active") return null;
  arc.status = "resolved";
  arc.progress = 1;
  arc.closed_turn = turn;
  arc.resolution = String(resolution || "").trim() || null;
  return arc;
}

function abandon(state, arcId, turn) {
  const arc = find(state, arcId);
  if (!arc || arc.status !== "active") return null;
  arc.status = "abandoned";
  arc.closed_turn = turn;
  return arc;
}

// Apply the extraction's arc_changes. Shape:
// { opened:[{title,kind,goal,canon_refs}], advanced:[{arc_id,delta,note}],
//   resolved:[{arc_id,resolution}], abandoned:[{arc_id}] }
function applyExtraction(state, changes, turn) {
  const out = { opened: [], advanced: [], milestones: [], resolved: [], abandoned: [] };
  if (!changes) return out;
  for (const o of changes.opened || []) {
    const arc = open(state, o, turn);
    if (arc) out.opened.push(arc.arc_id);
  }
  for (const a of changes.advanced || []) {
    const r = advance(state, a.arc_id, a.delta != null ? a.delta : 0.2, turn);
    if (r) { out.advanced.push(a.arc_id); out.milestones.push(...r.crossed); }
  }
  for (const r of changes.resolved || []) {
    const arc = resolve(state, r.arc_id, r.resolution, turn);
    if (arc) out.resolved.push(arc.arc_id);
  }
  for (const a of changes.abandoned || []) {
    const arc = abandon(state, a.arc_id, turn);
    if (arc) out.abandoned.push(arc.arc_id);
  }
  return out;
}

// Soft scene directive: gently keep the least-progressed active growth/relation
// arc in the GM's awareness so long-running goals aren't forgotten. Rotates by
// picking the arc touched longest ago. Never a checklist; one quiet line.
function activeGrowthDirective(state) {
  const arcs = activeArcs(state).filter((a) => a.kind === "growth" || a.kind === "relationship");
  if (!arcs.length) return null;
  // Prefer an arc with some momentum but not yet resolved; oldest-touched first.
  arcs.sort((a, b) => (a.milestones_hit.length - b.milestones_hit.length) || (a.opened_turn - b.opened_turn));
  const arc = arcs[0];
  const stage = arc.milestones_hit.length ? arc.milestones_hit[arc.milestones_hit.length - 1].label : "아직 초입";
  return `이 인물이 오래 품어온 흐름: "${arc.goal}" (${stage}). 이번 장면에서 억지로 진전시키지는 말되, 관련된 순간이 오면 그 결이 조금이라도 움직이는지 지켜보라.`;
}

module.exports = {
  ensure, activeArcs, open, find, advance, resolve, abandon,
  applyExtraction, activeGrowthDirective, MILESTONES, MAX_ACTIVE,
};
