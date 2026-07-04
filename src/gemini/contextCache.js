// Phase 13 V1/V2 — Context Cache + invalidation.
//
// SYSTEM_PROMPT_BASE (+ house rules + content-intensity line + prompt version)
// does not change turn-to-turn, yet we resend the whole thing every call. This
// module tracks a per-campaign cache handle for that static block so the turn
// pipeline can send a cache reference instead of the full text once Gemini's
// context-caching API is engaged.
//
// V2: the cache key is a hash of the exact static text. The moment that text
// changes (a House Rule is added, content intensity flips, the prompt version
// bumps) the key changes and the old handle is invalidated + recreated. A TTL
// mirrors Gemini's own cache expiry so a stale handle is transparently rebuilt.
//
// In mock / no-key mode there is no server-side cache to create, so this becomes
// bookkeeping only (cache_ref stays null) — the turn still sends full text. The
// value here is the deterministic invalidation logic, which is what we test.

"use strict";

const crypto = require("crypto");

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h, matching Gemini's default cache TTL

// campaignId -> { key, cache_ref, created_at, ttl_ms, hits }
const registry = new Map();

function hashStatic(staticText) {
  return crypto.createHash("sha256").update(String(staticText || "")).digest("hex").slice(0, 16);
}

// Decide the cache state for this turn. Does NOT call the network — callers that
// have a live key can use `createHandle` to actually register cachedContent.
// Returns { key, cache_ref, hit, invalidated, expired }.
function evaluate(campaignId, staticText, { ttlMs = DEFAULT_TTL_MS, now = Date.now() } = {}) {
  const key = hashStatic(staticText);
  const prev = registry.get(campaignId);
  if (!prev) {
    const entry = { key, cache_ref: null, created_at: now, ttl_ms: ttlMs, hits: 0 };
    registry.set(campaignId, entry);
    return { key, cache_ref: null, hit: false, invalidated: false, expired: false, reason: "new" };
  }
  const expired = now - prev.created_at >= prev.ttl_ms;
  const invalidated = prev.key !== key;
  if (invalidated || expired) {
    const entry = { key, cache_ref: null, created_at: now, ttl_ms: ttlMs, hits: 0 };
    registry.set(campaignId, entry);
    return { key, cache_ref: null, hit: false, invalidated, expired, reason: invalidated ? "static_changed" : "ttl_expired" };
  }
  prev.hits += 1;
  return { key, cache_ref: prev.cache_ref, hit: true, invalidated: false, expired: false, reason: "hit" };
}

// Attach a server-side cache handle (cachedContent name) once created via the API.
function setHandle(campaignId, cacheRef) {
  const entry = registry.get(campaignId);
  if (entry) entry.cache_ref = cacheRef;
}

function invalidate(campaignId) {
  registry.delete(campaignId);
}

function status(campaignId) {
  const e = registry.get(campaignId);
  if (!e) return { cached: false };
  return { cached: true, key: e.key, has_handle: !!e.cache_ref, hits: e.hits, age_ms: Date.now() - e.created_at, ttl_ms: e.ttl_ms };
}

module.exports = { hashStatic, evaluate, setHandle, invalidate, status, DEFAULT_TTL_MS, _registry: registry };
