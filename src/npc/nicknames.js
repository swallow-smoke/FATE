// Phase 16 · A-tier #8 — Nickname System
//
// Every NPC addresses the player in their own way, and it shifts as the bond (or
// grudge) does: "그대" / "은인" / "배신자" / "북쪽의 검사" / "왕의 친구". Two layers:
//   · relationship tone  — derived from the player↔NPC edge dimensions
//   · deed epithet        — the player's reputation/identity (북쪽의 검사 …)
// A distant-but-respectful NPC uses your deed-name; an intimate one uses a warm
// address; an enemy a bitter one. Recomputed as relationships move; the chosen
// nickname is injected into the scene directive so the GM actually uses it.
//
// Rule-based and deterministic (no per-NPC LLM calls); safe under calm_mode.

"use strict";

// The player's current "deed name", if any. Phase 16+ — the Dynamic Title
// system is the source of truth; fall back to older signals for pre-title saves.
// `ctx` lets a specific NPC/region prefer a scope-matched title.
function deedEpithet(state, ctx) {
  try {
    const titles = require("../player/titles");
    const t = titles.pickForContext(state, ctx || {});
    if (t) return t;
  } catch (_) { /* titles module optional */ }
  const p = state.player || {};
  const ims = p.identity_milestones || [];
  if (ims.length && ims[ims.length - 1].to_trait) return ims[ims.length - 1].to_trait;
  if ((p.traits || []).length) return p.traits[p.traits.length - 1];
  const rep = (state.faction_reputation || []).find((r) => r.label && /영웅|적|친구|은인|공포|전설/.test(r.label));
  if (rep) return `${rep.faction_id || "어느 세력"}의 ${rep.label}`;
  return null;
}

// Choose a nickname for one edge. playerName is the fallback address.
function pickNickname(edge, playerName, epithet) {
  const e = edge || {};
  const name = playerName || "당신";
  // grudges first
  if ((e.hatred || 0) > 0.4) return e.type === "betrayed" || (e.guilt || 0) > 0.4 ? "배신자" : "원수";
  if ((e.fear || 0) > 0.6) return "두려운 자";
  if ((e.obsession || 0) > 0.55) return "나의 전부";
  // warmth/intimacy → a personal address
  if ((e.affection || 0) > 0.6) return "그대";
  if ((e.affection || 0) > 0.35 && (e.trust || 0) > 0.3) return "가까운 벗";
  if ((e.dependency || 0) > 0.5) return "의지가 되는 분";
  // respect/trust without much intimacy → deed-name if the player has one, else 은인/믿는 이
  if ((e.respect || 0) > 0.5) return epithet || "은인";
  if ((e.trust || 0) > 0.45) return epithet || "믿을 만한 이";
  // acquaintance → the deed-name reads well for someone who knows you by reputation
  if (epithet && ((e.respect || 0) > 0.15 || (e.trust || 0) > 0.15)) return epithet;
  return name;
}

// Recompute nicknames for every met NPC; record history on change.
// Returns [{ npc_ref, name, from, to }] for changed ones.
function updateAll(state, canonDb) {
  const playerName = (state.player && state.player.name) || "당신";
  const changes = [];
  for (const n of state.npcs || []) {
    const ent = canonDb.get(n.canon_ref);
    if (!ent || ent.type !== "Character" || !ent.data || !ent.data.discovered_by_player) continue;
    if (ent.data.no_player_relationship) continue;
    const prev = ent.data.player_nickname || null;
    // Phase 16+ — pick a title in THIS NPC's context (their faction/region).
    const epithet = deedEpithet(state, { faction: (ent.data.affiliations || [])[0], region: ent.data.current_location, lawful: true });
    const next = pickNickname(n.relationship_to_player, playerName, epithet);
    if (next && next !== prev) {
      ent.data.player_nickname = next;
      ent.data.player_nickname_history = [...(ent.data.player_nickname_history || []), { turn: state.turn_number, nickname: next }].slice(-10);
      changes.push({ npc_ref: n.canon_ref, name: ent.data.birth_name || n.canon_ref, from: prev, to: next });
    }
  }
  if (changes.length) canonDb.persist();
  return changes;
}

// Is this a distinctive nickname (worth surfacing/injecting), vs the bare
// fallback address (the player's own name or the generic "당신")?
function isDistinctive(state, nick) {
  if (!nick) return false;
  const playerName = (state.player && state.player.name) || "당신";
  return nick !== playerName && nick !== "당신";
}

// Nickname hints for the NPCs present in the scene, for prompt injection.
function present(state, canonDb, participants) {
  const out = [];
  for (const ref of participants || []) {
    const ent = canonDb.get(ref);
    const nick = ent && ent.data && ent.data.player_nickname;
    if (isDistinctive(state, nick)) out.push({ npc_ref: ref, name: ent.data.birth_name || ref, nickname: nick });
  }
  return out;
}

function directiveLine(hints) {
  if (!hints || !hints.length) return null;
  const parts = hints.map((h) => `${h.name}은(는) 플레이어를 "${h.nickname}"라 부른다`);
  return `호칭: ${parts.join("; ")}. 각 인물이 플레이어를 부를 때 이 호칭을 자연스럽게 사용하라(어색하면 생략 가능).`;
}

// Player-facing list for the relations tab.
function playerVisible(state, canonDb) {
  return (state.npcs || [])
    .map((n) => { const e = canonDb.get(n.canon_ref); return e && e.data && isDistinctive(state, e.data.player_nickname) ? { name: e.data.birth_name || n.canon_ref, nickname: e.data.player_nickname } : null; })
    .filter(Boolean);
}

module.exports = { updateAll, present, directiveLine, playerVisible, pickNickname, deedEpithet };
