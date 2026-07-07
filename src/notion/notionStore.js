// PATCH Notion Import §2 — Notion Integration 토큰 저장.
//
// Phase 8 D1과 동일 원칙: 토큰은 state/로그에 절대 남기지 않고, gitignore된
// data/ 아래에만 둔다. 추가로 이 패치의 "평문 저장 금지" 요구를 지키기 위해
// 파일에는 평문이 아니라 AES-256-GCM 암호문만 저장한다. 암호화 키는 별도
// 키파일에 두지 않고 이 설치본(호스트/OS 사용자)에서 결정론적으로 파생한다 —
// 완벽한 비밀보관은 아니지만, 디스크에 토큰 평문이 남지 않게 한다.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { DATA_DIR } = require("../state/campaignState");

const CONFIG_PATH = path.join(DATA_DIR, "notion_config.json");

// 설치본 고정 파생 키 (호스트명 + OS 사용자 + 앱 고정 salt → scrypt).
function derivedKey() {
  const material = `${os.hostname()}::${os.userInfo().username}::narrativeos-notion-v1`;
  return crypto.scryptSync(material, "nos-notion-salt", 32);
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

function decrypt(blob) {
  try {
    const [ivB, tagB, encB] = String(blob).split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey(), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]).toString("utf8");
  } catch (e) {
    return null; // 키 파생이 달라졌거나(다른 머신) 손상 → 토큰 없는 것으로 취급
  }
}

function loadRaw() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch (e) { return {}; }
}
function persist(obj) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2), "utf8");
}

function mask(token) {
  const t = String(token || "");
  if (t.length <= 8) return "••••";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

// --- public API -----------------------------------------------------------
function setToken(token) {
  const t = String(token || "").trim();
  if (!t) throw new Error("빈 토큰");
  const cfg = loadRaw();
  cfg.token_enc = encrypt(t);
  cfg.token_hint = mask(t);   // 저장/표시는 마스킹된 힌트만
  cfg.updated_at = new Date().toISOString();
  persist(cfg);
  return status();
}

// 실제 토큰 값 — 서버 내부(Notion API 호출)에서만 쓰고 어떤 응답에도 넣지 않는다.
function getToken() {
  const cfg = loadRaw();
  if (!cfg.token_enc) return null;
  return decrypt(cfg.token_enc);
}

function hasToken() { return !!getToken(); }

function clear() {
  try { if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH); } catch (e) {}
  return status();
}

// 상태(마스킹된 힌트 + 갱신시각)만 노출 — 토큰 값은 절대 반환하지 않는다.
function status() {
  const cfg = loadRaw();
  return {
    connected: !!cfg.token_enc && hasToken(),
    token_hint: cfg.token_hint || null,
    updated_at: cfg.updated_at || null,
    default_depth: cfg.default_depth || 2,
  };
}

function setDefaultDepth(d) {
  const cfg = loadRaw();
  cfg.default_depth = Math.max(1, Math.min(3, Number(d) || 2));
  persist(cfg);
  return status();
}

module.exports = { setToken, getToken, hasToken, clear, status, setDefaultDepth, mask };
