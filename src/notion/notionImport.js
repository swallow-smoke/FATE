// PATCH Notion Import §4·§5·§7 — 구조화 분류 · 중복 감지 · Kernel/Registry 등록.
//
// 분류는 Phase4 A4와 같은 패턴의 "구조화 전용" 프롬프트로, 서사 생성과 완전히
// 분리된다(gemini.generateStructured). 불확실하면 억지로 끼워맞추지 않고 Other로
// 분류한다. 등록은 AI 생성물과 동일하게 정식 경로(canon.register / registry)를
// 거친다 — Notion에서 왔다고 검증을 면제하지 않는다.

const gemini = require("../gemini/geminiClient");
const dimensionRegistry = require("../custom/dimensionRegistry");

const TYPES = [
  "Character", "World", "Faction", "Item", "Organization", "Property",
  "FamilyRelation", "Promise", "CalendarEvent", "WantedRecord",
  "RegionReputation", "HouseRule", "NarrativeArc", "Motif",
  "HiddenVariable", "Bundle", "Other",
];

let CLASSIFY_PROMPT = `당신은 TRPG 설정 문서를 분류·추출하는 어시스턴트입니다.
주어진 Notion 페이지(제목 + 본문)가 다음 중 무엇인지 판단하고 해당 스키마로 추출하세요.
순수 JSON만 출력합니다(설명·마크다운·코드블록 없이).

type 후보:
- "Character": 인물. data: { "birth_name":"", "species":"human", "background":"", "core_values":[""],
    "goal_current":"", "current_location":"", "schedule_hint":"",
    "psychology": { "attachment_style":"secure|anxious|avoidant|fearful", "core_fear":"", "desire":"", "defense_mechanism":"", "trauma":"" } }
- "World": 장소/세계. data: { "name":"", "description":"", "terrain":"", "climate":"", "security_level":"", "notable_features":[""] }
- "Faction": 세력/조직. data: { "name":"", "description":"", "founding_principle":"", "goal":"", "leader":"", "key_people":"", "influence":"", "stance":"" }
- "NarrativeArc": 서사 아크/줄거리. data: { "title":"", "summary":"", "stage":"setup|rising|climax|resolution", "beats":[""] }
- "Motif": 반복 모티프/주제. data: { "label":"", "description":"" }
- "HiddenVariable": 숨은 내면 변수 정의. data: { "label":"", "description":"", "default_value":0.5, "high_directive":"", "low_directive":"" }
- "Other": 위 어디에도 확실히 안 맞음. data: { "note":"" }  ← 불확실하면 반드시 이걸로.

출력 형식: { "type":"...", "data":{...}, "confidence":0.0~1.0 }
원칙: 본문에 없는 내용을 지어내지 말 것. 애매하면 confidence를 낮추고 Other로.`;

