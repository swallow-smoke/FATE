// PATCH_NARRATIVE_ACCUMULATION_GAPS · Motif Registry
//
// A motif is a recurring image/symbol/phrase that gives a campaign texture —
// 붉은 리본, 식은 홍차, "괜찮아"라는 거짓말, 창밖의 눈. The engine keeps a
// registry so the same motif can *recur* deliberately (a payoff) instead of a
// symbol appearing once and vanishing. Motifs are registered from the extraction
// call (motif_hints) or seeded by the Notion/MD importer (PATCH_NOTION_IMPORT
// classifies "Motif" pages), deduped by a normalized label, and the GM is
// occasionally nudged to let a well-worn motif resurface.
//
// Mock-safe & system-first: pure bookkeeping + one soft directive line. Also a
// registered extension category on the Dimension Registry lineage (motif is the
// 4th kind alongside hidden-variable / emotion-vocab / theme).

"use strict";

const CATEGORIES = new Set(["object", "image", "phrase", "sound", "place", "gesture", "weather"]);
const RECUR_COOLDOWN = 12; // don't ask the same motif to recur more than this often
const RECUR_MIN_OCCURRENCES = 2; // a motif must be established before we echo it

function ensure(state) {
  if (!Array.isArray(state.motifs)) state.motifs = [];
  return state.motifs;
}

function norm(label) {
  return String(label || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Register a sighting of a motif (creating it if new). Returns the motif record.
function register(state, { label, category, source }, turn) {
  const motifs = ensure(state);
  const l = String(label || "").trim();
  if (!l) return null;
  const key = norm(l);
  let m = motifs.find((x) => norm(x.label) === key);
  if (m) {
    m.occurrences += 1;
    m.last_seen_turn = turn;
    if (category && CATEGORIES.has(category)) m.category = category;
  } else {
    m = {
      motif_id: "motif_" + String(motifs.length + 1).padStart(4, "0"),
      label: l,
      category: CATEGORIES.has(category) ? category : "image",
      source: source || "narrative",
      first_seen_turn: turn,
      last_seen_turn: turn,
      last_echoed_turn: null,
      occurrences: 1,
    };
    motifs.push(m);
  }
  return m;
}

// motif_hints from extraction: [{ label, category }]
function applyExtraction(state, hints, turn) {
  const registered = [];
  for (const h of hints || []) {
    const m = register(state, h, turn);
    if (m) registered.push(m.motif_id);
  }
  return registered;
}

// Pick one established motif that hasn't been echoed recently and hand the GM a
// soft line inviting it to resurface. Prefers the most-seen, least-recently
// echoed motif. Returns null when nothing qualifies.
function recurringDirective(state, turn) {
  const motifs = ensure(state).filter(
    (m) => m.occurrences >= RECUR_MIN_OCCURRENCES &&
      (m.last_echoed_turn == null || turn - m.last_echoed_turn >= RECUR_COOLDOWN)
  );
  if (!motifs.length) return null;
  motifs.sort((a, b) => (b.occurrences - a.occurrences) || ((a.last_echoed_turn || 0) - (b.last_echoed_turn || 0)));
  const m = motifs[0];
  m.last_echoed_turn = turn;
  return `반복 모티프 "${m.label}"가 이 이야기에 배어 있다. 설명하지 말고, 자연스러운 순간에 이 이미지가 다시 스치듯 등장해 이전 장면들과 조용히 공명하게 하라.`;
}

module.exports = { ensure, register, applyExtraction, recurringDirective, CATEGORIES };
