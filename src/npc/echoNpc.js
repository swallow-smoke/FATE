// PATCH_NARRATIVE_ACCUMULATION_GAPS · Echo (잔향체)
//
// When an emotionally significant NPC dies or permanently departs, they don't
// just vanish from the sim — they leave an *echo*. The character's canon data
// gets an `echo_state` and thereafter their absence can surface: their old
// haunt feels emptier, a shared object aches, others still speak of them. This
// is the accumulation counterpart to nickname/flashback — the world remembers
// who is gone.
//
// System-first: an echo is only created for NPCs the player actually bonded with
// (so a random dead guard doesn't haunt the story). The directive is one soft
// line, cooldown-gated, and read-only over Canon/relationships. calm_mode keeps
// echoes (they deepen, they don't disrupt).

"use strict";

const BOND_THRESHOLD = 0.35; // affection|trust|respect|dependency this high = "mattered"
const ECHO_COOLDOWN = 10;

function bondStrength(edge) {
  if (!edge) return 0;
  const dims = ["affection", "trust", "respect", "dependency", "obligation"];
  return Math.max(...dims.map((d) => Number(edge[d]) || 0), 0);
}

// Mark an NPC as an echo. kind: "loss" (died) | "departure" (left the story).
// Only fires when the player-bond was meaningful. Returns the echo_state or null.
function markEcho(canonDb, state, canonId, kind, relEdge) {
  const ent = canonDb.get(canonId);
  if (!ent || ent.type !== "Character" || !ent.data) return null;
  if (ent.data.echo_state && ent.data.echo_state.active) return ent.data.echo_state;
  if (bondStrength(relEdge) < BOND_THRESHOLD) return null;
  const name = ent.data.birth_name || canonId;
  const echo = {
    active: true,
    kind: kind === "departure" ? "departure" : "loss",
    since_turn: state.turn_number,
    last_location: ent.data.current_location || null,
    name,
    reminder: kind === "departure"
      ? `${name}이(가) 떠난 자리의 빈 온도`
      : `${name}이(가) 남긴 부재의 무게`,
  };
  canonDb.update({ canon_id: canonId, field: "echo_state", new_value: echo }, state.turn_number);
  return echo;
}

function activeEchoes(canonDb) {
  return canonDb.all().filter((e) => e.type === "Character" && e.data && e.data.echo_state && e.data.echo_state.active);
}

// Called from turn.js right after npcLifecycle.handleDeath (or on a departure
// flag). relEdgeFn(ref) → the player edge for that ref.
function onDeparture(canonDb, state, canonId, kind, relEdge) {
  return markEcho(canonDb, state, canonId, kind, relEdge);
}

// Soft directive: if this scene's location is where an echo NPC used to be (or
// they're referenced in the scene's canon refs), let their absence be felt.
// Cooldown-gated per campaign so it doesn't fire every visit.
function directiveLine(state, canonDb, sceneSpec) {
  const echoes = activeEchoes(canonDb);
  if (!echoes.length) return null;
  const turn = state.turn_number;
  state.echo_log = state.echo_log || {};
  const loc = sceneSpec && sceneSpec.location;
  const refs = new Set([...(sceneSpec.participants || []), ...(sceneSpec.canon_refs || [])]);
  for (const e of echoes) {
    const es = e.data.echo_state;
    const hereByPlace = loc && es.last_location && es.last_location === loc;
    const hereByRef = refs.has(e.canon_id);
    if (!hereByPlace && !hereByRef) continue;
    const last = state.echo_log[e.canon_id];
    if (last != null && turn - last < ECHO_COOLDOWN) continue;
    state.echo_log[e.canon_id] = turn;
    return `${es.reminder}가 이 장면에 스며 있다. ${es.name}을(를) 직접 불러내 설명하지 말고, 비워진 자리·남은 습관·다른 인물이 무심코 삼키는 말로만 그 부재를 느끼게 하라.`;
  }
  return null;
}

module.exports = { markEcho, onDeparture, activeEchoes, directiveLine, bondStrength, BOND_THRESHOLD };
