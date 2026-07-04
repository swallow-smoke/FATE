// Phase 13 V9 — Narrative Scheduler.
//
// A single home for every "how many turns between X" cadence that used to be
// scattered across the phase docs (15 / 20~30 / 5~10 …). Nothing here is a new
// behaviour — it is a consolidation so tuning happens in one place, and so the
// low-token mode (Phase 12 U3) can stretch a cadence just by overriding a value.

"use strict";

// Baseline cadences (turns). These match the values the individual engines
// previously hard-coded; wiring them through here keeps them authoritative.
const DEFAULT_SCHEDULE = {
  narrative_turn: 1,
  extraction_turn: 1,
  world_simulation_event: 15,
  npc_npc_background_interaction: 25,
  npc_proactive_contact_check: 7,
  living_npc_status_update: 100,
  emotional_resonance_recalc: 30,
  campaign_health_recalc: 10,
  npc_cleanup_archival: 100,
  full_state_snapshot: 100,
};

// Low-token overrides (Phase 12 U3): only the proactive-contact cadence is
// stretched (5~10 → 30). Everything else is gated elsewhere by a hard on/off.
const LOW_TOKEN_OVERRIDES = {
  npc_proactive_contact_check: 30,
};

// Resolve the effective schedule for a campaign: defaults, then any per-campaign
// settings override, then low-token stretch on top.
function resolve(state) {
  const s = (state && state.settings) || {};
  const lowToken = !!s.low_token_mode;
  const out = { ...DEFAULT_SCHEDULE };
  // per-campaign tuning: settings.schedules.{key} wins over the default.
  if (s.schedules && typeof s.schedules === "object") {
    for (const k of Object.keys(out)) {
      if (Number(s.schedules[k]) > 0) out[k] = Number(s.schedules[k]);
    }
  }
  // legacy single-value settings kept working (world_event_period etc.).
  if (Number(s.world_event_period) > 0) out.world_simulation_event = Number(s.world_event_period);
  if (Number(s.living_npc_period) > 0) out.living_npc_status_update = Number(s.living_npc_period);
  if (Number(s.resonance_period) > 0) out.emotional_resonance_recalc = Number(s.resonance_period);
  if (lowToken) Object.assign(out, LOW_TOKEN_OVERRIDES);
  return out;
}

// True when `turn` lands on the cadence for `key` (turn > 0 and divisible).
function isDue(state, key, turn) {
  const period = resolve(state)[key];
  if (!period || period <= 0) return false;
  const t = turn == null ? state.turn_number : turn;
  return t > 0 && t % period === 0;
}

module.exports = { DEFAULT_SCHEDULE, LOW_TOKEN_OVERRIDES, resolve, isDue };
