// Step 3 — Memory Engine (08-Memory/MemoryEngine.md)
//
// Rule-based only: relevance uses tag/keyword matching (no embeddings/vector
// DB — MemoryEngine §10). Stores Memory Objects to a JSON file, retrieves the
// top 5-8 for the current scene. The <memory_context> string is assembled
// separately in gemini/promptBlocks.js so the engine stays swappable.

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../state/campaignState");

const TIER = { Temporary: 1, Personal: 2, Historical: 3, Cultural: 4, Legendary: 5 };
const TIER_NAME = ["", "Temporary", "Personal", "Historical", "Cultural", "Legendary"];

// relevance weights (MemoryEngine §4). Tunable; constant for MVP.
const W = { tier: 1.0, emotion: 2.0, recency: 1.0, overuse: 0.5 };
const DEFAULT_N = 6; // top 5-8

function createMemoryEngine(campaignId) {
  const filePath = path.join(DATA_DIR, `${campaignId}_memory.json`);

  let memories = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : [];
  let seq = memories.reduce((m, o) => Math.max(m, o._seq || 0), 0);

  function persist() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(memories, null, 2), "utf8");
  }

  function all() {
    return memories.slice();
  }

  // --- memory.write ------------------------------------------------------
  // Creates a Memory Object (MemoryEngine §3) with auto-promotion (§2).
  function write(mem, turn) {
    seq += 1;
    const emotionIntensity = mem.emotion_intensity ?? 0;
    const participants = mem.participants || [];

    // Tier assignment (§2 promotion rules):
    // Temporary(1); intensity >= 3 auto-promotes to Personal(2); a beat that
    // touches >= 3 NPCs/participants is Historical(3).
    let tier = TIER.Temporary;
    const promotion_history = [];
    if (emotionIntensity >= 3) {
      tier = TIER.Personal;
      promotion_history.push({ from_tier: 1, to_tier: 2, at_turn: turn, reason: "emotion_intensity>=3" });
    }
    if (participants.length >= 3) {
      const from = tier;
      tier = TIER.Historical;
      promotion_history.push({ from_tier: from, to_tier: 3, at_turn: turn, reason: "participants>=3" });
    }
    // Optional tier floor (e.g. World Simulation records a resolved event as
    // Historical regardless of participant count).
    if (mem.tier && mem.tier > tier) {
      promotion_history.push({ from_tier: tier, to_tier: mem.tier, at_turn: turn, reason: mem.tier_reason || "tier floor" });
      tier = mem.tier;
    }

    const obj = {
      _seq: seq,
      id: `mem_${String(seq).padStart(7, "0")}`,
      tier,
      type: TIER_NAME[tier].toLowerCase(),
      summary: mem.summary || "",
      participants,
      location: mem.location || null,
      timestamp: { campaign_turn: turn, in_world_date: mem.in_world_date || null },
      emotion_tags: mem.emotion_tags || [],
      emotion_intensity: emotionIntensity,
      canon_refs: mem.canon_refs || [],
      decay_eligible: tier >= TIER.Personal ? false : true,
      promotion_history,
      recall_count: 0,
      last_recalled_turn: null,
      linked_memories: [],
    };
    memories.push(obj);
    persist();
    return obj;
  }

  // --- relevance scoring (rule-based, §4) --------------------------------
  function score(mem, scene, turn) {
    const sceneEmotions = new Set(
      [scene.primary_emotion, ...(scene.emotion_tags || [])].filter(Boolean)
    );
    const emotionMatch = (mem.emotion_tags || []).filter((t) => sceneEmotions.has(t)).length;
    const age = turn - (mem.last_recalled_turn ?? mem.timestamp.campaign_turn);
    const recency = 1 / (1 + Math.max(0, age));
    return (
      W.tier * mem.tier +
      W.emotion * emotionMatch +
      W.recency * recency -
      W.overuse * (mem.recall_count || 0)
    );
  }

  // Does the memory touch the current scene at all? (participants/location/refs)
  function touchesScene(mem, scene) {
    const parts = new Set(scene.participants || []);
    const refs = new Set(scene.canon_refs || scene.must_include || []);
    if ((mem.participants || []).some((p) => parts.has(p))) return true;
    if (mem.location && (scene.location === mem.location || refs.has(mem.location))) return true;
    if ((mem.canon_refs || []).some((r) => refs.has(r) || parts.has(r))) return true;
    return false;
  }

  // --- retrieval (§4) ----------------------------------------------------
  // Returns the selected Memory Objects (not the formatted string).
  function retrieve(scene, turn, n = DEFAULT_N) {
    const candidates = memories.filter((m) => touchesScene(m, scene));
    const scored = candidates
      .map((m) => ({ m, s: score(m, scene, turn) }))
      .sort((a, b) => b.s - a.s);

    const selected = scored.slice(0, n).map((x) => x.m);

    // §4.4 — force-include at least one Tier>=3 whose canon_refs overlap,
    // regardless of score (history/legend must not be forgotten).
    const refs = new Set([...(scene.participants || []), ...(scene.canon_refs || scene.must_include || [])]);
    const forced = memories.find(
      (m) => m.tier >= TIER.Historical && (m.canon_refs || []).some((r) => refs.has(r)) && !selected.includes(m)
    );
    if (forced) {
      if (selected.length >= n) selected.pop();
      selected.push(forced);
    }

    // recall bookkeeping (§3): mark as summoned this turn.
    for (const m of selected) {
      m.recall_count = (m.recall_count || 0) + 1;
      m.last_recalled_turn = turn;
    }
    if (selected.length) persist();
    return selected;
  }

  return { all, write, retrieve, score, filePath, TIER, TIER_NAME };
}

module.exports = { createMemoryEngine, TIER, TIER_NAME };
