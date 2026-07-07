"use strict";

const DEFAULT_REGISTRY = {
  version: 1,
  dimensions: [
    { id: "sanity", label: "정신 안정", kind: "hidden", default_value: 0.8, archived: false, description: "현실감과 판단의 안정성.", low_directive: "현실감이 흔들린다 — 사소한 단서도 불길하게 읽히게.", high_directive: "판단이 또렷하다 — 혼란 속에서도 세부를 붙잡는다." },
    { id: "fatigue", label: "피로", kind: "hidden", default_value: 0.2, archived: false, description: "몸과 마음의 소모.", high_directive: "피로가 깊다 — 말투와 움직임이 조금 늦고 거칠어진다." },
    { id: "stress", label: "긴장", kind: "hidden", default_value: 0.25, archived: false, description: "방어적 압박과 예민함.", high_directive: "긴장이 높다 — 방어적인 반응과 짧은 침묵이 잦아진다." },
    { id: "hope", label: "희망", kind: "hidden", default_value: 0.6, archived: false, description: "앞으로 나아갈 수 있다는 감각.", low_directive: "희망이 낮다 — 냉소와 체념이 묘사에 살짝 배어든다.", high_directive: "희망이 살아 있다 — 작은 온기와 가능성을 놓치지 않는다." },
    { id: "willpower", label: "의지", kind: "hidden", default_value: 0.7, archived: false, description: "버티고 선택하는 힘.", low_directive: "의지가 약해졌다 — 포기하고 싶은 기색을 행동의 머뭇거림으로 드러낸다." },
    { id: "guilt", label: "죄책감", kind: "hidden", default_value: 0.15, archived: false, description: "스스로에게 남은 빚.", high_directive: "죄책감이 무겁다 — 관련 인물 앞에서 시선과 말끝이 흔들린다." },
    { id: "humanity", label: "인간성", kind: "hidden", default_value: 0.9, archived: false, description: "타인을 사람으로 대하는 감각.", high_directive: "여전히 온기가 남아 있다 — 배려가 작게 새어 나온다." },
    { id: "corruption", label: "마모", kind: "hidden", default_value: 0.05, archived: false, description: "도덕적 감각의 마모.", high_directive: "도덕적으로 마모된 상태 — 주변 인물의 경계심과 불편함을 은은하게." },
    { id: "trauma_accumulation", label: "누적 상처", kind: "hidden", default_value: 0.1, archived: false, description: "반복된 상처의 잔향.", high_directive: "누적된 상처 — 특정 자극에 과민하게 반응할 여지를 둔다." },
  ],
  emotion_vocab: [
    { id: "calm", label: "고요", archived: false, description: "낮은 파동의 안정감.", contrast: "small_warmth" },
    { id: "small_warmth", label: "작은 온기", archived: false, description: "조심스러운 친밀함.", contrast: "calm" },
    { id: "tension", label: "긴장", archived: false, description: "곧 무언가 일어날 듯한 압력.", contrast: "calm" },
    { id: "fear", label: "두려움", archived: false, description: "위협 앞의 수축.", contrast: "warmth" },
    { id: "grief", label: "상실감", archived: false, description: "잃어버린 것의 무게.", contrast: "quiet_relief" },
    { id: "anger", label: "분노", archived: false, description: "밀어붙이는 열.", contrast: "quiet_resolve" },
    { id: "hope", label: "희망", archived: false, description: "미래가 닫히지 않았다는 감각.", contrast: "calm" },
    { id: "dread", label: "불길함", archived: false, description: "아직 모습을 드러내지 않은 공포.", contrast: "relief" },
    { id: "relief", label: "안도", archived: false, description: "위험이 잠시 물러난 숨.", contrast: "calm" },
  ],
  themes: [
    { id: "growth", label: "성장", archived: false, description: "변화와 자기 이해." },
    { id: "relationship", label: "관계", archived: false, description: "사람 사이의 거리와 믿음." },
    { id: "truth", label: "진실", archived: false, description: "감춰진 것을 마주함." },
    { id: "survival", label: "생존", archived: false, description: "살아남기 위해 지불하는 것." },
    { id: "power", label: "권력", archived: false, description: "힘과 책임, 지배." },
    { id: "love", label: "사랑", archived: false, description: "끌림, 헌신, 두려움." },
  ],
  scene_types: [
    { id: "conflict", label: "갈등", archived: false, tone_notes: "대립과 압박이 장면을 민다." },
    { id: "bond", label: "유대", archived: false, tone_notes: "관계의 거리 변화가 중심이다." },
    { id: "discovery", label: "발견", archived: false, tone_notes: "새 정보나 단서가 자연스럽게 드러난다." },
    { id: "reflection", label: "성찰", archived: false, tone_notes: "사건보다 내면과 여운을 따라간다." },
    { id: "transition", label: "전환", archived: false, tone_notes: "장소, 시간, 국면이 바뀐다." },
    { id: "catharsis", label: "카타르시스", archived: false, tone_notes: "쌓인 감정이 장면의 중심에서 해소된다." },
  ],
  intensity_guides: {
    low: "폭력·공포·로맨스는 간접적이고 짧게. 감정은 여백과 암시 위주.",
    medium: "장면에 필요한 만큼만 구체적으로. 감정선은 선명하게, 자극은 과장하지 않는다.",
    high: "중요한 순간은 충분히 깊고 감각적으로. 단, 선정성/잔혹성의 반복 묘사는 피한다.",
  },
  onboarding: {
    intro_seen: false,
    content_reviewed: false,
    scenario_preset: null,
  },
  wellness: {
    play_reminder_minutes: 180,
    backup_reminder_turns: 50,
    last_play_reminder_at: null,
    last_backup_reminder_turn: 0,
  },
};

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function ensure(state) {
  if (!state.custom_registry) state.custom_registry = clone(DEFAULT_REGISTRY);
  const reg = state.custom_registry;
  for (const [k, v] of Object.entries(DEFAULT_REGISTRY)) {
    if (reg[k] === undefined) reg[k] = clone(v);
  }
  for (const listKey of ["dimensions", "emotion_vocab", "themes", "scene_types"]) {
    if (!Array.isArray(reg[listKey])) reg[listKey] = clone(DEFAULT_REGISTRY[listKey]);
  }
  reg.intensity_guides = { ...DEFAULT_REGISTRY.intensity_guides, ...(reg.intensity_guides || {}) };
  reg.onboarding = { ...DEFAULT_REGISTRY.onboarding, ...(reg.onboarding || {}) };
  reg.wellness = { ...DEFAULT_REGISTRY.wellness, ...(reg.wellness || {}) };
  return reg;
}

