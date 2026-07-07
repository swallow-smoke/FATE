// Step 7 — Gemini API client (GeminiSystemPrompt §4, §5)
//
// Two SEPARATE calls (§6 checklist): the main narrative call and the low-cost
// structured-extraction call. Mixing them corrupts the narrative output format,
// so they are distinct requests (and can use different models).
//
// If GEMINI_API_KEY is unset, both fall back to MOCK implementations so the
// full turn loop can still be verified end-to-end.

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const fs = require("fs");
const path = require("path");

// C4 — models are mutable so the 설정 탭 API 섹션 can override them at runtime.
// The runtime config (models + optional API keys entered in the UI) is persisted
// to data/runtime_config.json and loaded on boot; it takes precedence over .env.
let NARRATIVE_MODEL = process.env.GEMINI_NARRATIVE_MODEL || "gemini-2.5-pro";
let EXTRACT_MODEL = process.env.GEMINI_EXTRACT_MODEL || "gemini-2.5-flash";

// C4 — allowed model options exposed as a dropdown in the settings UI.
const AVAILABLE_MODELS = [
  "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite",
  "gemini-3.1-flash", "gemini-3.1-flash-lite", "gemini-3.1-pro",
];
let RUNTIME_KEYS = []; // keys entered via the settings UI (override/augment env)
const RUNTIME_CONFIG_PATH = path.join(__dirname, "..", "..", "data", "runtime_config.json");

// Phase 8 D1 — API key pool + quota-aware rotation. Keys come from the
// environment only (never persisted to state or logs, per the handoff): a
// comma-separated GEMINI_API_KEYS, or GEMINI_API_KEY plus GEMINI_API_KEY_2..N.
// On a 429 the current key is parked (quota_exhausted_until) and the next
// available key is used. Key VALUES are never returned by any status call.
function loadKeyPool() {
  const pool = [];
  const push = (k) => { if (k && !pool.some((p) => p.key === k)) pool.push({ key: k.trim(), quota_exhausted_until: null }); };
  // C4 — UI-entered keys come first (highest precedence), then env keys.
  RUNTIME_KEYS.forEach(push);
  (process.env.GEMINI_API_KEYS || "").split(",").forEach(push);
  push(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= 6; i++) push(process.env[`GEMINI_API_KEY_${i}`]);
  return pool;
}
let KEY_POOL = loadKeyPool();
function reloadKeys() { KEY_POOL = loadKeyPool(); return KEY_POOL.length; }

// C4 — persist + load runtime config (models + UI keys). Keys are stored here
// because the user explicitly entered them in the app (overrides the env-only
// rule by design); the data/ dir is gitignored.
function loadRuntimeConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(RUNTIME_CONFIG_PATH, "utf8"));
    if (raw.narrative_model) NARRATIVE_MODEL = raw.narrative_model;
    if (raw.extract_model) EXTRACT_MODEL = raw.extract_model;
    if (Array.isArray(raw.keys)) RUNTIME_KEYS = raw.keys.filter(Boolean);
    KEY_POOL = loadKeyPool();
  } catch (e) { /* no runtime config yet — env defaults stand */ }
}
function saveRuntimeConfig() {
  try {
    fs.mkdirSync(path.dirname(RUNTIME_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(RUNTIME_CONFIG_PATH, JSON.stringify({ narrative_model: NARRATIVE_MODEL, extract_model: EXTRACT_MODEL, keys: RUNTIME_KEYS }, null, 2));
  } catch (e) { /* best-effort persistence */ }
}
// applyRuntimeConfig({ narrative_model, extract_model, keys }) — partial patch.
// keys: full replacement array of UI-entered keys (null/undefined = leave as-is).
function applyRuntimeConfig(patch) {
  const p = patch || {};
  if (p.narrative_model && AVAILABLE_MODELS.includes(p.narrative_model)) NARRATIVE_MODEL = p.narrative_model;
  if (p.extract_model && AVAILABLE_MODELS.includes(p.extract_model)) EXTRACT_MODEL = p.extract_model;
  if (Array.isArray(p.keys)) RUNTIME_KEYS = p.keys.map((k) => String(k).trim()).filter(Boolean);
  KEY_POOL = loadKeyPool();
  saveRuntimeConfig();
  return getRuntimeConfig();
}
// Never returns key VALUES — only how many UI keys are set.
function getRuntimeConfig() {
  return {
    narrative_model: NARRATIVE_MODEL, extract_model: EXTRACT_MODEL,
    available_models: AVAILABLE_MODELS, ui_key_count: RUNTIME_KEYS.length,
  };
}
loadRuntimeConfig();

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
// Phase 14 X4 — opt-in unlimited recorder (default: keep only newest 20).
let fullRecord = false;
function setFullRecord(v) { fullRecord = !!v; }
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
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    if (usageListener && data.usageMetadata) {
      try {
        usageListener({
          campaign_id: currentCampaign,
          model,
          kind,
          prompt_tokens: data.usageMetadata.promptTokenCount || 0,
          output_tokens: data.usageMetadata.candidatesTokenCount || 0,
          // Phase 14 X4 — LLM Recorder snapshots (prompt + response).
          prompt_snapshot: `${systemPrompt}\n\n[USER]\n${userText}`,
          response_snapshot: text,
          full_record: fullRecord,
        });
      } catch (e) { /* accounting must never break a turn */ }
    }
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
    return { ...EMPTY_EXTRACTION(), _error: e.message };
  }
}