CLASSIFY_PROMPT = `You extract structured campaign settings from a TRPG / interactive-novel document.
The input may be a full world bible, not only a single world description. Extract every useful player-facing setting:
characters, places, factions, organizations, items, properties, family ties, promises, calendar dates, wanted/reputation
records, house rules, arcs, motifs, and hidden variables.

Return JSON only. No markdown, no explanation.

If the document contains more than one useful entity, prefer:
{
  "type": "Bundle",
  "confidence": 0.0-1.0,
  "data": {
    "worlds": [{ "name":"", "description":"", "terrain":"", "climate":"", "security_level":"", "notable_features":[""], "place_kind":"", "condition":"" }],
    "characters": [{ "birth_name":"", "species":"human", "background":"", "core_values":[""], "goal_current":"", "current_location":"", "affiliations":[""], "schedule_hint":"", "relationship_to_player_type":"", "secrets": { "public":"", "hidden":"", "locked":"" }, "psychology": { "attachment_style":"secure|anxious|avoidant|fearful", "core_fear":"", "desire":"", "defense_mechanism":"", "trauma":"" } }],
    "factions": [{ "name":"", "description":"", "founding_principle":"", "goal":"", "leader":"", "key_people":"", "influence":"", "stance":"" }],
    "organizations": [{ "name":"", "hq":"", "ranks":[""], "rules":[""], "funds":0, "rivals":[""], "member":false }],
    "items": [{ "name":"", "description":"", "tags":[""], "condition":"", "owner":"" }],
    "properties": [{ "name":"", "kind":"house|farm|inn|shop|lab|castle|other", "region":"", "level":1, "contents":[""], "memories":[""] }],
    "family_relations": [{ "from":"", "to":"", "type":"parent|spouse|sibling|child|adopted|heir" }],
    "promises": [{ "npc_ref":"", "summary":"", "due_day":null }],
    "calendar_events": [{ "title":"", "kind":"promise|birthday|anniversary|festival|reservation|event", "day":null, "note":"" }],
    "wanted_records": [{ "scope_id":"", "scope_label":"", "level":1, "bounty":0, "reason":"" }],
    "region_reputation": [{ "scope":"nation|city|region|faction|organization", "scope_id":"", "name":"", "standing":0, "reason":"" }],
    "house_rules": [""],
    "arcs": [{ "title":"", "summary":"", "stage":"setup|rising|climax|resolution", "beats":[""] }],
    "motifs": [{ "label":"", "description":"" }],
    "hidden_variables": [{ "label":"", "description":"", "default_value":0.5, "high_directive":"", "low_directive":"" }],
    "notes": [""]
  }
}

If the page is clearly only one entity, you may return one of:
Character, World, Faction, Item, Organization, Property, FamilyRelation, Promise, CalendarEvent, WantedRecord,
RegionReputation, HouseRule, NarrativeArc, Motif, HiddenVariable, Other.

Rules:
- Do not invent details not supported by the text. Leave fields blank or arrays empty.
- For references, use names if canonical ids are unknown; the importer will normalize ids later.
- If uncertain, lower confidence and place unclear prose in notes/Other.

Output shape: { "type":"...", "data":{...}, "confidence":0.0-1.0 }`;

function typePrefix(type) {
  return {
    Character: "char_",
    World: "loc_",
    Faction: "faction_",
    Item: "item_",
    Organization: "org_",
    Property: "prop_",
    NarrativeArc: "arc_",
    Motif: "motif_",
    HiddenVariable: "var_",
  }[type] || "item_";
}
// safeId는 NFD(자모 분해)로 들어온 한글을 걸러내 빈 문자열을 낼 수 있으므로,
// 항상 NFC로 정규화하고 빈 결과일 땐 타임스탬프로 대체한다(HTTP 본문 인코딩 방어).
function slugify(v, prefix) {
  const s = dimensionRegistry.safeId(String(v || "").normalize("NFC"));
  return (prefix || "") + (s || Date.now().toString(36) + Math.floor(Math.random() * 900 + 100));
}
function suggestCanonId(type, data, title) {
  const base = (type === "Character" && data.birth_name)
    || data.name || data.title || data.label || data.summary || data.text || title || "item";
  return slugify(base, typePrefix(type));
}

function expandImportItem(item, title) {
  if (!item || item.type !== "Bundle") return [item];
  const d = item.data || {};
  const conf = typeof item.confidence === "number" ? item.confidence : 0.5;
  const out = [];
  const pushMany = (key, type) => {
    for (const data of Array.isArray(d[key]) ? d[key] : []) {
      if (!data || (typeof data === "object" && !Object.keys(data).length)) continue;
      out.push({
        type,
        data: typeof data === "string" ? { text: data } : data,
        confidence: conf,
        canon_id: suggestCanonId(type, typeof data === "string" ? { text: data } : data, title),
        _mock: item._mock,
        _bundle_source: title || "",
      });
    }
  };
  pushMany("worlds", "World");
  pushMany("characters", "Character");
  pushMany("factions", "Faction");
  pushMany("organizations", "Organization");
  pushMany("items", "Item");
  pushMany("properties", "Property");
  pushMany("family_relations", "FamilyRelation");
  pushMany("promises", "Promise");
  pushMany("calendar_events", "CalendarEvent");
  pushMany("wanted_records", "WantedRecord");
  pushMany("region_reputation", "RegionReputation");
  pushMany("house_rules", "HouseRule");
  pushMany("arcs", "NarrativeArc");
  pushMany("motifs", "Motif");
  pushMany("hidden_variables", "HiddenVariable");
  pushMany("notes", "Other");
  return out.length ? out : [{ type: "Other", data: { note: `${title || "Bundle"}: no extractable entries` }, confidence: 0.3, _mock: item._mock }];
}

