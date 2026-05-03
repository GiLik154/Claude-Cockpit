"""로그 API 라우트."""

import gzip
import os
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from backend import parsers
from backend.constants import MAX_LOG_TAIL_LINES, MAX_PARSE_LOG_TEXT

router = APIRouter()


@router.get("/api/sessions/{session_id}/logs")
async def api_get_logs(session_id: str, tail: int = 200) -> PlainTextResponse:
    """세션 로그 파일의 마지막 tail줄을 반환."""
    import backend.app as _app

    _app._validate_session_id(session_id)
    tail = min(max(tail, 1), MAX_LOG_TAIL_LINES)
    path = _app.get_log_path(session_id)
    gz_path = path + ".gz"
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    elif os.path.exists(gz_path):
        with gzip.open(gz_path, "rt", encoding="utf-8") as f:
            lines = f.readlines()
    else:
        return PlainTextResponse("")
    return PlainTextResponse("".join(lines[-tail:]))


@router.post("/api/parse-log")
async def api_parse_log(body: Dict[str, Any]) -> Dict[str, Any]:
    """로그 텍스트를 구조화된 엔트리로 파싱."""
    text = body.get("text", "")
    if len(text) > MAX_PARSE_LOG_TEXT:
        raise HTTPException(
            status_code=413,
            detail=f"로그가 너무 큽니다 (최대 {MAX_PARSE_LOG_TEXT // (1024 * 1024)}MB)",
        )
    entries = parsers.parse_log_entries(text)
    groups = parsers.group_by_command(entries)
    return {
        "entries": entries,
        "groups": [
            {
                "command": g["command"],
                "entries": g["items"],
                "summary": parsers.build_summary(g["items"]),
            }
            for g in groups
        ],
    }
