// Phase 13 V7 — Incremental State Update (change journal).
//
// StateSchema §6 originally serialized the whole CampaignState every turn. We
// keep the full save as the authoritative on-disk copy (undo/import/snapshots
// all read it, so correctness stays simple), but additionally record WHICH
// top-level fields actually changed each turn into a compact journal. That gives
// the diff-based view the spec wants — for the Advanced/profiler panels and for
// reasoning about churn — without risking a fragile diff-only reconstruction.
//
// Every `full_state_snapshot` cadence the journal is truncated (the snapshot is
// the new baseline), so the journal never grows without bound.

"use strict";

// campaignId -> shallow hash of each top-level key at last record.
const lastSeen = new Map();

function hashOf(v) {
  try { return JSON.stringify(v).length + ":" + JSON.stringify(v).slice(0, 32); }
  catch { return "?"; }
}

// Compute changed top-level keys vs the previous turn and append to the journal
// kept on state.state_change_log (bounded). Returns the list of changed keys.
function record(state) {
  const id = state.campaign_id;
  const prev = lastSeen.get(id) || {};
  const now = {};
  const changed = [];
  for (const k of Object.keys(state)) {
    if (k === "state_change_log") continue;
    const h = hashOf(state[k]);
    now[k] = h;
    if (prev[k] !== h) changed.push(k);
  }
  lastSeen.set(id, now);
  state.state_change_log = [
    ...(state.state_change_log || []),
    { turn: state.turn_number, changed },
  ].slice(-120);
  return changed;
}

// Reset the baseline after a full snapshot (the snapshot IS the new baseline).
function resetBaseline(state) {
  lastSeen.delete(state.campaign_id);
  state.state_change_log = [];
}

module.exports = { record, resetBaseline, _lastSeen: lastSeen };
