// Step 7 — Gemini API client (GeminiSystemPrompt §4, §5)
//
// Two SEPARATE calls (§6 checklist): the main narrative call and the low-cost
// structured-extraction call. Mixing them corrupts the narrative output format,
// so they are distinct requests (and can use different models).
//
// If GEMINI_API_KEY is unset, both fall back to MOCK implementations so the
// full turn loop can still be verified end-to-end.

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

const NARRATIVE_MODEL = process.env.GEMINI_NARRATIVE_MODEL || "gemini-2.5-pro";
const EXTRACT_MODEL = process.env.GEMINI_EXTRACT_MODEL || "gemini-2.5-flash";

// Phase 8 D1 — API key pool + quota-aware rotation. Keys come from the
// environment only (never persisted to state or logs, per the handoff): a
// comma-separated GEMINI_API_KEYS, or GEMINI_API_KEY plus GEMINI_API_KEY_2..N.
// On a 429 the current key is parked (quota_exhausted_until) and the next
// available key is used. Key VALUES are never returned by any status call.
function loadKeyPool() {
  const pool = [];
  const push = (k) => { if (k && !pool.some((p) => p.key === k)) pool.push({ key: k.trim(), quota_exhausted_until: null }); };
  (process.env.GEMINI_API_KEYS || "").split(",").forEach(push);
  push(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= 6; i++) push(process.env[`GEMINI_API_KEY_${i}`]);
  return pool;
}
let KEY_POOL = loadKeyPool();
function reloadKeys() { KEY_POOL = loadKeyPool(); return KEY_POOL.length; }

function availableKey() {
  const now = Date.now();
  return KEY_POOL.find((k) => k.key && (!k.quota_exhausted_until || k.quota_exhausted_until <= now)) || null;
}
function parkKey(entry, retryAfterSec) {
  const ms = (retryAfterSec && retryAfterSec > 0 ? retryAfterSec : 3600) * 1000;
  entry.quota_exhausted_until = Date.now() + ms;
}

// True when at least one key is configured — even if all are currently parked
// (parked keys throw a quota error → banner, which is correct, not mock mode).
function hasKey() { return KEY_POOL.length > 0; }
function anyKeyConfigured() { return KEY_POOL.length > 0; }

// Status for the settings UI — counts and exhaustion only, NEVER the key text.
function keysStatus() {
  const now = Date.now();
  return {
    total: KEY_POOL.length,
    available: KEY_POOL.filter((k) => !k.quota_exhausted_until || k.quota_exhausted_until <= now).length,
    keys: KEY_POOL.map((k, i) => ({ key_ref: `key_${i + 1}`, exhausted: !!(k.quota_exhausted_until && k.quota_exhausted_until > now), quota_exhausted_until: k.quota_exhausted_until })),
  };
}

// Phase 5 Wave 3 — usage/cost accounting. The server registers a listener that
// appends each call's token counts to the per-campaign usage log.
let usageListener = null;
function setUsageListener(fn) { usageListener = fn; }
// The current campaign is set by the turn/wizard entry points so deep call
// sites don't need to thread it through.
let currentCampaign = null;
function setCampaign(id) { currentCampaign = id; }

