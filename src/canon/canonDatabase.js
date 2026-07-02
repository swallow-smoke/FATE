// Step 2 — Canon Database (02-Kernel/CanonDatabase.md)
//
// Static "what is true" store. MVP: Character / World / Faction only,
// canon.register + canon.update only, immutable_fields violation check from
// the very start (CanonDatabase §9). Version history is deferred — we overwrite
// the latest value (§5 note).

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../state/campaignState");

const SUPPORTED_TYPES = ["Character", "World", "Faction", "Quest", "Rumor", "Item"];

// Sensible default field partitions per type. A register call may override
// immutable_fields / mutable_fields explicitly.
const DEFAULT_FIELDS = {
  Character: {
    immutable_fields: ["birth_name", "species", "core_values"],
    mutable_fields: ["current_location", "current_status", "relationship_summary", "affiliations", "psychology", "goal_current", "schedule_hint"],
  },
  World: {
    immutable_fields: ["region", "terrain"],
    mutable_fields: ["climate", "notable_features", "controlling_faction"],
  },
  Faction: {
    immutable_fields: ["founding_principle"],
    mutable_fields: ["leader", "strength", "stance", "notable_members"],
  },
  Quest: {
    immutable_fields: ["origin_event", "quest_type"],
    mutable_fields: ["status", "quest_hint", "involved_refs"],
  },
  // Phase 5 Wave 2 — previously-unused types activated.
  Rumor: {
    immutable_fields: ["origin_region", "accuracy", "source_event"],
    mutable_fields: ["content", "spread_regions", "spread_turn", "next_spread_turn", "heard_by_player", "heard_turn", "discovered_by_player"],
  },
  Item: {
    immutable_fields: ["name", "first_acquired_turn"],
    mutable_fields: ["tags", "discovered_by_player"],
  },
};

function createCanonDatabase(campaignId) {
  const filePath = path.join(DATA_DIR, `${campaignId}_canon.json`);

  function loadAll() {
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  let entities = loadAll();

  function persist() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(entities, null, 2), "utf8");
  }

  function get(canonId) {
    return entities.find((e) => e.canon_id === canonId) || null;
  }

  function all() {
    return entities.slice();
  }

  // --- canon.register (CanonDatabase §5) ---------------------------------
  function register({ canon_id, type, data, immutable_fields, mutable_fields }, turn) {
    if (!SUPPORTED_TYPES.includes(type)) {
      return { ok: false, reason: `Unsupported canon type "${type}" (MVP: ${SUPPORTED_TYPES.join(", ")})` };
    }
    if (!canon_id) return { ok: false, reason: "canon_id is required" };

    // 2. duplicate canon_id check
    if (get(canon_id)) {
      return { ok: false, reason: `canon_id "${canon_id}" already registered` };
    }

    // 3. contradiction check (MVP): don't re-introduce a character already
    // recorded dead as alive under a new id sharing the same birth_name.
    if (type === "Character" && data && data.birth_name) {
      const clash = entities.find(
        (e) => e.type === "Character" && e.data.birth_name === data.birth_name
      );
      if (clash) {
        return {
          ok: false,
          reason: `Character with birth_name "${data.birth_name}" already exists as ${clash.canon_id}`,
        };
      }
    }

    const defaults = DEFAULT_FIELDS[type];
    const entity = {
      canon_id,
      type,
      immutable_fields: immutable_fields || defaults.immutable_fields,
      mutable_fields: mutable_fields || defaults.mutable_fields,
      data: data || {},
      registered_at_turn: turn,
      last_updated_turn: turn,
      source: "kernel_approved",
      version: 1,
    };
    entities.push(entity);
    persist();
    return { ok: true, entity };
  }

  // --- canon.update (CanonDatabase §5) -----------------------------------
  function update({ canon_id, field, new_value }, turn) {
    const entity = get(canon_id);
    if (!entity) return { ok: false, reason: `canon_id "${canon_id}" not found` };

    // 2. immutable_fields violation → immediate reject (hard rule, §9)
    if (entity.immutable_fields.includes(field)) {
      return {
        ok: false,
        reason: `Field "${field}" is immutable on ${canon_id} — reject`,
      };
    }
    // Only allow known mutable fields (or a genuinely new data field that is
    // not declared immutable). This keeps immutable protection strict.
    entity.data[field] = new_value;
    entity.last_updated_turn = turn;
    entity.version += 1;
    persist();
    return { ok: true, entity };
  }

  // --- <canon_context> assembly (CanonDatabase §7) -----------------------
  // Filter to entities relevant to the current scene's participants / refs.
  function relevantTo(refs) {
    const wanted = new Set(refs || []);
    return entities.filter((e) => wanted.has(e.canon_id));
  }

  // Phase 5 Wave 2 — wiki gating: mark entities the player has actually seen
  // in a scene. Pages only exist for discovered entities.
  function markDiscovered(canonIds, turn) {
    let changed = false;
    for (const id of canonIds || []) {
      const e = get(id);
      if (e && e.type !== "Rumor" && !(e.data && e.data.discovered_by_player)) {
        e.data.discovered_by_player = true;
        e.data.discovered_turn = turn;
        changed = true;
      }
    }
    if (changed) persist();
    return changed;
  }

  return { get, all, register, update, relevantTo, markDiscovered, persist, filePath, SUPPORTED_TYPES };
}

module.exports = { createCanonDatabase, SUPPORTED_TYPES, DEFAULT_FIELDS };
