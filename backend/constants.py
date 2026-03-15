"""백엔드 공통 상수."""

import os
import re
from typing import Dict, List

# 경로
BASE_DIR: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR: str = os.path.join(BASE_DIR, "frontend")
STORAGE_DIR: str = os.path.join(BASE_DIR, "storage")
SESSIONS_FILE: str = os.path.join(STORAGE_DIR, "sessions.json")
LOGS_DIR: str = os.path.join(BASE_DIR, "storage", "logs")

# tmux
TMUX: str = "tmux"
PREFIX: str = "claude-proxy-"
USAGE_TMUX: str = "claude-proxy-usage"
TMUX_DEFAULT_COLS: str = "120"
TMUX_DEFAULT_ROWS: str = "40"
TMUX_USAGE_COLS: str = "250"
TMUX_USAGE_SESSION_COLS: str = "200"

# 타이밍 (초)
TMUX_SESSION_INIT_DELAY: float = 0.5
TMUX_CD_DELAY: float = 0.3
USAGE_CLI_STARTUP_DELAY: float = 3.0
USAGE_CAPTURE_DELAY: float = 3.0
USAGE_FIRST_READY_DELAY: float = 6.0
USAGE_LOADING_RETRY_DELAY: float = 2.0
USAGE_LOADING_MAX_RETRIES: int = 3
TMUX_CAPTURE_TIMEOUT: float = 3.0
PTY_SPAWN_TIMEOUT: float = 5.0

# PTY
PTY_READ_BUFFER: int = 8192
PTY_POLL_INTERVAL: float = 0.005

# API 제한
MAX_LOG_TAIL_LINES: int = 10000
MAX_CAPTURE_LINES: int = 10000
DEFAULT_SCROLLBACK_LINES: int = 500

# 정규식 패턴
_VALID_SESSION_ID: re.Pattern[str] = re.compile(r'^[a-zA-Z0-9_-]+$')
_VALID_PANE_ID: re.Pattern[str] = re.compile(r'^%\d+$')
ANSI_ESCAPE: re.Pattern[str] = re.compile(
    r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?[@-~]|\r'
)

# 프리셋 명령어 매핑
PRESET_COMMANDS: Dict[str, List[str]] = {
    "skip-permissions": ["claude", "--dangerously-skip-permissions"],
    "agent-teams": ["env", "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1", "claude"],
    "both": [
        "env", "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1",
        "claude", "--dangerously-skip-permissions",
    ],
    "default": ["claude"],
}
