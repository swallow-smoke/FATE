// Phase 16 · System 3 — World News
//
// A single feed that aggregates what happened in the world this turn — even the
// things the player never witnessed — and formats each as a 신문 / 게시판 / 공고 /
// 소문 item. The world keeps generating news whether the player is watching or
// not; they catch up by reading the board. Rule-based headlines by default;
// genuine key moments (a place's fall, an NPC achieving a lifelong goal) get an
// LLM headline from the enrichment pass upstream.
//
// calm_mode: caller passes { calm:true } → only items that directly concern the
// player's known world (discovered place changes, met-NPC goal outcomes) are
// kept; ambient political/economic churn is suppressed so the feed stays quiet.

"use strict";

const MAX_NEWS = 40;
let seq = 0;

const EVENT_HEADLINE = {
  politics: "권력의 저울이 기울다",
  economy: "시장이 요동치다",
  nature: "하늘이 노하다",
  culture: "오래된 관습, 도마 위에 오르다",
  conflict: "국경에 전운이 감돌다",
};
// which "paper" carries which category
const EVENT_KIND = { politics: "공고", economy: "신문", nature: "신문", culture: "게시판", conflict: "공고" };

function make(state, { kind, category, headline, body, source, key_moment = false, refs = [] }) {
  seq += 1;
  return {
    news_id: `news_${String(state.turn_number).padStart(4, "0")}_${String(seq).padStart(3, "0")}`,
    turn: state.turn_number,
    in_world_date: state.in_world_date || null,
    kind, category: category || null,
    headline, body: body || "",
    source: source || null,
    refs,
    seen_by_player: false,
    key_moment: !!key_moment,
  };
}

// Build this turn's news items from the world-tick outputs and append them.
// inputs: { generated, resolved, placeTransitions, goalMilestones, goalOutcomes, spawnedRumor }
function compose(state, canonDb, inputs = {}, { lowToken = false, calm = false } = {}) {
  state.world = state.world || {};
  state.world.news = state.world.news || [];
  const items = [];
  const nameOf = (id) => { const e = canonDb.get(id); return (e && e.data && (e.data.birth_name || (e.data.notable_features || [])[0])) || id; };

  // 1. A newly generated world event → newspaper/notice (ambient; dropped in calm).
  if (inputs.generated && !calm) {
    const ev = inputs.generated;
    items.push(make(state, { kind: EVENT_KIND[ev.category] || "신문", category: ev.category, headline: EVENT_HEADLINE[ev.category] || "세계의 소식", body: ev.summary, source: "세계", refs: [...(ev.affected_regions || []), ...(ev.affected_factions || [])] }));
  }
  // 2. Resolved events → follow-up newspaper (ambient; dropped in calm).
  for (const ev of inputs.resolved || []) {
    if (calm) break;
    items.push(make(state, { kind: "신문", category: ev.category, headline: "한 사건이 일단락되다", body: `${ev.summary} — 이제 사람들의 입에서 조금씩 잊혀간다.`, source: "세계", refs: [...(ev.affected_regions || []), ...(ev.affected_factions || [])] }));
  }
  // 3. Place transitions → always relevant (these are places the player knows).
  for (const t of inputs.placeTransitions || []) {
    items.push(make(state, {
      kind: t.direction === "up" ? "게시판" : "신문", category: "place",
      headline: `${t.name}, ${t.from_stage}에서 ${t.to_stage}(으)로`, body: t.summary,
      source: t.name, key_moment: !!t.key_moment, refs: [t.canon_id],
    }));
  }
  // 4. NPC goal outcomes → achieved/failed are notable; milestones only as 게시판.
  for (const o of inputs.goalOutcomes || []) {
    const achieved = o.outcome === "achieved";
    items.push(make(state, {
      kind: "게시판", category: "npc_goal",
      headline: achieved ? `${o.name}, 마침내 뜻을 이루다` : `${o.name}의 꿈이 무너지다`,
      body: `${o.name}: ${o.goal}${achieved ? " — 결국 이뤄냈다." : " — 좌절되고 말았다."}`,
      source: o.name, key_moment: true, refs: [o.canon_id],
    }));
  }
  for (const m of inputs.goalMilestones || []) {
    if (m.key_moment) continue; // achieved already emitted above
    if (calm) continue; // quiet the incremental chatter in calm mode
    items.push(make(state, { kind: "소문", category: "npc_goal", headline: "누군가의 근황", body: `${m.name}가 ${m.milestone}: ${m.goal}`, source: m.name, refs: [m.canon_id] }));
  }
  // 5. A freshly spawned rumor → the rumor mill (ambient; dropped in calm).
  if (inputs.spawnedRumor && !calm) {
    const r = inputs.spawnedRumor;
    items.push(make(state, { kind: "소문", category: "rumor", headline: "떠도는 이야기", body: (r.data && r.data.content) || "", source: (r.data && r.data.origin_region) || "어딘가", refs: [r.canon_id] }));
  }

  if (items.length) {
    state.world.news = [...state.world.news, ...items].slice(-MAX_NEWS);
  }
  return items;
}

// Unread count for the badge. Player-facing list is newest-first.
function unseenCount(state) {
  return ((state.world && state.world.news) || []).filter((n) => !n.seen_by_player).length;
}
function playerVisible(state) {
  return ((state.world && state.world.news) || []).slice().reverse();
}
function markAllSeen(state) {
  let n = 0;
  for (const item of (state.world && state.world.news) || []) if (!item.seen_by_player) { item.seen_by_player = true; n++; }
  return n;
}

module.exports = { compose, unseenCount, playerVisible, markAllSeen, MAX_NEWS };
