"""사용자 설정 (storage/settings.json) 로드/저장 + API."""

import json
import logging
import os
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from backend.constants import STORAGE_DIR

logger = logging.getLogger(__name__)

SETTINGS_FILE = os.path.join(STORAGE_DIR, "settings.json")

DEFAULT_SETTINGS: Dict[str, Any] = {
    "log_retention_days": 7,
}

LOG_RETENTION_MIN = 1
LOG_RETENTION_MAX = 90

router = APIRouter()


def load_settings() -> Dict[str, Any]:
    data: Dict[str, Any] = {}
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f) or {}
        except (json.JSONDecodeError, ValueError, OSError):
            logger.warning("settings.json 파싱 실패, 기본값 사용")
            data = {}
    merged = {**DEFAULT_SETTINGS, **data}
    merged["log_retention_days"] = _clamp_retention(merged.get("log_retention_days"))
    return merged


def save_settings(data: Dict[str, Any]) -> None:
    os.makedirs(STORAGE_DIR, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    try:
        os.chmod(SETTINGS_FILE, 0o600)
    except OSError:
        pass


def get_log_retention_days() -> int:
    return _clamp_retention(load_settings().get("log_retention_days"))


def _clamp_retention(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return DEFAULT_SETTINGS["log_retention_days"]
    return max(LOG_RETENTION_MIN, min(LOG_RETENTION_MAX, n))


@router.get("/api/settings")
async def api_get_settings() -> Dict[str, Any]:
    return load_settings()


@router.put("/api/settings")
async def api_update_settings(body: Dict[str, Any]) -> Dict[str, Any]:
    current = load_settings()
    if "log_retention_days" in body:
        current["log_retention_days"] = _clamp_retention(body["log_retention_days"])
    save_settings(current)
    return current


@router.post("/api/logs/cleanup")
async def api_cleanup_logs() -> Dict[str, Any]:
    """수동 회전 + 만료 삭제 트리거."""
    from backend.log_rotation import run_rotation_cycle

    retention = get_log_retention_days()
    rotated, deleted = run_rotation_cycle(retention)
    return {
        "rotated": rotated,
        "deleted": deleted,
        "retention_days": retention,
    }


@router.get("/api/logs/stats")
async def api_log_stats() -> Dict[str, Any]:
    """로그 디렉토리 사용량 통계."""
    from backend.constants import LOGS_DIR

    if not os.path.isdir(LOGS_DIR):
        return {"file_count": 0, "total_bytes": 0}
    total = 0
    count = 0
    for fname in os.listdir(LOGS_DIR):
        path = os.path.join(LOGS_DIR, fname)
        try:
            if not os.path.isfile(path):
                continue
            total += os.path.getsize(path)
            count += 1
        except OSError:
            continue
    return {"file_count": count, "total_bytes": total}
