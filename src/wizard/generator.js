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

async function generateWorld(freeText, state = null) {
  const promptSettings = require("../gemini/promptSettings");
  try {
    const j = await gemini.generateStructured(promptSettings.getPrompt(state, "wizard.world", WORLD_GEN_PROMPT), freeText, { temperature: 0.5 });
    if (j) return { ...j, _mock: false };
  } catch (e) { /* fall through to mock */ }
  return { ...mockWorld(freeText), _mock: true };
}

async function generateCharacters(freeText, worldContext, npcCount, state = null) {
  const promptSettings = require("../gemini/promptSettings");
  const user = `${freeText}\n\n[세계관 맥락]\n지역: ${(worldContext.regions || []).map((r) => r.canon_id).join(", ")}\n세력: ${(worldContext.factions || []).map((f) => f.canon_id).join(", ")}\nNPC ${npcCount || 3}명 추천.`;
  try {
    const j = await gemini.generateStructured(promptSettings.getPrompt(state, "wizard.characters", CHARACTER_GEN_PROMPT), user, { temperature: 0.6 });
    if (j) return { ...j, _mock: false };
  } catch (e) { /* fall through to mock */ }
  return { ...mockCharacters(freeText, npcCount), _mock: true };
}

// B1 — per-field AI 도움. The wizard opens as an EMPTY form; nothing is
// auto-generated. Each field (or field group) has an "AI 도움" button that calls
// this with a field id + the surrounding context, and gets back ONLY a
// suggestion for that field — the user chooses whether to accept it.
const SUGGEST_SPECS = {
  world_name:   { instr: "세계 이름 하나를 지어라.", key: "world_name", mock: (c) => ({ world_name: "안개의 항구, 벨하르" }) },
  tone:         { instr: "세계의 톤/분위기를 한 문장으로.", key: "tone", mock: () => ({ tone: "낮은 채도의, 젖은 돌과 안개의 분위기" }) },
  background_description: { instr: "세계관 배경을 2~4문단의 자유 서술로. 마법/기술/종교/역사 등을 강제로 구조화하지 말고 자연스럽게 서술.", key: "background_description", mock: (c) => ({ background_description: `${(c.worldText || "이 세계").slice(0, 40)}… 오래된 항구도시를 중심으로, 바다에서 온 것들과 뭍의 오랜 규칙이 부딪친다. 마법은 드물고 값비싸며, 아무도 그 대가를 정확히 알지 못한다.` }) },
  region:       { instr: "지역 하나를 만들어라.", key: "region", schema: `{ "name": "", "description": "", "terrain": "", "climate": "", "security_level": "", "notable_features": [""] }`, mock: () => ({ name: "썰물 시장", description: "썰물 때만 드러나는 갯벌 위에 서는 시장", terrain: "갯벌/부두", climate: "습하고 안개가 잦음", security_level: "치안 불안정", notable_features: ["밀수품이 오간다"] }) },
  faction:      { instr: "세력 하나를 만들어라.", key: "faction", schema: `{ "name": "", "description": "", "goal": "", "key_people": "", "faction_relations": "", "influence": "", "founding_principle": "" }`, mock: () => ({ name: "부두 조합", description: "항구 노동자들의 상호부조 조직", goal: "항구 통제권 확보", key_people: "노령의 갈", faction_relations: "상인 길드와 대립", influence: "항구 일대", founding_principle: "mutual_aid" }) },
  player_background: { instr: "플레이어 캐릭터의 배경을 한 문장으로.", key: "background", mock: (c) => ({ background: (c.charText || "과거를 숨긴 채 항구에 흘러든 전직 용병").slice(0, 80) }) },
  player_core_values: { instr: "핵심 가치관 2~3개를 배열로.", key: "core_values", schema: `{ "core_values": ["",""] }`, mock: () => ({ core_values: ["생존", "의리"] }) },
  player_fear:  { instr: "핵심 두려움 하나를 짧게.", key: "core_fear", mock: () => ({ core_fear: "잊히는 것" }) },
  player_desire:{ instr: "핵심 욕망 하나를 짧게.", key: "desire", mock: () => ({ desire: "머물 곳" }) },
  player_trauma:{ instr: "트라우마 하나를 짧게.", key: "trauma", mock: () => ({ trauma: "" }) },
  npc:          { instr: "세계관과 어울리는 NPC 한 명을 만들어라.", key: "npc", schema: `{ "birth_name": "", "background": "", "core_values": [""], "goal_current": "", "current_location": "지역 canon_id", "affiliations": ["세력 canon_id"], "schedule_hint": "", "psychology": { "attachment_style": "secure|anxious|avoidant|fearful", "core_fear": "", "desire": "", "defense_mechanism": "", "trauma": "" } }`, mock: (c) => ({ birth_name: "리아", background: "부두에서 자란 젊은 밀수업자", core_values: ["자유", "가족"], goal_current: "빚을 갚고 동생을 지키는 것", current_location: (c.world && (c.world.regions || [])[0] && c.world.regions[0].canon_id) || "", affiliations: [], schedule_hint: "낮에는 부두, 밤에는 선술집", psychology: { attachment_style: "avoidant", core_fear: "버림받는 것", desire: "안정", defense_mechanism: "회피 — 농담으로 화제를 돌린다", trauma: "" } }) },
};