// --- §4 분류 -------------------------------------------------------------
async function classifyPageText(title, text, state = null) {
  const promptSettings = require("../gemini/promptSettings");
  const user = `[제목]\n${title}\n\n[본문]\n${String(text || "").slice(0, 20000)}`;
  let parsed = null;
  try {
    parsed = await gemini.generateStructured(promptSettings.getPrompt(state, "notion.classify", CLASSIFY_PROMPT), user, { temperature: 0.2, kind: "notion_classify" });
  } catch (e) { /* fall through to heuristic mock */ }
  if (!parsed || !TYPES.includes(parsed.type)) parsed = heuristicClassify(title, text);
  const data = parsed.data || {};
  return {
    type: parsed.type,
    data,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    canon_id: suggestCanonId(parsed.type, data, title),
    _mock: !gemini.hasKey(),
  };
}

// 키 없을 때(또는 파싱 실패) 제목/본문 키워드로 러프 분류 — 오프라인 검증용.
function heuristicClassify(title, text) {
  const s = `${title}\n${text}`;
  if (/(조합|길드|세력|조직|guild|faction|창립)/i.test(s)) {
    return { type: "Faction", data: { name: title, description: firstSentence(text) }, confidence: 0.4 };
  }
  if (/(항구|도시|지역|장소|숲|마을|region|world|지형|기후)/i.test(s)) {
    return { type: "World", data: { name: title, description: firstSentence(text) }, confidence: 0.4 };
  }
  if (/(아크|줄거리|서사|arc|plot|막 구조|3막)/i.test(s)) {
    return { type: "NarrativeArc", data: { title, summary: firstSentence(text) }, confidence: 0.4 };
  }
  if (/(애착|두려움|욕망|방어기제|인물|캐릭터|human|인간)/i.test(s)) {
    return { type: "Character", data: { birth_name: title, background: firstSentence(text) }, confidence: 0.4 };
  }
  return { type: "Other", data: { note: `${title}: ${firstSentence(text)}` }, confidence: 0.3 };
}
function firstSentence(t) { return String(t || "").split(/(?<=[.!?。])\s+/)[0].slice(0, 200); }

