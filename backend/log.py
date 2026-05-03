"""로그 API 라우트."""

import gzip
import os
import re
from collections import deque
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from backend import parsers
from backend.constants import LOGS_DIR, MAX_LOG_TAIL_LINES, MAX_PARSE_LOG_TEXT

router = APIRouter()


def _collect_session_log_files(session_id: str) -> List[str]:
    """세션의 회전된 .gz 파일 + 현재 .log 파일을 시간 순으로 반환."""
    files: List[str] = []
    if not os.path.isdir(LOGS_DIR):
        return files
    base = f"session_{session_id}.log"
    rotated_re = re.compile(rf"^{re.escape(base)}\.(\d{{4}}-\d{{2}}-\d{{2}})(?:-\d+)?\.gz$")
    rotated: List[tuple[str, str]] = []
    for fname in os.listdir(LOGS_DIR):
        m = rotated_re.match(fname)
        if m:
            rotated.append((m.group(1), fname))
    rotated.sort()
    for _, fname in rotated:
        files.append(os.path.join(LOGS_DIR, fname))
    # 통째 압축본 (구버전)
    legacy_gz = os.path.join(LOGS_DIR, base + ".gz")
    if os.path.exists(legacy_gz):
        files.append(legacy_gz)
    current = os.path.join(LOGS_DIR, base)
    if os.path.exists(current):
        files.append(current)
    return files


def _read_tail(path: str, tail: int) -> List[str]:
    """대용량 파일에서도 메모리 부담 없이 마지막 tail줄을 읽음."""
    opener = gzip.open if path.endswith(".gz") else open
    dq: deque = deque(maxlen=tail)
    with opener(path, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            dq.append(line)
    return list(dq)


@router.get("/api/sessions/{session_id}/logs")
async def api_get_logs(session_id: str, tail: int = 200) -> PlainTextResponse:
    """세션 로그 파일(회전본 포함)의 마지막 tail줄을 반환."""
    import backend.app as _app

    _app._validate_session_id(session_id)
    tail = min(max(tail, 1), MAX_LOG_TAIL_LINES)
    files = _collect_session_log_files(session_id)
    if not files:
        return PlainTextResponse("")
    # 최근 파일부터 거꾸로 채워 tail줄을 모음
    collected: List[str] = []
    remaining = tail
    for path in reversed(files):
        try:
            lines = _read_tail(path, remaining)
        except OSError:
            continue
        collected = lines + collected
        remaining = tail - len(collected)
        if remaining <= 0:
            break
    return PlainTextResponse("".join(collected[-tail:]))


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
