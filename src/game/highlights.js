// Phase 6 E — quote pool + session highlight summary.
//
// Design note (explicit user instruction): AI must NOT silently pick or
// generate content here. "오늘의 명대사" is rule-based selection from text
// that already exists (bookmarks first, high-intensity lines only as
// fallback) — no LLM call. The session-highlight SUMMARY does call a cheap
// LLM, but only when the player presses the button; it is never triggered
// automatically (this mirrors the Wave1 recap pattern but on-demand, not
// on-load).

const turnLog = require("../history/turnLog");

// --- "오늘의 명대사" — pure selection, no generation. ------------------------
function quoteOfTheDay(state, campaignId) {
  const log = turnLog.load(campaignId);
  if (!log.length) return null;

  // 1st priority: a line the player themselves bookmarked. bookmarked_turns
  // and turnLog entries both use the displayed (post-increment) turn number.
  const bookmarked = (state.bookmarked_turns || []);
  if (bookmarked.length) {
    const pick = log.find((e) => bookmarked.includes(e.turn));
    if (pick) return { turn: pick.turn, text: firstSentence(pick.gm), source: "bookmark" };
  }

  // Fallback: highest emotion_intensity line recorded (rule-based, not AI).
  const byIntensity = log.slice().sort((a, b) => (b.emotion_intensity || 0) - (a.emotion_intensity || 0));
  if (byIntensity.length && byIntensity[0].emotion_intensity > 0) {
    const pick = byIntensity[0];
    return { turn: pick.turn, text: firstSentence(pick.gm), source: "auto" };
  }
  return null;
}

function firstSentence(text) {
  const s = String(text || "").split(/(?<=[.!?다])\s+/)[0] || "";
  return s.slice(0, 140);
}

// --- session highlight summary — manual trigger, one cheap LLM call. ------
async function summarizeSession(state, campaignId, gemini) {
  const log = turnLog.load(campaignId);
  const boundaries = turnLog.sessionBoundaries(campaignId);
  const lastBoundaryTurn = boundaries.length ? boundaries[boundaries.length - 1].before_turn : null;
  const thisSession = lastBoundaryTurn != null ? log.filter((e) => e.turn >= lastBoundaryTurn) : log;
  if (!thisSession.length) return { summary: null, reason: "no turns this session" };

  const bookmarkedThisSession = thisSession.filter((e) => (state.bookmarked_turns || []).includes(e.turn));
  const source = bookmarkedThisSession.length ? bookmarkedThisSession : thisSession.slice(-8);
  const text = source.map((e) => `[턴 ${e.turn}] ${e.gm}`).join("\n\n");

  gemini.setCampaign(campaignId);
  const summary = await gemini.summarize(
    "다음은 TRPG 세션의 일부 장면들이다. 이번 세션의 하이라이트를 3~5문장으로 요약하라. 순수 텍스트로만.",
    text
  );
  return { summary: summary || null, turns_used: source.map((e) => e.turn) };
}

module.exports = { quoteOfTheDay, summarizeSession };
