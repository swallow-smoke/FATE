// Phase 3 · Wave 1 · System 4 — Living NPC (offscreen progression)
//
// On a periodic cadence (default every 100 turns) each NPC's goal_current is
// checked against resolved World Simulation events. If a resolved event touches
// the NPC's faction, the goal is treated as having progressed offscreen and the
// NPC's Canon state changes via canon.update — so the player meets a changed
// NPC later. Generation turnover (marriage/birth/death) is Wave 4, not here.

function due(state) {
  const period = (state.settings && state.settings.living_npc_period) || 100;
  const turn = state.turn_number;
  return turn > 0 && turn % period === 0;
}

// Advance NPC goals offscreen. Returns a list of changes for the debug trace.
function progress(state, canonDb, memoryEngine, kernel) {
  if (!due(state)) return [];
  const turn = state.turn_number;
  const resolvedFactions = new Set(
    (state.world.active_events || [])
      .filter((e) => e.status === "resolved")
      .flatMap((e) => e.affected_factions || [])
  );

  const changes = [];
  for (const npc of canonDb.all().filter((e) => e.type === "Character")) {
    const goal = npc.data.goal_current;
    if (!goal || npc.data.goal_progressed_turn) continue;
    const touches = (npc.data.affiliations || []).some((a) => resolvedFactions.has(a));
    if (!touches) continue;

    // Goal progressed offscreen — reflect it in Canon (mutable fields only).
    const newStatus = `${npc.data.current_status || "alive"} · 목표 진전: ${goal}`;
    kernel.request(state, "living_npc", "canon.update", { canon_id: npc.canon_id, field: "current_status", new_value: newStatus });
    kernel.request(state, "living_npc", "canon.update", { canon_id: npc.canon_id, field: "goal_progressed_turn", new_value: turn });

    memoryEngine.write(
      {
        summary: `${npc.data.birth_name || npc.canon_id}는 오프스크린에서 목표를 향해 나아갔다: ${goal}`,
        participants: [npc.canon_id],
        emotion_tags: ["resolve"],
        emotion_intensity: 2,
        canon_refs: [npc.canon_id],
        tier: 2,
        tier_reason: "living NPC offscreen progress",
      },
      turn
    );
    changes.push({ canon_id: npc.canon_id, goal, newStatus });
  }
  return changes;
}

module.exports = { progress, due };