// Phase 13 V6 — Deterministic Validator. The extraction response is assumed
// valid JSON, but models occasionally wrap it, prepend prose, or truncate.
// Recovery ladder: (1) parse as-is, (2) strip ```json fences, (3) slice from
// the first { to the last }. If all fail, return the empty schema with a
// _parse_error flag — the turn continues (this turn simply isn't remembered).
const EMPTY_EXTRACTION = () => ({
  new_memories: [], canon_updates: [], flag_changes: [], item_gains: [], item_uses: [],
  identity_shift: null, new_dynamic_trait_candidate: null, integrity_issues: [], proper_nouns: [],
  relationship_changes: [], // PATCH 관계 전환
  arc_changes: null, motif_hints: [], // PATCH_NARRATIVE_ACCUMULATION_GAPS
  chapter_changes: null, // PATCH_CHAPTER_CHECKLIST
  npc_arc_changes: null, // PATCH_WEBNOVEL_TECHNIQUES
  soft_goal_progress: [], // PATCH_IP_EXTENSIONS_PROJECT_MIO
});
function normalizeExtraction(parsed) {
  const e = EMPTY_EXTRACTION();
  return {
    ...e,
    new_memories: parsed.new_memories || [],
    canon_updates: parsed.canon_updates || [],
    flag_changes: parsed.flag_changes || [],
    item_gains: parsed.item_gains || [],
    item_uses: parsed.item_uses || [],
    identity_shift: parsed.identity_shift || null,
    new_dynamic_trait_candidate: parsed.new_dynamic_trait_candidate || null, // Phase 9 F2
    integrity_issues: parsed.integrity_issues || [], // Phase 14 W1
    proper_nouns: parsed.proper_nouns || [],         // Phase 14 W2
    relationship_changes: parsed.relationship_changes || [], // PATCH 관계 전환
    arc_changes: parsed.arc_changes || null,         // PATCH_NARRATIVE_ACCUMULATION_GAPS
    motif_hints: parsed.motif_hints || [],           // PATCH_NARRATIVE_ACCUMULATION_GAPS
    chapter_changes: parsed.chapter_changes || null, // PATCH_CHAPTER_CHECKLIST
    npc_arc_changes: parsed.npc_arc_changes || null, // PATCH_WEBNOVEL_TECHNIQUES
    soft_goal_progress: parsed.soft_goal_progress || [], // PATCH_IP_EXTENSIONS_PROJECT_MIO
  };
}
function parseExtraction(raw) {
  const attempts = [];
  const text = String(raw || "").trim();
  attempts.push(text);
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) attempts.push(fence[1].trim());
  const first = text.indexOf("{"), last = text.lastIndexOf("}");
  if (first >= 0 && last > first) attempts.push(text.slice(first, last + 1));
  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    try {
      const parsed = JSON.parse(attempts[i]);
      const out = normalizeExtraction(parsed);
      if (i > 0) out._recovered = true; // needed a fallback step
      return out;
    } catch (e) { lastErr = e; }
  }
  return { ...EMPTY_EXTRACTION(), _parse_error: lastErr ? lastErr.message : "unparseable", _raw: raw };
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
    { re: /(크게 다|중상|불구|만성 통증|부상을 입)/, name: "만성 통증", category: "physical", desc: "몸 한구석이 늘 욱신거린다" },
    { re: /(배신당|배신을 당|뒤통수)/, name: "경계심", category: "psychological", desc: "누구도 쉽게 믿지 못하게 되었다" },
    { re: /(첫 승리|처음으로 이겼|마침내 해냈|대승)/, name: "자신감", category: "psychological", desc: "해낼 수 있다는 확신이 생겼다" },
  ];
  const hit = TRAIT_TRIGGERS.find((t) => t.re.test(narrativeText));
  // Phase 14 W1 — mock flags a high-severity integrity issue only on an explicit
  // marker word, so the watchdog regeneration path is testable without a model.
  const integrity_issues = /(모순|설정붕괴|말투가 급변|앞뒤가 안 맞)/.test(narrativeText)
    ? [{ type: "canon_contradiction", description: "mock detected an explicit contradiction marker", severity: "high" }]
    : [];
  return {
    ...EMPTY_EXTRACTION(),
    new_memories: [
      {
        summary: `플레이어의 행동으로 장면이 전개되었다: ${narrativeText.slice(0, 40)}...`,
        participants: ["player"],
        emotion_tags: ["unease"],
        emotion_intensity: 1,
      },
    ],
    integrity_issues,
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
async function generateStructured(systemPrompt, userText, { temperature = 0.5, maxOutputTokens = 4096, kind = "structured_gen" } = {}) {
  if (!hasKey()) return null; // caller falls back to its own mock
  const raw = await callGemini(EXTRACT_MODEL, systemPrompt, userText, {
    temperature,
    maxOutputTokens,
    responseMimeType: "application/json",
  }, kind);
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
  generateStructured, summarize, setUsageListener, setCampaign, setFullRecord,
  hasKey, anyKeyConfigured, keysStatus, reloadKeys,
  // C4 — runtime model/key config. Models are getters (mutable at runtime).
  applyRuntimeConfig, getRuntimeConfig, AVAILABLE_MODELS,
  get NARRATIVE_MODEL() { return NARRATIVE_MODEL; },
  get EXTRACT_MODEL() { return EXTRACT_MODEL; },
};
