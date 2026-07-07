// PATCH_INDIVIDUAL_WORKS_ANALYSIS · Status-Window Visibility Mode
//
// The engine's iron rule is "never expose internal numbers." But an entire genre
// — LitRPG / 게임판타지 / 상태창물 — is *built* on a visible status window: levels,
// stats, skill numbers shown to the reader on purpose. This is a per-campaign,
// genre-scoped exception: when status_window_mode is on, a curated numeric window
// (player stats + explicitly game-like dynamic traits) becomes visible, and the
// prompt is told it may render that window. Everything OUTSIDE the window still
// obeys the no-numbers rule (hidden variables, relationship dims stay hidden).
//
// Modes: "off" (default — pure narrative), "litrpg" (full stat window),
// "minimal" (just a couple of headline stats). Built on the Dimension Registry
// lineage (a dynamic trait can be flagged game_stat to opt into the window).

"use strict";

const MODES = new Set(["off", "litrpg", "minimal"]);

function mode(state) {
  const m = state.settings && state.settings.status_window_mode;
  return MODES.has(m) ? m : "off";
}

function enabled(state) {
  return mode(state) !== "off";
}

// Genre exception: when the window is on, the prompt MAY show the window's
// numbers. Used by promptBlocks to relax the no-numbers rule for this block only.
function allowsNumbers(state) {
  return enabled(state);
}

// Build the visible window payload. Player base stats always qualify; dynamic
// traits qualify when flagged game_stat (or when the whole mode is litrpg and the
// trait is player-facing). Hidden variables NEVER appear here.
function build(state) {
  if (!enabled(state)) return { visible: false, mode: "off", stats: [], traits: [], level: null };
  const m = mode(state);
  const p = state.player || {};
  const statEntries = Object.entries(p.stats || {});
  const stats = (m === "minimal" ? statEntries.slice(0, 3) : statEntries).map(([label, value]) => ({ label, value, max: 5 }));
  const traits = (p.dynamic_traits || [])
    .filter((t) => t.visible_to_player !== false && (m === "litrpg" || t.game_stat))
    .map((t) => ({ label: t.name, value: Number((t.value || 0).toFixed(2)), max: 1, description: t.player_facing_description || t.name }));
  return {
    visible: true,
    mode: m,
    level: p.level != null ? p.level : (p.generation != null ? null : null),
    stats,
    traits,
  };
}

// Prompt directive permitting the window (scoped numeric exception). null when off.
function promptDirective(state) {
  if (!enabled(state)) return null;
  const w = build(state);
  const statText = w.stats.map((s) => `${s.label} ${s.value}/${s.max}`).join(", ");
  return `상태창 장르 모드(${w.mode}): 이 캠페인은 게임형 상태창을 노출하는 장르다. 아래 지정된 수치는 예외적으로 상태창 형식으로 보여줘도 된다 — ${statText || "(플레이어 스탯)"}. 단, 이 상태창에 지정되지 않은 내부 수치(관계 수치·숨은 변수·감정 강도 등)는 여전히 절대 노출하지 마라. 상태창은 장면 흐름을 해치지 않는 선에서 간결하게.`;
}

function setMode(state, m) {
  if (!MODES.has(m)) return { ok: false, reason: `unknown status_window_mode "${m}"` };
  state.settings = state.settings || {};
  state.settings.status_window_mode = m;
  return { ok: true, mode: m };
}

module.exports = { MODES, mode, enabled, allowsNumbers, build, promptDirective, setMode };
