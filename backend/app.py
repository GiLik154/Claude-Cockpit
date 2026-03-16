"""FastAPI 백엔드 진입점. 헬퍼 함수들을 정의하고 서브모듈 라우터를 포함한다."""

import asyncio
import json
import logging
import os
import re
import shlex
import subprocess
import time
from datetime import datetime
from typing import Any, Dict, List, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.constants import (
    ANSI_ESCAPE,
    DEFAULT_SCROLLBACK_LINES,
    FRONTEND_DIR,
    GROUPS_FILE,
    LOGS_DIR,
    MAX_RECENT_SESSIONS,
    MODEL_OPTIONS,
    PREFIX,
    PRESET_COMMANDS,
    RECENT_SESSIONS_FILE,
    SENSITIVE_ENV_PREFIXES,
    SESSIONS_FILE,
    STORAGE_DIR,
    TMUX,
    TMUX_CAPTURE_TIMEOUT,
    TMUX_CD_DELAY,
    TMUX_DEFAULT_COLS,
    TMUX_DEFAULT_ROWS,
    TMUX_SESSION_INIT_DELAY,
    TMUX_USAGE_SESSION_COLS,
    USAGE_CLI_STARTUP_DELAY,
    USAGE_PROMPT_POLL_INTERVAL,
    USAGE_PROMPT_POLL_TIMEOUT,
    USAGE_TMUX,
    _VALID_PANE_ID,
    _VALID_SESSION_ID,
)

# 전용 usage 세션 초기화 여부
_usage_ready: bool = False

# 세션 메타데이터 동시 접근 방지 잠금
_meta_lock = asyncio.Lock()

logger = logging.getLogger(__name__)

app = FastAPI(title="Claude Web Console")


@app.on_event("startup")
async def _prewarm_usage_session() -> None:
    """서버 시작 시 usage 세션을 백그라운드로 미리 생성."""
    asyncio.create_task(_ensure_usage_session())


# --- 유효성 검사 ---

def _validate_session_id(session_id: str) -> None:
    if not _VALID_SESSION_ID.match(session_id):
        raise HTTPException(status_code=400, detail="Invalid session ID")


def _validate_pane_id(pane_id: str) -> None:
    if not _VALID_PANE_ID.match(pane_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid pane ID format (expected %%<number>)",
        )


# --- 환경변수 ---

def _clean_env() -> Dict[str, str]:
    """민감한 환경변수를 제거한 사본을 반환."""
    return {k: v for k, v in os.environ.items()
            if not k.startswith(SENSITIVE_ENV_PREFIXES)}


# --- 로그 ---

def get_log_path(session_id: str) -> str:
    os.makedirs(LOGS_DIR, exist_ok=True)
    return os.path.join(LOGS_DIR, f"session_{session_id}.log")


def append_log(session_id: str, direction: str, text: str) -> None:
    path = get_log_path(session_id)
    clean = ANSI_ESCAPE.sub('', text)
    if not clean.strip():
        return
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    prefix = ">>> " if direction == "in" else ""
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {prefix}{clean}")
        if not clean.endswith('\n'):
            f.write('\n')


# --- tmux 헬퍼 ---

def tmux_run(*args: str) -> Tuple[str, int]:
    result = subprocess.run(
        [TMUX] + list(args),
        capture_output=True,
        text=True,
        env=_clean_env(),
    )
    return result.stdout.strip(), result.returncode


def list_tmux_sessions() -> List[str]:
    out, rc = tmux_run("list-sessions", "-F", "#{session_name}")
    if rc != 0:
        return []
    return [s for s in out.split("\n") if s.startswith(PREFIX)]


def session_exists(session_name: str) -> bool:
    _, rc = tmux_run("has-session", "-t", session_name)
    return rc == 0


def create_tmux_session(session_name: str, cmd: List[str], cwd: str) -> None:
    tmux_run(
        "new-session", "-d",
        "-s", session_name,
        "-x", TMUX_DEFAULT_COLS, "-y", TMUX_DEFAULT_ROWS,
        "/bin/zsh", "-l",
    )
    time.sleep(TMUX_SESSION_INIT_DELAY)
    tmux_run("send-keys", "-t", session_name, f"cd {shlex.quote(cwd)}", "Enter")
    time.sleep(TMUX_CD_DELAY)
    full_cmd = " ".join(cmd)
    tmux_run("send-keys", "-t", session_name, full_cmd, "Enter")


