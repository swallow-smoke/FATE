// Phase 3 · Wave 3 · System 10 — AI Self Reflection
//
// After each turn (lifecycle step 12) the system reflects: was one NPC leaned
// on too hard? is emotion skewed? what should the next scene adjust? The result
// is stored on state.self_reflection and read by the Rhythm/Emotion Directors
// on the FOLLOWING turn. Rule-based by default; when a key is present it adds a
// short LLM note (1 cheap call, non-fatal).

const REFLECT_PROMPT =
  '다음은 방금 생성된 TRPG 장면과 최근 맥락이다. 한 문장으로 다음 장면이 무엇을 조정하면 좋을지 제안하라. JSON만 출력: {"note":""}';

// Rule-based analysis over recent history. Returns the reflection object.
function analyze(state) {
  const hist = (state.scene_history || []).slice(-6);
  const emo = (state.player.emotion_state.recent_history || []).slice(-6);

  // NPC over-use: any single NPC in >= 80% of recent scenes.
  const npcCounts = {};
  hist.forEach((h) => (h.participants || []).filter((p) => p !== "player").forEach((p) => (npcCounts[p] = (npcCounts[p] || 0) + 1)));
  const overusedNpc = Object.entries(npcCounts).find(([, c]) => hist.length >= 4 && c / hist.length >= 0.8);

  // emotion skew: one emotion in >= 60% of recent turns.
  const emoCounts = {};
  emo.forEach((e) => (emoCounts[e] = (emoCounts[e] || 0) + 1));
  const skew = Object.entries(emoCounts).find(([, c]) => emo.length >= 4 && c / emo.length >= 0.6);

  const suggest_avoid_emotion = skew ? skew[0] : null;
  const suggest_variety = !!overusedNpc;

  const notes = [];
  if (overusedNpc) notes.push(`NPC "${overusedNpc[0]}"에 과도하게 의존 중 — 다른 인물/장소를 끌어들일 것`);
  if (skew) notes.push(`감정이 "${skew[0]}"로 치우침 — 대조 감정을 고려`);
  return {
    turn: state.turn_number,
    overused_npc: overusedNpc ? overusedNpc[0] : null,
    emotion_skew: suggest_avoid_emotion,
    suggest_scene_variety: suggest_variety,
    note: notes.join(" / ") || "균형 양호",
    source: "rule",
  };
}

async function reflect(state, gemini) {
  const base = analyze(state);
  if (gemini && gemini.hasKey && gemini.hasKey() && gemini.reflectNote) {
    try {
      const recent = (state.recent_dialogue || []).slice(-1).map((r) => r.gm).join("\n");
      const note = await gemini.reflectNote(REFLECT_PROMPT, recent);
      if (note) { base.llm_note = note; base.source = "rule+llm"; }
    } catch (e) {
      base.llm_error = e.message;
    }
  }
  return base;
}

module.exports = { reflect, analyze };
