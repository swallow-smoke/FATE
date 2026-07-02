// Phase 5 Wave 2 — Inventory (entirely new system).
// state.inventory: [{ item_id, canon_ref, name, quantity, acquired_turn,
//   acquired_context_memory_ref, tags[] }]
// Acquisition/consumption is detected by the post-processing extraction step
// (item_gains / item_uses fields added to the extraction schema). Crafting is
// a single narrative skill check — no recipe grid by design.

function nextItemId(state) {
  const n = (state.inventory || []).reduce((m, it) => Math.max(m, Number((it.item_id || "").replace(/\D/g, "") || 0)), 0);
  return `item_${String(n + 1).padStart(4, "0")}`;
}

function slugify(name) {
  return "item_" + String(name).toLowerCase().replace(/[^a-z0-9가-힣]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
}

// Add an item; registers a Canon "Item" entity if one doesn't exist yet.
function addItem(state, canonDb, kernel, { name, quantity = 1, tags = [], memory_ref = null }) {
  if (!name) return { ok: false, reason: "item name required" };
  state.inventory = state.inventory || [];

  const canonRef = slugify(name);
  if (!canonDb.get(canonRef)) {
    kernel.request(state, "inventory", "canon.register", {
      canon_id: canonRef,
      type: "Item",
      data: { name, tags, first_acquired_turn: state.turn_number, discovered_by_player: true },
    });
  }
  const existing = state.inventory.find((it) => it.canon_ref === canonRef);
  if (existing) {
    existing.quantity += quantity;
    return { ok: true, item: existing, merged: true };
  }
  const item = {
    item_id: nextItemId(state),
    canon_ref: canonRef,
    name,
    quantity,
    acquired_turn: state.turn_number,
    acquired_context_memory_ref: memory_ref,
    tags,
  };
  state.inventory.push(item);
  return { ok: true, item };
}

// Consume/remove. quantity hits 0 -> row removed (canon entity stays: it
// remains true that the item existed).
function removeItem(state, { name, canon_ref, quantity = 1 }) {
  state.inventory = state.inventory || [];
  const ref = canon_ref || (name ? slugify(name) : null);
  const idx = state.inventory.findIndex((it) => it.canon_ref === ref || it.name === name);
  if (idx < 0) return { ok: false, reason: "item not in inventory" };
  const item = state.inventory[idx];
  item.quantity -= quantity;
  if (item.quantity <= 0) state.inventory.splice(idx, 1);
  return { ok: true, item };
}

// Apply the extraction call's item fields for this turn.
function applyExtraction(state, canonDb, kernel, extraction, memoryRefs) {
  const applied = { gained: [], used: [] };
  for (const g of extraction.item_gains || []) {
    const r = addItem(state, canonDb, kernel, { name: g.name, quantity: g.quantity || 1, tags: g.tags || [], memory_ref: (memoryRefs && memoryRefs[0]) || null });
    if (r.ok) applied.gained.push(r.item.name);
  }
  for (const u of extraction.item_uses || []) {
    const r = removeItem(state, { name: u.name, quantity: u.quantity || 1 });
    if (r.ok) applied.used.push(u.name);
  }
  return applied;
}

module.exports = { addItem, removeItem, applyExtraction, slugify };
