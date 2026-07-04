// Relationship label mapping (backend copy of public/js/tabs.js relLabel).
//
// The Phase 5 relations tab turns a RelationshipEdge into a qualitative label
// ("깊이 신뢰하는 사이" 등) at read time. Milestone detection (PATCH — 관계 전환)
// needs the SAME mapping server-side so it can compare the label before/after a
// turn's relationship change. Keep this in sync with the frontend relLabel().

// labelOf(rel) → string. Mirrors public/js/tabs.js:relLabel exactly.
function labelOf(rel) {
  if (!rel) return "아는 사이";
  const {
    trust = 0, affection = 0, fear = 0, respect = 0, obligation = 0,
    hatred = 0, guilt = 0, obsession = 0, jealousy = 0, dependency = 0,
  } = rel;
  if (hatred > 0.6) return affection > 0.4 ? "애증이 뒤엉킨 사이" : "적의를 품은 사이";
  if (obsession > 0.6) return "집착에 가까운 사이";
  if (guilt > 0.5) return "죄책감이 남은 사이";
  if (jealousy > 0.6) return "질투가 스민 사이";
  if (dependency > 0.6) return "깊이 의존하는 사이";
  if (trust > 0.7 && affection > 0.6) return "깊이 신뢰하는 사이";
  if (affection > 0.7) return "애틋한 사이";
  if (trust < 0.3 && fear > 0.5) return "두려워하며 경계하는 사이";
  if (fear > 0.5) return "두려워하는 사이";
  if (trust < 0.2 && affection < 0.2) return "서먹한 사이";
  if (respect > 0.6) return "존중하는 사이";
  if (obligation > 0.5) return "빚이 있는 사이";
  if (trust > 0.5) return "믿음이 쌓여가는 사이";
  return "지켜보는 사이";
}

const CORE_DIMS = ["trust", "affection", "fear", "respect", "obligation", "hatred", "obsession", "dependency"];

// nearBoundary(rel, margin) → true if a small (±margin) shift in any single
// evolving dimension would flip the label. Used by the Scene Composer to give a
// looming relationship transition its due weight BEFORE the narrative is written
// (we don't yet know the exact delta, only that the edge sits on a threshold).
function nearBoundary(rel, margin = 0.12) {
  if (!rel) return false;
  const base = labelOf(rel);
  for (const dim of CORE_DIMS) {
    for (const sign of [1, -1]) {
      const probe = { ...rel, [dim]: Math.max(-1, Math.min(1, (rel[dim] || 0) + sign * margin)) };
      if (labelOf(probe) !== base) return true;
    }
  }
  return false;
}

module.exports = { labelOf, nearBoundary, CORE_DIMS };
