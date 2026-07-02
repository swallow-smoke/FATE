// Phase 4 Part B2 — Ending System (built during Phase 5; was missing).
//
// When story_structure reaches Act 3 and a climax-grade catharsis scene has
// fired, the Kernel checks ending conditions. Ending narrative is NOT
// hardcoded — the flag combination picks a branch and Gemini narrates it.

// Which ending branch a flag combination maps to. Branches are generic on
// purpose: actual prose is generated per-campaign.
const BRANCHES = [
  { id: "ending_sacrifice", requires: (flags) => flags.some((f) => f.value === true && /sacrific|희생/.test(f.flag_id)), label: "희생의 결말" },
  { id: "ending_bond", requires: (flags) => flags.filter((f) => f.value === true && /(saved|helped|freed)_/.test(f.flag_id)).length >= 2, label: "유대의 결말" },
  { id: "ending_solitude", requires: (flags) => flags.some((f) => f.value === true && /(betrayed|killed)_/.test(f.flag_id)), label: "고독한 결말" },
  { id: "ending_open", requires: () => true, label: "열린 결말" }, // fallback
];

// Ending gate: Act 3 + a recent catharsis scene + no overdue foreshadow.
// Overdue foreshadow forces a recovery scene BEFORE the ending can fire.
function checkConditions(state) {
  if (state.ending && state.ending.reached) return { ready: false, reason: "already ended" };
  const act = (state.story_structure && state.story_structure.current_act) || "Act 1";
  if (act !== "Act 3") return { ready: false, reason: `current act is ${act}` };

  const recentCatharsis = (state.scene_history || []).slice(-5).some((h) => (h.scene_type || []).includes("catharsis"));
  if (!recentCatharsis) return { ready: false, reason: "no recent catharsis scene" };

  const overdue = (state.foreshadow_pool || []).filter((f) => !f.resolved && f.deadline_turn < state.turn_number);
  if (overdue.length) return { ready: false, reason: "unresolved overdue foreshadow", force_recovery: overdue.map((f) => f.id) };

  return { ready: true };
}

function pickBranch(state) {
  const flags = state.story_flags || [];
  return BRANCHES.find((b) => b.requires(flags)) || BRANCHES[BRANCHES.length - 1];
}

// Directive line for the Gemini call when the ending scene runs.
function endingDirective(branch) {
  return `이번 장면은 캠페인의 엔딩 장면이다 (분기: ${branch.label}). 지금까지의 서사를 이 분기의 정서로 매듭짓는 완결된 장면을 서술하라. 새 갈등을 시작하지 마라.`;
}

// Final summary payload for the "캠페인 완료" screen.
function buildSummary(state, healthMetrics) {
  const keyChoices = (state.story_flags || []).filter((f) => f.value === true).slice(-8).map((f) => f.flag_id);
  const relations = (state.npcs || []).map((n) => ({ canon_ref: n.canon_ref, rel: n.relationship_to_player }));
  return {
    ending_id: state.ending.ending_id,
    label: state.ending.label,
    turn: state.turn_number,
    key_choices: keyChoices,
    relations,
    health: healthMetrics || {},
  };
}

module.exports = { checkConditions, pickBranch, endingDirective, buildSummary, BRANCHES };