const RETRYABLE = (status) => status === 429 || status >= 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Phase 5 Wave 1 — automatic retry with exponential backoff (max 3 retries)
// on 429/5xx and network errors. The UI shows a banner while this runs.
async function callGemini(model, systemPrompt, userText, generationConfig, kind = "other") {
  let lastErr = null;
  // Allow extra attempts so a 429 can both rotate keys AND back off.
  const maxAttempts = 3 + KEY_POOL.length;
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    if (attempt > 0) await sleep(500 * Math.pow(2, Math.min(attempt - 1, 3)));
    const entry = availableKey();
    if (!entry) { lastErr = lastErr || new Error("모든 API 키의 쿼터가 소진되었습니다."); break; }
    let res;
    try {
      res = await fetch(`${API_ROOT}/${model}:generateContent?key=${entry.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userText }] }],
          generationConfig,
        }),
      });
    } catch (e) {
      lastErr = e; // network error — retryable
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      lastErr = new Error(`Gemini ${model} HTTP ${res.status}: ${body.slice(0, 500)}`);
      lastErr.status = res.status;
      // D1 — on 429, park this key (honoring Retry-After) and try the next one.
      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after"));
        parkKey(entry, Number.isFinite(ra) ? ra : 3600);
        continue;
      }
      if (RETRYABLE(res.status)) continue;
      throw lastErr;
    }
    const data = await res.json();
    if (usageListener && data.usageMetadata) {
      try {
        usageListener({
          campaign_id: currentCampaign,
          model,
          kind,
          prompt_tokens: data.usageMetadata.promptTokenCount || 0,
          output_tokens: data.usageMetadata.candidatesTokenCount || 0,
        });
      } catch (e) { /* accounting must never break a turn */ }
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    return text.trim();
  }
  throw lastErr || new Error("Gemini call failed after retries");
}

// Extraction-schema keywords used to recognize leaked structured output.
const EXTRACTION_MARKERS = /new_memories|canon_updates|flag_changes/i;

// Strip any JSON that leaked into the narrative despite SYSTEM_PROMPT_BASE's
// "pure narrative only" rule (Phase 2 step 0). Removes fenced ```json blocks
// and a trailing bare JSON object carrying extraction-shaped keys.
function stripJsonBlocks(text) {
  let t = text;
  // fenced code blocks that look like JSON / carry extraction keys
  t = t.replace(/```(?:json)?\s*[\s\S]*?```/gi, (block) =>
    EXTRACTION_MARKERS.test(block) || /^\s*```(?:json)?\s*[[{]/i.test(block) ? "" : block
  );
  // a trailing bare JSON object with extraction keys
  t = t.replace(/\{[\s\S]*?(?:new_memories|canon_updates|flag_changes)[\s\S]*\}\s*$/i, "");
  return t.trim();
}

function looksLikePureJson(text) {
  const t = text.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

// --- main narrative call (lifecycle step 10) -----------------------------
async function generateNarrative(systemPrompt, playerInput) {
  if (!hasKey()) return stripJsonBlocks(mockNarrative(playerInput));

  let raw = await callGemini(NARRATIVE_MODEL, systemPrompt, playerInput, {
    temperature: 0.9,
    maxOutputTokens: 2048,
  }, "narrative");
  let clean = stripJsonBlocks(raw);

  // If the model returned JSON (or only JSON), retry once with a hard reminder.
  if (!clean || looksLikePureJson(raw) || EXTRACTION_MARKERS.test(raw)) {
    const stricter =
      systemPrompt +
      "\n\n[재요청] 직전 응답에 JSON/구조화 데이터가 포함되었습니다. " +
      "절대 JSON, 코드블록, 시스템 태그를 출력하지 말고 순수 서사 텍스트로만 다시 서술하세요.";
    raw = await callGemini(NARRATIVE_MODEL, stricter, playerInput, {
      temperature: 0.7,
      maxOutputTokens: 2048,
    }, "narrative_retry");
    clean = stripJsonBlocks(raw);
  }

  // Last-resort fallback so the chat never shows raw JSON.
  if (!clean || looksLikePureJson(clean)) {
    return "(장면을 서술하지 못했습니다. 다시 시도해 주세요.)";
  }
  return clean;
}

// --- structured extraction call (lifecycle step 11, §5) ------------------
// Best-effort: the narrative has already been shown to the player, so a flaky
// extraction call (HTTP 5xx, parse failure) must NOT crash the turn. On failure
// we return an empty extraction and record the error for the debug trace.
async function extractFacts(extractionSystemPrompt, narrativeText) {
  if (!hasKey()) return mockExtraction(narrativeText);
  try {
    const raw = await callGemini(EXTRACT_MODEL, extractionSystemPrompt, narrativeText, {
      temperature: 0.2,
      maxOutputTokens: 1024,
    }, "extraction");
    return parseExtraction(raw);
  } catch (e) {
    return { new_memories: [], canon_updates: [], flag_changes: [], _error: e.message };
  }
}

function parseExtraction(raw) {
  let text = raw.trim();
  // strip ```json fences if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  try {
    const parsed = JSON.parse(text);
    return {
      new_memories: parsed.new_memories || [],
      canon_updates: parsed.canon_updates || [],
      flag_changes: parsed.flag_changes || [],
      item_gains: parsed.item_gains || [],
      item_uses: parsed.item_uses || [],
      identity_shift: parsed.identity_shift || null,
      new_dynamic_trait_candidate: parsed.new_dynamic_trait_candidate || null, // Phase 9 F2
    };
  } catch (e) {
    // Extraction is best-effort; a parse failure must not break the turn.
    return { new_memories: [], canon_updates: [], flag_changes: [], item_gains: [], item_uses: [], identity_shift: null, _parse_error: e.message, _raw: raw };
  }
}

// --- MOCK implementations (no API key) -----------------------------------
function mockNarrative(playerInput) {
  return (
    `[MOCK 서사] 당신은 "${playerInput}"라고 말하며 움직인다. ` +
    `바람이 낮게 깔리고, 주변의 인물들은 각자의 일에 몰두한 채 당신의 다음 행동을 기다리지 않는다. ` +
    `무언가 미묘하게 달라진 공기가 느껴진다.\n\n` +
    `— 가까운 인물에게 말을 건다\n— 조용히 주변을 살핀다\n— 자리를 뜬다`
  );
}

function mockExtraction(narrativeText) {
  // Phase 9 F2/F5 — mock proposes a dynamic-trait candidate only on genuinely
  // life-changing keywords, so the rate-limit / dedup paths are testable without
  // a live model (and trivial scenes correctly propose nothing).
  const TRAIT_TRIGGERS = [
    { re: /(임신|아이를 가졌|출산)/, name: "모성", category: "psychological", desc: "아이를 지키려는 마음이 자라난다" },
    { re: /(크게 다|중상|불구|만성 통증|부상을 입)/, name: "만성 통증", category: "physical", desc: "몸 한구석이 늘 욱신거린다" },
    { re: /(배신당|배신을 당|뒤통수)/, name: "경계심", category: "psychological", desc: "누구도 쉽게 믿지 못하게 되었다" },
    { re: /(첫 승리|처음으로 이겼|마침내 해냈|대승)/, name: "자신감", category: "psychological", desc: "해낼 수 있다는 확신이 생겼다" },
  ];
  const hit = TRAIT_TRIGGERS.find((t) => t.re.test(narrativeText));
  return {
    new_memories: [
      {
        summary: `플레이어의 행동으로 장면이 전개되었다: ${narrativeText.slice(0, 40)}...`,
        participants: ["player"],
        emotion_tags: ["unease"],
        emotion_intensity: 1,
      },
    ],
    canon_updates: [],
    flag_changes: [],
    item_gains: [],
    item_uses: [],
    identity_shift: null,
    new_dynamic_trait_candidate: hit ? { name: hit.name, category: hit.category, origin_summary: narrativeText.slice(0, 40), player_facing_description: hit.desc } : null,
  };
}

// --- optional low-cost reflection note (Wave 3 §10) ----------------------
async function reflectNote(systemPrompt, text) {
  if (!hasKey() || !text) return null;
  const raw = await callGemini(EXTRACT_MODEL, systemPrompt, text, { temperature: 0.3, maxOutputTokens: 256 }, "reflection");
  const parsed = parseExtraction(raw); // reuse fenced-JSON parsing
  return parsed && parsed._raw ? null : raw && raw.includes("note") ? tryNote(raw) : null;
}
function tryNote(raw) {
  try { const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/); const j = JSON.parse((m ? m[1] : raw).trim()); return j.note || null; } catch { return null; }
}

// --- structured generation (Phase 4 A4 — wizard world/character JSON) -----
// Completely separate from SYSTEM_PROMPT_BASE: JSON mode, low temperature.
async function generateStructured(systemPrompt, userText, { temperature = 0.5, maxOutputTokens = 4096 } = {}) {
  if (!hasKey()) return null; // caller falls back to its own mock
  const raw = await callGemini(EXTRACT_MODEL, systemPrompt, userText, {
    temperature,
    maxOutputTokens,
    responseMimeType: "application/json",
  }, "structured_gen");
  let text = raw;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  return JSON.parse(text);
}

// --- low-cost summary (Phase 5 Wave 1 — session recap) ---------------------
async function summarize(instruction, text, kind = "recap") {
  if (!hasKey()) return null;
  return callGemini(EXTRACT_MODEL, instruction, text, { temperature: 0.3, maxOutputTokens: 512 }, kind);
}

module.exports = {
  generateNarrative, extractFacts, parseExtraction, stripJsonBlocks, reflectNote,
  generateStructured, summarize, setUsageListener, setCampaign,
  hasKey, anyKeyConfigured, keysStatus, reloadKeys, NARRATIVE_MODEL, EXTRACT_MODEL,
};
