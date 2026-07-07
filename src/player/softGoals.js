// PATCH_IP_EXTENSIONS_PROJECT_MIO · Soft Goal Checklist
//
// Unlike a Dynamic Quest (an engine-tracked objective with mechanical steps) a
// soft goal is a *non-binding intention* the player or GM jots down: "미오와
// 화해한다", "도서관의 비밀을 알아본다", "이번 학기를 무사히 넘긴다". Nothing forces
// them; they're a gentle checklist the player can tick, and the GM is softly
// aware of them so play can drift toward what the player actually cares about —
// without railroading. Player-facing and player-owned (not extracted/auto-added,
// though the GM may mark one fulfilled when it clearly happens).

"use strict";

const MAX = 12;

function ensure(state) {
  if (!Array.isArray(state.soft_goals)) state.soft_goals = [];
  return state.soft_goals;
}

function add(state, text, source) {
  const goals = ensure(state);
  const t = String(text || "").trim();
  if (!t) return { ok: false, reason: "goal text required" };
  if (goals.filter((g) => !g.done).length >= MAX) return { ok: false, reason: `too many active goals (max ${MAX})` };
  const g = {
    goal_id: "sg_" + String(goals.length + 1).padStart(3, "0"),
    text: t.slice(0, 200),
    done: false,
    created_turn: state.turn_number,
    done_turn: null,
    source: source || "player",
  };
  goals.push(g);
  return { ok: true, goal: g };
}

function toggle(state, goalId, done) {
  const g = ensure(state).find((x) => x.goal_id === goalId);
  if (!g) return { ok: false, reason: "goal not found" };
  g.done = done == null ? !g.done : !!done;
  g.done_turn = g.done ? state.turn_number : null;
  return { ok: true, goal: g };
}

function remove(state, goalId) {
  const goals = ensure(state);
  const i = goals.findIndex((x) => x.goal_id === goalId);
  if (i < 0) return { ok: false, reason: "goal not found" };
  const [g] = goals.splice(i, 1);
  return { ok: true, removed: g.goal_id };
}

// Extraction can quietly mark a soft goal fulfilled when the story clearly hits
// it (soft_goal_progress: [{ goal_id, done:true }]). Never adds goals.
function applyExtraction(state, changes, turn) {
  const done = [];
  for (const c of changes || []) {
    const g = ensure(state).find((x) => x.goal_id === c.goal_id);
    if (g && c.done && !g.done) { g.done = true; g.done_turn = turn; done.push(g.goal_id); }
  }
  return done;
}

// Soft prompt awareness: the still-open goals, framed as "what the player is
// reaching for" — the GM leans toward these when natural, never forces them.
function promptDirective(state) {
  const open = ensure(state).filter((g) => !g.done);
  if (!open.length) return null;
  return `플레이어가 마음에 둔 목표(강제 아님): ${open.slice(0, 5).map((g) => g.text).join(" · ")}. 자연스러운 흐름 안에서 이쪽으로 기회를 열어두되, 억지로 밀어붙이거나 체크리스트처럼 처리하지 마라.`;
}

module.exports = { ensure, add, toggle, remove, applyExtraction, promptDirective, MAX };
