const { SYSTEM_PROMPT_BASE, EXTRACTION_SYSTEM_PROMPT } = require("./systemPromptBase");
const wizard = require("../wizard/generator");
const notionImport = require("../notion/notionImport");

const LIMIT = 24000;

const BUILTIN_PROMPTS = [
  {
    key: "narrative.system_addendum",
    group: "story",
    label: "서사 생성 추가 지시",
    description: "매 턴 GM 서사 생성 시스템 프롬프트 끝에 추가됩니다. 기존 절대 원칙은 유지됩니다.",
    mode: "append",
    default_text: "",
    max: 6000,
  },
  {
    key: "extraction.addendum",
    group: "story",
    label: "후처리 JSON 추출 추가 지시",
    description: "서사 후 상태/기억/관계 변경을 JSON으로 추출할 때 추가됩니다. JSON 스키마를 깨지 않아야 합니다.",
    mode: "append",
    default_text: "",
    max: 4000,
  },
  {
    key: "narrative.base",
    group: "core",
    label: "서사 생성 기본 시스템 프롬프트",
    description: "GM의 핵심 원칙입니다. 비워두면 앱 기본값을 사용합니다. 덮어쓰면 캠페인 전체 문체와 안전 규칙에 큰 영향을 줍니다.",
    mode: "replace",
    default_text: SYSTEM_PROMPT_BASE,
    max: LIMIT,
    dangerous: true,
  },
  {
    key: "extraction.base",
    group: "core",
    label: "후처리 JSON 추출 기본 프롬프트",
    description: "서사에서 새 사실을 추출하는 JSON 스키마 프롬프트입니다. 덮어쓸 때는 반드시 JSON 출력 규칙을 유지하세요.",
    mode: "replace",
    default_text: EXTRACTION_SYSTEM_PROMPT,
    max: LIMIT,
    dangerous: true,
  },
  {
    key: "notion.classify",
    group: "import",
    label: "Notion/텍스트 문서 분류 프롬프트",
    description: "Notion 페이지와 .md/.txt 파일을 캐릭터/세계/세력/아크 등으로 분류할 때 사용됩니다.",
    mode: "replace",
    default_text: notionImport.CLASSIFY_PROMPT,
    max: LIMIT,
  },
  {
    key: "wizard.world",
    group: "wizard",
    label: "마법사 세계 생성 프롬프트",
    description: "자유 서술에서 초기 세계관 JSON을 만들 때 사용됩니다.",
    mode: "replace",
    default_text: wizard.WORLD_GEN_PROMPT,
    max: LIMIT,
  },
  {
    key: "wizard.characters",
    group: "wizard",
    label: "마법사 캐릭터 생성 프롬프트",
    description: "자유 서술과 세계 맥락에서 플레이어/NPC JSON을 만들 때 사용됩니다.",
    mode: "replace",
    default_text: wizard.CHARACTER_GEN_PROMPT,
    max: LIMIT,
  },
  {
    key: "wizard.field_suggest",
    group: "wizard",
    label: "마법사 필드별 AI 도움 프롬프트",
    description: "세계명, 지역, NPC 등 개별 필드의 AI 도움 버튼에서 공통 래퍼로 사용됩니다. {{request}} {{schema}}가 치환됩니다.",
    mode: "template",
    default_text: `당신은 TRPG 설정을 다듬는 어시스턴트입니다. 아래 맥락에 어울리도록 요청한 항목만 생성하세요.
요청: {{request}}
순수 JSON만 출력합니다. 스키마: {{schema}}
원칙: 과하게 지어내지 말고 맥락과 일관되게. 사용자가 이미 적은 값이 있으면 그것과 어울리게.`,
    max: 8000,
  },
  {
    key: "summary.recap",
    group: "summary",
    label: "지난 이야기 리캡 프롬프트",
    description: "캠페인 복귀 리캡을 만들 때 사용됩니다.",
    mode: "replace",
    default_text: "다음 TRPG 대화 기록을 3~5문장으로 요약해 '지난 이야기' 리캡을 작성하라. 순수 텍스트로만.",
    max: 4000,
  },
  {
    key: "summary.explain",
    group: "summary",
    label: "Explain 모드 프롬프트",
    description: "방금 장면이 왜 나왔는지 개발자/사용자에게 설명할 때 사용됩니다.",
    mode: "replace",
    default_text: "다음은 방금 생성된 TRPG 장면의 내부 연출 근거다. 개발자가 읽기 쉽게 3~4문장으로 왜 이런 장면이 나왔는지 설명하라. 순수 텍스트로만.",
    max: 4000,
  },
  {
    key: "summary.daily_digest",
    group: "summary",
    label: "하루 정리 프롬프트",
    description: "긴 시간 진행 후 하루 동안 있었던 일을 요약할 때 사용됩니다.",
    mode: "replace",
    default_text: "다음은 하루 동안 있었던 일이다. 3~4문장으로 '그날의 정리'를 서술하라. 순수 텍스트로만.",
    max: 4000,
  },
  {
    key: "summary.world_history",
    group: "summary",
    label: "세계 역사서 프롬프트",
    description: "세계 사건 로그를 역사서 산문으로 정리할 때 사용됩니다.",
    mode: "replace",
    default_text: "다음은 한 세계에서 시간순으로 일어난 사건들이다. 이것을 한 권의 역사서 서문처럼 3~5문단의 담담한 연대기 산문으로 서술하라. 순수 텍스트.",
    max: 4000,
  },
  {
    key: "dream.generate",
    group: "summary",
    label: "꿈 생성 프롬프트",
    description: "수면 시 악몽/예지몽/회상 분위기의 짧은 꿈을 만들 때 사용됩니다. {{kind}}가 치환됩니다.",
    mode: "template",
    default_text: "다음 기억 조각을 바탕으로 {{kind}} 분위기의 짧은 꿈을 2~4문장으로 써라. 순수 텍스트.",
    max: 4000,
  },
  {
    key: "theme.generate",
    group: "tools",
    label: "UI 테마 생성 프롬프트",
    description: "자유 설명에서 CSS 변수 JSON을 만들 때 사용됩니다. {{allowed_keys}} {{allowed_fonts}}가 치환됩니다.",
    mode: "template",
    default_text: `너는 UI 테마 디자이너다. 아래 설명에 맞는 CSS 변수 값을 JSON으로만 출력하라.
허용 키: {{allowed_keys}}
색상은 hex, 폰트는 [{{allowed_fonts}}] 중에서만, --radius-base는 0~24 숫자(px).
형식: { "tokens": { "--color-bg": "#..." } }`,
    max: 6000,
  },
  {
    key: "plugin.generate",
    group: "tools",
    label: "플러그인 생성 프롬프트",
    description: "자유 설명에서 플러그인 매니페스트 JSON을 만들 때 사용됩니다. {{extension_points}}가 치환됩니다.",
    mode: "template",
    default_text: `너는 게임 확장 팩 설계자다. 아래 설명에 맞는 플러그인 매니페스트를 JSON으로만 출력하라.
extends 배열의 각 항목 type은 [{{extension_points}}] 중 하나만.
형식: { "name": "", "extends": [{ "type": "scene_type", "value": { "id": "", "label": "", "tone_notes": "" } }] }`,
    max: 6000,
  },
];

