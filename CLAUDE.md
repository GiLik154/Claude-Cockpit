# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

```bash
# Install dependencies
pip install -r requirements.txt

# Start the server (from project root)
uvicorn backend.app:app --host 0.0.0.0 --port 8080 --reload
```

Requires `tmux` to be installed on the system. The app serves at `http://localhost:8080`.

### Running Tests

```bash
# Backend (pytest)
pip install -r requirements-dev.txt
pytest

# Frontend (vitest + jsdom)
npm install
npm test
```

## Architecture

Browser-based terminal proxy for managing multiple Claude CLI sessions simultaneously. Users create sessions via the web UI, each backed by a tmux process running `claude` CLI.

**Data flow:** Browser (xterm.js) ↔ WebSocket ↔ PTY (pty.fork) ↔ tmux session ↔ Claude CLI

### Backend (modular — `backend/`)

- **`app.py`** — FastAPI app, validation helpers, tmux helpers, session metadata persistence, usage parser. Imports routers from sub-modules
- **`constants.py`** — All constants (tmux config, timeouts, presets, regex patterns)
- **`sessions.py`** — Session CRUD, capture, panes route handlers
- **`log.py`** — Log route handler
- **`usage.py`** — Usage/status route handlers, dedicated usage tmux session
- **`websocket.py`** — WebSocket terminal bridge (PTY fork, incremental UTF-8 decoder)

Key details:
- Each session is a tmux session named `claude-proxy-{id}`
- WebSocket uses `codecs.getincrementaldecoder('utf-8')` to prevent Korean character splitting
- Environment variables starting with `CLAUDECODE` or `CLAUDE_CODE_ENTRY` are stripped from child processes via `_clean_env()`

### Frontend (single-page app)

- `index.html` — Layout, modals, CDN imports for xterm.js v5.5.0 + addons (fit, web-links)
- JS modules: `chat-core.js` (constants/state), `chat-ui.js` (modals/sidebar), `chat-log.js` (log viewer), `chat-usage.js` (usage badge), `chat-input.js` (input/IME), `chat-panes.js` (agent teams view), `chat-sessions.js` (session CRUD), `chat-terminal.js` (xterm/WebSocket), `chat.js` (entry point)
- CSS modules: `style.css` (variables), `style-layout.css`, `style-sidebar.css`, `style-terminal.css`, `style-modal.css`, `style-input.css`, `style-components.css`, `style-responsive.css`

**Static assets are versioned** via `?v=N` query param on CSS/JS imports in `index.html`. Bump this number when changing frontend files. Currently v54.

### Key Frontend Behaviors

- **Double-Enter to send**: Single Enter inserts newline; if the value already ends with `\n`, Enter sends
- **IME composition tracking**: `isComposing` flag prevents send during Korean input composition
- **Mobile 2-row input bar**: `toolbar-row` (Cancel, ESC, 1/2/3, Del, Log, Panes, Restart) + `input-row` (textarea + Send). Desktop uses `display: contents` to keep single-row layout
- **Log viewer**: Console-style HTML rendering with `parseLogToHtml()` — parses CLI output into structured blocks (user input, tool calls as collapsible `<details>`, responses, thinking). Native DOM scroll for mobile performance
- **Usage badge + modal**: Header badge shows `CTX N%`, `Session N%`, `Week N%`. Context polled every 10s via `/status` API. Click badge opens usage modal with progress bars via global `/api/usage` endpoint (dedicated tmux session, doesn't disrupt active sessions)
- **Mobile toolbar**: Horizontally scrollable (`overflow-x: auto; flex-wrap: nowrap`) to fit all buttons on small screens
- **Panes view**: For Agent Teams mode — polls `/api/sessions/{id}/panes` and `/capture` to show agent status cards with Korean status text
- **Token retry**: Auto-detects rate limit messages in terminal output and retries after countdown
- **WebSocket reconnect**: Auto-reconnects every 2 seconds on disconnect

### Storage (`storage/`)

- `sessions.json` — Session metadata (name, cmd, cwd, preset). Numeric auto-incrementing IDs
- `settings.json` — API key and model config (used only by the unused `claude_client.py` module)
- `logs/` — Per-session plain text logs

### Session Presets

| Preset | Command |
|--------|---------|
| `both` (default) | `env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --dangerously-skip-permissions` |
| `agent-teams` | `env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude` |
| `skip-permissions` | `claude --dangerously-skip-permissions` |
| `default` | `claude` |

### CLI Output Parsing Patterns

`parseLogToHtml()` in `chat.js` and `parseUsageFromOutput()` recognize these Claude CLI patterns:
- `❯ ...` → user input
- `⏺ Bash(...)` / `Update(...)` / `Read(...)` etc → tool calls (rendered as collapsible `<details>`)
- `⎿ ...` → tool results
- `✻✳✶✽✢ Verb... (Ns · ↓ N tokens)` → thinking/working status
- `Done (N tool uses · N tokens · Ns)` → completion summary
- `Context left until auto-compact: N%` → context window remaining (parsed from tmux status bar)

## Conventions

- User communicates in Korean; UI status strings in `chat.js` are in Korean
- No framework/bundler — vanilla JS, CSS, HTML with CDN dependencies only
- Server runs on port **8080** (not 8000)
- **작업 후 항상 커밋**: 코드 변경 작업이 완료되면 반드시 git commit & push 해야 함. Remote: `https://github.com/GiLik154/Claude-Cockpit.git`
