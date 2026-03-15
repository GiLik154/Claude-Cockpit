# Claude Cockpit — 제품 요구사항 명세서 (PRD)

**버전:** 1.0
**작성일:** 2026-03-11
**저장소:** https://github.com/GiLik154/Claude-Cockpit.git

---

## 1. 개요

**Claude Cockpit**은 여러 Claude CLI 세션을 동시에 관리할 수 있는 브라우저 기반 터미널 프록시입니다. 하나의 브라우저 탭에서 Claude AI 세션을 생성, 모니터링, 상호작용할 수 있는 통합 웹 인터페이스를 제공합니다.

### 문제 정의

여러 Claude CLI 세션을 실행하려면 터미널 창을 여러 개 열어야 하고, 수동으로 전환해야 하며, 사용량이나 세션 상태를 한눈에 파악할 수 없습니다. Agent Teams나 병렬 Claude 세션을 사용하는 파워 유저에게는 이를 효율적으로 관리할 통합 대시보드가 필요합니다.

### 해결 방안

Claude CLI 세션을 tmux로 감싸고, WebSocket으로 노출하며, xterm.js로 렌더링하는 경량 웹 애플리케이션입니다. 구조화된 로그 뷰어, 사용량 추적, Agent Teams 시각화, 모바일 지원을 추가로 제공합니다.

---

## 2. 대상 사용자

| 페르소나 | 설명 |
|---------|------|
| **파워 개발자** | 여러 프로젝트에서 Claude CLI 세션을 동시에 실행하는 사용자 |
| **Agent Teams 사용자** | Claude의 실험적 Agent Teams 기능으로 병렬 AI 에이전트를 관리하는 사용자 |
| **모바일 사용자** | 휴대폰이나 태블릿에서 Claude 세션을 모니터링하거나 상호작용하는 사용자 |
| **팀 리더** | 여러 활성 Claude 세션과 리소스 사용량을 한눈에 파악하려는 사용자 |

---

## 3. 핵심 기능

### 3.1 멀티 세션 관리

- 브라우저에서 Claude CLI 세션 생성, 삭제, 재시작
- 각 세션은 명명된 tmux 프로세스(`claude-proxy-{id}`)로 구동
- 세션 메타데이터 `storage/sessions.json`에 자동 저장 (이름, 명령, 작업 디렉토리, 프리셋)
- 자동 증가 숫자 ID
- 사이드바에서 세션 목록과 실시간 상태(실행 중/중지됨) 확인

### 3.2 실시간 터미널

- xterm.js v5.5.0을 통한 풀 터미널 에뮬레이션
- WebSocket 브릿지: 브라우저 ↔ PTY ↔ tmux 세션 ↔ Claude CLI
- 컬러 렌더링, 스크롤백 버퍼, 터미널 리사이즈 지원
- 한글 문자 분할 방지를 위한 증분 UTF-8 디코더
- WebSocket 연결 끊김 시 자동 재연결 (2초 간격)
- 초기 연결 시 스크롤백 히스토리 전송

### 3.3 세션 프리셋

| 프리셋 | 명령 | 용도 |
|--------|------|------|
| `both` (기본값) | `env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --dangerously-skip-permissions` | Agent Teams + 권한 자동 수락 |
| `agent-teams` | `env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude` | Agent Teams (권한 확인 포함) |
| `skip-permissions` | `claude --dangerously-skip-permissions` | 권한 자동 수락만 |
| `default` | `claude` | 표준 Claude CLI |

### 3.4 구조화된 로그 뷰어

- 원시 CLI 출력을 분류된 스타일 HTML 블록으로 파싱:
  - `❯` → 사용자 입력 (하이라이트)
  - `⏺ ToolName(...)` → 도구 호출 (접기/펼치기 가능한 `<details>` 요소)
  - `⎿` → 도구 결과
  - `✻✳✶✽✢` → 사고/작업 중 상태
  - 일반 텍스트 → Claude 응답
- 사용자 명령어별 그룹화
- 도구 호출 상세 내용 접기/펼치기
- 텍스트 선택 및 복사 지원
- 네이티브 DOM 스크롤 (모바일 성능 최적화)
- 새로고침 시 열림/닫힘 상태 및 스크롤 위치 보존

### 3.5 사용량 추적

