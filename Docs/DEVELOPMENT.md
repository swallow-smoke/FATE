# 개발 가이드

## 요구사항

- **Node.js**
- **Gemini API 키** (선택) — 없으면 MOCK 모드로 전 기능이 동작합니다.

## 설치 & 실행

```bash
npm install
cp .env.example .env
npm start                # http://localhost:3000
```

### 환경변수 `.env`

| 변수 | 설명 |
|---|---|
| `GEMINI_API_KEY` | 비우면 MOCK, 채우면 LIVE. `GEMINI_API_KEYS`(콤마) 또는 `GEMINI_API_KEY_1..N`으로 다중 키 |
| `GEMINI_NARRATIVE_MODEL` | 서사 생성 모델 (기본 `gemini-2.5-flash`) |
| `GEMINI_EXTRACT_MODEL` | 상태 추출 모델 (기본 `gemini-2.5-flash-lite`) |
| `PORT` | 서버 포트 (기본 3000) |

> Pro 모델은 무료 티어에서 제외되므로 Flash/Flash-Lite를 권장합니다.

## 테스트

```bash
npm run smoke              # 서버·키 없이 5턴 루프 + 스키마(불변 필드 보호 등) 검증
node scripts/golden.js     # Golden 캠페인 회귀 — baseline과 대조
node scripts/wave1.js      # 기능 묶음별 백엔드 스모크 (wave1 ~ wave15)
node scripts/uicheck.js    # Playwright 브라우저 UI 스모크
```

- `scripts/wave*.js`는 기능 묶음별 스모크 테스트입니다. 새 기능을 추가하면 해당 wave를 확장하거나 새 wave를 추가합니다.
- `scripts/golden.js`는 `scripts/golden_baseline.json`을 기준으로 이전 동작이 깨졌는지 확인합니다. 의도한 변경이면 baseline을 갱신합니다.
- 테스트로 서버를 띄웠다면 반드시 종료하세요.

## 프로젝트 구조

```
src/
  server.js          Express API (엔드포인트 정의)
  turn.js            턴 오케스트레이터
  kernel/            Narrative Kernel — 상태 변경의 유일한 관문
  state/             CampaignState, 마이그레이션, 스냅샷, 증분 상태
  canon/  memory/  emotion/  scene/     엔진 코어
  gemini/            시스템 프롬프트 + 캐시/토큰/컨텍스트 최적화 + 클라이언트
  directors/         Theme / Rhythm / Debate / Drama
  npc/  relationship/  world/  meta/    서사 심화
  game/  quest/  mystery/  story/  comm/  inventory/  legacy/   게임플레이·스토리
  history/  personal/  undo/  usage/    이력·개인화
  theme/  plugins/    사용자 확장
  util/              압축 등 유틸
public/
  index.html         SPA 진입점
  js/                launcher, wizard, tabs, story, advanced, notifications ...
  style.css
scripts/             smokeTurn, wave1~15, golden, uicheck
data/                캠페인 저장 파일 + 앱 전역 themes/plugins/templates
Docs/                문서
```

## 개발 원칙

새 기능을 설계할 때 지키는 규칙입니다.

1. **Kernel을 거친다** — 상태를 바꾸려면 `Kernel.request()`를 호출합니다. 새 변경 유형이 필요하면 Kernel의 요청 타입 집합을 먼저 확장하세요. 상태를 직접 쓰지 마세요.
2. **AI는 보조** — 편의기능은 사람이 버튼으로 트리거하고 AI는 그 결과만 실행합니다. 무단 자동 실행을 기본값으로 두지 마세요.
3. **수치는 숨긴다** — 관계·특성·히든 변수의 원시 수치는 플레이어 UI에 노출하지 않습니다. 문장/라벨/배지로만 표현하고, 수치는 Advanced 패널에서만 봅니다.
4. **MOCK 폴백** — 모든 AI 호출에는 결정론적 mock 폴백을 둡니다. 키 없이 `npm run smoke`로 검증되어야 합니다.
5. **미리보기 후 적용** — 생성형 확장(테마·플러그인)은 반드시 미리보기 → 사람 확정을 거치며, 생성된 실행 코드를 eval/주입하지 않습니다.

## 확장 지점

플러그인으로 코드 없이 추가할 수 있는 것: 장면 타입, 장르 스탯 프리셋, 통신 채널, 하우스룰 번들, Advanced 위젯. 자세한 규칙은 [기능 카탈로그 §6](FEATURES.md#6-확장-테마--플러그인)을 참고하세요.

새 Director, Kernel 요청 타입, 상태 스키마 변경, 서사 프롬프트 로직은 플러그인 범위 밖이며 코어를 직접 수정해야 합니다.

## 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| `429`, `limit: 0` | 해당 모델이 무료 티어 미지원(예: Pro). Flash/Flash-Lite로 변경 |
| `429`, 할당량 소진 | 잠시 대기 후 재시도, 또는 다중 API 키 등록 |
| 디버그 트레이스가 채팅에 노출 | 설정 > Advanced 모드가 켜져 있는지 확인(기본 꺼짐) |
| 한도가 빠듯함 | 설정 탭의 **저토큰 모드**로 선택적 호출을 끄거나 줄임 |
