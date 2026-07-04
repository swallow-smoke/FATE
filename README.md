<div align="center">

# NarrativeOS

**AI가 서술하고, 엔진이 세계를 기억하는 인터랙티브 TRPG 캠페인 플랫폼**

브라우저에서 세계관과 캐릭터를 만들고 자연어로 행동하면, AI(Gemini)가 장면을 서술합니다.
그 이면에서 감정·기억·관계·세계 시뮬레이션 등 수십 개의 서브시스템이 캠페인의 일관성과 깊이를 지탱합니다.

`Node.js` · `Express` · `Gemini API` · 프레임워크 없는 순수 JS 프론트엔드 · 로컬 실행

**[▶ 바로 플레이하러 가기 — 플레이 가이드](Docs/GUIDE.md)**

</div>

---

## ✨ 이런 게 됩니다

- **AI 서술 + 상태 정합성** — AI는 장면을 쓰고, 그 결과로 일어난 변화(관계, 기억, 아이템, 세계 사건)는 검증 계층(**Kernel**)을 통과해야만 세계에 반영됩니다. AI가 설정을 어겨도(죽은 인물 재등장 등) 엔진이 걸러냅니다.
- **살아있는 NPC** — NPC는 화면 밖에서도 서로 관계를 맺고, 먼저 연락을 보내고, 자기 목표에 따라 움직입니다.
- **드러나지 않는 깊이** — 관계는 10차원 벡터로, 캐릭터 특성은 사건에 반응해 동적으로 생겨나고 사라집니다. 플레이어에겐 수치가 아니라 **문장과 라벨**로만 보입니다.
- **세계가 흘러갑니다** — 소문이 퍼지고, 세력 평판이 변하고, 편지가 도착하고(가로채이기도 하고), 예고된 사건의 카운트다운이 흐릅니다.
- **키 없이도 전부 체험** — Gemini 키가 없으면 **MOCK 모드**로 모든 기능이 결정론적으로 동작합니다.
- **직접 확장** — 자연어로 커스텀 테마와 플러그인(장면 타입·장르 스탯·통신 채널 등)을 만들 수 있습니다. AI는 안전한 스키마 값만 채우고, 실행 코드는 주입되지 않습니다.

## 📸 화면 구성

여섯 개의 탭으로 캠페인을 진행합니다.

| 탭 | 하는 일 |
|---|---|
| **이야기** | 자연어 행동 입력, AI 서술, 선택지·시간스킵·Undo·분기 저장 |
| **캐릭터** | 저널, 성장 궤적, 동적 특성, 지나온 선택의 여정 |
| **세계** | 타임라인·복선·소문·세력 평판·백과사전·날씨·단서·통신 |
| **관계** | NPC 관계망 그래프(정성적 라벨) |
| **인벤토리** | 아이템과 서사 기반 조합 |
| **설정** | 톤 조정·콘텐츠 강도·하우스룰·백업·사용량·테마·플러그인 |

개발자용 **Advanced 패널**(기본 꺼짐)에서는 감정·심리·관계 수치, 프롬프트 원문, 성능 프로파일 등 내부를 들여다볼 수 있습니다.

---

## 🚀 빠른 시작

```bash
npm install
cp .env.example .env     # 아래 참고
npm start                # http://localhost:3000 접속
```

### 환경변수 `.env`

```bash
GEMINI_API_KEY=""                            # 비우면 MOCK 모드로 전체 동작
GEMINI_NARRATIVE_MODEL=gemini-2.5-flash      # 서사 생성 모델
GEMINI_EXTRACT_MODEL=gemini-2.5-flash-lite   # 후처리 추출 모델
PORT=3000
```

여러 키를 돌려쓰려면 `GEMINI_API_KEYS`(콤마 구분) 또는 `GEMINI_API_KEY_1..N`을 지정하세요. 한도(429)에 걸리면 자동으로 다음 키로 넘어갑니다.

### 테스트

```bash
npm run smoke        # 서버·키 없이 5턴 루프 + 스키마 검증
```

