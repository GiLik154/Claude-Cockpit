"""로그 API 라우트."""

import os

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from backend.constants import MAX_LOG_TAIL_LINES

router = APIRouter()


@router.get("/api/sessions/{session_id}/logs")
async def api_get_logs(session_id: str, tail: int = 200) -> PlainTextResponse:
    """세션 로그 파일의 마지막 tail줄을 반환."""
    import backend.app as _app

    _app._validate_session_id(session_id)
    tail = min(max(tail, 1), MAX_LOG_TAIL_LINES)
    path = _app.get_log_path(session_id)
    if not os.path.exists(path):
        return PlainTextResponse("")
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    return PlainTextResponse("".join(lines[-tail:]))
