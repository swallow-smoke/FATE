// Phase 8 Part A1 — save-file version migration framework.
//
// Rules (per handoff):
//  1. Every schema change is one migration function: migrate_vN_to_vN+1(state).
//  2. On load, if state.schema_version < CURRENT, apply each needed migration
//     in strict order (no skipping), bumping schema_version each step.
//  3. Migrations only ADD or RENAME fields. Removals are marked _deprecated,
//     never actually deleted (no historical data loss).
//  4. On failure, the caller preserves the original file as .bak and surfaces
//     an error (handled in campaignState.load).
//
// Baseline: the schema as of Phase 1~7 is fixed at v7 (matching the version the
// running saves already carry). Future changes bump CURRENT_SCHEMA_VERSION and
// register a migrator below.

"use strict";

const CURRENT_SCHEMA_VERSION = 8;

// version N key holds the function taking a v(N) state to v(N+1).
const MIGRATIONS = {
  // v7 → v8: campaign lifecycle fields (Phase 8 A3 / B / C).
  7: (state) => {
    if (state.campaign_status === undefined) {
      state.campaign_status = state.ending && state.ending.reached ? "completed" : "active";
    }
    if (state.world_templates === undefined) state.world_templates = [];
    return state;
  },
};

// Apply all migrations from state's version up to CURRENT. Idempotent for
// already-current states. Throws on a broken migrator so load() can .bak.
function applyMigrations(state) {
  let v = Number(state.schema_version || 7);
  while (v < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[v];
    if (!migrate) throw new Error(`No migration registered for schema v${v} → v${v + 1}`);
    state = migrate(state);
    v += 1;
    state.schema_version = v;
  }
  return state;
}

module.exports = { CURRENT_SCHEMA_VERSION, applyMigrations, MIGRATIONS };
