// Phase 3 · Wave 2 · System 5 — Theme Director
//
// Picks the campaign's initial theme from Narrative DNA, then transitions it as
// Story Flags accumulate. Fills the theme_directive input to the Scene Composer
// (SceneComposer §2), which had been empty until now.

// Narrative DNA dimension -> starting theme (highest-weighted dimension wins).
const DNA_THEME = {
  survival: "생존",
  politics: "권력",
  romance: "사랑",
  emotion: "관계",
  mystery: "진실",
  horror: "공포",
  exploration: "모험",
  tone: "성장",
};

// Flag-keyword accumulation -> candidate theme transition.
const FLAG_TRANSITIONS = [
  { match: /betray|배신/i, threshold: 3, theme: "용서" },
  { match: /save|saved|구|살렸/i, threshold: 3, theme: "희생" },
  { match: /power|권력|왕/i, threshold: 3, theme: "권력" },
];

function initialTheme(narrativeDna) {
  const dna = narrativeDna || {};
  let best = "성장";
  let bestW = -1;
  for (const [dim, theme] of Object.entries(DNA_THEME)) {
    if ((dna[dim] || 0) > bestW) { bestW = dna[dim] || 0; best = theme; }
  }
  return best;
}

// Run each turn (cheap). Mutates state.theme; returns the theme_directive.
function run(state) {
  const theme = state.theme || (state.theme = { active_theme: null, theme_progress: 0, theme_history: [], weight_in_scene_selection: 0.3 });

  if (!theme.active_theme) {
    theme.active_theme = initialTheme(state.narrative_dna);
    theme.theme_history.push({ theme: theme.active_theme, turns: [state.turn_number, null] });
  }

  // Transition check: count flags matching each transition keyword.
  const flags = (state.story_flags || []).filter((f) => f.value === true);
  for (const t of FLAG_TRANSITIONS) {
    const count = flags.filter((f) => t.match.test(f.flag_id)).length;
    if (count >= t.threshold && theme.active_theme !== t.theme) {
      // close previous, open new
      const prev = theme.theme_history[theme.theme_history.length - 1];
      if (prev && prev.turns[1] === null) prev.turns[1] = state.turn_number;
      theme.active_theme = t.theme;
      theme.theme_progress = 0;
      theme.theme_history.push({ theme: t.theme, turns: [state.turn_number, null], reason: `${t.match} flag x${count}` });
      break;
    }
  }

  theme.theme_progress = Math.min(1, (theme.theme_progress || 0) + 0.02);

  return { active_theme: theme.active_theme, weight: theme.weight_in_scene_selection };
}

module.exports = { run, initialTheme };
