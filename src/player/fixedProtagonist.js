// PATCH_IP_EXTENSIONS_PROJECT_MIO · Fixed Protagonist Mode
//
// In an IP campaign (Project Mio) the player doesn't roll a blank custom PC —
// they step into a *specific, canon* character (미오) with an established
// personality, history, and voice. Fixed-protagonist mode binds the player to a
// Canon Character: their psychology/background inform how the world reads them,
// the GM keeps them in character, yet the player-agency lock still holds (the GM
// never decides their actions). This is the setting + the prompt directive; the
// bound entity is force-included in the canon context every turn.
//
// Coexists with the default free-PC mode (enabled=false). Read-only over Canon.

"use strict";

function config(state) {
  const c = state.settings && state.settings.fixed_protagonist;
  return c && c.enabled && c.canon_ref ? c : null;
}

function enabled(state) {
  return !!config(state);
}

function set(state, { enabled, canon_ref }, canonDb) {
  state.settings = state.settings || {};
  if (!enabled) { state.settings.fixed_protagonist = { enabled: false, canon_ref: null }; return { ok: true, fixed_protagonist: state.settings.fixed_protagonist }; }
  if (!canon_ref) return { ok: false, reason: "canon_ref required when enabling fixed protagonist" };
  const ent = canonDb && canonDb.get(canon_ref);
  if (!ent || ent.type !== "Character") return { ok: false, reason: `canon_ref "${canon_ref}" is not a registered Character` };
  state.settings.fixed_protagonist = { enabled: true, canon_ref };
  return { ok: true, fixed_protagonist: state.settings.fixed_protagonist, name: (ent.data && ent.data.birth_name) || canon_ref };
}

// The canon_ref the player is bound to (or null). turn.js force-includes this in
// the scene's canon refs so the protagonist's own sheet is always in context.
function boundRef(state) {
  const c = config(state);
  return c ? c.canon_ref : null;
}

// Prompt directive: play as this canon character. Kept compatible with the
// player-agency lock (we describe who they ARE, not what they DO).
function promptDirective(state, canonDb) {
  const c = config(state);
  if (!c) return null;
  const ent = canonDb && canonDb.get(c.canon_ref);
  const name = (ent && ent.data && ent.data.birth_name) || c.canon_ref;
  return `고정 주인공 모드: 플레이어는 커스텀 캐릭터가 아니라 정해진 인물 "${name}"을(를) 연기한다. 이 인물의 성격·말투·내력·가치관(Canon에 정의됨)에 맞게 세계와 NPC가 그를 대하도록 하라. 단, 플레이어 캐릭터의 다음 행동·대사·선택은 여전히 AI가 정하지 말고 플레이어 입력을 기다려라 — 정해진 것은 '그가 누구인가'이지 '그가 무엇을 할 것인가'가 아니다.`;
}

module.exports = { config, enabled, set, boundRef, promptDirective };
