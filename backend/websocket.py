"""WebSocket 터미널 브릿지 -- PTY fork로 tmux 세션에 연결."""

import asyncio
import codecs
import fcntl
import json
import logging
import os
import pty
import signal
import struct
import termios
from typing import Tuple

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend import parsers
from backend.constants import (
    MAX_WS_MESSAGE_SIZE,
    PREFIX,
    PTY_POLL_INTERVAL,
    PTY_READ_BUFFER,
    PTY_SPAWN_TIMEOUT,
    RESIZE_MAX,
    RESIZE_MIN,
    TMUX,
    TMUX_DEFAULT_COLS,
    TMUX_DEFAULT_ROWS,
    _VALID_SESSION_ID,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _spawn_pty_sync(tmux_name: str) -> Tuple[int, int]:
    """tmux 세션에 연결된 PTY를 생성. (child_pid, pty_fd) 반환."""
    import backend.app as _app

    env = _app._clean_env()
    env["TERM"] = "xterm-256color"
    env["LANG"] = "en_US.UTF-8"
    env["LC_ALL"] = "en_US.UTF-8"

    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.execvpe(TMUX, [TMUX, "attach-session", "-t", tmux_name], env)
        except Exception:
            os._exit(1)

    flag = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flag | os.O_NONBLOCK)
    return pid, fd


@router.websocket("/ws/terminal/{session_id}")
async def ws_terminal(ws: WebSocket, session_id: str) -> None:
    """브라우저 xterm.js 터미널과 tmux 세션을 PTY로 연결."""
    import backend.app as _app

    await ws.accept()

    if not _VALID_SESSION_ID.match(session_id):
        await ws.send_text(json.dumps({"type": "error", "data": "Invalid session ID"}))
        await ws.close()
        return

    tmux_name = f"{PREFIX}{session_id}"
    if not _app.session_exists(tmux_name):
        await ws.send_text(json.dumps({"type": "error", "data": "Session not found or not running"}))
        await ws.close()
        return

    # 리더 pane(첫 번째 pane)을 active로 선택 — Agent Teams가 active pane을 변경할 수 있으므로
    _app.tmux_run("select-pane", "-t", f"{tmux_name}.0")

    # 스크롤백 히스토리 먼저 전송
    history = await _app._capture_tmux_history_async(tmux_name)
    if history.strip():
        await ws.send_text(json.dumps({"type": "output", "data": history}))

    # PTY 생성 (pty.fork는 비동기 불가 → 스레드 풀 사용)
    loop = asyncio.get_running_loop()
    try:
        pid, fd = await asyncio.wait_for(
            loop.run_in_executor(None, _spawn_pty_sync, tmux_name),
            timeout=PTY_SPAWN_TIMEOUT,
        )
    except Exception as e:
        await ws.send_text(json.dumps({"type": "error", "data": f"PTY spawn failed: {e}"}))
        await ws.close()
        return

    # 한글 깨짐 방지용 점진적 UTF-8 디코더
    utf8_decoder = codecs.getincrementaldecoder('utf-8')('replace')

    async def read_pty() -> None:
        try:
            while True:
                await asyncio.sleep(PTY_POLL_INTERVAL)
                try:
                    data = os.read(fd, PTY_READ_BUFFER)
                    if data:
                        decoded = utf8_decoder.decode(data)
                        if decoded:
                            _app.append_log(session_id, "out", decoded)
                            await ws.send_text(json.dumps({
                                "type": "output",
                                "data": decoded,
                            }))
                            # 파싱된 사용량 정보 전송
                            usage = parsers.parse_usage_from_output(decoded)
                            if usage:
                                await ws.send_text(json.dumps({"type": "usage_update", "data": usage}))
                            # 토큰 만료 감지
                            expiry = parsers.detect_token_expiry(decoded)
                            if expiry > 0:
                                await ws.send_text(json.dumps({"type": "token_expiry", "data": {"seconds": expiry}}))
                except BlockingIOError:
                    continue
                except OSError:
                    await ws.send_text(json.dumps({"type": "exit"}))
                    break
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.debug("read_pty unexpected error", exc_info=True)

    reader_task = asyncio.create_task(read_pty())

    try:
        while True:
            msg = await ws.receive_text()
            if len(msg) > MAX_WS_MESSAGE_SIZE:
                continue
            payload = json.loads(msg)
            msg_type = payload.get("type")

            if msg_type == "input":
                try:
                    input_data = payload.get("data", "")
                    _app.append_log(session_id, "in", input_data)
                    _app.tmux_run("select-pane", "-t", f"{tmux_name}.0")
                    os.write(fd, input_data.encode("utf-8"))
                except OSError:
                    break
            elif msg_type == "resize":
                rows = max(RESIZE_MIN, min(RESIZE_MAX, int(payload.get("rows", TMUX_DEFAULT_ROWS))))
                cols = max(RESIZE_MIN, min(RESIZE_MAX, int(payload.get("cols", TMUX_DEFAULT_COLS))))
                winsize = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
                _app.tmux_run("resize-window", "-t", tmux_name, "-x", str(cols), "-y", str(rows))
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.warning("WebSocket handler unexpected error", exc_info=True)
    finally:
        # 1) 프로세스 종료
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        # 2) fd 닫기 (프로세스에 EOF 전달)
        try:
            os.close(fd)
        except OSError:
            pass
        # 3) reader 태스크 정리
        reader_task.cancel()
        try:
            await reader_task
        except (asyncio.CancelledError, Exception):
            pass
        # 4) 프로세스 reap (좀비 방지)
        try:
            _pid, _ = os.waitpid(pid, os.WNOHANG)
            if _pid == 0:
                # 아직 안 죽었으면 SIGKILL 후 blocking wait
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
        except ChildProcessError:
            pass
        except ProcessLookupError:
            pass
