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
USAGE_CAPTURE_DELAY: float = 1.0
TMUX_CAPTURE_TIMEOUT: float = 3.0
PTY_SPAWN_TIMEOUT: float = 5.0

# Usage 프롬프트 폴링
USAGE_PROMPT_POLL_INTERVAL: float = 0.3
USAGE_PROMPT_POLL_TIMEOUT: float = 15.0
USAGE_OUTPUT_POLL_INTERVAL: float = 0.3
USAGE_OUTPUT_POLL_TIMEOUT: float = 10.0
ZOMBIE_CLEANUP_INTERVAL: float = 60.0

# PTY
PTY_READ_BUFFER: int = 8192
PTY_POLL_INTERVAL: float = 0.005

# API 제한
MAX_LOG_TAIL_LINES: int = 10000
MAX_PARSE_LOG_TEXT: int = 5 * 1024 * 1024  # 5MB
MAX_CAPTURE_LINES: int = 10000
DEFAULT_SCROLLBACK_LINES: int = 500
MAX_SESSIONS: int = 20
MAX_SEND_KEYS_LENGTH: int = 10000
MAX_WS_MESSAGE_SIZE: int = 102400  # 100KB
RESIZE_MIN: int = 1
RESIZE_MAX: int = 500

# 자식 프로세스에서 제거할 민감한 환경변수 접두사
GROUPS_FILE: str = os.path.join(STORAGE_DIR, "groups.json")
RECENT_SESSIONS_FILE: str = os.path.join(STORAGE_DIR, "recent_sessions.json")
MAX_RECENT_SESSIONS: int = 10
MAX_GROUPS: int = 20
MAX_GROUP_MEMBERS: int = 10
MAX_BROADCAST_TEXT_LENGTH: int = 10000

SENSITIVE_ENV_PREFIXES: tuple = (
    "CLAUDECODE", "CLAUDE_CODE_ENTRY",
    "ANTHROPIC_", "OPENAI_",
    "GEMINI_", "GOOGLE_GENAI_", "MISTRAL_", "COHERE_", "GROQ_",
    "PERPLEXITY_", "XAI_", "DEEPSEEK_", "REPLICATE_",
)

# 부분 문자열 기반 민감 환경변수 패턴 (대문자 변수명에 포함되면 차단)
SENSITIVE_ENV_SUBSTRINGS: tuple = (
    "_SECRET", "_PASSWORD", "PRIVATE_KEY", "_API_KEY",
)

# --dangerously-skip-permissions 포함 프리셋
DANGER_PRESETS: frozenset = frozenset({"skip-permissions", "both"})

# 정규식 패턴
_VALID_SESSION_ID: re.Pattern[str] = re.compile(r'^[a-zA-Z0-9_-]+$')
_VALID_PANE_ID: re.Pattern[str] = re.compile(r'^%\d+$')
ANSI_ESCAPE: re.Pattern[str] = re.compile(
    r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?[@-~]|\r'
)

# 모델 옵션 (CLI --model 플래그 값)
MODEL_OPTIONS: Dict[str, str] = {
    "auto": "",           # --model 없이 기본 모델 사용
    "opus": "opus",
    "sonnet": "sonnet",
    "haiku": "haiku",
}

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
