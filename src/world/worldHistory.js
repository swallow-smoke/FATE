// Phase 16 · A-tier #9 — World History Book
//
// The campaign, read back as a chronicle. We compile the significant beats that
// already happened — Historical+ memories, resolved world events, place
// transformations, NPCs who fulfilled or lost their goals, generational
// turnover — into one time-ordered "history book" that grows the longer you
// play. Read-only aggregation over Memory + Canon + State (no writes), so it is
// always safe to call and unaffected by calm_mode.

"use strict";

// One flat, chronologically-sorted chronicle plus light chapter grouping.
function build(state, canonDb, memoryEngine) {
  const entries = [];
  const push = (turn, date, kind, text) => { if (text) entries.push({ turn: turn || 0, date: date || null, kind, text }); };

  // Historical / Cultural / Legendary memories are the backbone.
  for (const m of memoryEngine.all() || []) {
    if ((m.tier || 1) >= 3) push(m.timestamp.campaign_turn, m.timestamp.in_world_date, "사건", m.summary);
  }
  // Resolved world events.
  for (const ev of (state.world && state.world.active_events) || []) {
    if (ev.status === "resolved") push(ev.resolved_turn || ev.triggered_turn, null, "세계", `${ev.summary} (일단락)`);
  }
  // Place transformations (Living Places).
  for (const e of canonDb.all() || []) {
    if (e.type !== "World" || !e.data) continue;
    const name = (e.data.notable_features || [])[0] || e.data.region || e.canon_id;
    for (const h of e.data.place_history || []) push(h.turn, h.in_world_date, "장소", `${name}: ${h.from_stage} → ${h.to_stage} (${h.summary || ""})`);
  }
  // NPC goal outcomes (NPC Goal System).
  for (const e of canonDb.all() || []) {
    if (e.type !== "Character" || !e.data || !e.data.goal_state) continue;
    const gs = e.data.goal_state;
    if (gs.status === "achieved") push(gs.achieved_turn, null, "인물", `${e.data.birth_name || e.canon_id}가 뜻을 이루다: ${gs.goal}`);
    else if (gs.status === "failed") push(gs.failed_turn, null, "인물", `${e.data.birth_name || e.canon_id}의 뜻이 꺾이다: ${gs.goal}`);
  }
  // Generational turnover (Legacy Engine), if the predecessor left a mark.
  const legacy = state.player && state.player.legacy;
  if (legacy && legacy.world_memory_of_predecessor) push(0, null, "세대", legacy.world_memory_of_predecessor);

  entries.sort((a, b) => (a.turn || 0) - (b.turn || 0));

  // Chapter by generation if we have more than one; else a single volume.
  const generation = (state.player && state.player.generation) || 1;
  return {
    state,
    generation,
    total: entries.length,
    world_name: (state.meta && (state.meta.display_name || state.meta.world_name)) || null,
    chronicle: entries,
    counts: entries.reduce((acc, e) => { acc[e.kind] = (acc[e.kind] || 0) + 1; return acc; }, {}),
  };
}

// Optional LLM prose: turn the raw chronicle into a few narrated paragraphs.
// Called on demand (it costs tokens); falls back to the bullet list.
async function narrate(book, gemini, { lowToken = false } = {}) {
  if (lowToken || !gemini || !gemini.hasKey || !gemini.hasKey() || !(book.chronicle || []).length) return null;
  try {
    const promptSettings = require("../gemini/promptSettings");
    const body = book.chronicle.map((e) => `- (${e.date || e.turn + "턴"}) [${e.kind}] ${e.text}`).join("\n");
    return await gemini.summarize(promptSettings.getPrompt(book.state || null, "summary.world_history"), body, "world_history");
  } catch (_) { return null; }
}

module.exports = { build, narrate };
