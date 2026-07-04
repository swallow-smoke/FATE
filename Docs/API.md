# API 레퍼런스

`src/server.js`가 노출하는 REST 엔드포인트입니다. 모든 응답은 JSON입니다. `:id`는 캠페인 ID를 뜻합니다.

베이스 URL: `http://localhost:3000` (기본 `PORT=3000`)

---

## 턴 & 스토리

| Method | Path | 설명 |
|---|---|---|
| POST | `/api/turn` | 플레이어 행동으로 한 턴 실행(서사 생성 + 상태 추출·반영) |
| POST | `/api/turn/regenerate` | 마지막 서사를 재생성 |
| POST | `/api/bookmark/:id` | 특정 대사 북마크 토글 |
| GET | `/api/history/:id` | 턴 로그 조회 |
| POST | `/api/campaign/:id/undo` | 직전 턴 되돌리기 |
| GET | `/api/undo/:id` | Undo 가능 상태 조회 |
| GET | `/api/recap/:id` | 세션 리캡 생성 |
| GET | `/api/quote/:id` | 명대사 조회 |
| POST | `/api/highlights/:id` | 세션 하이라이트 요약(사람이 트리거) |
| POST | `/api/campaign/:id/force-event` | 이벤트 강제 발생(개발/디버그) |

## 캠페인 & 마법사

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/campaigns` | 런처용 캠페인 목록 |
| POST | `/api/campaign/new` | 신규 캠페인 |
| POST | `/api/campaign/saveas` | 현재 상태를 분기 저장 |
| DELETE | `/api/campaign/:id` | 캠페인 삭제 |
| POST | `/api/wizard/world` | 세계관 AI 생성 |
| POST | `/api/wizard/characters` | 캐릭터 AI 생성 |
| POST | `/api/wizard/suggest` | 입력값 기반 제안 |
| POST | `/api/wizard/create` | 마법사 결과로 캠페인 생성 |
| POST | `/api/seed` | 시드 데이터 주입 |
| GET | `/api/templates` | 세계관 템플릿 목록 |
| POST | `/api/campaign/:id/save-template` | 현재 세계관을 템플릿으로 저장 |
| DELETE | `/api/templates/:tid` | 템플릿 삭제 |
| POST | `/api/campaign/from-template` | 템플릿으로 새 캠페인 |
| POST | `/api/campaign/:id/confirm-transition` | 사망/은퇴를 확정하여 세대교체 실행 |

## 상태 & 패널

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/state/:id` | 캠페인 전체 상태 |
| GET | `/api/canon/:id` | Canon 데이터 |
| GET | `/api/memory/:id` | 기억 데이터 |
| GET | `/api/health/:id` | 캠페인 건강도 |
| GET | `/api/advanced/:id` | Advanced 패널 데이터 |
| POST | `/api/state/:id/advanced-mode` | Advanced 모드 토글 |
| POST | `/api/state/:id/settings` | 설정 저장(톤·강도·하우스룰·저토큰 등) |
| POST | `/api/explain/:id` | Explain 모드(마지막 턴 근거 설명) |
| GET | `/api/snapshots/:id` | 스냅샷 목록 |
| POST | `/api/snapshots/:id/restore` | 스냅샷 복원 |
| GET | `/api/worldtab/:id` | 세계 탭 데이터(타임라인·소문·평판·날씨 등) |
| GET | `/api/wiki/:id` | 백과사전(위키) |
| GET | `/api/relations/:id` | 관계 그래프 |
| GET | `/api/inventory/:id` | 인벤토리 |

## 플레이어 & 특성

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/player/:id` | 플레이어 캐릭터 정보 |
| POST | `/api/player/:id/trait` | 특성 수동 추가 |
| POST | `/api/player/:id/ack-trait` | 새 특성 알림 확인 |

## 통신 (편지 / DM)

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/comm/:id` | 수신함·미읽음 수 조회 |
| POST | `/api/comm/:id/read` | 메시지 읽음 처리 |
| POST | `/api/campaign/:id/letter` | 편지 발송 |

## 개인 메모 & 목표

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/notes/:id` | 개인 메모 조회 |
| POST | `/api/notes/:id` | 메모 추가 |
| DELETE | `/api/notes/:id/:noteId` | 메모 삭제 |
| POST | `/api/goal/:id` | 목표 설정 |
| GET | `/api/playstats/:id` | 플레이 통계 |
| GET | `/api/autosave/:id` | 자동저장 슬롯 목록 |
| POST | `/api/autosave/:id/restore` | 자동저장 복원 |

> 개인 메모는 절대 AI 프롬프트에 섞이지 않습니다(테스트로 검증됨).

## 사용량 · 백업 · 런타임

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/usage` | 전체 사용량 대시보드 |
| GET | `/api/usage/:id` | 캠페인별 사용량 |
| GET | `/api/export/:id` | 캠페인 JSON 백업 (`?gz=1`로 gzip) |
| GET | `/api/export/:id/narrative` | 서사만 텍스트로 내보내기 |
| POST | `/api/import` | 캠페인 가져오기 |
| GET | `/api/keys` | API 키 상태(값 미노출) |
| POST | `/api/keys/reload` | 환경변수에서 키 재로드 |
| GET | `/api/runtime-config` | 런타임 모델/키 설정 조회 |
| POST | `/api/runtime-config` | 런타임 모델/키 설정 변경 |
| GET | `/api/status` | 서버·모드(MOCK/LIVE) 상태 |

## 확장: 테마 & 플러그인

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/themes` | 테마 목록 + 허용 키/폰트 |
| POST | `/api/themes/generate` | 자유서술로 테마 토큰 AI 생성(미리보기용) |
| POST | `/api/themes` | 테마 저장 |
| DELETE | `/api/themes/:tid` | 테마 삭제 |
| GET | `/api/plugins` | 플러그인 목록 + 확장 지점 |
| POST | `/api/plugins/generate` | 자유서술로 플러그인 매니페스트 AI 생성(미리보기용) |
| POST | `/api/plugins` | 플러그인 등록 |
| POST | `/api/plugins/:pid/toggle` | 플러그인 켜기/끄기 |
| DELETE | `/api/plugins/:pid` | 플러그인 삭제 |
| POST | `/api/campaign/:id/apply-plugin-bundle` | 하우스룰 번들을 캠페인에 적용 |
