// Phase 4 Part B1 — Dice / SkillCheck (built during Phase 5; was missing).
//
// The Story/Scene layer decides IF a check is needed (rule: narratively
// predetermined scenes skip the check; genuinely uncertain actions roll).
// Numbers (roll, DC) are NEVER shown in the narrative — only the outcome word.

const SKILLS = ["설득", "전투", "은신", "지식", "직감"];

// Keyword heuristic standing in for the Director decision. Crafting ("조합")
// also routes through here (Phase 5: one narrative check, no recipe grid).
const TRIGGERS = [
  { re: /(설득|협상|구슬|회유|담판)/, skill: "설득" },
  { re: /(싸우|공격|베|막아|전투|제압|주먹)/, skill: "전투" },
  { re: /(숨|잠입|몰래|미행|훔치)/, skill: "은신" },
  { re: /(조사|해독|분석|기억해|알아내|연구)/, skill: "지식" },
  { re: /(직감|느낌|눈치|간파)/, skill: "직감" },
  { re: /(조합|결합|합쳐|만들어|제작)/, skill: "지식", crafting: true },
];

let seq = 0;

// Returns null (no check needed) or a check result object.
function maybeCheck(state, playerInput, force) {
  const hit = TRIGGERS.find((t) => t.re.test(playerInput)) || (force ? { skill: "직감" } : null);
  if (!hit) return null;

  const stats = (state.player && state.player.stats) || {};
  const modifier = Number(stats[hit.skill] || 0);

  // Phase 7 C2 — Difficulty Director tunes the DC. It only ever RAISES the bar
  // on a success streak (keeps the world honest); a failure streak is handled
  // by the scene/reward tone, never by making the roll easier.
  const dd = state.difficulty_director || {};
  const last3 = (dd.recent_checks || []).slice(-3);
  const streakWin = last3.length >= 3 && last3.every((c) => c.outcome === "success");
  const difficulty_modifier = streakWin ? 2 : 0;
  const difficulty_modifier_source = streakWin ? "difficulty_director:success_streak" : null;
  const difficulty = 12 + difficulty_modifier; // baseline DC + director tuning
  const result = 1 + Math.floor(Math.random() * 20);
  const total = result + modifier;

  let outcome;
  if (total >= difficulty + 4) outcome = "success";
  else if (total >= difficulty - 2) outcome = "partial";
  else outcome = "fail";

  // Phase 8 C2 — a check the player framed as life-or-death is tagged so a
  // failure can route into the (confirmation-gated) generation transition.
  const life_or_death = /(목숨을 걸|죽음을 무릅|생사|치명적|죽느냐|사느냐)/.test(playerInput);

  seq += 1;
  return {
    check_id: `chk_${String(state.turn_number).padStart(4, "0")}_${seq}`,
    skill: hit.skill,
    crafting: !!hit.crafting,
    life_or_death,
    difficulty,
    difficulty_modifier_source,
    roll: { dice: "1d20", result, modifier, total },
    outcome,
    narrative_weight: hit.crafting || hit.skill === "전투" ? "major" : "minor",
  };
}

// The line injected into <scene_directive>. Words only — no numbers.
function directiveLine(check) {
  const map = { success: "성공", partial: "부분 성공(대가 또는 복잡함이 따름)", fail: "실패" };
  const what = check.crafting ? "아이템 조합 시도" : `${check.skill} 시도`;
  return `판정 결과: 플레이어의 ${what}은(는) ${map[check.outcome]}로 서술할 것. 판정 수치는 절대 언급 금지.`;
}

module.exports = { maybeCheck, directiveLine, SKILLS };
