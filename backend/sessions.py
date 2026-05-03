"""세션 CRUD 및 panes/capture API 라우트."""

import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from backend import parsers
from backend.constants import (
    DANGER_PRESETS,
    MAX_CAPTURE_LINES,
    MAX_SEND_KEYS_LENGTH,
    MAX_SESSIONS,
    PREFIX,
)

router = APIRouter()


def _ensure_pane_in_session(tmux_name: str, pane_id: str) -> None:
    """pane_id가 tmux_name 세션에 속하는지 검증. 아니면 404."""
    import backend.app as _app

    out, rc = _app.tmux_run("list-panes", "-t", tmux_name, "-F", "#{pane_id}")
    if rc != 0:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    pane_ids = {line.strip() for line in out.split("\n") if line.strip()}
    if pane_id not in pane_ids:
        raise HTTPException(status_code=403, detail="해당 세션의 pane이 아닙니다")


@router.get("/api/sessions")
async def api_list_sessions() -> List[Dict[str, Any]]:
    """전체 세션 목록과 alive 상태를 반환."""
    import backend.app as _app

    meta = _app.load_session_meta()
    alive_sessions = _app.list_tmux_sessions()
    result: List[Dict[str, Any]] = []
    for sid, info in meta.items():
        tmux_name = f"{PREFIX}{sid}"
        preset = info.get("preset", "")
        item: Dict[str, Any] = {
            "session_id": sid,
            "name": info.get("name", sid),
            "cmd": info.get("cmd", ""),
            "cwd": info.get("cwd", ""),
            "preset": preset,
            "model": info.get("model", "auto"),
            "alive": tmux_name in alive_sessions,
            "danger_mode": preset in DANGER_PRESETS,
        }
        if info.get("previous_session_id"):
            item["previous_session_id"] = info["previous_session_id"]
        result.append(item)
    return result


@router.post("/api/sessions")
async def api_create_session(body: Dict[str, Any]) -> Dict[str, Any]:
    """새 Claude CLI 세션(tmux)을 생성."""
    import backend.app as _app

    async with _app._meta_lock:
        meta = _app.load_session_meta()

        if len(meta) >= MAX_SESSIONS:
            raise HTTPException(
                status_code=429,
                detail=f"최대 세션 수({MAX_SESSIONS}개)에 도달했습니다",
            )

        existing_nums: List[int] = []
        for k in meta:
            try:
                existing_nums.append(int(k))
            except ValueError:
                pass
        sid = str(max(existing_nums, default=0) + 1)

        name = body.get("name", f"Claude {sid}")
        preset = body.get("preset", "default")
        model = body.get("model", "auto")
        cwd = body.get("cwd") or os.path.expanduser("~")

        real_cwd = os.path.realpath(cwd)
        if not os.path.isdir(real_cwd):
            raise HTTPException(
                status_code=400,
                detail=f"작업 디렉터리가 존재하지 않습니다: {cwd}",
            )

        home_real = os.path.realpath(os.path.expanduser("~"))
        if os.path.commonpath([real_cwd, home_real]) != home_real:
            raise HTTPException(
                status_code=400,
                detail="작업 디렉터리는 홈 디렉터리 하위여야 합니다",
            )

        cmd = _app._resolve_preset_cmd(preset, model)

        tmux_name = f"{PREFIX}{sid}"
        _app.create_tmux_session(tmux_name, cmd, real_cwd)

        entry: Dict[str, Any] = {
            "name": name,
            "cmd": " ".join(cmd),
            "cwd": real_cwd,
            "preset": preset,
            "model": model,
        }
        prev_id = body.get("previous_session_id")
        if prev_id:
            entry["previous_session_id"] = str(prev_id)
        meta[sid] = entry
        _app.save_session_meta(meta)

    return {
        "session_id": sid,
        "name": name,
        "model": model,
        "danger_mode": preset in DANGER_PRESETS,
    }


@router.post("/api/sessions/{session_id}/restart")
async def api_restart_session(session_id: str) -> Dict[str, bool]:
    """세션을 kill 후 재생성."""
    import backend.app as _app

    _app._validate_session_id(session_id)
    async with _app._meta_lock:
        meta = _app.load_session_meta()
        info = meta.get(session_id)
        if not info:
            raise HTTPException(status_code=404, detail=f"세션 '{session_id}'을(를) 찾을 수 없습니다")

        tmux_name = f"{PREFIX}{session_id}"
        _app.kill_tmux_session(tmux_name)

        preset = info.get("preset", "default")
        model = info.get("model", "auto")
        cmd = _app._resolve_preset_cmd(preset, model)

        info["cmd"] = " ".join(cmd)
        _app.save_session_meta(meta)

    _app.create_tmux_session(tmux_name, cmd, info["cwd"])
    return {"ok": True}


@router.delete("/api/sessions/{session_id}")
async def api_delete_session(session_id: str) -> Dict[str, bool]:
    """세션 삭제: tmux kill + 메타데이터 제거 + 최근 세션에 보관."""
    import backend.app as _app

    _app._validate_session_id(session_id)
    async with _app._meta_lock:
        meta = _app.load_session_meta()
        info = meta.get(session_id)
        tmux_name = f"{PREFIX}{session_id}"
        _app.kill_tmux_session(tmux_name)
        if info:
            _app.add_recent_session(session_id, info)
        meta.pop(session_id, None)
        _app.save_session_meta(meta)
    return {"ok": True}


@router.get("/api/recent-sessions")
async def api_recent_sessions() -> List[Dict[str, Any]]:
    """최근 삭제된 세션 목록 반환."""
    import backend.app as _app
    return _app.load_recent_sessions()


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
    if pane_id:
        _ensure_pane_in_session(tmux_name, pane_id)
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
    if len(text) > MAX_SEND_KEYS_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"텍스트가 너무 깁니다 (최대 {MAX_SEND_KEYS_LENGTH}자)",
        )
    _app._validate_pane_id(pane_id)

    tmux_name = f"{PREFIX}{session_id}"
    if not _app.session_exists(tmux_name):
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    _ensure_pane_in_session(tmux_name, pane_id)

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
        if len(parts) < 2:
            continue
        try:
            index = int(parts[1])
        except ValueError:
            continue
        panes.append({
            "pane_id": parts[0],
            "index": index,
            "title": parts[2] if len(parts) > 2 else "",
            "active": parts[3] == "1" if len(parts) > 3 else False,
        })
    return panes


@router.get("/api/sessions/{session_id}/agent-status")
async def api_agent_status(session_id: str, pane_id: Optional[str] = None) -> Dict[str, Any]:
    """세션(또는 특정 pane)의 에이전트 상태를 추출."""
    import backend.app as _app

    _app._validate_session_id(session_id)
    if pane_id is not None:
        _app._validate_pane_id(pane_id)
    tmux_name = f"{PREFIX}{session_id}"
    if not _app.session_exists(tmux_name):
        return {"status": "idle", "message": "세션 없음"}
    if pane_id:
        _ensure_pane_in_session(tmux_name, pane_id)
    target = pane_id if pane_id else tmux_name
    content = await _app._capture_tmux_history_async(target, lines=30, escape_sequences=True)
    return parsers.extract_agent_status(content)
