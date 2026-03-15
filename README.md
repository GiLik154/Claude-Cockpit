# Claude Cockpit

브라우저에서 여러 [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) 세션을 동시에 관리하는 웹 대시보드.

<!-- ![Screenshot](docs/screenshot.png) -->

## 주요 기능

- **멀티 세션** — 하나의 브라우저 탭에서 여러 Claude CLI 세션 생성/전환/재시작/삭제
- **실시간 터미널** — 컬러, 스크롤백, 리사이즈를 지원하는 풀 터미널
- **3가지 뷰 모드** — Terminal, Log(구조화된 HTML), ANSI(컬러 웹뷰)
- **그룹 (Groups)** — 세션을 묶어 커스텀 에이전트 팀 구성, 그리드 뷰, 브로드캐스트/포커스 모드
- **Agent Teams** — 에이전트별 상태 카드 확인 및 개별 명령 전송
- **사용량 추적** — 컨텍스트 잔량, 세션/주간 사용량 실시간 표시
- **로그 뷰어** — 도구 호출 접기/펼치기, 명령어 네비게이션
- **토큰 재시도** — 레이트 리밋 감지 시 카운트다운 후 자동 재시도
- **모바일 지원** — 반응형 레이아웃, 터치 최적화 툴바

## 요구사항

| 항목 | 설치 방법 |
|------|----------|
| **Python 3.10+** | `brew install python3` (macOS) / `apt install python3` (Linux) |
| **tmux** | `brew install tmux` (macOS) / `apt install tmux` (Linux) |
| **Node.js** | `brew install node` (macOS) / `apt install nodejs npm` (Linux) |
| **Claude CLI** | `npm install -g @anthropic-ai/claude-code` 후 `claude` 실행하여 인증 ([설정 가이드](https://docs.anthropic.com/en/docs/claude-code)) |

## 설치 및 실행

```bash
git clone https://github.com/GiLik154/Claude-Cockpit.git
cd Claude-Cockpit

pip install -r requirements.txt
uvicorn backend.app:app --host 0.0.0.0 --port 8080 --reload
```

브라우저에서 **http://localhost:8080** 접속.

> 포트 8080이 이미 사용 중이면 `--port 9090` 등으로 변경하세요.

## 사용 방법

### 세션 만들기

1. 우측 상단 **+ New** 클릭
2. 세션 이름, 작업 디렉토리, 프리셋 선택 후 생성
3. 사이드바에서 세션 클릭으로 전환

### 세션 프리셋

| 프리셋 | 설명 |
|--------|------|
| Agent Teams + Skip Permissions | 에이전트 팀 + 자동 권한 수락 (기본값) |
| Agent Teams Only | 에이전트 팀만 (권한 확인 있음) |
| Skip Permissions Only | 자동 권한 수락만 |
| Default | 기본 Claude CLI |

### 입력 방식

| 환경 | 전송 | 개행 |
|------|------|------|
| 데스크톱 | Enter | Shift + Enter |
| 모바일 | Enter 2번 | Enter 1번 |

### 모바일 툴바

하단 툴바에서 Cancel, ESC, 숫자 선택(1/2/3), Delete, Log, Panes, Restart 등을 터치로 조작할 수 있습니다.

## 기능 상세

### 토큰 자동 재시도

Claude CLI 사용 중 레이트 리밋(토큰 한도 초과)이 발생하면 자동으로 감지합니다. 화면 하단에 카운트다운이 표시되고, 대기 시간이 지나면 마지막 명령을 자동으로 재전송합니다. 수동으로 먼저 재전송하면 자동 재시도는 취소됩니다.

### 전체 세션 재시작

헤더의 **Restart All** 버튼을 누르면 모든 활성 세션을 한번에 재시작합니다. 개별 세션은 사이드바의 재시작 버튼으로 재시작할 수 있습니다.

### 그룹 (Groups)

여러 세션을 하나의 그룹으로 묶어 커스텀 에이전트 팀을 구성할 수 있습니다.

**그룹 만들기:**

1. 사이드바 GROUPS 섹션의 **+** 버튼 클릭
2. 그룹 이름 입력, 멤버 세션 선택 및 역할(Role) 지정
3. 생성된 그룹을 클릭하면 그리드 뷰로 전환

**브로드캐스트 모드 (기본):**

- 입력창에 메시지를 입력하면 그룹 내 모든 세션에 동시 전송
- 입력 바에 파란색 상단 테두리 표시, 버튼이 "Broadcast"로 변경

**포커스 모드:**

- 그리드에서 특정 세션 셀 클릭 → 해당 세션만 파란 테두리로 강조
- 입력이 해당 세션에만 전송됨 (버튼 "Send"로 변경)
- ESC 키로 포커스 해제하면 다시 브로드캐스트 모드로 복귀

**모바일:**

- 1열 세로 그리드로 자동 변환
- 셀 터치로 포커스/브로드캐스트 전환

### Agent Teams 모드

Agent Teams 프리셋으로 세션을 생성하면 Claude가 여러 에이전트를 병렬로 생성해 작업합니다. 하단 **Panes** 버튼으로 에이전트 뷰를 활성화하면:

- 각 에이전트의 상태 카드(이름, 작업 상태, 마지막 활동 시간)를 실시간으로 확인
- 카드를 클릭해 특정 에이전트에게 직접 명령 전송
- 뷰 모드 3단계 전환: 꺼짐 → 터미널+카드 → 카드만 → 꺼짐

### 사용량 추적

헤더의 사용량 배지에서 실시간으로 확인 가능:

- **CTX** — 현재 세션의 컨텍스트 윈도우 잔량 (10초마다 갱신)
- **Session** — 세션 토큰 사용량
- **Week** — 주간 총 사용량

배지를 클릭하면 프로그레스 바로 상세 사용량을 확인할 수 있습니다.

### 로그 뷰어

터미널 출력을 구조화된 형태로 확인할 수 있습니다:

- 사용자 입력, Claude 응답, 도구 호출이 시각적으로 구분
- 도구 호출(Bash, Read, Edit 등)은 접기/펼치기 가능
- 명령어 단위로 그룹화되어 빠르게 탐색

### WebSocket 자동 재연결

네트워크 끊김 시 2초마다 자동으로 재연결을 시도합니다. 연결이 끊긴 동안 전송한 명령은 큐에 저장되어 재연결 후 자동 전송됩니다.

## 알려진 제한사항

- **macOS / Linux 전용** — tmux + PTY 기반이라 Windows에서는 WSL 필요
- **Claude CLI 인증** — 실행 전 `claude` 명령으로 인증이 완료되어 있어야 합니다
- **Agent Teams** — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 환경변수가 필요하며, CLI 버전에 따라 지원 여부가 다릅니다

## License

[MIT](LICENSE)
