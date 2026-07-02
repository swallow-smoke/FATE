// Phase 5 Wave 2 — 백과사전(위키) renderer.
// One canon entity = one page, rendered as sentence-style markdown (NOT a
// field dump), with canon_refs converted to wiki hyperlinks. Pages exist ONLY
// for discovered_by_player entities; links to undiscovered entities render as
// inert text handled by the frontend. Markdown lives in memory only — the
// separate campaign export handles files.

function name(e) {
  const d = e.data || {};
  return d.display_name || d.birth_name || d.name || e.canon_id;
}

function link(id) {
  return `[[${id}]]`; // frontend resolves to a wiki link (or inert if undiscovered)
}

function renderCharacter(e, canonDb) {
  const d = e.data || {};
  const psy = d.psychology || {};
  const s = [];
  const aff = (d.affiliations || []).filter((a) => canonDb.get(a));
  s.push(`**${name(e)}**은(는) ${d.species || "human"}이며${aff.length ? ` ${aff.map(link).join(", ")} 소속이다` : " 특정 소속이 없다"}.`);
  if (d.current_location) s.push(`현재 ${canonDb.get(d.current_location) ? link(d.current_location) : d.current_location}에 머물고 있다.`);
  if (d.current_status && d.current_status !== "alive") s.push(`상태: ${d.current_status}.`);
  if (d.background) s.push(d.background);
  if ((d.core_values || []).length) s.push(`${name(e)}에게 중요한 것은 ${(d.core_values || []).join(", ")}이다.`);
  if (d.goal_current) s.push(`요즘은 ${d.goal_current}에 몰두해 있다.`);
  if (d.schedule_hint) s.push(`평소에는 ${d.schedule_hint} 근처에서 볼 수 있다.`);
  if (psy.core_fear || psy.desire) {
    const bits = [psy.desire ? `${psy.desire}을(를) 바라고` : null, psy.core_fear ? `${psy.core_fear}을(를) 두려워한다` : null].filter(Boolean);
    s.push(`가까이서 지켜본 사람이라면, 이 인물이 ${bits.join(", ")}는 것을 눈치챌 수 있다.`);
  }
  return s.join(" ");
}

function renderWorld(e, canonDb) {
  const d = e.data || {};
  const s = [];
  s.push(`**${name(e)}**${d.terrain ? ` — ${d.terrain} 지형의 지역이다.` : "."}`);
  if (d.climate) s.push(`기후는 ${d.climate}.`);
  if ((d.notable_features || []).length) s.push(`이곳에 대해 전해지는 것: ${(d.notable_features || []).join("; ")}.`);
  if (d.controlling_faction && canonDb.get(d.controlling_faction)) s.push(`현재 ${link(d.controlling_faction)}의 영향권 아래 있다.`);
  const residents = canonDb.all().filter((c) => c.type === "Character" && c.data && c.data.current_location === (d.region || e.canon_id));
  if (residents.length) s.push(`이 지역에서 볼 수 있는 인물: ${residents.map((c) => link(c.canon_id)).join(", ")}.`);
  return s.join(" ");
}

function renderFaction(e, canonDb) {
  const d = e.data || {};
  const s = [];
  s.push(`**${name(e)}**은(는) ${d.founding_principle ? `"${d.founding_principle}"을(를) 기치로 세워진` : ""} 세력이다.`);
  if (d.leader) s.push(`이끄는 이는 ${d.leader}.`);
  if (d.stance) s.push(`외부에 대한 태도는 ${d.stance}.`);
  const members = canonDb.all().filter((c) => c.type === "Character" && (c.data.affiliations || []).includes(e.canon_id));
  if (members.length) s.push(`알려진 구성원: ${members.map((c) => link(c.canon_id)).join(", ")}.`);
  return s.join(" ");
}

function renderItem(e) {
  const d = e.data || {};
  const s = [`**${name(e)}**.`];
  if ((d.tags || []).length) s.push(`(${(d.tags || []).join(", ")})`);
  if (d.first_acquired_turn != null) s.push(`처음 손에 넣은 것은 ${d.first_acquired_turn}턴 무렵의 일이다.`);
  return s.join(" ");
}

function renderRumor(e) {
  const d = e.data || {};
  return `*"${d.content}"* — ${d.origin_region || "어딘가"}에서 시작된 소문.`;
}

function renderQuest(e) {
  const d = e.data || {};
  return `**${name(e)}** — ${d.quest_hint || d.origin_event || "진행 중인 일"} (${d.status || "open"}).`;
}

// The template function the handoff asks for.
function renderCanonAsMarkdown(entity, canonDb) {
  switch (entity.type) {
    case "Character": return renderCharacter(entity, canonDb);
    case "World": return renderWorld(entity, canonDb);
    case "Faction": return renderFaction(entity, canonDb);
    case "Item": return renderItem(entity);
    case "Rumor": return renderRumor(entity);
    case "Quest": return renderQuest(entity);
    default: return `**${name(entity)}**`;
  }
}

// Full page payload: body + related Personal+ memories (08-Memory §6).
function buildPage(entity, canonDb, memoryEngine) {
  const body = renderCanonAsMarkdown(entity, canonDb);
  const related = memoryEngine
    .all()
    .filter((m) => m.tier >= 2 && (m.canon_refs || []).includes(entity.canon_id))
    .slice(-12)
    .map((m) => ({ id: m.id, tier: m.tier, summary: m.summary, turn: m.timestamp.campaign_turn }));
  return { canon_id: entity.canon_id, type: entity.type, title: name(entity), body, related_memories: related, discovered: !!(entity.data && entity.data.discovered_by_player) };
}

// Wiki index: discovered pages only; undiscovered ids listed so the frontend
// can render inert links.
function buildIndex(canonDb, memoryEngine) {
  const all = canonDb.all();
  const discovered = all.filter((e) => e.data && e.data.discovered_by_player);
  return {
    pages: discovered.map((e) => buildPage(e, canonDb, memoryEngine)),
    undiscovered_ids: all.filter((e) => !(e.data && e.data.discovered_by_player)).map((e) => e.canon_id),
  };
}

module.exports = { renderCanonAsMarkdown, buildPage, buildIndex };
