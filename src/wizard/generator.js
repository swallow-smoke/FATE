// Phase 4 Part A3/A4 — wizard structured generation + Kernel registration
// pipeline (built during Phase 5; was missing).
//
// A4: a DEDICATED structured-JSON system prompt, never mixed with
// SYSTEM_PROMPT_BASE (different role, different temperature).
// A3: generated entities are NOT written directly — every one goes through
// kernel.request("canon.register", ...) so wizard-made and play-made canon
// share the same validation path.

const gemini = require("../gemini/geminiClient");

const WORLD_GEN_PROMPT = `당신은 TRPG 세계관/캐릭터 설정을 구조화된 JSON으로 생성하는 어시스턴트입니다.
사용자의 자유 서술을 바탕으로 아래 스키마를 정확히 따르는 JSON만 출력하세요.
설명, 인사말, 마크다운 코드블록 표시 없이 순수 JSON만 출력합니다.

{
  "world_name": "",
  "tone": "",
  "era": "modern | ancient | fantasy | future",
  "magic_or_tech": "",
  "regions": [{ "canon_id": "loc_영문소문자", "name": "", "terrain": "", "notable_features": [""] }],
  "factions": [{ "canon_id": "faction_영문소문자", "name": "", "founding_principle": "", "leader": "", "stance": "" }],
  "narrative_dna": { "tone": 3, "emotion": 3, "politics": 3, "survival": 3, "horror": 2, "mystery": 3, "romance": 2, "exploration": 3 }
}

원칙:
- 사용자가 명시하지 않은 디테일은 과하게 지어내지 말고, 세계관 톤에 맞는 범위 안에서 최소한으로 채운다.
- 이름/지명은 사용자가 준 문화적 맥락과 일관되게 짓는다.
- immutable로 지정될 필드(terrain, founding_principle 등)는 신중하게 생성한다 — 나중에 못 바꾼다.
- era는 세계관 설명에서 추정한다 (현대 배경이면 modern, 과거/중세면 ancient 또는 fantasy).
- narrative_dna 각 값은 1~5, 세계관 설명의 분위기에서 추정.`;

const CHARACTER_GEN_PROMPT = `당신은 TRPG 캐릭터 설정을 구조화된 JSON으로 생성하는 어시스턴트입니다.
순수 JSON만 출력합니다. 스키마:

{
  "player": { "birth_name": "", "species": "human", "background": "", "core_values": [""],
    "psychology": { "core_fear": "", "desire": "", "trauma": "" } },
  "npcs": [{ "canon_id": "char_영문소문자", "birth_name": "", "species": "human", "role": "npc",
    "core_values": [""], "current_location": "지역 canon_id", "affiliations": ["세력 canon_id"],
    "goal_current": "", "schedule_hint": "",
    "psychology": { "attachment_style": "secure|anxious|avoidant|fearful", "core_fear": "", "desire": "", "defense_mechanism": "" } }]
}

원칙: 세계관 맥락(지역/세력 canon_id 목록이 주어짐)과 일관되게. NPC는 요청된 수만큼만.`;

// --- mock fallbacks so the wizard works without an API key -----------------
function mockWorld(text) {
  return {
    world_name: "이름 없는 세계", tone: (text || "").slice(0, 40) || "낮은 채도의 세계", era: "fantasy",
    magic_or_tech: "마법은 희귀하고 위험하다",
    regions: [{ canon_id: "loc_harbor", name: "안개 항구", terrain: "port_city", notable_features: ["항상 안개가 낀다"] }],
    factions: [{ canon_id: "faction_guild", name: "부두 조합", founding_principle: "mutual_aid", leader: "무명", stance: "neutral" }],
    narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  };
}
function mockCharacters(text, npcCount) {
  return {
    player: { birth_name: "이름 없는 자", species: "human", background: (text || "").slice(0, 60) || "과거를 숨긴 떠돌이", core_values: ["생존"], psychology: { core_fear: "잊히는 것", desire: "머물 곳", trauma: "" } },
    npcs: Array.from({ length: Math.min(npcCount || 1, 5) }, (_, i) => ({
      canon_id: `char_npc${i + 1}`, birth_name: `무명 ${i + 1}`, species: "human", role: "npc",
      core_values: ["loyalty"], current_location: "loc_harbor", affiliations: ["faction_guild"],
      goal_current: "하루를 버티는 것", schedule_hint: "부두 근처",
      psychology: { attachment_style: "avoidant", core_fear: "굶주림", desire: "안정", defense_mechanism: "회피" },
    })),
  };
}

async function generateWorld(freeText) {
  try {
    const j = await gemini.generateStructured(WORLD_GEN_PROMPT, freeText, { temperature: 0.5 });
    if (j) return { ...j, _mock: false };
  } catch (e) { /* fall through to mock */ }
  return { ...mockWorld(freeText), _mock: true };
}

async function generateCharacters(freeText, worldContext, npcCount) {
  const user = `${freeText}\n\n[세계관 맥락]\n지역: ${(worldContext.regions || []).map((r) => r.canon_id).join(", ")}\n세력: ${(worldContext.factions || []).map((f) => f.canon_id).join(", ")}\nNPC ${npcCount || 3}명 추천.`;
  try {
    const j = await gemini.generateStructured(CHARACTER_GEN_PROMPT, user, { temperature: 0.6 });
    if (j) return { ...j, _mock: false };
  } catch (e) { /* fall through to mock */ }
  return { ...mockCharacters(freeText, npcCount), _mock: true };
}

// A3 steps 4-5: convert confirmed wizard output to canon.register requests.
// Every entity must pass the Kernel's normal validation to be registered.
function registerAll(kernel, state, confirmed) {
  const results = [];
  const push = (payload) => results.push({ canon_id: payload.canon_id, ...kernel.request(state, "wizard", "canon.register", payload) });

  for (const r of confirmed.regions || []) {
    push({ canon_id: r.canon_id, type: "World", data: { region: r.canon_id, display_name: r.name, terrain: r.terrain, notable_features: r.notable_features || [], discovered_by_player: true } });
  }
  for (const f of confirmed.factions || []) {
    push({ canon_id: f.canon_id, type: "Faction", data: { display_name: f.name, founding_principle: f.founding_principle, leader: f.leader, stance: f.stance, discovered_by_player: true } });
  }
  for (const n of confirmed.npcs || []) {
    push({ canon_id: n.canon_id, type: "Character", data: { ...n, discovered_by_player: false } });
  }
  return results;
}

module.exports = { generateWorld, generateCharacters, registerAll, WORLD_GEN_PROMPT, CHARACTER_GEN_PROMPT };
