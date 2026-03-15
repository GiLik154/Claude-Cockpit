# Claude Cockpit — Product Requirements Document (PRD)

**Version:** 1.0
**Date:** 2026-03-11
**Repository:** https://github.com/GiLik154/Claude-Cockpit.git

---

## 1. Overview

**Claude Cockpit** is a browser-based terminal proxy for managing multiple Claude CLI sessions simultaneously. It provides a unified web interface where users can create, monitor, and interact with Claude AI through real-time terminal sessions — all from a single browser tab.

### Problem Statement

Running multiple Claude CLI sessions requires multiple terminal windows, manual switching, and no centralized view of usage or session state. Power users who run Agent Teams or parallel Claude sessions lack a unified dashboard to manage them efficiently.

### Solution

A lightweight web application that wraps Claude CLI sessions in tmux, exposes them via WebSocket, and renders them with xterm.js — adding structured log viewing, usage tracking, Agent Teams visualization, and mobile support on top.

---

## 2. Target Users

| Persona | Description |
|---------|-------------|
| **Power Developer** | Runs multiple Claude CLI sessions for different projects simultaneously |
| **Agent Teams User** | Uses Claude's experimental Agent Teams feature to orchestrate parallel AI agents |
| **Mobile User** | Needs to monitor or interact with Claude sessions from a phone or tablet |
| **Team Lead** | Wants visibility into multiple active Claude sessions and their resource usage |

---

## 3. Core Features

### 3.1 Multi-Session Management

- Create, delete, and restart Claude CLI sessions from the browser
- Each session backed by a named tmux process (`claude-proxy-{id}`)
- Session metadata persisted to `storage/sessions.json` (name, command, working directory, preset)
- Auto-incrementing numeric session IDs
- Sidebar with session list showing live status (running/stopped)

### 3.2 Real-Time Terminal

- Full terminal emulation via xterm.js v5.5.0
- WebSocket bridge: Browser ↔ PTY ↔ tmux session ↔ Claude CLI
- Color rendering, scrollback buffer, terminal resize support
- Incremental UTF-8 decoder to prevent CJK character splitting
- Auto-reconnect on WebSocket disconnect (2-second interval)
- Scrollback history sent on initial connection

### 3.3 Session Presets

| Preset | Command | Use Case |
|--------|---------|----------|
| `both` (default) | `env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --dangerously-skip-permissions` | Agent Teams + auto-accept permissions |
| `agent-teams` | `env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude` | Agent Teams with permission prompts |
| `skip-permissions` | `claude --dangerously-skip-permissions` | Auto-accept permissions only |
| `default` | `claude` | Standard Claude CLI |

### 3.4 Structured Log Viewer

- Parses raw CLI output into categorized, styled HTML blocks:
  - `❯` → User input (highlighted)
  - `⏺ ToolName(...)` → Tool calls (collapsible `<details>` elements)
  - `⎿` → Tool results
  - `✻✳✶✽✢` → Thinking/working status
  - Plain text → Claude responses
- Grouped by user command
- Expand/collapse tool call details
- Text selection and copy support
- Native DOM scrolling (optimized for mobile)
- Preserves open/close state and scroll position on refresh

### 3.5 Usage Tracking

- **Header badge** displaying three metrics: `CTX N%`, `Session N%`, `Week N%`
- Context percentage polled every 10 seconds via `/status` API (parsed from tmux status bar)
- Session and weekly usage fetched on demand via dedicated tmux session (avoids disrupting active sessions)
- Click badge to open usage modal with progress bars
- Auto-retry on "Loading usage data" responses

### 3.6 Agent Teams View

- Polls `/api/sessions/{id}/panes` every 2 seconds
- Displays per-agent status cards with:
  - Avatar and agent name
  - Status text (Korean: "작업 중", "대기 중", etc.)
  - Last activity timestamp
- Click card to route input to specific agent's pane
- Three display modes cycling: off → both (terminal + cards) → cards only → off

### 3.7 Token Rate Limit Retry

- Auto-detects rate limit messages in terminal output
- Displays countdown timer before retry
- Automatically resends after timeout expires

### 3.8 Mobile-Optimized Interface

- Responsive layout with CSS Grid/Flexbox
- Two-row mobile input bar:
  - Toolbar row: Cancel, ESC, 1/2/3, Del, Log, Panes, Restart buttons
  - Input row: textarea + Send button
- Horizontally scrollable toolbar for small screens
- Touch-optimized button sizes (36px on mobile)
- Collapsible sidebar

### 3.9 Input Handling

- **Desktop:** Enter to send, Shift+Enter for newline
- **Mobile:** Double-Enter to send, single Enter for newline
- IME composition tracking (`compositionstart`/`compositionend`) to prevent premature send during Korean/CJK input
- Chrome-specific handling for Enter key during composition

---

## 4. Architecture

### 4.1 System Diagram

