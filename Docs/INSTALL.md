# 설치 및 실행

## 준비물

- Node.js
- Gemini API 키 ([Google AI Studio](https://aistudio.google.com/apikey)에서 발급) — 없어도 MOCK 모드로 실행 가능

## 설치

```bash
npm install
cp .env.example .env
```

## 환경변수 (.env)

```bash
# 비워두면 MOCK 모드(API 호출 없이 턴 루프 전체 확인 가능), 채우면 LIVE 모드
GEMINI_API_KEY=""

# Pro 모델은 2026년 4월부로 무료 티어에서 제외됨 — Flash/Flash-Lite 권장
GEMINI_NARRATIVE_MODEL=gemini-2.5-flash
GEMINI_EXTRACT_MODEL=gemini-2.5-flash-lite

PORT=3000
```

## 실행

```bash
npm start
```

`http://localhost:3000` 접속.

## 테스트

```bash
npm run smoke   # 서버/키 없이 5턴 루프 + 스키마(불변 필드 보호 등) 검증
```

## 무료 티어 참고

- Flash: 10 RPM / 250 RPD 안팎
- Flash-Lite: 15 RPM / 1,000 RPD 안팎
- 턴당 API 호출은 기본 2콜(서사 생성 + 후처리 추출)로 고정 — 정확한 최신 한도는 [AI Studio](https://aistudio.google.com/)에서 프로젝트별로 확인.
- 한도가 빠듯하면 설정 탭의 **저토큰 모드**로 선택적 호출(인터넷 검색 생성, NPC 배경 상호작용 등)을 끄거나 줄일 수 있음.

## 문제 해결

- **429 오류, `limit: 0`**: 해당 모델이 무료 티어에서 아예 지원 안 되는 경우(예: Pro). 모델을 Flash/Flash-Lite로 변경.
- **429 오류, 할당량 소진**: 잠시 대기 후 재시도, 또는 설정 탭에서 API 키 다중 등록(Phase8 D1) 활용.
- **디버그 트레이스가 채팅에 노출됨**: 설정 > Advanced 모드가 켜져 있는지 확인 — 기본값은 꺼짐.
