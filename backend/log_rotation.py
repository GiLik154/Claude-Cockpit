"""로그 일별 회전 + 보관일수 기반 자동 삭제."""

import gzip
import logging
import os
import re
from datetime import date, datetime, timedelta
from typing import Tuple

from backend.constants import LOGS_DIR

logger = logging.getLogger(__name__)

# session_<id>.log.YYYY-MM-DD.gz
_ROTATED_RE = re.compile(r"^session_[A-Za-z0-9_-]+\.log\.(\d{4}-\d{2}-\d{2})\.gz$")


def _today() -> date:
    return datetime.now().date()


def _file_mtime_date(path: str) -> date:
    return datetime.fromtimestamp(os.path.getmtime(path)).date()


def _gzip_file(src: str, dst: str) -> None:
    with open(src, "rb") as f_in, gzip.open(dst, "wb") as f_out:
        while chunk := f_in.read(1024 * 1024):
            f_out.write(chunk)
    try:
        os.chmod(dst, 0o600)
    except OSError:
        pass


def rotate_active_logs() -> int:
    """활성 세션의 .log 중 마지막 수정일이 오늘 이전인 것을 회전. 회전 수 반환."""
    if not os.path.isdir(LOGS_DIR):
        return 0
    today = _today()
    rotated = 0
    for fname in os.listdir(LOGS_DIR):
        if not fname.endswith(".log"):
            continue
        path = os.path.join(LOGS_DIR, fname)
        try:
            if os.path.getsize(path) == 0:
                continue
            mtime_date = _file_mtime_date(path)
            if mtime_date >= today:
                continue
            stamp = mtime_date.isoformat()
            dst = f"{path}.{stamp}.gz"
            # 같은 이름 충돌 시 -1, -2 ...
            n = 1
            while os.path.exists(dst):
                dst = f"{path}.{stamp}-{n}.gz"
                n += 1
            _gzip_file(path, dst)
            # 회전 후 원본은 truncate (활성 WebSocket의 append fd가 없으므로 안전)
            with open(path, "w", encoding="utf-8"):
                pass
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
            rotated += 1
            logger.info("로그 회전: %s → %s", fname, os.path.basename(dst))
        except Exception:
            logger.exception("로그 회전 실패: %s", fname)
    return rotated


def purge_expired_logs(retention_days: int) -> int:
    """retention_days보다 오래된 .gz 파일을 삭제. 삭제 수 반환."""
    if retention_days <= 0:
        return 0
    if not os.path.isdir(LOGS_DIR):
        return 0
    cutoff = _today() - timedelta(days=retention_days)
    deleted = 0
    for fname in os.listdir(LOGS_DIR):
        path = os.path.join(LOGS_DIR, fname)
        try:
            stamp_date = _extract_stamp(fname)
            if stamp_date is None:
                # 파일명에 날짜가 없으면 mtime 기준
                if not fname.endswith(".gz"):
                    continue
                stamp_date = _file_mtime_date(path)
            if stamp_date < cutoff:
                os.remove(path)
                deleted += 1
                logger.info("로그 삭제(만료): %s", fname)
        except Exception:
            logger.exception("로그 삭제 실패: %s", fname)
    return deleted


def _extract_stamp(fname: str) -> "date | None":
    m = _ROTATED_RE.match(fname)
    if not m:
        return None
    try:
        return date.fromisoformat(m.group(1))
    except ValueError:
        return None


def run_rotation_cycle(retention_days: int) -> Tuple[int, int]:
    """회전 + 만료 삭제를 순차 실행. (rotated, deleted) 반환."""
    rotated = rotate_active_logs()
    deleted = purge_expired_logs(retention_days)
    return rotated, deleted
