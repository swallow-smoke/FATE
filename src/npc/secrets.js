// Phase 16+ · NPC Secret (3-tier)
//
// Every NPC's knowledge about themselves is layered:
//   · public  — freely known / shown in the wiki & inspector
//   · hidden  — guarded, but revealable once they trust the player enough
//   · sealed  — never surfaced by the system, no matter the bond (the writer's
//               back-pocket; only the player *earning* it in-fiction unseals it)
// System-first: trust thresholds decide when a hidden secret becomes *tellable*,
// and we hand only that secret to the GM as an option — sealed text is never put
// in the prompt.

"use strict";

const REVEAL_TRUST = 0.5;
const REVEAL_AFFECTION = 0.6;

function ensure(entity) {
  const d = entity.data;
  if (!d.secrets) d.secrets = { public: [], hidden: [], sealed: [], revealed: [] };
  for (const k of ["public", "hidden", "sealed", "revealed"]) if (!Array.isArray(d.secrets[k])) d.secrets[k] = [];
  return d.secrets;
}

function trustsEnough(edge) {
  if (!edge) return false;
  return (edge.trust || 0) >= REVEAL_TRUST || (edge.affection || 0) >= REVEAL_AFFECTION;
}

// A hidden secret this NPC would now be willing to tell (not yet revealed). Never
// touches sealed. Returns the secret string or null.
function tellableSecret(entity, edge) {
  const s = ensure(entity);
  if (!trustsEnough(edge)) return null;
  return (s.hidden || []).find((h) => !(s.revealed || []).includes(h)) || null;
}

// Mark a secret as revealed (moves hidden → revealed/public knowledge).
function reveal(entity, secretText) {
  const s = ensure(entity);
  if (!secretText) return false;
  if (!(s.revealed || []).includes(secretText)) s.revealed.push(secretText);
  s.hidden = (s.hidden || []).filter((h) => h !== secretText);
  if (!(s.public || []).includes(secretText)) s.public.push(secretText);
  return true;
}

// Scene directive for a present NPC: hand the GM a tellable secret as an OPTION.
function directive(entity, edge) {
  const secret = tellableSecret(entity, edge);
  if (!secret) return null;
  const name = (entity.data && entity.data.birth_name) || entity.canon_id;
  return `비밀(선택): ${name}은(는) 이제 플레이어를 깊이 믿는다. 자연스러운 흐름이라면 오래 감춰온 사실을 털어놓을 수 있다 — "${secret}". 억지로 꺼내지 말고, 순간이 무르익었을 때만.`;
}

// Apply narrative-detected reveals: [{ npc_ref, secret }].
function applyExtraction(state, canonDb, reveals) {
  const done = [];
  for (const r of reveals || []) {
    const ent = r && r.npc_ref && canonDb.get(r.npc_ref);
    if (ent && ent.type === "Character" && reveal(ent, r.secret)) done.push({ npc_ref: r.npc_ref });
  }
  if (done.length) canonDb.persist();
  return done;
}

// Inspector / wiki view: only what the player may know (public + revealed).
function known(entity) {
  const s = ensure(entity);
  return [...new Set([...(s.public || []), ...(s.revealed || [])])];
}

module.exports = { ensure, tellableSecret, reveal, directive, applyExtraction, known, REVEAL_TRUST, REVEAL_AFFECTION };
