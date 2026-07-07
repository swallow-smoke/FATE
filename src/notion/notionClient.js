// PATCH Notion Import §3 — Notion REST 래퍼 + 재귀 페이지 수집.
//
// 워크스페이스 전체를 실수로 끌어오지 않도록 재귀 깊이를 반드시 제한한다
// (기본 2, 최대 3). 토큰이 없으면 mock 트리/본문으로 오프라인 동작한다
// (코드베이스의 다른 기능들과 동일한 mock fallback 관례).

const notionStore = require("./notionStore");

const API_ROOT = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const MAX_DEPTH_CAP = 3;   // 하드 상한 — 이 이상은 허용하지 않음
const MAX_PAGES = 200;     // 안전장치: 한 번의 discover가 훑는 최대 페이지 수
const ARCHIVE_RE = /(duplicate|archive|보관|중복|아카이브|백업|old|이전)/i;

function headers() {
  const token = notionStore.getToken();
  return {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

// URL 또는 raw id에서 32자리 hex를 뽑아 dashed UUID로.
function parsePageId(input) {
  const s = String(input || "").trim();
  const m = s.replace(/-/g, "").match(/[0-9a-fA-F]{32}/g);
  if (!m || !m.length) return null;
  const hex = m[m.length - 1].toLowerCase(); // URL 끝의 것이 페이지 id
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function notionGet(pathname) {
  const res = await fetch(`${API_ROOT}${pathname}`, { headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Notion ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function titleFromPage(page) {
  const props = (page && page.properties) || {};
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p && p.type === "title" && Array.isArray(p.title)) {
      return p.title.map((t) => t.plain_text).join("").trim() || "(제목 없음)";
    }
  }
  return "(제목 없음)";
}

async function getPageMeta(id) {
  const page = await notionGet(`/pages/${id}`);
  let parent_title = "";
  try {
    const parent = page.parent || {};
    if (parent.type === "page_id" && parent.page_id) {
      const pp = await notionGet(`/pages/${parent.page_id}`);
      parent_title = titleFromPage(pp);
    } else if (parent.type === "database_id" && parent.database_id) {
      const db = await notionGet(`/databases/${parent.database_id}`);
      parent_title = (db.title || []).map((t) => t.plain_text).join("").trim();
    }
  } catch (e) { /* 부모 조회 실패는 치명적이지 않음 */ }
  return {
    id: page.id,
    title: titleFromPage(page),
    last_edited_time: page.last_edited_time || null,
    parent_title,
  };
}

// 한 페이지의 자식 블록 전부(페이지네이션) — child_page 블록 목록과 raw 블록을 반환.
async function listChildren(blockId) {
  const out = [];
  let cursor = null;
  do {
    const q = cursor ? `?page_size=100&start_cursor=${cursor}` : "?page_size=100";
    const data = await notionGet(`/blocks/${blockId}/children${q}`);
    out.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return out;
}

// --- §3 재귀 수집 (깊이 제한 필수) ---------------------------------------
async function discover(rootUrl, maxDepth) {
  if (!notionStore.hasToken()) return { pages: mockDiscover(), mock: true };
  const depth = Math.max(1, Math.min(MAX_DEPTH_CAP, Number(maxDepth) || 2));
  const rootId = parsePageId(rootUrl);
  if (!rootId) throw new Error("유효한 Notion 페이지 링크가 아닙니다.");

  const visited = new Set();
  const pages = [];
  const rootMeta = await getPageMeta(rootId);
  const queue = [{ id: rootId, depth: 0, parent_title: rootMeta.parent_title, meta: rootMeta }];

  while (queue.length && pages.length < MAX_PAGES) {
    const node = queue.shift();
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    const meta = node.meta || await getPageMeta(node.id);
    pages.push({
      id: node.id,
      title: meta.title,
      last_edited_time: meta.last_edited_time,
      parent_title: node.parent_title || meta.parent_title || "",
      depth: node.depth,
      in_archive_folder: ARCHIVE_RE.test(node.parent_title || meta.parent_title || ""),
    });
    if (node.depth >= depth) continue; // 깊이 제한 — 워크스페이스 전체 순회 방지
    let children = [];
    try { children = await listChildren(node.id); } catch (e) { continue; }
    for (const b of children) {
      if (b.type === "child_page" && b.id && !visited.has(b.id)) {
        queue.push({ id: b.id, depth: node.depth + 1, parent_title: meta.title });
      }
    }
  }
  return { pages, mock: false, truncated: pages.length >= MAX_PAGES };
}

// --- §4 본문 텍스트 추출 --------------------------------------------------
const TEXT_TYPES = ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item",
  "numbered_list_item", "to_do", "toggle", "quote", "callout", "code"];

function blockText(b) {
  const body = b[b.type];
  if (!body || !Array.isArray(body.rich_text)) return "";
  return body.rich_text.map((t) => t.plain_text).join("");
}

async function fetchPageText(id, maxChars = 8000) {
  if (!notionStore.hasToken()) return mockPageText(id);
  const lines = [];
  async function walk(blockId, depth) {
    if (depth > 3 || lines.join("\n").length > maxChars) return;
    let blocks = [];
    try { blocks = await listChildren(blockId); } catch (e) { return; }
    for (const b of blocks) {
      if (TEXT_TYPES.includes(b.type)) {
        const t = blockText(b);
        if (t) lines.push(t);
      }
      if (b.has_children && b.type !== "child_page") await walk(b.id, depth + 1);
    }
  }
  await walk(id, 0);
  return lines.join("\n").slice(0, maxChars);
}

// --- mock (토큰 없을 때) --------------------------------------------------
// Duplicate/Archive 폴더에 같은 제목 페이지가 여러 벌 있는 상황을 재현해
// 중복 감지·아카이브 제외 UI를 오프라인에서 검증할 수 있게 한다.
function mockDiscover() {
  return [
    { id: "mock-root-0000", title: "Project Mio (루트)", last_edited_time: "2026-07-01T10:00:00Z", parent_title: "", depth: 0, in_archive_folder: false },
    { id: "mock-char-ria1", title: "리아 벨노어", last_edited_time: "2026-06-20T10:00:00Z", parent_title: "Characters", depth: 1, in_archive_folder: false },
    { id: "mock-world-har", title: "안개의 항구", last_edited_time: "2026-06-18T10:00:00Z", parent_title: "World", depth: 1, in_archive_folder: false },
    { id: "mock-fac-dock1", title: "부두 조합", last_edited_time: "2026-06-15T10:00:00Z", parent_title: "Factions", depth: 1, in_archive_folder: false },
    { id: "mock-arc-0001", title: "사라진 편지 아크", last_edited_time: "2026-06-10T10:00:00Z", parent_title: "Arcs", depth: 1, in_archive_folder: false },
    // 중복: 같은 "리아 벨노어"가 Duplicate 폴더에 두 벌 더.
    { id: "mock-char-ria2", title: "리아 벨노어", last_edited_time: "2026-03-01T10:00:00Z", parent_title: "Duplicate / Archive", depth: 2, in_archive_folder: true },
    { id: "mock-char-ria3", title: "리아 벨노어 (old)", last_edited_time: "2026-01-05T10:00:00Z", parent_title: "Duplicate / Archive", depth: 2, in_archive_folder: true },
  ];
}
function mockPageText(id) {
  const M = {
    "mock-char-ria1": "리아 벨노어. 인간. 항구 서점의 기록 담당자. 핵심 가치: 기억, 조심스러운 진심. 두려움: 다시 버려지는 것. 욕망: 한 번은 제대로 이유를 듣는 것. 애착 유형은 회피형. 농담으로 화제를 돌리는 방어기제.",
    "mock-char-ria2": "리아 벨노어(구버전). 밀수업자 설정. 낡은 초안.",
    "mock-char-ria3": "리아 벨노어 old. 폐기된 설정 메모.",
    "mock-world-har": "안개의 항구. 비가 자주 내리는 오래된 항구 도시. 폐창고와 작은 서점. 지형은 부두/갯벌, 습하고 안개가 잦다.",
    "mock-fac-dock1": "부두 조합. 항구 노동자들의 상호부조 조직. 창립 원칙: 상호부조. 목표: 항구 통제권 확보. 지도자: 노령의 갈.",
    "mock-arc-0001": "사라진 편지 아크. 리아가 맡아둔 편지 묶음이 사라지며 시작되는 서사. 3막 구조로 추적과 재회를 다룬다.",
  };
  return M[id] || "내용 없음.";
}

module.exports = { parsePageId, getPageMeta, discover, fetchPageText, ARCHIVE_RE };