- **헤더 배지**에 세 가지 지표 표시: `CTX N%`, `Session N%`, `Week N%`
- 컨텍스트 비율 10초마다 `/status` API로 폴링 (tmux 상태바에서 파싱)
- 세션/주간 사용량은 전용 tmux 세션을 통해 온디맨드로 조회 (활성 세션 방해 없음)
- 배지 클릭 시 프로그레스 바가 포함된 사용량 모달 열기
- "Loading usage data" 응답 시 자동 재시도

### 3.6 Agent Teams 뷰

- `/api/sessions/{id}/panes` 2초마다 폴링
- 에이전트별 상태 카드 표시:
  - 아바타 및 에이전트 이름
  - 상태 텍스트 ("작업 중", "대기 중" 등)
  - 마지막 활동 시간
- 카드 클릭으로 특정 에이전트 pane에 입력 라우팅
- 세 가지 표시 모드 순환: off → both (터미널 + 카드) → cards (카드만) → off

### 3.7 토큰 레이트 리밋 재시도

- 터미널 출력에서 레이트 리밋 메시지 자동 감지
- 재시도 전 카운트다운 타이머 표시
- 타임아웃 후 자동 재전송

### 3.8 모바일 최적화 인터페이스

- CSS Grid/Flexbox 기반 반응형 레이아웃
- 모바일 2단 입력 바:
  - 툴바 행: 취소, ESC, 1/2/3, Del, Log, Panes, Restart 버튼
  - 입력 행: textarea + Send 버튼
- 작은 화면을 위한 가로 스크롤 가능 툴바
- 터치 최적화 버튼 크기 (모바일 36px)
- 접을 수 있는 사이드바

### 3.9 입력 처리

- **데스크톱:** Enter로 전송, Shift+Enter로 줄바꿈
- **모바일:** 더블 Enter로 전송, 단일 Enter로 줄바꿈
- IME 조합 추적 (`compositionstart`/`compositionend`)으로 한글 입력 중 전송 방지
- Chrome에서 Enter 키 조합 확정 시 누락 방지 처리

---

## 4. 아키텍처

### 4.1 시스템 다이어그램

```
┌─────────────────────────────────────────────────┐
│                   브라우저                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ xterm.js │  │ 로그 뷰  │  │ 에이전트 카드 │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │          │
│       └──────┬───────┴───────┬───────┘          │
│              │  WebSocket    │  REST API         │
└──────────────┼───────────────┼──────────────────┘
               │               │
┌──────────────┼───────────────┼──────────────────┐
│              │   FastAPI     │                   │
│         ┌────▼────┐   ┌─────▼─────┐             │
│         │   PTY   │   │  라우터   │             │
│         │ (fork)  │   │ (sessions │             │
│         └────┬────┘   │  log,usage│             │
│              │        └─────┬─────┘             │
│         ┌────▼──────────────▼────┐              │
│         │     tmux 세션          │              │
│         │  claude-proxy-{id}     │              │
│         └────────────┬───────────┘              │
│                      │                          │
│              ┌───────▼───────┐                  │
│              │  Claude CLI   │                  │
│              └───────────────┘                  │
│                   서버                           │
└─────────────────────────────────────────────────┘
```

### 4.2 기술 스택

| 레이어 | 기술 |
|--------|------|
| 백엔드 | Python, FastAPI, asyncio |
| 프로세스 관리 | tmux, PTY (`pty.fork`) |
| 터미널 렌더링 | xterm.js v5.5.0 + FitAddon + WebLinksAddon |
| 통신 | WebSocket (실시간), REST (CRUD/상태) |
| 프론트엔드 | Vanilla JS (ES 모듈), CSS (프레임워크/번들러 없음) |
| 저장소 | JSON 파일 (`sessions.json`, `settings.json`, `logs/`) |
| 테스트 | pytest + pytest-asyncio (백엔드), vitest + jsdom (프론트엔드) |

### 4.3 백엔드 모듈

| 모듈 | 역할 |
|------|------|
| `app.py` | FastAPI 앱 초기화, 유효성 검증 헬퍼, tmux 헬퍼, 세션 영속성, 정적 파일 서빙 |
| `constants.py` | 모든 상수 (경로, tmux 설정, 타임아웃, 프리셋, 정규식 패턴) |
| `sessions.py` | 세션 CRUD 라우트, pane 캡처, send-keys |
| `log.py` | 로그 파일 조회 라우트 |
| `usage.py` | 사용량/상태 라우트, 전용 usage tmux 세션 |
| `websocket.py` | PTY fork 및 UTF-8 디코더를 사용한 WebSocket 터미널 브릿지 |

### 4.4 프론트엔드 모듈

