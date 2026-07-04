// Phase 13 V8 — periodic full snapshots for long-range rollback.
//
// Distinct from Phase 5 Undo (last 1 turn) and Phase 6 autosave slots (last 3
// turns): this is "take me back ~100 turns". Every `full_state_snapshot` cadence
// (Phase 13 V9 scheduler) we capture state + Memory DB + Canon DB together and
// keep only the most recent 3, deleting older ones so they never pile up.
//
// Destructive restore is gated behind a confirm dialog in the UI (same pattern
// as Phase 8 C2 death confirmation).

"use strict";

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./campaignState");
const scheduleConfig = require("../meta/scheduleConfig");
const compress = require("../util/compress");

const KEEP = 3;

function snapPath(id, turn) {
  return path.join(DATA_DIR, `${id}_snap_${turn}.json.gz`);
}

function list(id) {
  if (!fs.existsSync(DATA_DIR)) return [];
  const re = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_snap_(\\d+)\\.json\\.gz$`);
  return fs
    .readdirSync(DATA_DIR)
    .map((f) => { const m = f.match(re); return m ? { turn: Number(m[1]), file: f } : null; })
    .filter(Boolean)
    .sort((a, b) => b.turn - a.turn);
}

// Write a snapshot for the current turn, then prune to the newest KEEP.
function write(id, { state, memory, canon }) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const turn = state.turn_number;
  const bundle = { format: "narrativeos_snapshot_v1", turn, created_at: new Date().toISOString(), state, memory, canon };
  compress.writeJsonGz(snapPath(id, turn), bundle);
  // prune
  const all = list(id);
  for (const s of all.slice(KEEP)) {
    try { fs.unlinkSync(path.join(DATA_DIR, s.file)); } catch (_) {}
  }
  return { turn, kept: Math.min(all.length, KEEP) };
}

// Called from the turn loop; snapshots only on the scheduler cadence.
function maybeSnapshot(state, deps) {
  if (!scheduleConfig.isDue(state, "full_state_snapshot", state.turn_number)) return null;
  return write(state.campaign_id, {
    state,
    memory: deps.memoryEngine.all(),
    canon: deps.canonDb.all(),
  });
}

// Destructive restore: overwrite state + memory + canon files with a snapshot.
// Caller must clear the cached engine deps afterwards (server does this).
function restore(id, turn) {
  const p = snapPath(id, turn);
  if (!fs.existsSync(p)) return { ok: false, reason: "snapshot not found" };
  const bundle = compress.readJsonGz(p);
  const campaignState = require("./campaignState");
  const b = bundle.state;
  b.campaign_id = id;
  b.db_refs = { memory_db: `${id}_memory.json`, canon_db: `${id}_canon.json` };
  campaignState.save(campaignState.migrate(b));
  fs.writeFileSync(path.join(DATA_DIR, `${id}_memory.json`), JSON.stringify(bundle.memory || [], null, 2), "utf8");
  fs.writeFileSync(path.join(DATA_DIR, `${id}_canon.json`), JSON.stringify(bundle.canon || [], null, 2), "utf8");
  return { ok: true, turn };
}

module.exports = { write, maybeSnapshot, list, restore, snapPath, KEEP };
