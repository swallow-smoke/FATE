// Phase 15 Part BB — custom CSS themes (declarative, validated).
//
// A theme is a bag of CSS custom-property values — no logic, so we can allow a
// fair amount of freedom. Safety (BB2) comes from three checks:
//   1. only whitelisted variable NAMES may appear (no inventing new selectors)
//   2. each value must match its type (color = hex/rgb, font = registered list,
//      numeric = bounded)
//   3. anything that could load an external resource or run script
//      (url(), @import, javascript:, expression()) is rejected outright
// Gemini only fills these slots; the app renders them. Stored app-globally in
// data/themes.json so any campaign can switch to a saved theme.

"use strict";

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../state/campaignState");

const FILE = path.join(DATA_DIR, "themes.json");

// 1. whitelist of CSS variable slots a theme may set.
const COLOR_KEYS = ["--color-bg", "--color-surface", "--color-text", "--color-accent", "--color-danger", "--color-muted"];
const FONT_KEYS = ["--font-body", "--font-ui"];
const NUM_KEYS = { "--radius-base": { min: 0, max: 24, unit: "px" } };
const ALLOWED_KEYS = new Set([...COLOR_KEYS, ...FONT_KEYS, ...Object.keys(NUM_KEYS)]);

// 2. registered fonts (values may only reference these families).
const ALLOWED_FONTS = ["Noto Serif KR", "Pretendard", "Noto Sans KR", "serif", "sans-serif", "monospace", "system-ui"];

// 3. anything matching this is an external-resource / script vector → reject.
const DANGEROUS = /(url\s*\(|@import|javascript:|expression\s*\(|<|>|;|\}|\{)/i;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i;

function validateValue(key, raw) {
  const v = String(raw == null ? "" : raw).trim();
  if (!v) return { ok: false, reason: "빈 값" };
  if (DANGEROUS.test(v)) return { ok: false, reason: "외부 리소스/스크립트 가능 값 거부" };
  if (COLOR_KEYS.includes(key)) {
    if (!(HEX.test(v) || RGB.test(v))) return { ok: false, reason: "색상은 hex 또는 rgb() 형식만 허용" };
    return { ok: true, value: v };
  }
  if (FONT_KEYS.includes(key)) {
    // each comma-separated family must be a registered font (quotes stripped).
    const fams = v.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
    if (!fams.every((f) => ALLOWED_FONTS.includes(f))) return { ok: false, reason: `등록된 폰트만 허용: ${ALLOWED_FONTS.join(", ")}` };
    return { ok: true, value: fams.map((f) => (/\s/.test(f) ? `'${f}'` : f)).join(", ") };
  }
  if (NUM_KEYS[key]) {
    const { min, max, unit } = NUM_KEYS[key];
    const n = Number(String(v).replace(/px$/i, ""));
    if (!Number.isFinite(n) || n < min || n > max) return { ok: false, reason: `${min}~${max} 범위의 숫자만 허용` };
    return { ok: true, value: `${n}${unit}` };
  }
  return { ok: false, reason: "알 수 없는 토큰" };
}

// Validate + sanitize a tokens object. Returns { ok, tokens, rejected }.
function validateTokens(tokens) {
  const out = {};
  const rejected = [];
  for (const [k, v] of Object.entries(tokens || {})) {
    if (!ALLOWED_KEYS.has(k)) { rejected.push({ key: k, reason: "허용되지 않은 변수 이름" }); continue; }
    const r = validateValue(k, v);
    if (r.ok) out[k] = r.value;
    else rejected.push({ key: k, reason: r.reason });
  }
  return { ok: Object.keys(out).length > 0 && rejected.length === 0, tokens: out, rejected };
}

// Human-readable preview summary (DD) of what a theme changes.
function describe(tokens) {
  const parts = [];
  if (tokens["--color-bg"]) parts.push(`배경색 ${tokens["--color-bg"]}`);
  if (tokens["--color-accent"]) parts.push(`강조색 ${tokens["--color-accent"]}`);
  if (tokens["--font-body"]) parts.push(`본문 폰트 ${tokens["--font-body"]}`);
  if (tokens["--radius-base"]) parts.push(`모서리 ${tokens["--radius-base"]}`);
  return parts.length ? parts.join(", ") + " 로 바뀝니다." : "변경 사항이 없습니다.";
}

function load() {
  if (!fs.existsSync(FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return []; }
}
function persist(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), "utf8");
}

let seq = load().reduce((m, t) => Math.max(m, Number((t.theme_id || "").replace(/\D/g, "")) || 0), 0);

// Save a validated theme. Rejects if any token is invalid (fail closed).
function save({ name, tokens, created_from_description }) {
  const v = validateTokens(tokens);
  if (!v.ok) return { ok: false, reason: "검증 실패", rejected: v.rejected };
  seq += 1;
  const theme = {
    theme_id: `theme_${String(seq).padStart(4, "0")}`,
    name: String(name || "이름 없는 테마").slice(0, 60),
    tokens: v.tokens,
    created_from_description: created_from_description || null,
    created_at: new Date().toISOString(),
  };
  const list = load();
  list.push(theme);
  persist(list);
  return { ok: true, theme };
}

function get(themeId) { return load().find((t) => t.theme_id === themeId) || null; }
function remove(themeId) { const list = load().filter((t) => t.theme_id !== themeId); persist(list); return list; }

module.exports = { validateTokens, describe, save, load, get, remove, ALLOWED_KEYS, ALLOWED_FONTS, COLOR_KEYS, FONT_KEYS, NUM_KEYS, FILE };
