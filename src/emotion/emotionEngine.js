// Step 5 — Emotion Engine (04-Emotion/EmotionEngine.md)
//
// MVP: player scope only, three live fields (primary_emotion, intensity,
// fatigue_tracker). A per-turn fatigue check raises a "recovery needed" flag
// (EmotionEngine §11). NPC emotion is deferred.

const FATIGUE_THRESHOLD = 3; // §3 default
const COLLAPSE_INTENSITY = 5; // §4 — intensity 5 held 2+ turns forces recovery

// Contrast emotion to pivot to when a feeling has fatigued (§3 examples).
const CONTRAST = {
  grief: "quiet_relief",
  sadness: "small_warmth",
  tension: "calm",
  fear: "warmth",
  unease: "calm",
  anger: "quiet_resolve",
  despair: "new_hope",
  dread: "relief",
};

function contrastOf(emotion) {
  return CONTRAST[emotion] || "small_warmth";
}

// --- produce this turn's Emotion Directive (§8) --------------------------
// Reads the current emotion_state; decides target emotion / intensity and
// whether a recovery scene is required. Single-Director judgment (no Debate).
function produceDirective(emotionState, turn) {
  const wave = emotionState.current_wave || {};
  const primary = wave.primary_emotion || "calm";
  const intensity = wave.intensity ?? 0;
  const fatigue = (emotionState.fatigue_tracker || {})[primary] || 0;

  const collapseHeld =
    intensity >= COLLAPSE_INTENSITY && (wave.turns_at_current_intensity || 0) >= 2;
  const fatigued = fatigue >= FATIGUE_THRESHOLD;
  // §4 hard rule: an intensity 4+ scene must be followed by a rest scene.
  const highIntensityAftermath = intensity >= 4;
  const recovery = fatigued || collapseHeld || highIntensityAftermath;

  let directive;
  let reasoning;
  if (recovery) {
    directive = {
      primary_emotion: contrastOf(primary),
      intensity_target: 1,
      scene_type_hint: ["bond"],
      avoid: [primary, "conflict"],
      must_include: [],
      recovery_scene: true,
    };
    reasoning = collapseHeld
      ? `intensity ${intensity} held ${wave.turns_at_current_intensity} turns -> forced recovery`
      : highIntensityAftermath
      ? `intensity ${intensity} last turn -> mandatory rest scene (§4)`
      : `${primary} fatigue=${fatigue} >= ${FATIGUE_THRESHOLD} -> recovery, pivot to ${directive.primary_emotion}`;
  } else {
    directive = {
      primary_emotion: primary,
      intensity_target: Math.min(3, Math.max(intensity, 2)),
      scene_type_hint: ["discovery"],
      avoid: [],
      must_include: [],
      recovery_scene: false,
    };
    reasoning = `${primary} fatigue=${fatigue}, continue`;
  }

  // Emotional Addiction Prevention (Resonance Engine, Wave 3 §9): while a block
  // is active, avoid the over-used tag and pivot off it if it is our primary.
  const block = emotionState.addiction_block;
  if (block && turn < block.until) {
    if (!directive.avoid.includes(block.tag)) directive.avoid.push(block.tag);
    if (directive.primary_emotion === block.tag) {
      directive.primary_emotion = contrastOf(block.tag);
      reasoning += ` | addiction block on "${block.tag}" (${(block.ratio * 100) | 0}%) -> pivot to ${directive.primary_emotion}`;
    } else {
      reasoning += ` | addiction block on "${block.tag}" active`;
    }
  }

  return { turn, directive, reasoning_log: reasoning };
}

// --- post-turn wave update (§3) ------------------------------------------
// Applied after the narrative resolves, using the emotion the scene actually
// produced (from §5 extraction). Updates fatigue_tracker + recent_history.
function applyOutcome(emotionState, { primary_emotion, intensity }, turn) {
  const wave = emotionState.current_wave || {};
  const prevPrimary = wave.primary_emotion;
  const newPrimary = primary_emotion || prevPrimary || "calm";
  const newIntensity = intensity ?? wave.intensity ?? 0;

  // fatigue: same primary as last turn -> increment, else reset that emotion.
  emotionState.fatigue_tracker = emotionState.fatigue_tracker || {};
  if (newPrimary === prevPrimary) {
    emotionState.fatigue_tracker[newPrimary] = (emotionState.fatigue_tracker[newPrimary] || 0) + 1;
  } else {
    emotionState.fatigue_tracker[newPrimary] = 0;
  }

  emotionState.current_wave = {
    primary_emotion: newPrimary,
    secondary_emotion: wave.secondary_emotion || null,
    intensity: newIntensity,
    turns_at_current_intensity:
      newIntensity === wave.intensity ? (wave.turns_at_current_intensity || 0) + 1 : 0,
  };

  emotionState.recent_history = [...(emotionState.recent_history || []), newPrimary].slice(-12);
  emotionState.turn = turn;
  return emotionState;
}

// --- Catharsis condition (§6) --------------------------------------------
// Simplified for MVP: an emotion must have ACCUMULATED (a long run in
// recent_history, or high fatigue) AND a related Foreshadow/Flag must be
// recoverable now. The full 20-40 turn threshold is proxied by a shorter run
// so it is actually reachable in playtesting.
// PATCH 관계 전환 — relationshipTransition is an additional accumulation trigger:
// a relationship crossing a label boundary is itself an "earned" emotional peak,
// so it can tip a recoverable moment into Catharsis (still gated on something
// recoverable, to keep Catharsis from firing on every minor nudge).
function catharsisReady(emotionState, foreshadowRecoverable, relationshipTransition) {
  if (!foreshadowRecoverable) return false;
  const hist = emotionState.recent_history || [];
  const last = hist[hist.length - 1];
  let run = 0;
  for (let i = hist.length - 1; i >= 0 && hist[i] === last; i--) run++;
  const fatigueVals = Object.values(emotionState.fatigue_tracker || {});
  const maxFatigue = fatigueVals.length ? Math.max(...fatigueVals) : 0;
  const accumulated = run >= 4 || maxFatigue >= 4 || !!relationshipTransition;
  return accumulated;
}

module.exports = { produceDirective, applyOutcome, catharsisReady, FATIGUE_THRESHOLD, contrastOf };
