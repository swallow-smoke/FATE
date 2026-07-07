// Phase 16+ · Personal Calendar
//
// The player's own datebook: 약속·생일·기념일·축제·예약. It auto-absorbs upcoming
// Festivals and open Promises so everything the player should remember lives in
// one place, and it fires a gentle reminder as a date approaches (injected into
// the scene directive). Absolute in_world_day is the key. System-first: dates are
// state; the AI only surfaces the reminder in prose.

"use strict";

const KINDS = { promise: "약속", birthday: "생일", anniversary: "기념일", festival: "축제", reservation: "예약" };

let seq = 0;

function add(state, { title, kind = "reservation", day, source = null }, turn) {
  state.personal_calendar = state.personal_calendar || [];
  if (source && state.personal_calendar.some((e) => e.source === source)) return null; // dedupe
  seq += 1;
  const entry = { id: `cal_${String(turn || 0).padStart(4, "0")}_${seq}`, title: title || KINDS[kind] || "일정", kind: KINDS[kind] ? kind : "reservation", day, created_turn: turn, done: false, source };
  state.personal_calendar.push(entry);
  return entry;
}

// Pull upcoming festivals + open promises into the datebook (idempotent by source).
function sync(state) {
  const today = state.in_world_day || 1;
  // Festivals within 60 days.
  try {
    const festivals = require("../world/festivals");
    for (const f of festivals.upcoming(state, 60)) add(state, { title: f.name, kind: "festival", day: today + f.in_days, source: `festival:${f.id}` }, state.turn_number);
  } catch (_) {}
  // Open promises with a due day.
  for (const p of state.promises || []) {
    if (p.status === "open" && p.due_day) add(state, { title: p.summary || "약속", kind: "promise", day: p.due_day, source: `promise:${p.id}` }, state.turn_number);
  }
}

function upcoming(state, within = 90) {
  const today = state.in_world_day || 1;
  return (state.personal_calendar || [])
    .filter((e) => !e.done && e.day != null && e.day >= today && e.day - today <= within)
    .map((e) => ({ ...e, in_days: e.day - today }))
    .sort((a, b) => a.in_days - b.in_days);
}

// Entries due today or tomorrow → reminder. Also expire entries whose day passed.
function tick(state) {
  sync(state);
  const today = state.in_world_day || 1;
  const due = [];
  for (const e of state.personal_calendar || []) {
    if (e.done || e.day == null) continue;
    if (e.day <= today) { e.done = true; if (e.day === today) due.push(e); }
    else if (e.day - today <= 2) due.push(e);
  }
  return { due };
}

function reminderDirective(state) {
  const due = (state.personal_calendar || []).filter((e) => e.day != null && e.day - (state.in_world_day || 1) >= 0 && e.day - (state.in_world_day || 1) <= 2 && !e._reminded);
  if (!due.length) return null;
  const parts = due.map((e) => { const d = e.day - (state.in_world_day || 1); return `${e.title}(${d === 0 ? "오늘" : d + "일 뒤"})`; });
  return `다가오는 일정: ${parts.join(", ")}. 플레이어의 머릿속에 스치는 정도로 자연스럽게 상기시켜라(강요하지 말 것).`;
}

function playerVisible(state) {
  return upcoming(state, 120).map((e) => ({ title: e.title, kind: e.kind, kind_label: KINDS[e.kind] || e.kind, in_days: e.in_days, day: e.day }));
}

module.exports = { add, sync, tick, upcoming, reminderDirective, playerVisible, KINDS };
