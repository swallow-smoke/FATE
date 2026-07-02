// Phase 5 Wave 2 — Faction reputation.
// state.faction_reputation: [{ faction_id, standing: -1.0..1.0, label }].
// The Kernel adjusts standing when player actions touch a faction's interests.
// The UI shows ONLY the label — internal numbers are never exposed.

function labelFor(standing) {
  if (standing >= 0.7) return "존경받음";
  if (standing >= 0.35) return "신뢰받음";
  if (standing >= 0.1) return "호의적";
  if (standing > -0.1) return "중립";
  if (standing > -0.35) return "경계받음";
  if (standing > -0.7) return "적대적";
  return "공적";
}

function getOrCreate(state, factionId) {
  state.faction_reputation = state.faction_reputation || [];
  let rep = state.faction_reputation.find((r) => r.faction_id === factionId);
  if (!rep) {
    rep = { faction_id: factionId, standing: 0, label: labelFor(0), last_changed_turn: state.turn_number };
    state.faction_reputation.push(rep);
  }
  return rep;
}

function adjust(state, factionId, delta, reason) {
  const rep = getOrCreate(state, factionId);
  rep.standing = Math.max(-1, Math.min(1, Math.round((rep.standing + delta) * 100) / 100));
  rep.label = labelFor(rep.standing);
  rep.last_changed_turn = state.turn_number;
  rep.last_reason = reason || null;
  return rep;
}

// Rule-based per-turn hook: flags like helped_<faction>/betrayed_<faction>
// set this turn nudge that faction's standing.
function applyFlagEffects(state, canonDb) {
  const changes = [];
  const factions = canonDb.all().filter((e) => e.type === "Faction").map((e) => e.canon_id);
  const thisTurn = (state.story_flags || []).filter((f) => f.set_at_turn === state.turn_number && f.value === true);
  for (const f of thisTurn) {
    for (const fid of factions) {
      const short = fid.replace(/^faction_/, "");
      if (!f.flag_id.includes(short)) continue;
      let delta = 0;
      if (/^(helped|saved|freed)_/.test(f.flag_id)) delta = 0.15;
      else if (/^(betrayed|killed|attacked)_/.test(f.flag_id)) delta = -0.25;
      if (delta) changes.push(adjust(state, fid, delta, f.flag_id));
    }
  }
  return changes;
}

// Player-facing view: labels only.
function playerVisible(state, canonDb) {
  return (state.faction_reputation || []).map((r) => {
    const ent = canonDb.get(r.faction_id);
    return {
      faction_id: r.faction_id,
      name: (ent && ent.data && (ent.data.display_name || ent.canon_id)) || r.faction_id,
      label: r.label,
    };
  });
}

module.exports = { labelFor, adjust, applyFlagEffects, playerVisible, getOrCreate };
