// Phase 16+ · Home / Property System
//
// The player can own buildings — 집·농장·여관·상점·연구소·성 — each upgradeable
// and each a vessel for memories: 추억·편지·전리품·장식품 accumulate inside. This
// is deliberately a home for *keepsakes*, tying the Property system to Memory and
// Inventory so a house becomes a place the story can return to. System-first:
// acquisition/upgrade/storage are state ops; the AI narrates the move-in.

"use strict";

const KINDS = { house: "집", farm: "농장", inn: "여관", shop: "상점", lab: "연구소", castle: "성" };
const CONTENT_TYPES = { memory: "추억", letter: "편지", loot: "전리품", decor: "장식품" };

let seq = 0;

function acquire(state, { kind = "house", name, region }, turn) {
  state.properties = state.properties || [];
  seq += 1;
  const prop = {
    id: `prop_${String(turn || 0).padStart(4, "0")}_${seq}`,
    kind: KINDS[kind] ? kind : "house",
    name: name || KINDS[kind] || "집",
    region: region || null,
    acquired_turn: turn,
    level: 1,
    upgrades: [],
    contents: [],
  };
  state.properties.push(prop);
  return prop;
}

function get(state, id) { return (state.properties || []).find((p) => p.id === id) || null; }

function upgrade(state, id, upgradeName, turn) {
  const p = get(state, id);
  if (!p) return null;
  p.level = (p.level || 1) + 1;
  p.upgrades = [...(p.upgrades || []), { name: upgradeName || `증축 ${p.level}`, turn }];
  return p;
}

// Store a keepsake (memory ref / letter / loot item / decor) inside a property.
function store(state, id, { type = "decor", ref = null, note = "" }, turn) {
  const p = get(state, id);
  if (!p) return null;
  const entry = { type: CONTENT_TYPES[type] ? type : "decor", ref, note, turn };
  p.contents = [...(p.contents || []), entry].slice(-100);
  return entry;
}

// Apply extraction-provided property changes.
//   { acquired:[{kind,name,region}], upgraded:[{id,name}], stored:[{id,type,ref,note}] }
function applyExtraction(state, changes, turn) {
  const out = { acquired: [], upgraded: [], stored: [] };
  if (!changes) return out;
  for (const a of changes.acquired || []) out.acquired.push(acquire(state, a, turn));
  for (const u of changes.upgraded || []) { const p = upgrade(state, u.id, u.name, turn); if (p) out.upgraded.push({ id: p.id, level: p.level }); }
  for (const s of changes.stored || []) { const e = store(state, s.id, s, turn); if (e) out.stored.push({ id: s.id, type: e.type }); }
  return out;
}

// Player-facing list with kind labels resolved.
function playerVisible(state) {
  return (state.properties || []).map((p) => ({
    id: p.id, kind: p.kind, kind_label: KINDS[p.kind] || p.kind, name: p.name, region: p.region,
    level: p.level, upgrades: p.upgrades || [],
    contents: (p.contents || []).map((c) => ({ type: c.type, type_label: CONTENT_TYPES[c.type] || c.type, ref: c.ref, note: c.note, turn: c.turn })),
  }));
}

// Directive line so the GM can weave "네 집" into the scene when the player is home.
function homeDirective(state, location) {
  const here = (state.properties || []).find((p) => p.region && p.region === location);
  if (!here) return null;
  const keepsakes = (here.contents || []).slice(-3).map((c) => c.note || CONTENT_TYPES[c.type]).filter(Boolean);
  return `이곳에는 플레이어 소유의 ${KINDS[here.kind] || here.kind}("${here.name}", ${here.level}단계)가 있다${keepsakes.length ? ` — 안에는 ${keepsakes.join(", ")} 같은 물건이 있다` : ""}. 자기 공간에 돌아온 감각을 자연스럽게 살려라.`;
}

module.exports = { acquire, get, upgrade, store, applyExtraction, playerVisible, homeDirective, KINDS, CONTENT_TYPES };