// suggestField(field, context) → { field, suggestion } (suggestion is a value or
// a small object). Falls back to a deterministic mock when no API key.
async function suggestField(field, context) {
  const promptSettings = require("../gemini/promptSettings");
  const spec = SUGGEST_SPECS[field];
  if (!spec) return { field, suggestion: null, error: "unknown_field" };
  const ctx = context || {};
  const ctxLines = [
    ctx.worldText ? `세계 설명: ${ctx.worldText}` : null,
    ctx.world && ctx.world.world_name ? `세계 이름: ${ctx.world.world_name}` : null,
    ctx.world && ctx.world.tone ? `톤: ${ctx.world.tone}` : null,
    ctx.world && ctx.world.background_description ? `배경: ${String(ctx.world.background_description).slice(0, 400)}` : null,
    ctx.world && (ctx.world.regions || []).length ? `지역: ${(ctx.world.regions || []).map((r) => `${r.canon_id}:${r.name}`).join(", ")}` : null,
    ctx.world && (ctx.world.factions || []).length ? `세력: ${(ctx.world.factions || []).map((f) => `${f.canon_id}:${f.name}`).join(", ")}` : null,
    ctx.charText ? `플레이어 설명: ${ctx.charText}` : null,
    ctx.player && ctx.player.birth_name ? `플레이어 이름: ${ctx.player.birth_name}` : null,
    ctx.npc && ctx.npc.birth_name ? `현재 NPC: ${ctx.npc.birth_name}` : null,
  ].filter(Boolean).join("\n");
  const schema = spec.schema || `{ "${spec.key}": "" }`;
  const fallbackSys = `당신은 TRPG 설정을 돕는 어시스턴트입니다. 아래 맥락에 어울리도록 요청된 항목만 생성하세요.\n요청: ${spec.instr}\n순수 JSON만 출력합니다. 스키마: ${schema}\n원칙: 과하게 지어내지 말고 맥락에 일관되게. 사용자가 이미 적은 값이 있으면 그것과 어울리게.`;
  const sys = promptSettings.getPrompt(ctx.prompt_state || null, "wizard.field_suggest", fallbackSys, { request: spec.instr, schema });
  try {
    const j = await gemini.generateStructured(sys, ctxLines || "(추가 맥락 없음)", { temperature: 0.7 });
    if (j) {
      // region/faction/npc return the object itself; scalar fields return {key: value}.
      if (spec.schema) return { field, suggestion: j, _mock: false };
      return { field, suggestion: j[spec.key] !== undefined ? j[spec.key] : j, _mock: false };
    }
  } catch (e) { /* fall through to mock */ }
  const m = spec.mock(ctx);
  return { field, suggestion: spec.schema ? m : m[spec.key], _mock: true };
}

