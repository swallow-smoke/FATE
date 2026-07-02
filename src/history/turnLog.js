// Phase 6 B — full transcript log.
//
// state.recent_dialogue only keeps the last 3 turns (by design, for prompt
// cost — GeminiSystemPrompt §3). Search/filter/session-boundary/quote-pool
// features need the FULL history, so this is a separate append-only file per
// campaign, written alongside (not instead of) recent_dialogue.

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../state/campaignState");

// A gap of this many real-world minutes between two turns marks a session
// boundary (Phase 6 B). Distinct from Phase5's recap_hours threshold (that's
// "away long enough to want a recap"; this is "away long enough it reads as
// a new session" in the scrollback).
const SESSION_GAP_MINUTES = 45;

function logPath(campaignId) {
  return path.join(DATA_DIR, `${campaignId}_turnlog.json`);
}

function load(campaignId) {
  const p = logPath(campaignId);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; }
}

function persist(campaignId, entries) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(logPath(campaignId), JSON.stringify(entries, null, 2), "utf8");
}

// Phase 6 A — "응답 재생성" reruns the same turn number after an Undo
// rollback, so an existing entry for that turn is replaced rather than
// duplicated (idempotent by turn number).
function append(campaignId, entry) {
  const entries = load(campaignId).filter((e) => e.turn !== entry.turn);
  entries.push({
    turn: entry.turn,
    in_world_date: entry.in_world_date || null,
    player: entry.player,
    gm: entry.gm,
    primary_emotion: entry.primary_emotion || null,
    participants: entry.participants || [],
    emotion_intensity: entry.emotion_intensity || 0,
    at: new Date().toISOString(),
  });
  entries.sort((a, b) => a.turn - b.turn);
  persist(campaignId, entries);
  return entries;
}

// --- B: search / filter --------------------------------------------------
function search(campaignId, { q, npc, emotion } = {}) {
  let entries = load(campaignId);
  if (q) {
    const needle = q.toLowerCase();
    entries = entries.filter((e) => (e.player + " " + e.gm).toLowerCase().includes(needle));
  }
  if (npc) entries = entries.filter((e) => (e.participants || []).includes(npc));
  if (emotion) entries = entries.filter((e) => e.primary_emotion === emotion);
  return entries;
}

// --- B: session boundaries — gaps >= SESSION_GAP_MINUTES between turns ----
function sessionBoundaries(campaignId) {
  const entries = load(campaignId);
  const boundaries = [];
  for (let i = 1; i < entries.length; i++) {
    const gapMin = (new Date(entries[i].at) - new Date(entries[i - 1].at)) / 60000;
    if (gapMin >= SESSION_GAP_MINUTES) boundaries.push({ before_turn: entries[i].turn, gap_minutes: Math.round(gapMin) });
  }
  return boundaries;
}

module.exports = { append, load, search, sessionBoundaries, SESSION_GAP_MINUTES, logPath };