```
┌─────────────────────────────────────────────────┐
│                   Browser                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ xterm.js │  │ Log View │  │ Agent Cards  │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │          │
│       └──────┬───────┴───────┬───────┘          │
│              │  WebSocket    │  REST API         │
└──────────────┼───────────────┼──────────────────┘
               │               │
┌──────────────┼───────────────┼──────────────────┐
│              │   FastAPI     │                   │
│         ┌────▼────┐   ┌─────▼─────┐             │
│         │   PTY   │   │  Routers  │             │
│         │ (fork)  │   │ (sessions │             │
│         └────┬────┘   │  log,usage│             │
│              │        └─────┬─────┘             │
│         ┌────▼──────────────▼────┐              │
│         │     tmux sessions      │              │
│         │  claude-proxy-{id}     │              │
│         └────────────┬───────────┘              │
│                      │                          │
│              ┌───────▼───────┐                  │
│              │  Claude CLI   │                  │
│              └───────────────┘                  │
│                   Server                        │
└─────────────────────────────────────────────────┘
```

### 4.2 Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python, FastAPI, asyncio |
| Process Management | tmux, PTY (`pty.fork`) |
| Terminal Rendering | xterm.js v5.5.0 + FitAddon + WebLinksAddon |
| Communication | WebSocket (real-time), REST (CRUD/status) |
| Frontend | Vanilla JS (ES modules), CSS (no framework/bundler) |
| Storage | JSON files (`sessions.json`, `settings.json`, `logs/`) |
| Testing | pytest + pytest-asyncio (backend), vitest + jsdom (frontend) |

### 4.3 Backend Modules

| Module | Responsibility |
|--------|---------------|
| `app.py` | FastAPI app init, validation helpers, tmux helpers, session persistence, static file serving |
| `constants.py` | All constants (paths, tmux config, timeouts, presets, regex patterns) |
| `sessions.py` | Session CRUD routes, pane capture, send-keys |
| `log.py` | Log file retrieval route |
| `usage.py` | Usage/status routes, dedicated usage tmux session |
| `websocket.py` | WebSocket terminal bridge with PTY fork and UTF-8 decoder |

### 4.4 Frontend Modules

| Module | Responsibility |
|--------|---------------|
| `chat.js` | Entry point, initialization |
| `chat-core.js` | Shared constants, state, utilities |
| `chat-terminal.js` | xterm.js terminal creation, WebSocket management |
| `chat-sessions.js` | Session CRUD, rendering, switching |
| `chat-log.js` | Log parsing (`parseLogToHtml`), rendering |
| `chat-ui.js` | Modals, sidebar, onboarding |
| `chat-input.js` | Input handling, IME composition |
| `chat-usage.js` | Usage badge, usage modal |
| `chat-panes.js` | Agent Teams pane view |
| `chat-utils.js` | Date formatting, parsing, scroll utilities |

---

## 5. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check (tmux session count, uptime) |
| GET | `/api/sessions` | List all sessions with alive status |
| POST | `/api/sessions` | Create new session (name, preset, cwd) |
| DELETE | `/api/sessions/{id}` | Delete session (kill tmux + remove metadata) |
| POST | `/api/sessions/{id}/restart` | Restart session |
| GET | `/api/sessions/{id}/logs` | Get session log (last N lines) |
| GET | `/api/sessions/{id}/capture` | Capture tmux pane content (with ANSI) |
| GET | `/api/sessions/{id}/status` | Get context remaining % |
| POST | `/api/sessions/{id}/usage` | Send `/usage` command and return result |
| GET | `/api/sessions/{id}/panes` | List tmux panes (for Agent Teams) |
| POST | `/api/sessions/{id}/send-keys` | Send keys to specific pane |
| POST | `/api/usage` | Global usage via dedicated session |
| DELETE | `/api/usage-session` | Kill usage session |
| WS | `/ws/terminal/{id}` | WebSocket terminal bridge |
| GET | `/` | Serve frontend |

---

## 6. Storage

| Path | Format | Purpose |
|------|--------|---------|
| `storage/sessions.json` | JSON | Session metadata (name, cmd, cwd, preset) |
| `storage/settings.json` | JSON | API key and model config |
| `storage/logs/session_{id}.log` | Text | Per-session timestamped logs |

---

## 7. Dependencies

### Runtime
- Python 3.10+
- `fastapi >= 0.115.0`
- `uvicorn >= 0.34.0`
- `tmux` (system package)

### Frontend (CDN)
- xterm.js v5.5.0
- xterm-addon-fit
- xterm-addon-web-links

### Development
- `pytest >= 8.0`, `pytest-asyncio >= 0.24`, `httpx >= 0.27`, `anyio >= 4.0`
- `vitest >= 3.0`, `jsdom >= 25.0`

---

## 8. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | WebSocket latency < 50ms for terminal I/O |
| **Reliability** | Auto-reconnect on WebSocket disconnect; session state survives server restart (tmux persists) |
| **Security** | Environment variables with `CLAUDECODE` / `CLAUDE_CODE_ENTRY` prefix stripped from child processes |
| **Compatibility** | Desktop browsers (Chrome, Firefox, Safari), Mobile browsers (iOS Safari, Android Chrome) |
| **Deployment** | Single-machine deployment; no external database; no build step required |
| **Localization** | UI strings in Korean; English CLI output preserved |

---

## 9. Future Considerations

- Multi-user authentication and session isolation
- Remote server deployment with SSH tunneling
- Session sharing / collaborative viewing
- Persistent conversation history search
- Notification system for long-running task completion
- Custom prompt templates per session
- Export/import session configurations
