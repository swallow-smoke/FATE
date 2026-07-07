// Phase 16+ · Living Objects
//
// Items are not frozen: a sword goes 새것→사용감→녹슴, and repair/enhancement can
// push it 명검→전설; a flower wilts then dries into a keepsake; a letter yellows
// and its ink bleeds. Decay is autonomous world motion (quiet under calm_mode);
// repair/enhance are player actions applied from extraction. Every change is
// stamped into the item's condition_history so the object carries its own story.

"use strict";

const KIND_STAGES = {
  weapon: { decay: ["새것", "손에 익은", "녹슨"], enhance: ["잘 벼려진", "명검", "전설의 검"] },
  flower: { decay: ["싱싱한", "시든", "말린"] },
  letter: { decay: ["깨끗한", "낡은", "잉크가 번진"] },
  tool:   { decay: ["새것", "닳은", "고장난"], enhance: ["개량된"] },
  generic:{ decay: ["새것", "낡은"] },
};

function inferKind(item) {
  const hay = `${item.name || ""} ${(item.tags || []).join(" ")}`;
  if (/검|칼|도끼|창|활|무기|sword|blade|axe|spear|bow|weapon/i.test(hay)) return "weapon";
  if (/꽃|장미|flower|rose|bloom/i.test(hay)) return "flower";
  if (/편지|서신|letter|note/i.test(hay)) return "letter";
  if (/도구|연장|tool|kit/i.test(hay)) return "tool";
  return "generic";
}

function ensure(item) {
  if (!item.object_kind) item.object_kind = inferKind(item);
  if (typeof item.condition_stage !== "number") item.condition_stage = 0;
  if (!item.enhanced) item.enhanced = { on: false, level: 0 };
  if (!Array.isArray(item.condition_history)) item.condition_history = [];
  return item;
}

function label(item) {
  ensure(item);
  const chain = KIND_STAGES[item.object_kind] || KIND_STAGES.generic;
  if (item.enhanced.on) return (chain.enhance || [])[Math.min(item.enhanced.level - 1, (chain.enhance || []).length - 1)] || "강화된";
  return chain.decay[Math.min(item.condition_stage, chain.decay.length - 1)] || "";
}

function record(item, stageLabel, turn, note) {
  item.condition_history = [...(item.condition_history || []), { turn, stage: stageLabel, note: note || "" }].slice(-15);
}

// Autonomous decay tick. Quiet under calm_mode. Returns changed items.
function tick(state, { calm = false } = {}) {
  const turn = state.turn_number;
  const period = (state.settings && state.settings.living_object_period) || 14;
  if (calm || turn === 0 || turn % period !== 0) return { changed: [] };
  const changed = [];
  for (const item of state.inventory || []) {
    ensure(item);
    if (item.enhanced.on) continue; // enhanced items don't rot on their own
    const chain = KIND_STAGES[item.object_kind] || KIND_STAGES.generic;
    if (item.condition_stage >= chain.decay.length - 1) continue; // already at final stage
    // sentimental keepsakes (dried flowers, old letters) decay slower.
    if (Math.random() < (item.object_kind === "weapon" || item.object_kind === "tool" ? 0.5 : 0.35)) {
      item.condition_stage += 1;
      const lbl = label(item);
      record(item, lbl, turn, "세월");
      changed.push({ name: item.name, kind: item.object_kind, stage: lbl });
    }
  }
  return { changed };
}

// Player actions from extraction: { repaired:[name], enhanced:[name], wilted:[name] }.
function applyExtraction(state, changes, turn) {
  const out = { repaired: [], enhanced: [] };
  if (!changes) return out;
  const byName = (name) => (state.inventory || []).find((i) => i.name === name);
  for (const name of changes.repaired || []) { const it = byName(name); if (it) { ensure(it); it.condition_stage = 0; it.enhanced.on = false; record(it, label(it), turn, "수리"); out.repaired.push(name); } }
  for (const name of changes.enhanced || []) { const it = byName(name); if (it) { ensure(it); it.enhanced = { on: true, level: (it.enhanced.level || 0) + 1 }; record(it, label(it), turn, "강화"); out.enhanced.push(name); } }
  return out;
}

function playerVisible(state) {
  return (state.inventory || []).map((i) => { ensure(i); return { name: i.name, kind: i.object_kind, condition: label(i), history: (i.condition_history || []).slice().reverse() }; });
}

module.exports = { tick, applyExtraction, playerVisible, label, ensure, inferKind, KIND_STAGES };
