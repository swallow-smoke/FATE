// Phase 3 · Wave 3 · System 9 — Emotional Resonance Engine (full)
//
// EmotionEngine §5 had only the schema. This computes resonance_profile every
// N turns from the emotion_tags of the window + player-engagement weighting
// (longer/more frequent responses = immersion). Includes Emotional Addiction
// Prevention: if one tag dominates >= 60% of the window, the next 5 turns block
// that tag so the campaign does not fixate on one feeling.

const ADDICTION_RATIO = 0.6;
const ADDICTION_BLOCK_TURNS = 5;

// engagement weight from player response length (immersion proxy).
function immersionWeight(len) {
  return 1 + Math.min(2, (len || 0) / 80);
}

// Recompute on the resonance period. Returns { profile, addiction_block } or
// null when not due. Mutates state.player.emotion_state.
function recompute(state) {
  const period = (state.settings && state.settings.resonance_period) || 30;
  const turn = state.turn_number;
  if (turn === 0 || turn % period !== 0) return null;

  const log = (state.engagement_log || []).filter((e) => e.turn > turn - period);
  const weights = {};
  let total = 0;
  for (const e of log) {
    const w = immersionWeight(e.player_len);
    for (const tag of e.tags || []) {
      weights[tag] = (weights[tag] || 0) + w;
      total += w;
    }
  }
  const profile = {};
  if (total > 0) for (const [t, w] of Object.entries(weights)) profile[t] = +(w / total).toFixed(3);

  state.player.emotion_state.resonance_profile = profile;

  // Addiction prevention
  let addiction_block = null;
  const top = Object.entries(profile).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= ADDICTION_RATIO) {
    addiction_block = { tag: top[0], until: turn + ADDICTION_BLOCK_TURNS, ratio: top[1] };
    state.player.emotion_state.addiction_block = addiction_block;
  }
  return { profile, addiction_block };
}

module.exports = { recompute, ADDICTION_RATIO };
