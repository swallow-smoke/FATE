// PATCH_IP_EXTENSIONS_PROJECT_MIO · Multiple Dice Pools
//
// The Phase-4 skillCheck is a single implicit 1d20 test. Some systems (and the
// Mio TRPG sheet) want several *named* dice pools — different resources rolled
// with different dice: "마력 3d6", "운명 1d20", "평판 2d10+2". This adds
// configurable per-campaign pools and an explicit roll, distinct from the
// automatic skill check. Rolls are deterministic-testable (an injectable rng)
// and, like every check, only the OUTCOME is meant for the narrative — raw dice
// stay in the dev/advanced layer unless the campaign runs a status-window genre.
//
// Config lives in state.dice_pools; skillCheck stays the default uncertain-action
// path. calm_mode is irrelevant (pools only roll when explicitly invoked).

"use strict";

const MAX_POOLS = 12;
const DEFAULT_DC = 12;

function ensure(state) {
  if (!Array.isArray(state.dice_pools)) state.dice_pools = [];
  return state.dice_pools;
}

// Define / replace a named pool. spec: { id?, name, faces, count, modifier?, dc? }
function define(state, spec) {
  const pools = ensure(state);
  const name = String((spec && spec.name) || "").trim();
  const faces = Number(spec && spec.faces);
  const count = Number(spec && spec.count);
  if (!name) return { ok: false, reason: "pool name required" };
  if (!Number.isInteger(faces) || faces < 2 || faces > 100) return { ok: false, reason: "faces must be 2..100" };
  if (!Number.isInteger(count) || count < 1 || count > 20) return { ok: false, reason: "count must be 1..20" };
  const id = (spec.id && String(spec.id)) || ("pool_" + name.replace(/\s+/g, "_").toLowerCase());
  const pool = {
    pool_id: id,
    name,
    faces,
    count,
    modifier: Number(spec.modifier) || 0,
    dc: Number.isFinite(Number(spec.dc)) ? Number(spec.dc) : DEFAULT_DC,
  };
  const i = pools.findIndex((p) => p.pool_id === id);
  if (i >= 0) pools[i] = pool;
  else {
    if (pools.length >= MAX_POOLS) return { ok: false, reason: `too many pools (max ${MAX_POOLS})` };
    pools.push(pool);
  }
  return { ok: true, pool };
}

function remove(state, poolId) {
  const pools = ensure(state);
  const i = pools.findIndex((p) => p.pool_id === poolId);
  if (i < 0) return { ok: false, reason: "pool not found" };
  pools.splice(i, 1);
  return { ok: true, removed: poolId };
}

// Roll a named pool. rng() → [0,1). Returns dice + total + outcome word.
function roll(state, poolId, { rng = Math.random, bonus = 0 } = {}) {
  const pool = ensure(state).find((p) => p.pool_id === poolId || p.name === poolId);
  if (!pool) return { ok: false, reason: "pool not found" };
  const dice = [];
  for (let i = 0; i < pool.count; i++) dice.push(1 + Math.floor(rng() * pool.faces));
  const sum = dice.reduce((a, b) => a + b, 0);
  const total = sum + (pool.modifier || 0) + (Number(bonus) || 0);
  const dc = pool.dc || DEFAULT_DC;
  let outcome;
  if (total >= dc + 4) outcome = "success";
  else if (total >= dc - 2) outcome = "partial";
  else outcome = "fail";
  return {
    ok: true,
    pool_id: pool.pool_id, name: pool.name,
    dice, notation: `${pool.count}d${pool.faces}${pool.modifier ? (pool.modifier > 0 ? "+" + pool.modifier : pool.modifier) : ""}`,
    total, dc, outcome,
  };
}

// The line handed to the scene directive — outcome words only, no raw dice.
function directiveLine(rollResult) {
  if (!rollResult || !rollResult.ok) return null;
  const map = { success: "성공", partial: "부분 성공(대가가 따름)", fail: "실패" };
  return `[${rollResult.name}] 판정 결과: ${map[rollResult.outcome]}로 서술하라. 구체적 수치는 언급하지 마라.`;
}

module.exports = { ensure, define, remove, roll, directiveLine, MAX_POOLS };
