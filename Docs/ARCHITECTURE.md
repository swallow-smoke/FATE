# 아키텍처

NarrativeOS의 내부 동작을 설명합니다. 기능 목록은 [기능 카탈로그](FEATURES.md), API는 [API 레퍼런스](API.md)를 참고하세요.

---

## 전체 구성

```
브라우저 (public/ — 순수 JS SPA)
    │  HTTP / JSON
    ▼
Express 서버 (src/server.js)
    │  캠페인별 엔진 인스턴스를 캐시하여 재사용
    ▼
턴 오케스트레이터 (src/turn.js)
    │
    ├─ Scene Composer      장면 구성
    ├─ Memory Engine       관련 기억 인출
    ├─ Directors           주제·리듬·긴장 조율
    ├─ Gemini Client       ① 서사 생성 콜
    ├─ Gemini Client       ② 상태 추출 콜
    │
    ▼
★ Narrative Kernel ★  ── 모든 상태 변경의 유일한 관문
    │
    ▼
CampaignState  →  data/<campaign>_state.json 외
```

핵심 불변식: **어떤 서브시스템도 `CampaignState`를 직접 수정하지 않는다.** 모두 `Kernel.request()`를 호출하고, Kernel이 검증을 통과시킨 패치만 상태에 반영된다.

---

## Narrative Kernel

`src/kernel/kernel.js`. 상태를 바꾸는 유일한 중재자입니다.

- **고정된 요청 타입 집합**만 받습니다: `memory.write`, `memory.promote`, `canon.register`, `canon.update`, `emotion.directive`, `story.beat`, `relationship.update`, `flag.set`, `scene.request`, `trait.create`, `trait.update`, `trait.delete`, `plugin.register`. 새 타입을 추가하려면 스펙을 먼저 수정해야 합니다.
- **검증**: Canon 일관성(바뀌면 안 되는 필드 보호)과 필수 필드 존재를 확인합니다.
- **반환**: `{ approved, reason, patch, conflicts }`. 승인된 패치만 호출부가 상태에 적용합니다.
- **레이트 리밋 예시**: 같은 캐릭터에 대한 특성 생성은 20턴 쿨다운, 특성 갱신은 5턴 간격. 단, 장르 프리셋·수동 추가 특성은 레이트 리밋 대상에서 제외됩니다.

설계 노트: [NarrativeKernel.md](NarrativeKernel.md).

---

## 턴 라이프사이클

`src/turn.js`가 한 턴을 오케스트레이션합니다. 순서상 중요한 점:

1. **장면을 먼저 구성**합니다(Scene Composer). 새 턴에서 실제 장면 맥락은 이때 만들어지기 때문입니다.
2. 그 새 SceneSpec을 기준으로 **기억을 인출**합니다 — 지난 턴 장면을 재사용하는 것보다 관련성이 높습니다.
3. 프롬프트를 조립하며 `<memory_context>`를 포함해 **① 서사 생성 콜**을 보냅니다.
4. 생성된 서사를 대상으로 **② 상태 추출 콜**을 보내 변화(관계·기억·특성·Canon 후보 등)를 구조화된 JSON으로 받습니다.
5. 추출 결과를 Kernel 요청으로 변환해 검증 후 커밋합니다.
6. 무결성 검사(AI Watchdog)에서 심각한 설정 붕괴가 감지되면 서사를 조용히 한 번 재생성하고 다시 추출합니다.

턴당 AI 호출은 **2번**(서사 + 추출)으로 고정입니다. Self Reflection 등은 추출 콜에 병합되어 호출 수를 늘리지 않습니다.

---

## 상태 & 영속성

- **CampaignState** (`src/state/campaignState.js`) — 단일 통합 스키마. 필드마다 소유 시스템이 정해져 있습니다.
- **마이그레이션** (`src/state/migrations.js`) — 스키마 버전을 순차 적용, 로드 실패 시 `.bak` 보존.
- **증분 상태** (`src/state/incrementalState.js`) — 변경된 top-level 키를 저널링(전체 저장은 안전상 유지).
- **스냅샷** (`src/state/snapshots.js`) — 100턴마다 gzip 스냅샷, 최근 3개 보관, 복원 가능.

