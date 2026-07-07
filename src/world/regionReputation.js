// Phase 16+ · Region Reputation
//
// Reputation tracked separately per scope — 국가(nation) / 도시(city) / 세력
// (faction) / 조직(org) — so the player can be a hero in one city and an outlaw
// in the next. Generalises the older faction-only reputation. Standing is
// -100..100 with a qualitative label; every change keeps its reason (feeds the
// Timeline). Dynamic Title reads the extremes (±60) to mint 영웅/적 titles.

"use strict";

const SCOPES = { nation: "국가", city: "도시", faction: "세력", org: "조직" };

function labelFor(s) {
  if (s >= 60) return "영웅";
  if (s >= 25) return "우호적";
  if (s > -25) return "중립";
  if (s > -60) return "적대적";
  return "원수";
}

function getOrCreate(state, { scope, scope_id, name }) {
  state.region_reputation = state.region_reputation || [];
  let r = state.region_reputation.find((x) => x.scope === scope && x.scope_id === scope_id);
  if (!r) { r = { scope, scope_id, name: name || scope_id, standing: 0, label: "중립", history: [] }; state.region_reputation.push(r); }
  if (name && !r.name) r.name = name;
  return r;
}

function adjust(state, target, delta, reason, turn) {
  const r = getOrCreate(state, target);
  r.standing = Math.max(-100, Math.min(100, (r.standing || 0) + Number(delta || 0)));
  r.label = labelFor(r.standing);
  if (delta) r.history = [...(r.history || []), { turn, delta: Number(delta), reason: reason || "", label: r.label }].slice(-30);
  return r;
}

// Apply narrative-detected changes: [{ scope, scope_id, name, delta, reason }].
function applyExtraction(state, changes, turn) {
  const out = [];
  for (const c of changes || []) { if (c && c.scope && c.scope_id && c.delta) { const r = adjust(state, c, c.delta, c.reason, turn); out.push({ scope: r.scope, scope_id: r.scope_id, standing: r.standing }); } }
  return out;
}

function playerVisible(state) {
  return (state.region_reputation || []).map((r) => ({ scope: r.scope, scope_label: SCOPES[r.scope] || r.scope, scope_id: r.scope_id, name: r.name, standing: r.standing, label: r.label }));
}

module.exports = { adjust, getOrCreate, labelFor, applyExtraction, playerVisible, SCOPES };
