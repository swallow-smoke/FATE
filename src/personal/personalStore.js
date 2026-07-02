// Phase 6 D/F — personal notes + next-session goal.
//
// Deliberately NOT part of CampaignState and NOT passed to anything in
// src/gemini/*. This file is never require()'d by turn.js, promptBlocks.js,
// or systemPromptBase.js — that separation is the actual guarantee (not just
// a naming convention) that player-private text can never leak into a
// Gemini call. If a future phase needs this content in a prompt, that must
// be an explicit, opt-in change here — not an accidental import elsewhere.

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../state/campaignState");

function notesPath(campaignId) {
  return path.join(DATA_DIR, `${campaignId}_notes.json`);
}

function load(campaignId) {
  const p = notesPath(campaignId);
  if (!fs.existsSync(p)) return { notes: [], next_session_goal: null, recent_searches: [] };
  try {
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!d.recent_searches) d.recent_searches = [];
    return d;
  } catch { return { notes: [], next_session_goal: null, recent_searches: [] }; }
}

// Phase 6 B — recent search terms (kept server-side per the handoff note,
// not localStorage — this app isn't sandboxed, a real file is fine).
function addRecentSearch(campaignId, q) {
  const data = load(campaignId);
  data.recent_searches = [q, ...data.recent_searches.filter((s) => s !== q)].slice(0, 8);
  persist(campaignId, data);
  return data.recent_searches;
}

function persist(campaignId, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(notesPath(campaignId), JSON.stringify(data, null, 2), "utf8");
}

function addNote(campaignId, text) {
  const data = load(campaignId);
  const note = { id: `note_${Date.now().toString(36)}`, text: String(text).slice(0, 2000), created_at: new Date().toISOString() };
  data.notes.push(note);
  persist(campaignId, data);
  return note;
}

function deleteNote(campaignId, id) {
  const data = load(campaignId);
  data.notes = data.notes.filter((n) => n.id !== id);
  persist(campaignId, data);
  return data.notes;
}

function setGoal(campaignId, text) {
  const data = load(campaignId);
  data.next_session_goal = text ? { text: String(text).slice(0, 500), set_at: new Date().toISOString() } : null;
  persist(campaignId, data);
  return data.next_session_goal;
}

module.exports = { load, addNote, deleteNote, setGoal, addRecentSearch, notesPath };