// C3 — map an initial player↔NPC relationship type to seed edge values (each
// dimension on -1..1). "낯선 사람"/"안 정해짐" seed a near-neutral edge; the
// "연결 없음" case never reaches here (no edge is created at all).
const REL_TYPE_SEED = {
  "친구":       { trust: 0.5, affection: 0.5, respect: 0.35, obligation: 0.2, fear: 0 },
  "가족":       { trust: 0.6, affection: 0.6, respect: 0.4, obligation: 0.5, fear: 0 },
  "스승":       { trust: 0.5, affection: 0.3, respect: 0.7, obligation: 0.3, fear: 0.05 },
  "라이벌":     { trust: -0.1, affection: -0.1, respect: 0.4, obligation: 0, fear: 0.1 },
  "낯선 사람":  { trust: 0.05, affection: 0, respect: 0.05, obligation: 0, fear: 0 },
  "안 정해짐":  { trust: 0, affection: 0, respect: 0, obligation: 0, fear: 0 },
};
function seedEdgeFor(relType) {
  const base = REL_TYPE_SEED[String(relType || "").trim()] || REL_TYPE_SEED["안 정해짐"];
  return { ...base };
}

// A3 steps 4-5: convert confirmed wizard output to canon.register requests.
// Every entity must pass the Kernel's normal validation to be registered.
// C1 — regions/factions carry the new optional detail fields (blank ones are
// simply omitted). C3 — NPCs additionally seed a player RelationshipEdge in
// state.npcs unless flagged "연결 없음" (no_player_connection).
function registerAll(kernel, state, confirmed) {
  const results = [];
  const push = (payload) => results.push({ canon_id: payload.canon_id, ...kernel.request(state, "wizard", "canon.register", payload) });
  const clean = (obj) => { const o = {}; for (const [k, v] of Object.entries(obj)) { if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)) o[k] = v; } return o; };

  for (const r of confirmed.regions || []) {
    push({ canon_id: r.canon_id, type: "World", data: clean({
      region: r.canon_id, display_name: r.name, description: r.description,
      terrain: r.terrain, climate: r.climate, security_level: r.security_level, // C1
      notable_features: r.notable_features || [], discovered_by_player: true,
    }) });
  }
  for (const f of confirmed.factions || []) {
    push({ canon_id: f.canon_id, type: "Faction", data: clean({
      display_name: f.name, description: f.description, founding_principle: f.founding_principle,
      leader: f.leader, stance: f.stance,
      goal: f.goal, key_people: f.key_people, faction_relations: f.faction_relations, influence: f.influence, // C1
      discovered_by_player: true,
    }) });
  }
  for (const n of confirmed.npcs || []) {
    const noConnection = !!n.no_player_connection; // C3
    const relType = n.relationship_to_player_type || n.relationship_type || "";
    // Strip UI-only fields before persisting to canon.
    const { no_player_connection, relationship_to_player_type, relationship_type, _selected, ...canonData } = n;
    push({ canon_id: n.canon_id, type: "Character", data: {
      ...canonData, discovered_by_player: false,
      no_player_relationship: noConnection, // C3 — honored by NPCBrain/social
      relationship_type_hint: noConnection ? null : (relType || null),
    } });
    // C3 — seed the player edge unless this is a pure world-figure (연결 없음).
    if (!noConnection && !(state.npcs || []).some((x) => x.canon_ref === n.canon_id)) {
      const seed = seedEdgeFor(relType);
      (state.npcs = state.npcs || []).push({
        canon_ref: n.canon_id,
        relationship_to_player: { from: n.canon_id, to: "player_main", ...seed, type: relType || "acquaintance", last_changed_turn: state.turn_number || 0, change_history: [] },
      });
    }
  }
  return results;
}

module.exports = { generateWorld, generateCharacters, suggestField, registerAll, REL_TYPE_SEED, WORLD_GEN_PROMPT, CHARACTER_GEN_PROMPT };
