// Step 6 (+ Phase 2 step 2, + Phase 3 Wave 2) — Scene Composer
//
// Now merges the full Director set: Emotion + Story + Rhythm + Theme, plus the
// Drama Manager (mood) and a real Director Debate on conflict (no more hardcoded
// "Emotion always wins"). scene_type spans all 6 types; low-intensity scenes
// cycle Bond/Discovery/Reflection; Catharsis stays gated.

const directorDebate = require("../directors/directorDebate");
const dramaManager = require("../directors/dramaManager");

const LOW_INTENSITY_TYPES = ["bond", "discovery", "reflection"];
const RECOVERY_TYPES = ["bond", "reflection"];

function pickSceneType(allowed, recentTypes) {
  const recent = new Set(recentTypes);
  return allowed.find((t) => !recent.has(t)) || allowed[0];
}

// inputs: { emotion_directive, story_directive, rhythm_directive,
//           theme_directive, sceneHistory, turn, state }
function compose(inputs) {
  const emotionDirective = inputs.emotion_directive;
  const sd = inputs.story_directive || {};
  const rhythm = inputs.rhythm_directive || { avoid_scene_types: [], intensity_spike: null };
  const theme = inputs.theme_directive || {};
  const sceneHistory = inputs.sceneHistory;
  const turn = inputs.turn;
  const ed = emotionDirective.directive;

  let intensity = ed.intensity_target ?? 2;
  const recentTypes = (sceneHistory || []).slice(-3).flatMap((h) => h.scene_type || []);

  // --- Director Debate (Wave 2 §7) ---------------------------------------
  const debate = directorDebate.resolve({ emotion: emotionDirective, story: sd, rhythm });

  let allowed;
  let note;

  if (sd.catharsis_ready) {
    allowed = ["catharsis"];
    intensity = Math.max(4, intensity);
    note = "catharsis condition met -> Catharsis";
  } else if (debate.occurred && debate.decision.allowed) {
    allowed = [...debate.decision.allowed];
    if (debate.decision.intensity_target != null) intensity = debate.decision.intensity_target;
    note = `debate -> ${debate.reasoning_log}`;
  } else if (ed.recovery_scene) {
    allowed = [...RECOVERY_TYPES];
    note = "recovery scene -> Bond/Reflection (Emotion Directive priority)";
  } else {
    const urgency = sd.urgency || "medium";
    // Phase 6 E — "사건 필요해": a player-forced beat overrides the low-intensity
    // gate so a real event actually lands next turn, not just a mood shift.
    if (urgency === "forced_high") intensity = Math.max(intensity, 3);
    const hint = (ed.scene_type_hint || []).filter((t) => ["conflict", "bond", "discovery", "reflection", "transition"].includes(t));
    if (intensity <= 2) {
      const hintLow = hint.filter((t) => LOW_INTENSITY_TYPES.includes(t));
      allowed = [...new Set([...hintLow, ...LOW_INTENSITY_TYPES])];
    } else if (urgency === "high" || urgency === "forced_high") {
      allowed = [...new Set([...hint, "discovery", "conflict", "transition", "reflection"])];
    } else {
      allowed = [...new Set([...hint, "discovery", "reflection", "transition", "bond"])];
    }
    allowed = allowed.filter((t) => t !== "catharsis");

    // Rhythm Director: intensity spike when the pace is flat (Wave 2 §6).
    if (rhythm.intensity_spike === "low") intensity = Math.min(intensity, 1);
    else if (rhythm.intensity_spike === "high") intensity = Math.max(intensity, 4);
    // re-apply low filter if a low spike dropped us into the low band
    if (intensity <= 2) allowed = allowed.filter((t) => LOW_INTENSITY_TYPES.includes(t));
    if (intensity >= 4 && !allowed.includes("conflict")) allowed.unshift("conflict");

    note = `urgency=${urgency}, intensity=${intensity}`;
  }

  // Apply Rhythm avoid + debate avoid (keep at least one candidate).
  const avoidTypes = new Set([...(rhythm.avoid_scene_types || []), ...((debate.decision && debate.decision.avoid) || [])]);
  if (!sd.catharsis_ready) {
    const filtered = allowed.filter((t) => !avoidTypes.has(t));
    if (filtered.length) allowed = filtered;
  }
  if (!allowed.length) allowed = ["bond"];

  const chosen = pickSceneType(allowed, recentTypes);
  if (recentTypes.includes(chosen)) note += ` | NOTE: "${chosen}" repeats within 3 turns`;

  // participants / refs from the Story Director.
  const involved = sd.involved_canon_refs || [];
  const explicitParticipants = sd.participants || involved.filter((r) => !r.startsWith("foreshadow"));
  const participants = ["player", ...explicitParticipants];
  const foreshadowRefs = sd.foreshadow_refs || involved.filter((r) => r.startsWith("foreshadow"));
  const must_include = [...new Set([
    ...(ed.must_include || []),
    ...foreshadowRefs,
    ...((debate.decision && debate.decision.must_include) || []),
  ])];

  // Drama Manager: mood on top of the structural scene_type (Wave 2 §8).
  const mood = inputs.state ? dramaManager.selectMood(inputs.state, [chosen]) : "slice_of_life";

  // Wave 4 §15 — Inner Conflict: a single hint on charged conflict scenes.
  // Minimal by design (not a separate system) — just one directive field.
  const inner_voice_hint =
    (chosen === "conflict" || chosen === "catharsis") && intensity >= 3
      ? "이 선택의 순간, 플레이어 내면의 상반된 목소리(이성/감정/두려움/용기)를 한두 문장으로 짧게 대비시켜라."
      : null;

  return {
    turn,
    scene_type: [chosen],
    mood,
    intensity,
    primary_emotion: ed.primary_emotion,
    participants,
    location: sd.location || null,
    must_include,
    avoid: ed.avoid || [],
    subtext_theme: theme.active_theme || null,
    tone_notes:
      chosen === "catharsis"
        ? "축적된 감정이 터지는 순간. 절제 없이 정면으로 다뤄라."
        : intensity <= 1
        ? "사건보다 분위기와 묘사 중심. 대사는 절제할 것."
        : "장면의 목적을 분명히 하되 감정 강도에 맞춰 서술.",
    banned_repetition: [...new Set(recentTypes)],
    inner_voice_hint,
    canon_refs: involved,
    _compose_note: note,
    _debate: debate.occurred ? { log: debate.log, reasoning_log: debate.reasoning_log } : null,
  };
}

module.exports = { compose, LOW_INTENSITY_TYPES };
