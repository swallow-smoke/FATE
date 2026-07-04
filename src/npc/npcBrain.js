// Phase 7 Part A1 — NPCBrain (능동 행동)
//
// Each turn, for every NPC actually in the current scene, decides whether this
// is a good moment for that NPC to *act toward its own goal* rather than merely
// react. It only proposes CANDIDATES appended to the story_directive — the
// Kernel's conflict adjudication still decides whether any get realized. Heavy
// actions (betrayal) are gated on the 10-dim RelationshipEdge (Part C3).

"use strict";

const COOLDOWN = 4; // turns an NPC must wait between active beats

// Find the player→NPC edge (Phase 5 shape) so heavy-action gates can read it.
function edgeFor(state, npcRef) {
  const n = (state.npcs || []).find((x) => x.canon_ref === npcRef);
  return (n && n.relationship_to_player) || {};
}

// proposeCandidates(state, canonDb, participants) → [{ npc_ref, action_type, line, weight }]
function proposeCandidates(state, canonDb, participants) {
  const log = state.npc_brain_log = state.npc_brain_log || {}; // npc_ref → last active turn
  const turn = state.turn_number;
  const candidates = [];

  for (const ref of participants || []) {
    const ent = canonDb.get(ref);
    if (!ent || ent.type !== "Character") continue;
    const d = ent.data || {};
    // C3 — "플레이어와 연결 없음" NPC는 관계 데이터가 없는 순수 배경 인물이므로
    // 능동 행동(선제 연락/부탁/대결 등) 후보에서 제외한다. 장면에 등장은 하되
    // 스스로 플레이어에게 먼저 다가갈 이유가 없다.
    if (d.no_player_relationship) continue;
    const psy = d.psychology || {};
    const goal = d.goal_current || psy.desire;
    if (!goal) continue;

    // Cooldown: don't let one NPC seize the wheel every turn.
    const last = log[ref];
    if (last != null && turn - last < COOLDOWN) continue;

    const rel = edgeFor(state, ref);
    const name = d.birth_name || ref;

    // Heavy action: only when the NPC actively resents the player.
    if ((rel.hatred || 0) > 0.6 || (rel.obsession || 0) > 0.7) {
      candidates.push({
        npc_ref: ref, action_type: "confront",
        line: `${name}은(는) 숨겨온 적의를 드러낼 기회를 엿본다 — 목표: ${goal}`,
        weight: 0.9,
      });
      continue;
    }

    // Ordinary proactive beat: speaks first / asks / reveals something.
    const kinds = [
      { t: "initiate", line: `${name}이(가) 먼저 말을 건다 — ${goal}을(를) 향해` },
      { t: "request", line: `${name}이(가) 플레이어에게 부탁을 한다 (${goal})` },
      { t: "reveal", line: `${name}이(가) 숨기던 것을 조금 드러낸다` },
    ];
    const pick = kinds[(turn + ref.length) % kinds.length];
    candidates.push({ npc_ref: ref, action_type: pick.t, line: pick.line, weight: 0.5 });
  }

  return candidates;
}

// Record which candidate (if any) the scene actually used, so cooldown starts.
function markActed(state, npcRefs) {
  const log = state.npc_brain_log = state.npc_brain_log || {};
  for (const ref of npcRefs || []) log[ref] = state.turn_number;
}

module.exports = { proposeCandidates, markActed, COOLDOWN };