저장 파일은 캠페인 ID별로 나뉩니다: `data/<id>_state.json`, `_canon.json`, `_memory.json`, `_turnlog.json`, `_undo.json`, `_usage.json`. 라이브 상태 파일은 Undo·가져오기 호환을 위해 평문으로 유지하고, 스냅샷과 내보내기만 gzip을 적용합니다.

설계 노트: [StateSchema.md](StateSchema.md).

---

## 서브시스템 지도

| 계층 | 디렉터리 | 담당 |
|---|---|---|
| 코어 | `canon/` `memory/` `emotion/` `scene/` | Canon DB, 기억, 감정, 장면 구성 |
| 프롬프트 | `gemini/` | 시스템 프롬프트 조립, 캐시, 토큰 예산, 컨텍스트 최적화 |
| 조율 | `directors/` `meta/` | Theme/Rhythm/Debate/Drama, 공명·건강도·무결성·시간가속·스케줄러 |
| 서사 심화 | `npc/` `relationship/` `world/` `legacy/` `quest/` `mystery/` `story/` | 살아있는 NPC, 10차원 관계, 세계 시뮬, 세대교체, 퀘스트, 단서, 결과 체인 |
| 게임플레이 | `game/` `inventory/` `comm/` | 판정, 엔딩, 카운트다운, 프리셋, 인벤토리, 시대별 통신 |
| 이력/개인화 | `history/` `personal/` `undo/` `usage/` | 턴 로그, 개인 메모, Undo, 사용량 |
| 확장 | `theme/` `plugins/` | 커스텀 테마, 선언적 플러그인 |
| 인프라 | `util/` | 압축 등 유틸 |

---

## 프롬프트 조립

`src/gemini/systemPromptBase.js` + `promptBlocks.js`.

- **정적 베이스** + **4개 동적 블록**(Canon 컨텍스트, 기억 컨텍스트, 장면 지시, 상황별 지시)으로 조립됩니다.
- 프롬프트에는 버전 태그(`nos-v1.x`)가 붙어, 버전이 바뀌면 컨텍스트 캐시가 무효화됩니다.
- 날씨·히든 변수·난이도·NPC 행동·단서 등 각 서브시스템의 지시가 동적 블록으로 주입됩니다. 히든 변수는 "설명문"이 아니라 "행동 경향"으로 프레이밍됩니다.

설계 노트: [GeminiSystemPrompt.md](GeminiSystemPrompt.md), [SceneComposer.md](SceneComposer.md), [EmotionEngine.md](EmotionEngine.md), [MemoryEngine.md](MemoryEngine.md), [CanonDatabase.md](CanonDatabase.md).

---

## 비용 최적화

무료 티어에서도 돌아가도록 설계된 장치들:

- **컨텍스트 캐시** (`gemini/contextCache.js`) — 정적 블록 해시 캐시, 관련 설정 변경 시 무효화.
- **델타 컨텍스트 + 동적 LOD** (`gemini/contextOptimizer.js`) — 안 바뀐 Canon/기억은 `(이전과 동일)` 마커로 대체, 참가자 관련도에 따라 상세도 차등(Full/Medium/제외).
- **토큰 예산** (`gemini/tokenBudget.js`) — 블록별 예산 초과 시 저우선 항목 제거.
- **통합 스케줄러** (`meta/scheduleConfig.js`) — 모든 백그라운드 주기를 단일 config로 관리, 저토큰 모드에서 빈도 자동 축소.
- **저토큰 모드** — 선택적 호출을 끄고 핵심 2콜만 유지.

---

## MOCK 모드

`GEMINI_API_KEY`가 비어 있으면 모든 AI 호출이 결정론적 mock으로 대체됩니다. 서버·키 없이도 전체 턴 루프와 모든 서브시스템을 검증할 수 있어, 개발과 테스트의 기본 경로입니다. 상태 추출 mock은 특정 키워드(임신·부상·배신·승리 등)에만 반응하도록 설계되어 회귀 테스트가 결정적입니다.
