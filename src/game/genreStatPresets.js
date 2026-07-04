// Phase 10 Part M1 — genre-based initial stat presets. A fixed table (not AI
// guessed) so the same world always starts with the same special stat, avoiding
// a mess of near-duplicate trait names. Registered once at campaign creation,
// exempt from the Kernel's trait rate limit (M1 note).

"use strict";

// tech_level → the dynamic trait a fresh character of that world starts with.
const PRESET_BY_TECH = {
  fantasy_low: { name: "마력", category: "supernatural", player_facing_description: "몸속에 잠든 마력의 기운" },
  fantasy_high: { name: "마력", category: "supernatural", player_facing_description: "선명하게 흐르는 마력" },
  sci_fi: { name: "기술 친화도", category: "social", player_facing_description: "기계와 시스템을 다루는 감각" },
  modern: { name: "전기 이해도", category: "social", player_facing_description: "전자기기와 네트워크에 대한 이해" },
  industrial: { name: "기계 이해도", category: "social", player_facing_description: "기계 장치를 다루는 손끝" },
  // medieval / ancient intentionally have no special stat (not every genre needs one).
};

function presetFor(techLevel) {
  return PRESET_BY_TECH[techLevel] || null;
}

// Register the preset directly on player.dynamic_traits (bypasses trait.create
// rate limit — this is a one-time setup, not an in-play event).
function addPresetTrait(state, name, category, desc) {
  state.player.dynamic_traits = state.player.dynamic_traits || [];
  if (state.player.dynamic_traits.some((t) => t.name === name)) return null;
  const trait = {
    trait_id: `trait_preset_${name}`,
    name, category,
    origin_event_turn: 0,
    origin_summary: "타고난 소양 (장르 기본 특성)",
    canon_refs: [], value: 0, trend: "stable", last_updated_turn: 0,
    visible_to_player: true, origin: "genre_preset",
    player_facing_description: desc || name,
  };
  state.player.dynamic_traits.push(trait);
  return trait;
}

function applyPreset(state) {
  const applied = [];
  const preset = presetFor(state.world && state.world.tech_level);
  if (preset) { const t = addPresetTrait(state, preset.name, preset.category, preset.player_facing_description); if (t) applied.push(t); }
  // Phase 15 CC — plugin-registered genre→stat presets (keyed by genre_preset).
  try {
    const pluginPresets = require("../plugins/plugins").traitPresets();
    const genre = String((state.meta && state.meta.genre_preset) || "").toLowerCase();
    if (genre && pluginPresets[genre]) { const t = addPresetTrait(state, pluginPresets[genre], "social", `${genre} 장르의 기본 소양`); if (t) applied.push(t); }
  } catch (_) {}
  return applied.length ? applied[0] : null;
}

module.exports = { presetFor, applyPreset, PRESET_BY_TECH };