---

## 🧠 작동 원리 (한눈에)

```
브라우저 ──HTTP──> Express 서버 ──> 턴 오케스트레이터
                                        │
    ┌──────────┬───────────┬───────────┼───────────┐
    ▼          ▼           ▼           ▼           ▼
 장면 구성   기억 인출   디렉터 조율   AI 서술    상태 추출
                                        │
                                        ▼
                          ★ Narrative Kernel ★   ← 모든 상태 변경의 유일한 관문
                                        │
                                        ▼
                                 CampaignState → data/*.json
```

**턴 1회 = AI 호출 2번**(장면 서술 + 상태 추출)으로 고정. 모든 서브시스템은 Kernel의 검증을 거쳐야만 세계 상태를 바꿀 수 있습니다.

자세한 내부 구조는 **[아키텍처 문서](Docs/ARCHITECTURE.md)** 참고.

---

## 📚 문서

| 문서 | 내용 |
|---|---|
| **[플레이 가이드](Docs/GUIDE.md)** | 이게 뭔지, 어떻게 시작하고 노는지 — 플레이어용 |
| **[기능 카탈로그](Docs/FEATURES.md)** | 엔진 코어·서사·게임플레이·UI 등 전체 기능 정리 |
| **[아키텍처](Docs/ARCHITECTURE.md)** | Kernel, 턴 라이프사이클, 상태 스키마, 최적화 |
| **[API 레퍼런스](Docs/API.md)** | REST 엔드포인트 전체 |
| **[개발 가이드](Docs/DEVELOPMENT.md)** | 설치·테스트·디렉터리 구조·확장 방법 |

핵심 시스템별 설계 노트: [Kernel](Docs/NarrativeKernel.md) · [State](Docs/StateSchema.md) · [Canon](Docs/CanonDatabase.md) · [Memory](Docs/MemoryEngine.md) · [Emotion](Docs/EmotionEngine.md) · [Scene](Docs/SceneComposer.md) · [Prompt](Docs/GeminiSystemPrompt.md)

---

## 🗂️ 프로젝트 구조

```
src/
  kernel/       모든 상태 변경을 중재하는 Narrative Kernel
  state/        CampaignState 스키마, 마이그레이션, 스냅샷
  canon/  memory/  emotion/  scene/     엔진 코어
  gemini/       시스템 프롬프트 조립 + 캐시·토큰·컨텍스트 최적화
  directors/    Theme / Rhythm / Debate / Drama 디렉터
  npc/  relationship/  world/  meta/    서사 심화 시스템
  game/  quest/  mystery/  story/  comm/  inventory/   게임플레이
  theme/  plugins/    사용자 확장
  server.js     Express API
  turn.js       턴 오케스트레이터
public/         프론트엔드 SPA (index.html, js/, style.css)
scripts/        smoke·회귀·UI 테스트
data/           캠페인 저장 파일, 앱 전역 테마/플러그인/템플릿
Docs/           문서
```

---

## ⚙️ 설계 원칙

1. **Kernel 단일 중재자** — 어떤 시스템도 상태를 직접 쓰지 않고 `Kernel.request()`를 거칩니다.
2. **AI는 보조, 사람이 트리거** — 편의기능은 사람이 실행하고 AI가 돕습니다. 무단 자동 실행은 지양합니다.
3. **수치는 숨기고 서사로** — 관계·특성·히든 변수는 문장과 라벨로만 노출합니다.
4. **미리보기 없이 적용 없음** — AI 생성 테마/플러그인은 사람 확정을 거치고, 실행 코드는 주입하지 않습니다.
5. **MOCK 우선** — 키 없이도 전 기능을 결정론적으로 검증할 수 있습니다.

---

## 📄 라이선스 / 상태

개인 프로젝트 (MVP, `v0.1.0`). 무료 티어 기준 턴당 2콜로 동작하도록 설계되었으며, 한도가 빠듯하면 설정 탭의 **저토큰 모드**로 선택적 호출을 끌 수 있습니다.
