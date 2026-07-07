// Phase 16+ · Festivals
//
// The world calendar breathes: 축제·기념일·종교 의식·국가 이벤트 recur each year and
// fire on their day whether or not the player planned for them. They are gentle,
// atmospheric world-motion — a festival is a gift to a quiet romance run — so
// unlike conflict-driven systems these keep firing under calm_mode. Firing pushes
// a World News notice, a scene directive, and (via Personal Calendar) a reminder.
//
// A year is modelled as 365 in-world days; day-of-year drives recurrence.

"use strict";

const YEAR = 365;

// Default recurring events. `kind`: festival | anniversary | religious | national.
const DEFAULT_FESTIVALS = [
  { id: "newyear", name: "신년제", kind: "national", day: 1, blurb: "새해를 맞아 거리마다 등불과 덕담이 오간다." },
  { id: "founding", name: "건국 기념일", kind: "national", day: 100, blurb: "나라의 시작을 기리는 행렬이 이어진다." },
  { id: "lantern", name: "등불절", kind: "festival", day: 150, blurb: "강 위로 소원을 실은 등불이 흘러간다." },
  { id: "harvest", name: "수확제", kind: "festival", day: 280, blurb: "한 해의 결실을 나누며 광장이 북적인다." },
  { id: "souls", name: "망자의 밤", kind: "religious", day: 310, blurb: "떠난 이들을 기리는 촛불이 창마다 놓인다." },
];

function dayOfYear(day) { return (((Number(day || 1) - 1) % YEAR) + YEAR) % YEAR + 1; }
function yearOf(day) { return Math.floor((Number(day || 1) - 1) / YEAR); }

function defs(state) {
  // allow campaign-specific festivals appended in state.festivals.defs later.
  return [...DEFAULT_FESTIVALS, ...((state.festivals && state.festivals.defs) || [])];
}

// Festivals whose day-of-year is today.
function activeOn(state, day) {
  const doy = dayOfYear(day != null ? day : state.in_world_day);
  return defs(state).filter((f) => dayOfYear(f.day) === doy);
}

// Upcoming festivals within `within` days (for the Personal Calendar).
function upcoming(state, within = 30) {
  const today = dayOfYear(state.in_world_day);
  return defs(state)
    .map((f) => { let d = dayOfYear(f.day) - today; if (d < 0) d += YEAR; return { ...f, in_days: d }; })
    .filter((f) => f.in_days > 0 && f.in_days <= within)
    .sort((a, b) => a.in_days - b.in_days);
}

// Fire any festival that starts today (once per year). Returns fired announcements.
function tick(state) {
  state.festivals = state.festivals || { fired: [], last_check_day: 0 };
  const day = state.in_world_day || 1;
  const yr = yearOf(day);
  const fired = [];
  for (const f of activeOn(state, day)) {
    if ((state.festivals.fired || []).some((x) => x.festival_id === f.id && x.year === yr)) continue;
    const rec = { festival_id: f.id, name: f.name, kind: f.kind, year: yr, day, turn: state.turn_number };
    state.festivals.fired = [...(state.festivals.fired || []), rec].slice(-60);
    fired.push({ ...rec, blurb: f.blurb });
  }
  state.festivals.last_check_day = day;
  return fired;
}

// Scene directive when a festival is happening today.
function directive(state) {
  const active = activeOn(state);
  if (!active.length) return null;
  const f = active[0];
  return `오늘은 «${f.name}»이다 — ${f.blurb} 이 분위기를 배경으로 자연스럽게 녹여라(플레이어가 원치 않으면 억지로 끌고 가지 말 것).`;
}

function playerVisible(state) {
  return {
    today: activeOn(state).map((f) => ({ name: f.name, kind: f.kind, blurb: f.blurb })),
    upcoming: upcoming(state, 60).map((f) => ({ name: f.name, kind: f.kind, in_days: f.in_days })),
    recent: (state.festivals && state.festivals.fired || []).slice(-10).reverse(),
  };
}

module.exports = { tick, activeOn, upcoming, directive, playerVisible, DEFAULT_FESTIVALS, YEAR, dayOfYear };
