// Phase 5 Wave 1 — Undo (single most-recent rollback of state+memory+canon).
// Phase 6 C — extended to a ring buffer of up to 3 snapshots so the player can
// browse/restore any of the last 3 autosave points, not just the latest.
//
// snapshot() is called once per turn, BEFORE the turn mutates anything.
// restore() (no args) keeps Phase 5's one-shot "undo the last turn" behavior:
// it pops and applies the newest snapshot. restoreSlot(turn) lets Phase 6's
// autosave-rotation UI jump to an older one directly.

const fs = require("fs");
const path = require("path");
const campaignState = require("../state/campaignState");

const MAX_SLOTS = 3;

function undoPath(campaignId) {
  return path.join(campaignState.DATA_DIR, `${campaignId}_undo.json`);
}

function readIfExists(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

function loadSlots(campaignId) {
  const p = undoPath(campaignId);
  if (!fs.existsSync(p)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(data) ? data : data.state != null ? [data] : []; // migrate old single-object format
  } catch { return []; }
}

function persistSlots(campaignId, slots) {
  fs.writeFileSync(undoPath(campaignId), JSON.stringify(slots), "utf8");
}

// Capture the on-disk state BEFORE the turn runs. Cheap: three file reads.
function snapshot(campaignId) {
  const snap = {
    taken_at: new Date().toISOString(),
    state: readIfExists(campaignState.statePath(campaignId)),
    memory: readIfExists(path.join(campaignState.DATA_DIR, `${campaignId}_memory.json`)),
    canon: readIfExists(path.join(campaignState.DATA_DIR, `${campaignId}_canon.json`)),
  };
  try {
    const s = snap.state ? JSON.parse(snap.state) : null;
    snap.turn = s ? s.turn_number : 0;
  } catch { snap.turn = 0; }

  const slots = loadSlots(campaignId);
  slots.push(snap);
  while (slots.length > MAX_SLOTS) slots.shift();
  persistSlots(campaignId, slots);
}

function available(campaignId) {
  const slots = loadSlots(campaignId);
  if (!slots.length) return null;
  const latest = slots[slots.length - 1];
  return { turn: latest.turn, taken_at: latest.taken_at };
}

// Phase 6 C — all rotation slots, newest last (for the UI to list/pick from).
function list(campaignId) {
  return loadSlots(campaignId).map((s) => ({ turn: s.turn, taken_at: s.taken_at }));
}

function applySlot(campaignId, snap) {
  if (snap.state == null) return { ok: false, reason: "snapshot has no state" };
  fs.writeFileSync(campaignState.statePath(campaignId), snap.state, "utf8");
  const memP = path.join(campaignState.DATA_DIR, `${campaignId}_memory.json`);
  const canP = path.join(campaignState.DATA_DIR, `${campaignId}_canon.json`);
  if (snap.memory != null) fs.writeFileSync(memP, snap.memory, "utf8");
  else if (fs.existsSync(memP)) fs.unlinkSync(memP);
  if (snap.canon != null) fs.writeFileSync(canP, snap.canon, "utf8");
  else if (fs.existsSync(canP)) fs.unlinkSync(canP);
  return { ok: true, turn: snap.turn };
}

// Phase 5 one-shot Undo: pop + apply the newest slot.
function restore(campaignId) {
  const slots = loadSlots(campaignId);
  if (!slots.length) return { ok: false, reason: "no undo snapshot" };
  const snap = slots.pop();
  const r = applySlot(campaignId, snap);
  if (r.ok) persistSlots(campaignId, slots);
  return r;
}

// Phase 6 C: restore a specific rotation slot by turn number. Drops that slot
// and anything newer (they're no longer reachable once we've jumped back).
function restoreSlot(campaignId, turn) {
  const slots = loadSlots(campaignId);
  const idx = slots.findIndex((s) => s.turn === turn);
  if (idx < 0) return { ok: false, reason: "slot not found" };
  const r = applySlot(campaignId, slots[idx]);
  if (r.ok) persistSlots(campaignId, slots.slice(0, idx));
  return r;
}

module.exports = { snapshot, restore, restoreSlot, available, list, undoPath, MAX_SLOTS };
