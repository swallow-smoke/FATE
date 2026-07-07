// Phase 16+ · Family Tree
//
// Kinship among Characters as a symmetric graph on state.family_graph.edges:
//   { from, to, type }  with the inverse edge kept in sync automatically.
// Types: parent/child, spouse, sibling, adopted_parent/adopted_child, heir.
// System-first: links are set from extraction (kinship_changes) or wizard/canon;
// the viewer just reads the graph. Building the player's lineage, successors and
// in-laws is then a pure graph walk.

"use strict";

const INVERSE = {
  parent: "child", child: "parent",
  spouse: "spouse", sibling: "sibling",
  adopted_parent: "adopted_child", adopted_child: "adopted_parent",
  heir: "predecessor", predecessor: "heir",
};

function edges(state) { state.family_graph = state.family_graph || { edges: [] }; return state.family_graph.edges; }
function has(list, from, to, type) { return list.some((e) => e.from === from && e.to === to && e.type === type); }

// Link a and b with `type` (a is the `type` of b), keeping the inverse in sync.
function link(state, a, b, type) {
  if (!a || !b || a === b || !INVERSE[type]) return false;
  const list = edges(state);
  let added = false;
  if (!has(list, a, b, type)) { list.push({ from: a, to: b, type }); added = true; }
  const inv = INVERSE[type];
  if (!has(list, b, a, inv)) { list.push({ from: b, to: a, type: inv }); added = true; }
  return added;
}

function unlink(state, a, b) {
  const list = edges(state);
  const before = list.length;
  state.family_graph.edges = list.filter((e) => !((e.from === a && e.to === b) || (e.from === b && e.to === a)));
  return before !== state.family_graph.edges.length;
}

// Apply extraction-provided kinship changes: [{ a, b, type }].
function applyExtraction(state, kinshipChanges) {
  const applied = [];
  for (const k of kinshipChanges || []) {
    if (k && k.a && k.b && link(state, k.a, k.b, k.type)) applied.push({ a: k.a, b: k.b, type: k.type });
  }
  return applied;
}

// All relatives of `ref`, grouped by relation type (canon-resolved names).
function relativesOf(state, canonDb, ref) {
  const out = {};
  for (const e of edges(state)) {
    if (e.from !== ref) continue;
    const ent = canonDb && canonDb.get(e.to);
    (out[e.type] = out[e.type] || []).push({ canon_id: e.to, name: (ent && ent.data && ent.data.birth_name) || e.to });
  }
  return out;
}

// A compact tree centred on rootRef for the Family Tree viewer.
function treeFor(state, canonDb, rootRef) {
  const rel = relativesOf(state, canonDb, rootRef);
  const rootEnt = canonDb && canonDb.get(rootRef);
  return {
    root: { canon_id: rootRef, name: (rootEnt && rootEnt.data && rootEnt.data.birth_name) || rootRef },
    parents: [...(rel.parent || []), ...(rel.adopted_parent || [])],
    spouse: rel.spouse || [],
    siblings: rel.sibling || [],
    children: [...(rel.child || []), ...(rel.adopted_child || [])],
    heirs: rel.heir || [],
  };
}

// Everyone who appears in any kinship edge (for a picker / whole-tree view).
function members(state) {
  const s = new Set();
  for (const e of edges(state)) { s.add(e.from); s.add(e.to); }
  return [...s];
}

module.exports = { link, unlink, applyExtraction, relativesOf, treeFor, members, INVERSE };
