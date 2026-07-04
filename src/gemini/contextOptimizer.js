// Phase 13 V4 (Dynamic LOD) + V5 (Semantic Delta Context).
//
// V4: three levels of Canon detail instead of the old all-or-nothing —
//   Full   : this scene's participants + explicit refs (full psychology)
//   Medium : characters mentioned in the last N turns but not in this scene
//            (name + one-line only)
//   None   : everything else (omitted)
//
// V5: within the chosen entities, compare each rendered line to what we sent
// last turn (a hash snapshot kept on state.prompt_delta). Unchanged entities are
// collapsed to an "(이전과 동일)" marker so their body is not resent. Applies to
// the structured Canon/Memory blocks only — never to the narrative call itself.

"use strict";

const crypto = require("crypto");

const MENTION_WINDOW = 6; // "recently mentioned" = within the last N scenes

function lineHash(s) {
  return crypto.createHash("sha1").update(String(s || "")).digest("hex").slice(0, 12);
}

// Choose Canon entities + their LOD for this turn.
// Returns { entities: [...], lod: { canon_id: "full"|"medium" } }.
function selectCanon(state, canonDb, sceneSpec) {
  const fullIds = new Set([...(sceneSpec.participants || []), ...(sceneSpec.canon_refs || [])].filter(Boolean));
  const full = canonDb.relevantTo([...fullIds]);

  // Recently-mentioned characters not already full → Medium LOD.
  const recentParticipants = new Set(
    (state.scene_history || []).slice(-MENTION_WINDOW).flatMap((h) => h.participants || [])
  );
  const medium = canonDb.all().filter(
    (e) => e.type === "Character" && recentParticipants.has(e.canon_id) && !fullIds.has(e.canon_id)
  );

  const lod = {};
  for (const e of full) lod[e.canon_id] = "full";
  for (const e of medium) lod[e.canon_id] = "medium";
  return { entities: [...full, ...medium], lod };
}

// Compute the delta for a set of already-rendered {id, body} lines against the
// per-campaign snapshot. Returns a Set of ids whose body is unchanged, and
// updates the snapshot in place on state. `bucket` namespaces canon vs memory.
function unchangedIds(state, bucket, rendered) {
  state.prompt_delta = state.prompt_delta || {};
  const prev = state.prompt_delta[bucket] || {};
  const next = {};
  const unchanged = new Set();
  for (const { id, body } of rendered) {
    const h = lineHash(body);
    next[id] = h;
    if (prev[id] === h) unchanged.add(id);
  }
  state.prompt_delta[bucket] = next;
  return unchanged;
}

module.exports = { selectCanon, unchangedIds, lineHash, MENTION_WINDOW };
