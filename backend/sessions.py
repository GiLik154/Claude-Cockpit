"""세션 CRUD 및 panes/capture API 라우트."""

import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from backend.constants import MAX_CAPTURE_LINES, PREFIX

router = APIRouter()


@router.get("/api/sessions")
async def api_list_sessions() -> List[Dict[str, Any]]:
    """전체 세션 목록과 alive 상태를 반환."""
    import backend.app as _app

    meta = _app.load_session_meta()
    alive_sessions = _app.list_tmux_sessions()
    result: List[Dict[str, Any]] = []
    for sid, info in meta.items():
        tmux_name = f"{PREFIX}{sid}"
        result.append({
            "session_id": sid,
            "name": info.get("name", sid),
            "cmd": info.get("cmd", ""),
            "cwd": info.get("cwd", ""),
            "preset": info.get("preset", ""),
            "alive": tmux_name in alive_sessions,
        })
    return result


@router.post("/api/sessions")
async def api_create_session(body: Dict[str, Any]) -> Dict[str, str]:
    """새 Claude CLI 세션(tmux)을 생성."""
    import backend.app as _app

    meta = _app.load_session_meta()

    existing_nums: List[int] = []
    for k in meta:
        try:
            existing_nums.append(int(k))
        except ValueError:
            pass
    sid = str(max(existing_nums, default=0) + 1)

    name = body.get("name", f"Claude {sid}")
    preset = body.get("preset", "default")
    cwd = body.get("cwd") or os.path.expanduser("~")

    cmd = _app._resolve_preset_cmd(preset)

    tmux_name = f"{PREFIX}{sid}"
    _app.create_tmux_session(tmux_name, cmd, cwd)

    meta[sid] = {
        "name": name,
        "cmd": " ".join(cmd),
        "cwd": cwd,
        "preset": preset,
    }
    _app.save_session_meta(meta)

    return {"session_id": sid, "name": name}


@router.post("/api/sessions/{session_id}/restart")
async def api_restart_session(session_id: str) -> Dict[str, bool]:
    """세션을 kill 후 재생성."""
    import backend.app as _app

    _app._validate_session_id(session_id)
    meta = _app.load_session_meta()
    info = meta.get(session_id)
    if not info:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

    tmux_name = f"{PREFIX}{session_id}"
    _app.kill_tmux_session(tmux_name)

    preset = info.get("preset", "default")
    cmd = _app._resolve_preset_cmd(preset)

    info["cmd"] = " ".join(cmd)
    _app.save_session_meta(meta)

    _app.create_tmux_session(tmux_name, cmd, info["cwd"])
    return {"ok": True}


@router.delete("/api/sessions/{session_id}")
async def api_delete_session(session_id: str) -> Dict[str, bool]:
    """세션 삭제: tmux kill + 메타데이터 제거."""
    import backend.app as _app

    _app._validate_session_id(session_id)
    meta = _app.load_session_meta()
    tmux_name = f"{PREFIX}{session_id}"
    _app.kill_tmux_session(tmux_name)
    meta.pop(session_id, None)
    _app.save_session_meta(meta)
    return {"ok": True}


@router.get("/api/sessions/{session_id}/capture")
async def api_capture_session(
    session_id: str,
    lines: int = 2000,
    pane_id: Optional[str] = None,
) -> PlainTextResponse:
    """tmux pane 내용을 ANSI 이스케이프 포함하여 캡처."""
    import backend.app as _app

    _app._validate_session_id(session_id)
    if pane_id is not None:
        _app._validate_pane_id(pane_id)
    lines = min(max(lines, 1), MAX_CAPTURE_LINES)
    tmux_name = f"{PREFIX}{session_id}"
    if not _app.session_exists(tmux_name):
        return PlainTextResponse("")
    target = pane_id if pane_id else tmux_name
    content = await _app._capture_tmux_history_async(target, lines=lines, escape_sequences=True)
    return PlainTextResponse(content)


@router.post("/api/sessions/{session_id}/send-keys")
async def api_send_keys(session_id: str, body: Dict[str, Any]) -> Dict[str, bool]:
    """특정 tmux pane에 키 입력을 전송."""
    import backend.app as _app

    _app._validate_session_id(session_id)
    pane_id = body.get("pane_id")
    text = body.get("text", "")
    if not pane_id or not text:
        raise HTTPException(status_code=400, detail="pane_id and text required")
    _app._validate_pane_id(pane_id)

    tmux_name = f"{PREFIX}{session_id}"
    if not _app.session_exists(tmux_name):
        raise HTTPException(status_code=404, detail="Session not found")

    _app.tmux_run("send-keys", "-t", pane_id, "-l", text)
    _app.tmux_run("send-keys", "-t", pane_id, "Enter")
    return {"ok": True}


@router.get("/api/sessions/{session_id}/panes")
async def api_list_panes(session_id: str) -> List[Dict[str, Any]]:
    """세션의 tmux pane 목록을 반환 (Agent Teams 뷰용)."""
    import backend.app as _app

    _app._validate_session_id(session_id)
    tmux_name = f"{PREFIX}{session_id}"
    if not _app.session_exists(tmux_name):
        return []
    out, rc = _app.tmux_run(
        "list-panes", "-t", tmux_name, "-F",
        "#{pane_id}\t#{pane_index}\t#{pane_title}\t#{pane_active}"
    )
    if rc != 0:
        return []
    panes: List[Dict[str, Any]] = []
    for line in out.split("\n"):
        if not line.strip():
            continue
        parts = line.split("\t")
        panes.append({
            "pane_id": parts[0],
            "index": int(parts[1]),
            "title": parts[2] if len(parts) > 2 else "",
            "active": parts[3] == "1" if len(parts) > 3 else False,
        })
    return panes
