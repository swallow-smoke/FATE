// Phase 16+ · Wanted System
//
// Crime has consequences that live in the world, per region/faction:
//   범죄 → 현상금(bounty) → 수배(level) → 체포 위험 → 감옥
// A wanted status escalates on its own the longer it goes unresolved (the hunt
// intensifies), which is autonomous world motion → suppressed under calm_mode.
// Arrest is never auto-applied (player agency); we raise arrest_risk and let the
// narrative/player resolve it. Clearing comes from pardon/serving time/bribe.

"use strict";

const LEVEL_LABEL = ["없음", "주의 인물", "수배", "중범죄 수배", "국가 지명수배", "최우선 지명수배"];
const BOUNTY_PER_LEVEL = [0, 50, 200, 800, 3000, 10000];

let seq = 0;

function find(state, scopeId) { return (state.wanted || []).find((w) => w.scope_id === scopeId && w.status !== "cleared") || null; }

// Register a crime in a scope (region or faction). Escalates an existing record.
function addCrime(state, { scope_id, scope_label, reason, severity = 1 }, turn) {
  state.wanted = state.wanted || [];
  let w = find(state, scope_id);
  if (!w) {
    seq += 1;
    w = { id: `wanted_${String(turn || 0).padStart(4, "0")}_${seq}`, scope_id, scope_label: scope_label || scope_id, level: 0, bounty: 0, reason: reason || "범죄", since_turn: turn, status: "wanted", arrest_risk: 0, last_tick: turn, log: [] };
    state.wanted.push(w);
  }
  w.level = Math.min(5, (w.level || 0) + Math.max(1, severity));
  w.bounty = BOUNTY_PER_LEVEL[w.level];
  w.reason = reason || w.reason;
  w.status = w.status === "jailed" ? "jailed" : "wanted";
  w.log = [...(w.log || []), { turn, reason: reason || "범죄", level: w.level }].slice(-20);
  return w;
}

// Autonomous escalation: the hunt intensifies while a bounty stands. Quiet in calm.
function tick(state, { calm = false } = {}) {
  const turn = state.turn_number;
  const period = (state.settings && state.settings.wanted_tick_period) || 10;
  if (calm || turn === 0 || turn % period !== 0) return { escalated: [] };
  const escalated = [];
  for (const w of state.wanted || []) {
    if (w.status !== "wanted") continue;
    // bounty creeps up, and a long-unresolved case can bump the level.
    w.bounty = Math.round(w.bounty * 1.1);
    w.arrest_risk = Math.min(1, (w.arrest_risk || 0) + 0.1);
    if (turn - (w.since_turn || turn) >= period * 3 && w.level < 5) { w.level += 1; w.bounty = Math.max(w.bounty, BOUNTY_PER_LEVEL[w.level]); }
    w.last_tick = turn;
    escalated.push({ scope_id: w.scope_id, level: w.level, bounty: w.bounty, arrest_risk: Math.round(w.arrest_risk * 100) / 100 });
  }
  return { escalated };
}

function arrest(state, scopeId, turn) { const w = find(state, scopeId); if (w) { w.status = "jailed"; w.arrest_risk = 0; w.jailed_turn = turn; } return w; }
function serveTime(state, scopeId, turn) { const w = find(state, scopeId); if (w) { w.status = "cleared"; w.cleared_turn = turn; w.cleared_reason = "형기 종료"; } return w; }
function clear(state, scopeId, reason, turn) { const w = find(state, scopeId); if (w) { w.status = "cleared"; w.cleared_turn = turn; w.cleared_reason = reason || "사면"; } return w; }

// Apply extraction-provided wanted changes.
//   { crimes:[{scope_id,scope_label,reason,severity}], arrested:[scope_id], cleared:[{scope_id,reason}] }
function applyExtraction(state, changes, turn) {
  const out = { crimes: [], arrested: [], cleared: [] };
  if (!changes) return out;
  for (const c of changes.crimes || []) out.crimes.push(addCrime(state, c, turn).scope_id);
  for (const a of changes.arrested || []) { if (arrest(state, a, turn)) out.arrested.push(a); }
  for (const c of changes.cleared || []) { if (clear(state, c.scope_id || c, c.reason, turn)) out.cleared.push(c.scope_id || c); }
  return out;
}

function playerVisible(state) {
  return (state.wanted || []).filter((w) => w.status !== "cleared").map((w) => ({
    scope_id: w.scope_id, scope_label: w.scope_label, level: w.level, level_label: LEVEL_LABEL[w.level] || "수배",
    bounty: w.bounty, reason: w.reason, status: w.status, arrest_risk: Math.round((w.arrest_risk || 0) * 100),
  }));
}

// Scene directive when the player is somewhere they're wanted.
function directive(state, location, canonDb) {
  const ent = location && canonDb && canonDb.get(location);
  const region = (ent && ent.data && ent.data.region) || location;
  const factions = (ent && ent.data && ent.data.controlling_faction) ? [ent.data.controlling_faction] : [];
  const w = (state.wanted || []).find((x) => x.status === "wanted" && (x.scope_id === region || x.scope_id === location || factions.includes(x.scope_id)));
  if (!w) return null;
  return `수배 상태: 이 지역에서 플레이어는 "${LEVEL_LABEL[w.level]}"이며 현상금 ${w.bounty}이 걸려 있다(죄목: ${w.reason}). 경비·현상금 사냥꾼의 시선, 사람들의 수군거림을 긴장감으로 은근히 드러내라(단, 강제 체포로 몰지 말 것).`;
}

module.exports = { addCrime, tick, arrest, serveTime, clear, applyExtraction, playerVisible, directive, LEVEL_LABEL };
