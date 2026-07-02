// Phase 6 smoke test — convenience features (38). Exercises the new
// endpoints end-to-end against a running server (http://localhost:3000).
const BASE = "http://localhost:3000";
const id = "smoke6_" + Date.now().toString(36);

async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ""); }
}

(async () => {
  console.log("== Phase 6 smoke ==", id);

  const world = {
    campaign_id: id, world_name: "6단계 세계", era: "fantasy", genre_preset: "fantasy",
    regions: [{ canon_id: "loc_p6", name: "포구", terrain: "urban", notable_features: ["테스트"] }],
    factions: [{ canon_id: "faction_p6", name: "조합", founding_principle: "mutual_aid", leader: "갈", stance: "neutral" }],
    player: { birth_name: "테스터6", species: "human", background: "6단계 검증용", core_values: ["검증"], psychology: {} },
    npcs: [],
    narrative_dna: { tone: 3, emotion: 4, politics: 2, survival: 3, horror: 2, mystery: 3, romance: 2, exploration: 3 },
  };
  const created = await j("POST", "/api/wizard/create", world);
  check("setup: wizard create", created.data.ok, created.data);

  // --- A: slash commands ----------------------------------------------------
  const note = await j("POST", "/api/turn", { campaign_id: id, player_input: "/메모 이건 GM이 보면 안 되는 개인 메모" });
  check("/메모 short-circuits (no narrative)", note.data.note_saved === true && note.data.narrative === null, note.data);
  const stAfterNote = await j("GET", `/api/state/${id}`);
  check("/메모 did not advance turn_number", stAfterNote.data.turn_number === 0, stAfterNote.data.turn_number);

  const forced = await j("POST", "/api/turn", { campaign_id: id, player_input: "/판정 허공을 바라본다" });
  check("/판정 forces a check even without trigger keyword", !!(forced.data.check && forced.data.check.skill), forced.data.check);

  const rest = await j("POST", "/api/turn", { campaign_id: id, player_input: "/휴식" });
  check("/휴식 runs a normal turn", rest.status === 200 && !!rest.data.narrative, rest.data.error);

  // --- C: play stats + autosave rotation -------------------------------------
  const stats = await j("GET", `/api/playstats/${id}`);
  check("play stats total_turns >= 2", stats.data.total_turns >= 2, stats.data);
  const slots = await j("GET", `/api/autosave/${id}`);
  check("autosave slots recorded (<=3)", slots.data.slots.length >= 1 && slots.data.slots.length <= 3, slots.data);

  // --- A: response length + settings meta ------------------------------------
  const set = await j("POST", `/api/state/${id}/settings`, {
    settings: { response_length: "short" },
    meta: { display_name: "내 캠페인 이름", icon: "🔥" },
  });
  check("settings: response_length + meta saved", set.data.settings.response_length === "short" && set.data.meta.display_name === "내 캠페인 이름" && set.data.meta.icon === "🔥", set.data);

  // --- B: bookmark + history search/filter ------------------------------------
  const bm = await j("POST", `/api/bookmark/${id}`, { turn: 1 });
  check("bookmark toggled on", (bm.data.bookmarked_turns || []).includes(1), bm.data);
  const bmOff = await j("POST", `/api/bookmark/${id}`, { turn: 1 });
  check("bookmark toggled off", !(bmOff.data.bookmarked_turns || []).includes(1), bmOff.data);
  await j("POST", `/api/bookmark/${id}`, { turn: 1 }); // leave it bookmarked for the quote test

  // Only 2 real turns have run so far (/판정, /휴식) — /메모 short-circuits
  // before touching turnLog, so it contributes no entry.
  const hist = await j("GET", `/api/history/${id}`);
  check("history has entries for the 2 turns so far", hist.data.entries.length === 2, hist.data.entries.map((e) => e.turn));
  const histQ = await j("GET", `/api/history/${id}?q=휴식`);
  check("history text search narrows results", histQ.data.entries.length >= 1 && histQ.data.entries.length <= 3, histQ.data.entries.length);
  const histBadFilter = await j("GET", `/api/history/${id}?npc=no_such_npc`);
  check("history npc filter excludes non-matching", histBadFilter.data.entries.length === 0, histBadFilter.data.entries.length);
  const histAfterSearch = await j("GET", `/api/history/${id}`);
  check("recent_searches recorded", (histAfterSearch.data.recent_searches || []).includes("휴식"), histAfterSearch.data.recent_searches);

  // --- D: personal notebook (separate store, never in prompt) ----------------
  const addedNote = await j("POST", `/api/notes/${id}`, { text: "설정탭에서 남긴 메모" });
  check("notebook add", !!addedNote.data.id, addedNote.data);
  const notesList = await j("GET", `/api/notes/${id}`);
  check("notebook has 2 notes (slash + tab)", notesList.data.notes.length === 2, notesList.data.notes);
  const delNote = await j("DELETE", `/api/notes/${id}/${addedNote.data.id}`);
  check("notebook delete", delNote.data.notes.length === 1, delNote.data);
  // guarantee separation: personal notes file must never be read by prompt code
  const fs = require("fs");
  const promptSrc = fs.readFileSync(require("path").join(__dirname, "..", "src", "gemini", "promptBlocks.js"), "utf8");
  check("promptBlocks.js never requires personalStore", !promptSrc.includes("personalStore"), null);
  const turnSrc = fs.readFileSync(require("path").join(__dirname, "..", "src", "turn.js"), "utf8");
  const usesPersonalStoreInPrompt = /personalStore[\s\S]*assembleSystemPrompt|assembleSystemPrompt[\s\S]*personalStore/.test(turnSrc);
  check("turn.js does not thread personalStore into assembleSystemPrompt", !usesPersonalStoreInPrompt, null);

  // --- F: next-session goal (separate, manual) --------------------------------
  const goal = await j("POST", `/api/goal/${id}`, { text: "다음엔 조합장을 만나보기" });
  check("goal saved", goal.data.text === "다음엔 조합장을 만나보기", goal.data);

  // --- E: force-event + quote (rule-based) + highlights (manual AI-assist) ---
  const force = await j("POST", `/api/campaign/${id}/force-event`);
  check("force-event ok", force.data.ok, force.data);
  const stForced = await j("GET", `/api/state/${id}`);
  check("forced_beat flag set", stForced.data.forced_beat === "high", stForced.data.forced_beat);
  const forcedTurn = await j("POST", "/api/turn", { campaign_id: id, player_input: "주변을 둘러본다" });
  check("forced_beat consumed after the turn", forcedTurn.status === 200, forcedTurn.data.error);
  const stAfterForce = await j("GET", `/api/state/${id}`);
  check("forced_beat cleared post-turn", stAfterForce.data.forced_beat === null, stAfterForce.data.forced_beat);

  const quote = await j("GET", `/api/quote/${id}`);
  check("quote-of-the-day prefers the bookmark", quote.data.quote && quote.data.quote.source === "bookmark", quote.data.quote);

  const hl = await j("POST", `/api/highlights/${id}`);
  check("highlights endpoint responds", hl.status === 200, hl.data);

  // --- A: regenerate (undo + rerun same input) --------------------------------
  const before = await j("GET", `/api/state/${id}`);
  const turnBefore = before.data.turn_number;
  const regen = await j("POST", "/api/turn/regenerate", { campaign_id: id });
  check("regenerate ok", regen.status === 200 && !!regen.data.narrative, regen.data);
  const after = await j("GET", `/api/state/${id}`);
  check("regenerate keeps the same turn number (re-roll, not advance)", after.data.turn_number === turnBefore, { before: turnBefore, after: after.data.turn_number });
  const histAfterRegen = await j("GET", `/api/history/${id}`);
  const turnNumbers = histAfterRegen.data.entries.map((e) => e.turn);
  check("turnLog has no duplicate turn numbers after regenerate", new Set(turnNumbers).size === turnNumbers.length, turnNumbers);
  check("turnLog entry count unchanged by regenerate (replaced, not appended)", histAfterRegen.data.entries.length === 3, turnNumbers);

  // --- C: campaign duplicate (reuses saveas; notes/turnlog copy along) -------
  const dup = await j("POST", "/api/campaign/saveas", { from: id, to: id + "_dup" });
  check("duplicate via saveas", dup.data.ok, dup.data);
  const dupNotes = await j("GET", `/api/notes/${id}_dup`);
  check("duplicate carried personal notes", dupNotes.data.notes.length === 1, dupNotes.data);

  // cleanup
  for (const cid of [id, id + "_dup"]) await j("DELETE", `/api/campaign/${cid}`);
  const after2 = await j("GET", "/api/campaigns");
  check("cleanup", !(after2.data || []).some((c) => c.campaign_id.startsWith(id)));

  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
