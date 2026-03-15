"""사용량 및 상태 API 라우트."""

import asyncio
import re
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException

from backend.constants import (
    ANSI_ESCAPE,
    PREFIX,
    TMUX_CD_DELAY,
    USAGE_CAPTURE_DELAY,
    USAGE_FIRST_READY_DELAY,
    USAGE_LOADING_MAX_RETRIES,
    USAGE_LOADING_RETRY_DELAY,
    USAGE_TMUX,
    TMUX_USAGE_COLS,
)

router = APIRouter()


@router.get("/api/sessions/{session_id}/status")
async def api_session_status(session_id: str) -> Dict[str, Any]:
    """tmux 상태 바에서 context-left 퍼센트와 모델 정보를 파싱."""
    import backend.app as _app

    _app._validate_session_id(session_id)
    tmux_name = f"{PREFIX}{session_id}"
    if not _app.session_exists(tmux_name):
        return {"context_left": None, "model": None}

    # context left: 하단 5줄
    raw_bottom = await _app._capture_tmux_pane_async(tmux_name, "-5", join_lines=True)
    clean_bottom = ANSI_ESCAPE.sub('', raw_bottom)
    m = re.search(r'Context left until auto-compact:\s*(\d+)%', clean_bottom)
    context_left = int(m.group(1)) if m else None

    # 모델 감지: 스크롤백 전체 캡처 → 상단 5줄에서 배너 파싱
    raw_all = await _app._capture_tmux_pane_async(tmux_name, "-")
    banner = "\n".join(raw_all.split("\n")[:5])
    clean_banner = ANSI_ESCAPE.sub('', banner)
    model = _detect_model(clean_banner)

    # 감지된 모델을 메타데이터에 업데이트
    if model:
        async with _app._meta_lock:
            meta = _app.load_session_meta()
            if session_id in meta and meta[session_id].get("model") != model:
                meta[session_id]["model"] = model
                _app.save_session_meta(meta)

    return {"context_left": context_left, "model": model}


def _detect_model(text: str) -> Optional[str]:
    """Claude CLI 배너에서 모델명을 감지."""
    # 패턴: "Opus 4.6", "Sonnet 4.5", "Haiku 3.5" 등
    m = re.search(r'\b(Opus|Sonnet|Haiku)\s+[\d.]+', text, re.IGNORECASE)
    if m:
        return m.group(1).lower()
    return None


@router.post("/api/sessions/{session_id}/usage")
async def api_session_usage(session_id: str) -> Dict[str, Any]:
    """세션에 /usage 전송 후 결과를 캡처하고 ESC로 닫음."""
    import backend.app as _app

    _app._validate_session_id(session_id)
    tmux_name = f"{PREFIX}{session_id}"
    if not _app.session_exists(tmux_name):
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found or not running")

    _app.tmux_run("send-keys", "-t", tmux_name, "/usage", "Enter")
    await asyncio.sleep(USAGE_CAPTURE_DELAY)
    raw = await _app._capture_tmux_pane_async(tmux_name, "-30", join_lines=True)
    _app.tmux_run("send-keys", "-t", tmux_name, "Escape", "")
    return _app._parse_usage_output(raw)


@router.post("/api/usage")
async def api_global_usage() -> Dict[str, Any]:
    """전용 usage 세션에서 사용량을 조회 (활성 세션에 영향 없음)."""
    import backend.app as _app

    await _app._ensure_usage_session()

    if not _app._usage_ready:
        await asyncio.sleep(USAGE_FIRST_READY_DELAY)
        _app._usage_ready = True
    else:
        # 이전 다이얼로그 닫기
        _app.tmux_run("send-keys", "-t", USAGE_TMUX, "Escape", "")
        await asyncio.sleep(TMUX_CD_DELAY)

    _app.tmux_run("resize-window", "-t", USAGE_TMUX, "-x", TMUX_USAGE_COLS)
    _app.tmux_run("send-keys", "-t", USAGE_TMUX, "/usage", "Enter")
    await asyncio.sleep(USAGE_CAPTURE_DELAY)

    raw = await _app._capture_tmux_pane_async(USAGE_TMUX, "-30")

    # "Loading usage data" 감지 시 재시도
    for _ in range(USAGE_LOADING_MAX_RETRIES):
        clean = ANSI_ESCAPE.sub('', raw)
        if 'Loading usage data' not in clean:
            break
        await asyncio.sleep(USAGE_LOADING_RETRY_DELAY)
        raw = await _app._capture_tmux_pane_async(USAGE_TMUX, "-30")

    _app.tmux_run("send-keys", "-t", USAGE_TMUX, "Escape", "")

    result = _app._parse_usage_output(raw)

    # 파싱 실패 시 다음 호출에서 세션 재생성
    if "session_used" not in result and "week_used" not in result:
        _app._usage_ready = False

    return result


@router.delete("/api/usage-session")
async def api_kill_usage_session() -> Dict[str, bool]:
    """전용 usage 세션을 수동으로 종료."""
    import backend.app as _app

    _app.kill_tmux_session(USAGE_TMUX)
    _app._usage_ready = False
    return {"ok": True}
