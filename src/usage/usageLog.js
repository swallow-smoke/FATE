// Phase 5 Wave 3 — Gemini usage/cost accounting.
// One JSON file per campaign: cumulative call/token counters per call kind.
// Cost estimate uses rough public per-1M-token prices; display only.

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../state/campaignState");

// USD per 1M tokens (approximate; display-only estimate).
const PRICE = {
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

function usagePath(campaignId) {
  return path.join(DATA_DIR, `${campaignId}_usage.json`);
}

// Phase 12 U2 — normalize the low-level call "kind" into a dashboard category.
const KIND_TO_CATEGORY = {
  narrative: "narrative", narrative_retry: "narrative",
  extraction: "extraction", reflection: "extraction",
  recap: "session_recap", session_highlight: "session_highlight",
  daily_digest: "daily_digest", npc_background: "npc_background",
  director_debate: "director_debate", internet_search: "internet_search",
  npc_proactive: "npc_proactive", structured_gen: "wizard_generation",
};
function categoryOf(kind) { return KIND_TO_CATEGORY[kind] || kind || "other"; }
function today() { return new Date().toISOString().slice(0, 10); }

function blank(campaignId) {
  return { campaign_id: campaignId, calls: 0, prompt_tokens: 0, output_tokens: 0, by_kind: {}, by_model: {}, by_category: {}, daily: {} };
}

function load(campaignId) {
  const p = usagePath(campaignId);
  if (!fs.existsSync(p)) return blank(campaignId);
  try { const u = JSON.parse(fs.readFileSync(p, "utf8")); u.by_category = u.by_category || {}; u.daily = u.daily || {}; return u; } catch { return blank(campaignId); }
}

function record({ campaign_id, model, kind, prompt_tokens, output_tokens }) {
  if (!campaign_id) return;
  const u = load(campaign_id);
  u.calls += 1;
  u.prompt_tokens += prompt_tokens;
  u.output_tokens += output_tokens;
  const k = (u.by_kind[kind] = u.by_kind[kind] || { calls: 0, prompt_tokens: 0, output_tokens: 0 });
  k.calls += 1; k.prompt_tokens += prompt_tokens; k.output_tokens += output_tokens;
  const m = (u.by_model[model] = u.by_model[model] || { calls: 0, prompt_tokens: 0, output_tokens: 0 });
  m.calls += 1; m.prompt_tokens += prompt_tokens; m.output_tokens += output_tokens;
  // Phase 12 U2 — per-category totals + per-day totals (RPD tracking).
  const cat = categoryOf(kind);
  const c = (u.by_category[cat] = u.by_category[cat] || { calls: 0, prompt_tokens: 0, output_tokens: 0 });
  c.calls += 1; c.prompt_tokens += prompt_tokens; c.output_tokens += output_tokens;
  const d = today();
  const day = (u.daily[d] = u.daily[d] || { date: d, call_count: 0, by_category: {} });
  day.call_count += 1;
  day.by_category[cat] = (day.by_category[cat] || 0) + 1;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(usagePath(campaign_id), JSON.stringify(u, null, 2), "utf8");
}

// Today's RPD usage vs the configured free-tier limit (display-only). Returns a
// { date, call_count, by_category, limit, pct, warn } summary.
function todaySummary(usage, rpdLimit) {
  const d = today();
  const day = (usage.daily && usage.daily[d]) || { date: d, call_count: 0, by_category: {} };
  const limit = Number(rpdLimit) > 0 ? Number(rpdLimit) : null;
  const pct = limit ? Math.round((day.call_count / limit) * 100) : null;
  return { ...day, limit, pct, warn: pct != null && pct >= 80 };
}

function estimateCost(usage) {
  let usd = 0;
  for (const [model, m] of Object.entries(usage.by_model || {})) {
    const p = PRICE[model] || PRICE["gemini-2.5-flash"];
    usd += (m.prompt_tokens / 1e6) * p.input + (m.output_tokens / 1e6) * p.output;
  }
  return Math.round(usd * 10000) / 10000;
}

module.exports = { load, record, estimateCost, todaySummary, categoryOf, usagePath };