// --- §5 중복 감지 --------------------------------------------------------
function normTitle(t) {
  return String(t || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/(old|copy|사본|구버전|백업|v?\d+)/gi, "").replace(/[^\w가-힣]+/g, "").trim();
}
// 제목이 같거나 매우 유사한 페이지를 그룹핑. 그룹 내 최신 수정본을 recommended로,
// 나머지는 stale. 아카이브 폴더 페이지는 기본 선택 해제 추천(강제 아님).
function groupDuplicates(pages) {
  const groups = new Map();
  for (const p of pages) {
    const key = normTitle(p.title) || p.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  let gi = 0;
  const out = [];
  for (const [, members] of groups) {
    const isDup = members.length > 1;
    const groupId = isDup ? `grp_${gi++}` : null;
    // 최신 last_edited_time을 추천으로.
    const sorted = members.slice().sort((a, b) => new Date(b.last_edited_time || 0) - new Date(a.last_edited_time || 0));
    const newestId = sorted[0].id;
    for (const p of members) {
      const recommended = !isDup ? true : (p.id === newestId);
      out.push({
        ...p,
        group_id: groupId,
        is_duplicate: isDup,
        recommended,
        // 기본 선택: 추천이면서 아카이브 폴더가 아닌 것만 체크(강제 아님, 사람이 조정).
        default_selected: recommended && !p.in_archive_folder,
        stale: isDup && p.id !== newestId,
      });
    }
  }
  // 원래 순서(깊이/발견 순) 유지.
  const order = new Map(pages.map((p, i) => [p.id, i]));
  return out.sort((a, b) => order.get(a.id) - order.get(b.id));
}

// --- §7 Kernel 검증 경유 등록 --------------------------------------------
// items: [{ type, canon_id, data }]  (프론트에서 사람이 리뷰·편집한 뒤 전달)
function registerItems(kernel, state, canonDb, items) {
  const reg = dimensionRegistry.ensure(state);
  const results = [];
  for (const it of items || []) {
    const type = it.type;
    const data = it.data || {};
    try {
      if (type === "Character" || type === "World" || type === "Faction" || type === "Item") {
        const payload = buildCanonPayload(type, it.canon_id, data);
        const r = kernel.request(state, "notion_import", "canon.register", payload);
        results.push({ type, canon_id: payload.canon_id, ok: !!r.approved, reason: r.reason });
        if (r.approved && type === "Character") seedPlayerNpcEdge(state, payload.canon_id, data);
        if (r.approved && type === "Item") seedInventoryItem(state, payload.canon_id, data);
      } else if (type === "Organization") {
        state.organizations = state.organizations || [];
        const id = slugify(it.canon_id || data.name, "org_");
        if (!state.organizations.some((o) => o.id === id || o.name === data.name)) {
          state.organizations.push({
            id,
            name: String(data.name || "이름 없는 조직").slice(0, 120),
            hq: String(data.hq || "").slice(0, 120),
            ranks: listOf(data.ranks).slice(0, 12),
            rules: listOf(data.rules).slice(0, 12),
            funds: Number(data.funds) || 0,
            rivals: listOf(data.rivals).slice(0, 12),
            member: !!data.member,
            source: "notion_import",
          });
        }
        results.push({ type, canon_id: id, ok: true });
      } else if (type === "Property") {
        state.properties = state.properties || [];
        const id = slugify(it.canon_id || data.name, "prop_");
        if (!state.properties.some((p) => p.id === id || p.name === data.name)) {
          state.properties.push({
            id,
            kind: String(data.kind || "other").slice(0, 40),
            name: String(data.name || "이름 없는 거처").slice(0, 120),
            region: String(data.region || "").slice(0, 120),
            level: Math.max(1, Number(data.level) || 1),
            upgrades: listOf(data.upgrades),
            contents: listOf(data.contents),
            memories: listOf(data.memories).map((m) => ({ turn: state.turn_number || 0, text: String(m).slice(0, 300) })),
            source: "notion_import",
          });
        }
        results.push({ type, canon_id: id, ok: true });
      } else if (type === "FamilyRelation") {
        state.family_graph = state.family_graph || { edges: [] };
        state.family_graph.edges = state.family_graph.edges || [];
        const edge = { from: String(data.from || "").trim(), to: String(data.to || "").trim(), type: String(data.type || "kin").trim() };
        if (edge.from && edge.to && !state.family_graph.edges.some((e) => e.from === edge.from && e.to === edge.to && e.type === edge.type)) {
          state.family_graph.edges.push(edge);
        }
        results.push({ type, canon_id: `${edge.from}_${edge.type}_${edge.to}`, ok: !!(edge.from && edge.to) });
      } else if (type === "Promise") {
        state.promises = state.promises || [];
        const id = slugify(data.summary || it.canon_id, "promise_");
        if (!state.promises.some((p) => p.id === id)) {
          state.promises.push({
            id,
            npc_ref: String(data.npc_ref || "").trim(),
            summary: String(data.summary || "").slice(0, 300),
            made_turn: state.turn_number || 0,
            due_day: data.due_day == null || data.due_day === "" ? null : Number(data.due_day),
            status: "open",
            source: "notion_import",
          });
        }
        results.push({ type, canon_id: id, ok: true });
      } else if (type === "CalendarEvent") {
        state.personal_calendar = state.personal_calendar || [];
        const id = slugify(data.title || it.canon_id, "cal_");
        if (!state.personal_calendar.some((e) => e.id === id)) {
          state.personal_calendar.push({
            id,
            title: String(data.title || "일정").slice(0, 120),
            kind: String(data.kind || "event").slice(0, 40),
            day: data.day == null || data.day === "" ? null : Number(data.day),
            note: String(data.note || "").slice(0, 300),
            created_turn: state.turn_number || 0,
            done: false,
            source: "notion_import",
          });
        }
        results.push({ type, canon_id: id, ok: true });
      } else if (type === "WantedRecord") {
        state.wanted = state.wanted || [];
        const id = slugify(data.scope_id || data.reason || it.canon_id, "wanted_");
        if (!state.wanted.some((w) => w.id === id)) {
          state.wanted.push({
            id,
            scope_id: String(data.scope_id || "").trim(),
            scope_label: String(data.scope_label || data.scope_id || "").trim(),
            level: Math.max(1, Number(data.level) || 1),
            bounty: Math.max(0, Number(data.bounty) || 0),
            reason: String(data.reason || "수배 기록").slice(0, 240),
            since_turn: state.turn_number || 0,
            status: "wanted",
            arrest_risk: 0,
            log: [{ turn: state.turn_number || 0, note: "Imported from setting document" }],
          });
        }
        results.push({ type, canon_id: id, ok: true });
      } else if (type === "RegionReputation") {
        state.region_reputation = state.region_reputation || [];
        const scope = String(data.scope || "region").trim();
        const scope_id = String(data.scope_id || data.name || "").trim();
        let rep = state.region_reputation.find((r) => r.scope === scope && r.scope_id === scope_id);
        if (!rep) {
          rep = { scope, scope_id, name: String(data.name || scope_id).slice(0, 120), standing: 0, label: "중립", history: [] };
          state.region_reputation.push(rep);
        }
        rep.standing = clamp(Number(data.standing) || 0, -100, 100);
        rep.history = rep.history || [];
        if (data.reason) rep.history.push({ turn: state.turn_number || 0, delta: 0, reason: String(data.reason).slice(0, 240) });
        results.push({ type, canon_id: `${scope}_${scope_id}`, ok: !!scope_id });
      } else if (type === "HouseRule") {
        state.house_rules = state.house_rules || [];
        const text = String(data.text || data.note || "").trim().slice(0, 500);
        if (text && !state.house_rules.includes(text)) state.house_rules.push(text);
        results.push({ type, canon_id: slugify(text, "rule_"), ok: !!text });
      } else if (type === "NarrativeArc") {
        state.narrative_arcs = state.narrative_arcs || [];
        const arc = {
          arc_id: slugify(data.title, "arc_"),
          title: String(data.title || "제목 없는 아크").slice(0, 120),
          summary: String(data.summary || "").slice(0, 2000),
          stage: ["setup", "rising", "climax", "resolution"].includes(data.stage) ? data.stage : "setup",
          beats: (Array.isArray(data.beats) ? data.beats : []).map((b) => String(b).slice(0, 300)).slice(0, 20),
          source: "notion_import", created_turn: state.turn_number || 0,
        };
        if (!state.narrative_arcs.some((a) => a.arc_id === arc.arc_id)) state.narrative_arcs.push(arc);
        results.push({ type, canon_id: arc.arc_id, ok: true });
      } else if (type === "Motif") {
        const item = dimensionRegistry.upsert(reg.themes, {
          id: slugify(data.label, ""), label: String(data.label || "모티프").normalize("NFC").slice(0, 60),
          description: String(data.description || "").slice(0, 300), motif: true, origin: "notion",
        });
        results.push({ type, canon_id: item.id, ok: !!item.id });
      } else if (type === "HiddenVariable") {
        const item = dimensionRegistry.upsert(reg.dimensions, {
          id: slugify(data.label, ""), label: String(data.label || "변수").normalize("NFC").slice(0, 60), kind: "hidden",
          description: String(data.description || "").slice(0, 300),
          default_value: clamp01(data.default_value, 0.5),
          high_directive: String(data.high_directive || "").slice(0, 300) || undefined,
          low_directive: String(data.low_directive || "").slice(0, 300) || undefined,
          origin: "notion",
        });
        state.player.hidden_variables = state.player.hidden_variables || {};
        if (state.player.hidden_variables[item.id] === undefined) state.player.hidden_variables[item.id] = clamp01(item.default_value, 0.5);
        results.push({ type, canon_id: item.id, ok: !!item.id });
      } else {
        // Other → 세계관 자유 메모로.
        state.world = state.world || {};
        const note = String(data.note || "").slice(0, 1000);
        if (note) state.world.notes = `${state.world.notes ? state.world.notes + "\n\n" : ""}[Notion] ${note}`.slice(0, 8000);
        results.push({ type: "Other", ok: true });
      }
    } catch (e) {
      results.push({ type, ok: false, reason: e.message });
    }
  }
  return results;
}

function buildCanonPayload(type, canonId, data) {
  const clean = (o) => { const x = {}; for (const [k, v] of Object.entries(o)) { if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)) x[k] = v; } return x; };
  if (type === "Character") {
    return { canon_id: canonId, type: "Character", data: clean({
	      birth_name: data.birth_name || data.name, species: data.species || "human", role: "npc",
	      background: data.background, core_values: data.core_values || [],
	      goal_current: data.goal_current, current_location: data.current_location, affiliations: listOf(data.affiliations),
	      schedule_hint: data.schedule_hint, relationship_type_hint: data.relationship_to_player_type || null,
	      secrets: normalizeSecrets(data.secrets), psychology: data.psychology || {},
	      goal_state: data.goal_current ? { summary: data.goal_current, progress: 0, last_tick_turn: 0, history: [] } : undefined,
	      discovered_by_player: false,
	    }) };
	  }
	  if (type === "World") {
	    return { canon_id: canonId, type: "World", data: clean({
	      region: canonId, display_name: data.name, description: data.description,
	      terrain: data.terrain, climate: data.climate, security_level: data.security_level,
	      notable_features: data.notable_features || [], place_kind: data.place_kind, condition: data.condition,
	      place_stage: data.place_stage, place_trend: data.place_trend,
	      place_history: data.condition || data.description ? [{ turn: 0, stage: data.condition || "imported", note: String(data.description || "").slice(0, 240) }] : [],
	      discovered_by_player: true,
	    }) };
	  }
	  if (type === "Item") {
	    return { canon_id: canonId, type: "Item", data: clean({
	      name: data.name || data.title,
	      description: data.description,
	      tags: listOf(data.tags),
	      first_acquired_turn: 0,
	      owner: data.owner,
	      living: data.condition ? { condition: data.condition, history: [{ turn: 0, stage: data.condition, note: "Imported from setting document" }] } : undefined,
	      discovered_by_player: true,
	    }) };
	  }
	  // Faction
	  return { canon_id: canonId, type: "Faction", data: clean({
	    display_name: data.name, description: data.description, founding_principle: data.founding_principle,
	    leader: data.leader, stance: data.stance, goal: data.goal, key_people: data.key_people, influence: data.influence,
	    discovered_by_player: true,
	  }) };
}

