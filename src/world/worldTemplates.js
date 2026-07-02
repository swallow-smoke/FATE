// Phase 8 Part B — world templates (앤솔로지 모드). A template is a pure world
// snapshot (World + Faction canon only — never Characters, never history) that
// can seed a brand-new campaign with its own separate CampaignState/Memory.
// Stored globally in data/world_templates.json so any campaign can reuse them.

"use strict";

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../state/campaignState");

const FILE = path.join(DATA_DIR, "world_templates.json");

function load() {
  if (!fs.existsSync(FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return []; }
}
function persist(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), "utf8");
}

let seq = load().length;

// Snapshot World/Faction canon (Characters excluded) into a new template.
function saveTemplate({ name, source_campaign_id, canon, narrative_dna, world_name }) {
  const list = load();
  seq += 1;
  const tmpl = {
    template_id: `tmpl_${String(seq).padStart(4, "0")}`,
    name: name || world_name || "이름 없는 세계관",
    world_name: world_name || name || null,
    source_campaign_id: source_campaign_id || null,
    canon_snapshot: (canon || []).filter((e) => e.type === "World" || e.type === "Faction").map((e) => ({
      canon_id: e.canon_id, type: e.type, data: e.data, immutable_fields: e.immutable_fields, mutable_fields: e.mutable_fields,
    })),
    narrative_dna_defaults: narrative_dna || null,
    created_at: new Date().toISOString(),
  };
  list.push(tmpl);
  persist(list);
  return tmpl;
}

function get(templateId) { return load().find((t) => t.template_id === templateId) || null; }

function remove(templateId) {
  const list = load().filter((t) => t.template_id !== templateId);
  persist(list);
  return list;
}

module.exports = { load, saveTemplate, get, remove, FILE };
