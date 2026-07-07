"use strict";

const fs = require("fs");
const path = require("path");
const campaignState = require("../state/campaignState");

function dir() {
  const d = path.join(campaignState.DATA_DIR, "feedback");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function file(id) {
  return path.join(dir(), `${id}_feedback.json`);
}

function load(id) {
  const p = file(id);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) { return []; }
}

function save(id, list) {
  fs.writeFileSync(file(id), JSON.stringify(list.slice(-200), null, 2), "utf8");
}

function add(id, payload) {
  const list = load(id);
  const state = campaignState.load(id);
  const item = {
    id: "fb_" + Date.now().toString(36),
    created_at: new Date().toISOString(),
    turn: state.turn_number,
    in_world_date: state.in_world_date,
    reason: String(payload.reason || "").slice(0, 500),
    note: String(payload.note || "").slice(0, 2000),
    recent_dialogue: (state.recent_dialogue || []).slice(-3),
    player: { name: state.player && state.player.name, traits: state.player && state.player.traits },
    scene_history: (state.scene_history || []).slice(-5),
    current_scene: state.current_scene || null,
    custom_registry: state.custom_registry || null,
    settings: state.settings || {},
    prompt_profile: state.prompt_profile || {},
    last_prompt: state.last_prompt || null,
  };
  list.push(item);
  save(id, list);
  return item;
}

module.exports = { load, add };