function listOf(v) {
  if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
  if (v == null || v === "") return [];
  return String(v).split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}

function normalizeSecrets(secrets) {
  if (!secrets || typeof secrets !== "object") return undefined;
  return {
    public: String(secrets.public || "").slice(0, 300),
    hidden: String(secrets.hidden || "").slice(0, 300),
    locked: String(secrets.locked || "").slice(0, 300),
  };
}

function seedPlayerNpcEdge(state, canonId, data) {
  state.npcs = state.npcs || [];
  if (state.npcs.some((x) => x.canon_ref === canonId)) return;
  const relType = String(data.relationship_to_player_type || "").trim();
  state.npcs.push({
    canon_ref: canonId,
    relationship_to_player: {
      from: canonId,
      to: "player_main",
      type: relType || "acquaintance",
      trust: relType ? 0.25 : 0.05,
      affection: 0,
      tension: 0,
      last_changed_turn: state.turn_number || 0,
      change_history: relType ? [{ turn: state.turn_number || 0, reason: `Imported relationship: ${relType}` }] : [],
    },
  });
}

function seedInventoryItem(state, canonId, data) {
  state.inventory = state.inventory || [];
  if (state.inventory.some((x) => x.canon_ref === canonId)) return;
  state.inventory.push({
    item_id: slugify(data.name || canonId, "inv_"),
    canon_ref: canonId,
    name: String(data.name || canonId).slice(0, 120),
    quantity: Math.max(1, Number(data.quantity) || 1),
    tags: listOf(data.tags),
    memory_ref: null,
  });
}

function clamp(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}

function clamp01(v, d) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d; }

module.exports = { classifyPageText, expandImportItem, groupDuplicates, registerItems, TYPES, CLASSIFY_PROMPT };
