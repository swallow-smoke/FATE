// Phase 16+ · Organization System
//
// Guilds, orders, courts, cults — organisations with 계급(ranks)·본부(hq)·규칙
// (rules)·자금(funds)·적대 조직(rivals), which the player can JOIN and climb. An
// org may wrap an existing Faction canon entity (faction_ref). Membership feeds
// Dynamic Title (조직의 {rank}). Funds/rivalry drift on their own — autonomous
// world motion, quiet under calm_mode.

"use strict";

let seq = 0;

function get(state, id) { return (state.organizations || []).find((o) => o.id === id) || null; }

function register(state, { id, name, hq, ranks, rules, rivals, faction_ref }, turn) {
  state.organizations = state.organizations || [];
  const oid = id || (`org_${++seq}`);
  let o = get(state, oid);
  if (o) return o;
  o = {
    id: oid, name: name || oid, hq: hq || null, faction_ref: faction_ref || null,
    ranks: ranks && ranks.length ? ranks : ["수습", "정회원", "간부", "장로"],
    rules: rules || [], funds: typeof arguments[0].funds === "number" ? arguments[0].funds : 100,
    rivals: rivals || [], member: null, registered_turn: turn,
  };
  state.organizations.push(o);
  return o;
}

function join(state, id, rank, turn) {
  const o = get(state, id);
  if (!o) return null;
  o.member = { rank: rank || o.ranks[0], joined_turn: turn };
  return o;
}
function promote(state, id, rank, turn) {
  const o = get(state, id);
  if (!o || !o.member) return null;
  const idx = o.ranks.indexOf(rank);
  o.member.rank = rank || o.ranks[Math.min(o.ranks.indexOf(o.member.rank) + 1, o.ranks.length - 1)];
  o.member.promoted_turn = turn;
  return o;
}
function leave(state, id) { const o = get(state, id); if (o) o.member = null; return o; }

// Autonomous drift: funds ebb and flow, rivalries simmer. Quiet under calm.
function tick(state, { calm = false } = {}) {
  const turn = state.turn_number;
  if (calm || turn === 0 || turn % 20 !== 0) return { changes: [] };
  const changes = [];
  for (const o of state.organizations || []) {
    const before = o.funds || 0;
    o.funds = Math.max(0, Math.round(before + (Math.random() - 0.45) * 30));
    if (o.funds !== before) changes.push({ id: o.id, funds: o.funds });
  }
  return { changes };
}

// Apply narrative-detected changes: { registered:[...], joined:[{id,rank}], promoted:[{id,rank}], left:[id] }.
function applyExtraction(state, changes, turn) {
  const out = { registered: [], joined: [], promoted: [], left: [] };
  if (!changes) return out;
  for (const r of changes.registered || []) out.registered.push(register(state, r, turn).id);
  for (const j of changes.joined || []) { const o = join(state, j.id, j.rank, turn); if (o) out.joined.push(o.id); }
  for (const p of changes.promoted || []) { const o = promote(state, p.id, p.rank, turn); if (o) out.promoted.push(o.id); }
  for (const l of changes.left || []) { if (leave(state, l)) out.left.push(l); }
  return out;
}

function playerVisible(state) {
  return (state.organizations || []).map((o) => ({
    id: o.id, name: o.name, hq: o.hq, ranks: o.ranks, rules: o.rules, funds: o.funds, rivals: o.rivals,
    member: o.member ? { rank: o.member.rank } : null,
  }));
}

module.exports = { register, join, promote, leave, tick, applyExtraction, playerVisible, get };
