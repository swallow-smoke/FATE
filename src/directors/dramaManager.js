// Phase 3 · Wave 2 · System 8 — Drama Manager
//
// Scene Economy (6 types) is structural; the Drama Manager layers TONE on top.
// mood is chosen from the player's resonance_profile + the active theme +
// Narrative DNA. Added to the SceneSpec and reflected in <scene_directive>.

const MOODS = ["comedy", "slice_of_life", "mystery", "horror", "romance", "political", "adventure"];

const THEME_MOOD = {
  사랑: "romance",
  관계: "slice_of_life",
  용서: "slice_of_life",
  희생: "romance",
  권력: "political",
  진실: "mystery",
  공포: "horror",
  생존: "adventure",
  모험: "adventure",
  성장: "slice_of_life",
};

// resonance tag -> mood bias
const RESONANCE_MOOD = { family: "slice_of_life", romance: "romance", combat: "adventure", mystery: "mystery", politics: "political", horror: "horror" };

function topResonance(profile) {
  const entries = Object.entries(profile || {});
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][1] > 0 ? entries[0][0] : null;
}

function selectMood(state, sceneType) {
  const dna = state.narrative_dna || {};
  const theme = state.theme && state.theme.active_theme;
  const resonance = topResonance(state.player.emotion_state.resonance_profile);

  // priority: strong resonance signal > theme mapping > DNA extremes > default
  if (resonance && RESONANCE_MOOD[resonance]) return RESONANCE_MOOD[resonance];
  if (theme && THEME_MOOD[theme]) return THEME_MOOD[theme];
  if ((dna.horror || 0) >= 4) return "horror";
  if ((dna.mystery || 0) >= 4) return "mystery";
  if ((dna.politics || 0) >= 4) return "political";
  // Conflict scenes lean adventurous; bonds lean slice_of_life.
  if ((sceneType || []).includes("conflict")) return "adventure";
  if ((sceneType || []).includes("bond")) return "slice_of_life";
  return "slice_of_life";
}

module.exports = { selectMood, MOODS };