const MAP = new Map(BUILTIN_PROMPTS.map((p) => [p.key, p]));

function defaults() {
  return { enabled: true, items: {} };
}

function ensure(state) {
  state.prompt_settings = state.prompt_settings || defaults();
  state.prompt_settings.items = state.prompt_settings.items || {};
  if (state.prompt_settings.enabled === undefined) state.prompt_settings.enabled = true;
  return state.prompt_settings;
}

function cleanText(v, max = LIMIT) {
  return String(v || "").slice(0, max);
}

function setItem(state, key, patch) {
  const meta = MAP.get(key);
  if (!meta) return { ok: false, reason: "unknown prompt key" };
  const settings = ensure(state);
  const next = { ...(settings.items[key] || {}) };
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
  if (patch.text !== undefined) next.text = cleanText(patch.text, meta.max);
  if (patch.reset) {
    delete settings.items[key];
    return { ok: true, reset: true };
  }
  settings.items[key] = next;
  return { ok: true, item: next };
}

function getItem(state, key) {
  const meta = MAP.get(key);
  const settings = ensure(state || {});
  const item = (settings.items && settings.items[key]) || {};
  return { meta, item };
}

function getPrompt(state, key, fallback, vars = {}) {
  const { meta, item } = getItem(state, key);
  const base = fallback !== undefined ? fallback : (meta && meta.default_text) || "";
  if (!state || !state.prompt_settings || state.prompt_settings.enabled === false) return applyVars(base, vars);
  if (!meta || !item.enabled || !String(item.text || "").trim()) return applyVars(base, vars);
  return applyVars(cleanText(item.text, meta.max), vars);
}

function appendBlock(state, key, fallback = "", vars = {}) {
  return getPrompt(state, key, fallback, vars);
}

function applyVars(text, vars) {
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] !== undefined ? String(vars[k]) : "");
}

function clientPayload(state) {
  const settings = ensure(state);
  return {
    enabled: settings.enabled !== false,
    groups: ["story", "core", "import", "wizard", "summary", "tools"],
    prompts: BUILTIN_PROMPTS.map((p) => {
      const item = settings.items[p.key] || {};
      return {
        key: p.key,
        group: p.group,
        label: p.label,
        description: p.description,
        mode: p.mode,
        max: p.max,
        dangerous: !!p.dangerous,
        default_text: p.default_text,
        enabled: !!item.enabled,
        text: item.text || "",
        customized: !!(item.enabled && String(item.text || "").trim()),
      };
    }),
  };
}

module.exports = { BUILTIN_PROMPTS, ensure, defaults, setItem, getPrompt, appendBlock, clientPayload };
