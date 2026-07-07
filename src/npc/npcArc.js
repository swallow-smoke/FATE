// PATCH_WEBNOVEL_TECHNIQUES · NPC Resolution Arc ("캐빨")
//
// "캐빨" = the pull of a character who earns their own moment. Beyond the main
// through-line, individual NPCs deserve a personal mini-arc: a setup, a slow
// build of their own stakes, and a *spotlight* payoff where they get to shine,
// be vindicated, or resolve their private conflict. Without this, side cast stay
// wallpaper. This tracks each NPC's arc and tells the GM when a present NPC is
// due their spotlight — so their payoff lands when they're actually on-screen.
//
// Reuses the PATCH_NARRATIVE_ACCUMULATION_GAPS arc shape (stage/tension) but keys
// on an NPC. Mock-safe; the spotlight is a soft cue, never a forced scene.
// (Overlaps deliberately with PATCH_INDIVIDUAL_WORKS_ANALYSIS's neglect check,
// which reads these arcs to notice a built-up NPC being left on the shelf.)

"use strict";

const STAGES = ["setup", "build", "spotlight_due", "resolved"];
const SPOTLIGHT_TENSION = 1.0; // build past this → their moment is due
const MAX_ACTIVE = 8;

function ensure(state) {
  if (!Array.isArray(state.npc_arcs)) state.npc_arcs = [];
  return state.npc_arcs;
}

function forNpc(state, npcRef) {
  return ensure(state).find((a) => a.npc_ref === npcRef && a.stage !== "resolved") || null;
}

function open(state, npcRef, title, turn) {
  if (!npcRef) return null;
  const arcs = ensure(state);
  if (forNpc(state, npcRef)) return null; // one active arc per NPC
  if (arcs.filter((a) => a.stage !== "resolved").length >= MAX_ACTIVE) return null;
  const arc = {
    arc_id: "npcarc_" + String(arcs.length + 1).padStart(4, "0"),
    npc_ref: npcRef,
    title: String(title || "").trim() || "이 인물만의 사연",
    stage: "setup",
    tension: 0,
    opened_turn: turn,
    spotlight_turn: null,
    resolved_turn: null,
  };
  arcs.push(arc);
  return arc;
}

// Build an NPC's arc; crossing the threshold flips it to spotlight_due.
function build(state, npcRef, delta, turn) {
  const arc = forNpc(state, npcRef);
  if (!arc) return null;
  arc.tension = Math.max(0, arc.tension + (Number(delta) || 0.4));
  if (arc.stage === "setup") arc.stage = "build";
  if (arc.stage === "build" && arc.tension >= SPOTLIGHT_TENSION) arc.stage = "spotlight_due";
  return arc;
}

function resolve(state, arcOrNpcRef, turn) {
  const arc = ensure(state).find((a) => a.arc_id === arcOrNpcRef) || forNpc(state, arcOrNpcRef);
  if (!arc) return null;
  arc.stage = "resolved";
  arc.resolved_turn = turn;
  return arc;
}

function markSpotlightGiven(state, npcRef, turn) {
  const arc = forNpc(state, npcRef);
  if (!arc || arc.stage !== "spotlight_due") return null;
  arc.spotlight_turn = turn;
  // a delivered spotlight resolves the arc (the NPC had their moment)
  arc.stage = "resolved";
  arc.resolved_turn = turn;
  return arc;
}

// Extraction application. npc_arc_changes:
// { opened:[{npc_ref,title}], built:[{npc_ref,delta}], spotlight:[{npc_ref}], resolved:[{npc_ref}] }
function applyExtraction(state, changes, turn) {
  const out = { opened: [], built: [], spotlight: [], resolved: [] };
  if (!changes) return out;
  for (const o of changes.opened || []) { const a = open(state, o.npc_ref, o.title, turn); if (a) out.opened.push(a.arc_id); }
  for (const b of changes.built || []) { const a = build(state, b.npc_ref, b.delta, turn); if (a) out.built.push(a.arc_id); }
  for (const s of changes.spotlight || []) { const a = markSpotlightGiven(state, s.npc_ref, turn); if (a) out.spotlight.push(a.arc_id); }
  for (const r of changes.resolved || []) { const a = resolve(state, r.npc_ref, turn); if (a) out.resolved.push(a.arc_id); }
  return out;
}

// If a present NPC is due their spotlight, hand the GM a soft cue. Only NPCs in
// this scene, so their moment can actually happen now.
function directive(state, canonDb, participants) {
  const present = new Set(participants || []);
  const due = ensure(state).filter((a) => a.stage === "spotlight_due" && present.has(a.npc_ref));
  if (!due.length) return null;
  const arc = due[0];
  const e = canonDb && canonDb.get(arc.npc_ref);
  const name = (e && e.data && e.data.birth_name) || arc.npc_ref;
  return `캐릭터 순간(캐빨): ${name}은(는) 오래 자기 몫의 사연("${arc.title}")을 쌓아왔다. 이번 장면에 자연스러운 여지가 있다면, 이 인물이 스스로 빛나거나 자기 갈등을 매듭짓는 순간을 주라 — 주인공을 돋보이게 하는 도구가 아니라 그 자신으로서.`;
}

module.exports = { ensure, open, build, resolve, markSpotlightGiven, applyExtraction, directive, forNpc, STAGES };