| 모듈 | 역할 |
|------|------|
| `chat.js` | 진입점, 초기화 |
| `chat-core.js` | 공유 상수, 상태, 유틸리티 |
| `chat-terminal.js` | xterm.js 터미널 생성, WebSocket 관리 |
| `chat-sessions.js` | 세션 CRUD, 렌더링, 전환 |
| `chat-log.js` | 로그 파싱 (`parseLogToHtml`), 렌더링 |
| `chat-ui.js` | 모달, 사이드바, 온보딩 |
| `chat-input.js` | 입력 처리, IME 조합 |
| `chat-usage.js` | 사용량 배지, 사용량 모달 |
| `chat-panes.js` | Agent Teams pane 뷰 |
| `chat-utils.js` | 날짜 포맷, 파싱, 스크롤 유틸리티 |

---

## 5. API 엔드포인트

| 메서드 | 엔드포인트 | 설명 |
|--------|----------|------|
| GET | `/api/health` | 헬스체크 (tmux 세션 수, 업타임) |
| GET | `/api/sessions` | 전체 세션 목록 + alive 상태 |
| POST | `/api/sessions` | 새 세션 생성 (이름, 프리셋, cwd) |
| DELETE | `/api/sessions/{id}` | 세션 삭제 (tmux kill + 메타 제거) |
| POST | `/api/sessions/{id}/restart` | 세션 재시작 |
| GET | `/api/sessions/{id}/logs` | 세션 로그 조회 (마지막 N줄) |
| GET | `/api/sessions/{id}/capture` | tmux pane 내용 캡처 (ANSI 포함) |
| GET | `/api/sessions/{id}/status` | 컨텍스트 잔량 % 조회 |
| POST | `/api/sessions/{id}/usage` | `/usage` 명령 전송 후 결과 반환 |
| GET | `/api/sessions/{id}/panes` | tmux pane 목록 (Agent Teams용) |
| POST | `/api/sessions/{id}/send-keys` | 특정 pane에 키 전송 |
| POST | `/api/usage` | 전용 세션을 통한 전체 사용량 조회 |
| DELETE | `/api/usage-session` | Usage 세션 종료 |
| WS | `/ws/terminal/{id}` | WebSocket 터미널 브릿지 |
| GET | `/` | 프론트엔드 서빙 |

---

## 6. 저장소

| 경로 | 형식 | 용도 |
|------|------|------|
| `storage/sessions.json` | JSON | 세션 메타데이터 (이름, 명령, cwd, 프리셋) |
| `storage/settings.json` | JSON | API 키 및 모델 설정 |
| `storage/logs/session_{id}.log` | 텍스트 | 세션별 타임스탬프 로그 |

---

## 7. 의존성

### 런타임
- Python 3.10+
- `fastapi >= 0.115.0`
- `uvicorn >= 0.34.0`
- `tmux` (시스템 패키지)

### 프론트엔드 (CDN)
- xterm.js v5.5.0
- xterm-addon-fit
- xterm-addon-web-links

### 개발
- `pytest >= 8.0`, `pytest-asyncio >= 0.24`, `httpx >= 0.27`, `anyio >= 4.0`
- `vitest >= 3.0`, `jsdom >= 25.0`

---

## 8. 비기능 요구사항

| 카테고리 | 요구사항 |
|---------|---------|
| **성능** | 터미널 I/O WebSocket 지연 시간 < 50ms |
| **안정성** | WebSocket 연결 끊김 시 자동 재연결; 서버 재시작 후에도 세션 유지 (tmux 영속) |
| **보안** | `CLAUDECODE` / `CLAUDE_CODE_ENTRY` 접두사 환경변수를 자식 프로세스에서 제거 |
| **호환성** | 데스크톱 브라우저 (Chrome, Firefox, Safari), 모바일 브라우저 (iOS Safari, Android Chrome) |
| **배포** | 단일 머신 배포; 외부 데이터베이스 불필요; 빌드 단계 불필요 |
| **로컬라이제이션** | UI 문자열은 한국어; 영문 CLI 출력은 그대로 유지 |

---

## 9. 향후 고려사항

- 다중 사용자 인증 및 세션 격리
- SSH 터널링을 통한 원격 서버 배포
- 세션 공유 / 협업 뷰잉
- 영구 대화 이력 검색
- 장시간 작업 완료 알림 시스템
- 세션별 커스텀 프롬프트 템플릿
- 세션 설정 내보내기/가져오기