def kill_tmux_session(session_name: str) -> None:
    tmux_run("kill-session", "-t", session_name)


# --- 세션 메타데이터 ---

def load_session_meta() -> Dict[str, Any]:
    if os.path.exists(SESSIONS_FILE):
        with open(SESSIONS_FILE, "r") as f:
            return json.load(f)
    return {}


def save_session_meta(meta: Dict[str, Any]) -> None:
    os.makedirs(STORAGE_DIR, exist_ok=True)
    with open(SESSIONS_FILE, "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


def load_recent_sessions() -> List[Dict[str, Any]]:
    if os.path.exists(RECENT_SESSIONS_FILE):
        with open(RECENT_SESSIONS_FILE, "r") as f:
            return json.load(f)
    return []


def save_recent_sessions(recent: List[Dict[str, Any]]) -> None:
    os.makedirs(STORAGE_DIR, exist_ok=True)
    with open(RECENT_SESSIONS_FILE, "w") as f:
        json.dump(recent, f, indent=2, ensure_ascii=False)


def add_recent_session(session_id: str, info: Dict[str, Any]) -> None:
    """삭제된 세션을 최근 목록에 추가 (중복 경로 제거, 최대 MAX_RECENT_SESSIONS개)."""
    recent = load_recent_sessions()
    cwd = info.get("cwd", "")
    log_path = get_log_path(session_id)
    has_log = os.path.exists(log_path) and os.path.getsize(log_path) > 0
    entry = {
        "original_id": session_id,
        "name": info.get("name", ""),
        "cwd": cwd,
        "preset": info.get("preset", "default"),
        "model": info.get("model", "auto"),
        "has_log": has_log,
        "deleted_at": datetime.now().isoformat(),
    }
    # 같은 cwd + name 조합이 이미 있으면 교체
    recent = [r for r in recent if not (r.get("cwd") == cwd and r.get("name") == entry["name"])]
    recent.insert(0, entry)
    recent = recent[:MAX_RECENT_SESSIONS]
    save_recent_sessions(recent)


def load_group_meta() -> Dict[str, Any]:
    if os.path.exists(GROUPS_FILE):
        with open(GROUPS_FILE, "r") as f:
            return json.load(f)
    return {}


def save_group_meta(meta: Dict[str, Any]) -> None:
    os.makedirs(STORAGE_DIR, exist_ok=True)
    with open(GROUPS_FILE, "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


# --- tmux 캡처 (비동기) ---

async def _capture_tmux_pane_async(
    target: str,
    start_line: str = "-500",
    *,
    end_line: str = "",
    escape_sequences: bool = False,
    join_lines: bool = False,
) -> str:
    try:
        cmd: List[str] = [TMUX, "capture-pane", "-t", target, "-p", "-S", start_line]
        if end_line:
            cmd.extend(["-E", end_line])
        if escape_sequences:
            cmd.insert(4, "-e")
        if join_lines:
            cmd.append("-J")
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_clean_env(),
        )
        stdout, _ = await asyncio.wait_for(
            proc.communicate(), timeout=TMUX_CAPTURE_TIMEOUT,
        )
        return stdout.decode("utf-8", errors="replace") if proc.returncode == 0 else ""
    except Exception:
        return ""


async def _capture_tmux_history_async(
    tmux_name: str,
    lines: int = DEFAULT_SCROLLBACK_LINES,
    escape_sequences: bool = False,
) -> str:
    return await _capture_tmux_pane_async(
        tmux_name,
        f"-{lines}",
        escape_sequences=escape_sequences,
    )


# --- Usage 출력 파서 ---

def _parse_usage_output(raw: str) -> Dict[str, Any]:
    clean = ANSI_ESCAPE.sub('', raw)
    result: Dict[str, Any] = {}

    session_m = re.search(r'Current session.*?(\d+)%\s*used', clean, re.DOTALL)
    if session_m:
        result["session_used"] = int(session_m.group(1))

    week_m = re.search(r'Current week \(all models\).*?(\d+)%\s*used', clean, re.DOTALL)
    if week_m:
        result["week_used"] = int(week_m.group(1))

    sonnet_m = re.search(r'Current week \(Sonnet only\).*?(\d+)%\s*used', clean, re.DOTALL)
    if sonnet_m:
        result["sonnet_used"] = int(sonnet_m.group(1))

    reset_m = re.search(r'Resets\s+(.+?)(?:\n|$)', clean)
    if reset_m:
        result["resets"] = reset_m.group(1).strip()

    result["raw"] = clean.strip()
    return result


# --- 전용 usage 세션 ---

async def _usage_session_healthy() -> bool:
    if not session_exists(USAGE_TMUX):
        return False
    raw = await _capture_tmux_pane_async(USAGE_TMUX, "-30")
    if not raw:
        return False
    clean = ANSI_ESCAPE.sub('', raw)
    lines = [line.strip() for line in clean.strip().split('\n') if line.strip()]
    if not lines:
        return True  # 출력 없음 = 아직 시작 중
    # "Status dialog dismissed" 반복 → 세션 오염됨
    dismissed_count = clean.count('Status dialog dismissed')
    if dismissed_count >= 5:
        return False
    last = lines[-1]
    # 쉘 프롬프트만 보이면 claude가 종료된 것으로 판단
    if (re.match(r'^.*[%\$]\s*$', last)
            and '❯' not in clean
            and '/usage' not in clean
            and 'Context left' not in clean):
        return False
    return True


async def _wait_for_usage_prompt() -> bool:
    """usage 세션에서 ❯ 프롬프트가 나타날 때까지 폴링. 성공 시 True."""
    deadline = time.monotonic() + USAGE_PROMPT_POLL_TIMEOUT
    while time.monotonic() < deadline:
        raw = await _capture_tmux_pane_async(USAGE_TMUX, "-5")
        clean = ANSI_ESCAPE.sub('', raw)
        if '❯' in clean:
            return True
        # trust 다이얼로그가 나타나면 수락
        if 'Trust' in clean or 'trust' in clean or 'Yes' in clean:
            tmux_run("send-keys", "-t", USAGE_TMUX, "", "Enter")
        await asyncio.sleep(USAGE_PROMPT_POLL_INTERVAL)
    return False


async def _recreate_usage_session() -> None:
    global _usage_ready
    kill_tmux_session(USAGE_TMUX)
    await asyncio.sleep(TMUX_CD_DELAY)
    home = os.path.expanduser("~")
    tmux_run(
        "new-session", "-d",
        "-s", USAGE_TMUX,
        "-x", TMUX_USAGE_SESSION_COLS, "-y", TMUX_DEFAULT_ROWS,
        "/bin/zsh", "-l",
    )
    await asyncio.sleep(TMUX_SESSION_INIT_DELAY)
    tmux_run("send-keys", "-t", USAGE_TMUX, f"cd {shlex.quote(home)}", "Enter")
    await asyncio.sleep(TMUX_CD_DELAY)
    tmux_run("send-keys", "-t", USAGE_TMUX, "claude --dangerously-skip-permissions", "Enter")
    # 고정 sleep 대신 프롬프트 폴링
    if not await _wait_for_usage_prompt():
        # 폴백: trust 다이얼로그 수락 후 재시도
        tmux_run("send-keys", "-t", USAGE_TMUX, "", "Enter")
        await _wait_for_usage_prompt()
    _usage_ready = True


async def _ensure_usage_session() -> None:
    if await _usage_session_healthy():
        return
    await _recreate_usage_session()


def _resolve_preset_cmd(preset: str, model: str = "auto") -> List[str]:
    cmd = list(PRESET_COMMANDS.get(preset, PRESET_COMMANDS["default"]))
    model_flag = MODEL_OPTIONS.get(model, "")
    if model_flag:
        cmd.extend(["--model", model_flag])
    return cmd


# --- API 라우트 ---

@app.get("/api/health")
async def api_health() -> Dict[str, Any]:
    alive = list_tmux_sessions()
    usage_alive = session_exists(USAGE_TMUX)
    return {
        "status": "ok",
        "tmux_sessions": len(alive),
        "usage_session": "alive" if usage_alive else "none",
        "uptime": time.monotonic(),
    }


# 서브모듈 라우터 포함 — 위의 헬퍼들이 모두 정의된 후에 import해야 함
from backend.sessions import router as _sessions_router  # noqa: E402
from backend.log import router as _log_router  # noqa: E402
from backend.usage import router as _usage_router  # noqa: E402
from backend.groups import router as _groups_router  # noqa: E402
from backend.websocket import router as _ws_router  # noqa: E402

app.include_router(_sessions_router)
app.include_router(_log_router)
app.include_router(_usage_router)
app.include_router(_groups_router)
app.include_router(_ws_router)

# 정적 파일 & 인덱스 페이지
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="frontend")


@app.get("/")
async def serve_index() -> FileResponse:
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