function visible(list) {
  return (list || []).filter((x) => !x.archived);
}

function upsert(list, item) {
  const id = safeId(item.id || item.label);
  if (!id) throw new Error("id required");
  const clean = { ...item, id, label: String(item.label || id).slice(0, 60), archived: !!item.archived };
  const idx = list.findIndex((x) => x.id === id);
  if (idx >= 0) list[idx] = { ...list[idx], ...clean };
  else list.push(clean);
  return clean;
}

function safeId(v) {
  return String(v || "").trim().toLowerCase().replace(/[^\w가-힣-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
}

function hiddenDefaults(registry) {
  const out = {};
  for (const d of visible(registry.dimensions).filter((x) => x.kind === "hidden")) {
    out[d.id] = Number.isFinite(Number(d.default_value)) ? Math.max(0, Math.min(1, Number(d.default_value))) : 0.5;
  }
  return out;
}

function hiddenDirectives(state) {
  const reg = ensure(state);
  const hv = (state.player && state.player.hidden_variables) || {};
  const lines = [];
  for (const d of visible(reg.dimensions).filter((x) => x.kind === "hidden")) {
    const v = Number(hv[d.id]);
    if (!Number.isFinite(v)) continue;
    if (v >= 0.65 && d.high_directive) lines.push(d.high_directive);
    if (v <= 0.35 && d.low_directive) lines.push(d.low_directive);
  }
  return [...new Set(lines)].slice(0, 8);
}

function registryPromptLine(state) {
  const reg = ensure(state);
  const emo = visible(reg.emotion_vocab).map((x) => `${x.id}=${x.label || x.id}`).slice(0, 30);
  const themes = visible(reg.themes).map((x) => `${x.id}=${x.label || x.id}`).slice(0, 24);
  const scenes = visible(reg.scene_types).map((x) => `${x.id}=${x.label || x.id}`).slice(0, 24);
  return [
    "<custom_dimension_registry>",
    `감정 어휘: ${emo.join(", ") || "(기본)"}`,
    `주제 어휘: ${themes.join(", ") || "(기본)"}`,
    `장면 타입: ${scenes.join(", ") || "(기본)"}`,
    "위 어휘는 내부 조율용이다. 플레이어에게 목록처럼 설명하지 말고, 세계와 인물의 반응으로만 드러내라.",
    "</custom_dimension_registry>",
  ].join("\n");
}

module.exports = {
  DEFAULT_REGISTRY,
  ensure,
  visible,
  upsert,
  safeId,
  hiddenDefaults,
  hiddenDirectives,
  registryPromptLine,
};
