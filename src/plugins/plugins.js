// Phase 15 Part CC — declarative plugin system.
//
// A plugin does NOT ship code (see W0). It is a manifest that drops VALUES into
// extension points the engine already has. The engine owns all execution; the
// plugin only names things. Exactly five extension points are permitted (CC1);
// any other `type` is rejected at validation (CC3). Plugins are app-global
// (data/plugins.json), reusable across campaigns like world templates.

"use strict";

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../state/campaignState");

const FILE = path.join(DATA_DIR, "plugins.json");

// CC1 — the whitelist of extension points and the exact shape each value needs.
const EXTENSION_POINTS = {
  scene_type: { required: ["id", "label", "tone_notes"] },
  dynamic_trait_preset: { required: ["genre", "trait_name"] },
  communication_channel: { required: ["tech_level", "label", "reuse_delivery"] }, // reuse_delivery ∈ letter|dm
  house_rules_bundle: { required: ["name", "rules_text"] },
  advanced_widget: { required: ["title", "data_source", "render"] }, // data_source must be an existing feed
};
// advanced widgets may only read EXISTING data feeds (no new data sources).
const WIDGET_SOURCES = new Set(["emotion", "relationships", "memory", "hidden_variables", "difficulty", "mystery"]);
const CHANNEL_DELIVERY = new Set(["letter", "dm"]);

function validateExtension(ext) {
  if (!ext || typeof ext !== "object") return { ok: false, reason: "확장 항목이 객체가 아님" };
  const spec = EXTENSION_POINTS[ext.type];
  if (!spec) return { ok: false, reason: `허용되지 않은 확장 지점 "${ext.type}" (5개 중 하나만 가능)` };
  const value = ext.value || {};
  for (const f of spec.required) {
    if (value[f] === undefined || value[f] === null || value[f] === "") return { ok: false, reason: `${ext.type}.value.${f} 필수` };
  }
  // per-type extra constraints (keeps values inside the engine's real slots).
  if (ext.type === "advanced_widget" && !WIDGET_SOURCES.has(value.data_source)) {
    return { ok: false, reason: `advanced_widget.data_source는 기존 데이터 피드만 가능: ${[...WIDGET_SOURCES].join(", ")}` };
  }
  if (ext.type === "communication_channel" && !CHANNEL_DELIVERY.has(value.reuse_delivery)) {
    return { ok: false, reason: "communication_channel.reuse_delivery는 letter 또는 dm만 가능" };
  }
  // CC3 rule 2 — keep only the declared fields; extra fields are dropped (never executed).
  const clean = {};
  for (const f of spec.required) clean[f] = value[f];
  // a couple of optional-but-known fields per type
  if (ext.type === "advanced_widget" && value.label) clean.label = value.label;
  return { ok: true, extension: { type: ext.type, value: clean } };
}

// Validate a full manifest. Returns { ok, manifest, rejected }.
function validateManifest(m) {
  if (!m || typeof m !== "object") return { ok: false, reason: "매니페스트가 객체가 아님" };
  const extendsArr = Array.isArray(m.extends) ? m.extends : [];
  if (!extendsArr.length) return { ok: false, reason: "extends 배열이 비어 있음" };
  const kept = [];
  const rejected = [];
  for (const ext of extendsArr) {
    const r = validateExtension(ext);
    if (r.ok) kept.push(r.extension);
    else rejected.push({ type: ext && ext.type, reason: r.reason });
  }
  if (!kept.length) return { ok: false, reason: "유효한 확장 항목이 없음", rejected };
  return {
    ok: true,
    manifest: {
      plugin_id: m.plugin_id || `plugin_${Date.now().toString(36)}`,
      name: String(m.name || "이름 없는 플러그인").slice(0, 60),
      extends: kept,
      created_from_description: m.created_from_description || null,
      enabled: m.enabled !== false,
    },
    rejected,
  };
}

// Human-readable preview (DD) — what would this plugin add?
function describe(manifest) {
  const LABELS = { scene_type: "장면 타입", dynamic_trait_preset: "장르 특성 프리셋", communication_channel: "통신 채널", house_rules_bundle: "하우스 룰 묶음", advanced_widget: "Advanced 위젯" };
  return (manifest.extends || []).map((e) => {
    const v = e.value || {};
    const name = v.label || v.id || v.name || v.trait_name || v.title || "";
    return `${LABELS[e.type] || e.type} '${name}' 이(가) 추가됩니다.`;
  });
}

function load() {
  if (!fs.existsSync(FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return []; }
}
function persist(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), "utf8");
}

// Register a validated manifest (upsert by plugin_id).
function register(manifest) {
  const list = load().filter((p) => p.plugin_id !== manifest.plugin_id);
  list.push(manifest);
  persist(list);
  return manifest;
}
function get(pluginId) { return load().find((p) => p.plugin_id === pluginId) || null; }
function setEnabled(pluginId, enabled) {
  const list = load();
  const p = list.find((x) => x.plugin_id === pluginId);
  if (!p) return null;
  p.enabled = !!enabled;
  persist(list);
  return p;
}
function remove(pluginId) { const list = load().filter((p) => p.plugin_id !== pluginId); persist(list); return list; }

// --- consumers: merge enabled plugins' values into the engine's tables --------
function enabledExtensions(type) {
  return load().filter((p) => p.enabled).flatMap((p) => (p.extends || []).filter((e) => e.type === type).map((e) => e.value));
}
// Scene types added by plugins → { id: label } merged into the directive map.
function sceneTypeLabels() {
  const map = {};
  for (const v of enabledExtensions("scene_type")) map[v.id] = v.label;
  return map;
}
// Genre → trait presets added by plugins (Phase 10 M1 table extension).
function traitPresets() {
  const map = {};
  for (const v of enabledExtensions("dynamic_trait_preset")) map[String(v.genre).toLowerCase()] = v.trait_name;
  return map;
}
function houseRulesBundles() { return enabledExtensions("house_rules_bundle"); }

module.exports = {
  EXTENSION_POINTS, validateExtension, validateManifest, describe,
  load, register, get, setEnabled, remove,
  enabledExtensions, sceneTypeLabels, traitPresets, houseRulesBundles, FILE,
};
