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

from backend.constants import (
    PREFIX,
    PTY_POLL_INTERVAL,
    PTY_READ_BUFFER,
    PTY_SPAWN_TIMEOUT,
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
                rows = payload.get("rows", int(TMUX_DEFAULT_ROWS))
                cols = payload.get("cols", int(TMUX_DEFAULT_COLS))
                winsize = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
                _app.tmux_run("resize-window", "-t", tmux_name, "-x", str(cols), "-y", str(rows))
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.warning("WebSocket handler unexpected error", exc_info=True)
    finally:
        reader_task.cancel()
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            pass
