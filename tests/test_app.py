"""backend/app.py 헬퍼 함수 단위 테스트."""

import json
import os
import asyncio
from unittest.mock import patch, MagicMock

import pytest
from fastapi import HTTPException

from backend.app import (
    _cleanup_zombie_sessions,
    _clean_env,
    _is_trust_dialog,
    _parse_usage_output,
    _resolve_preset_cmd,
    _validate_pane_id,
    _validate_session_id,
    append_log,
    get_log_path,
    load_session_meta,
    save_session_meta,
    load_recent_sessions,
    save_recent_sessions,
    add_recent_session,
    load_group_meta,
    save_group_meta,
)
from backend.constants import PREFIX


# --- 유효성 검사 ---


class TestValidateSessionId:
    def test_valid_ids(self):
        for sid in ("1", "abc", "my-session", "test_123", "A-Z_0"):
            _validate_session_id(sid)  # 예외 없으면 통과

    def test_invalid_ids(self):
        for sid in ("", "../etc", "a b", "foo;bar", "id\nline"):
            with pytest.raises(HTTPException) as exc:
                _validate_session_id(sid)
            assert exc.value.status_code == 400


class TestValidatePaneId:
    def test_valid(self):
        for pid in ("%0", "%1", "%123"):
            _validate_pane_id(pid)

    def test_invalid(self):
        for pid in ("", "0", "%", "%%0", "%abc", "% 1"):
            with pytest.raises(HTTPException) as exc:
                _validate_pane_id(pid)
            assert exc.value.status_code == 400


# --- 환경변수 ---


class TestCleanEnv:
    def test_removes_sensitive_keys(self):
        fake_env = {
            "HOME": "/home/user",
            "ANTHROPIC_API_KEY": "secret",
            "OPENAI_API_KEY": "secret2",
            "CLAUDECODE_FOO": "bar",
            "CLAUDE_CODE_ENTRY_X": "y",
            "PATH": "/usr/bin",
        }
        with patch.dict(os.environ, fake_env, clear=True):
            cleaned = _clean_env()
        assert "HOME" in cleaned
        assert "PATH" in cleaned
        assert "ANTHROPIC_API_KEY" not in cleaned
        assert "OPENAI_API_KEY" not in cleaned
        assert "CLAUDECODE_FOO" not in cleaned
        assert "CLAUDE_CODE_ENTRY_X" not in cleaned


# --- 로그 ---


class TestAppendLog:
    def test_writes_log(self, tmp_path):
        with patch("backend.app.LOGS_DIR", str(tmp_path)):
            append_log("test1", "in", "hello world")
            path = os.path.join(str(tmp_path), "session_test1.log")
            assert os.path.exists(path)
            content = open(path).read()
            assert ">>> hello world" in content

    def test_skips_empty(self, tmp_path):
        with patch("backend.app.LOGS_DIR", str(tmp_path)):
            append_log("test2", "out", "   \n  ")
            path = os.path.join(str(tmp_path), "session_test2.log")
            assert not os.path.exists(path)

    def test_strips_ansi(self, tmp_path):
        with patch("backend.app.LOGS_DIR", str(tmp_path)):
            append_log("test3", "out", "\x1b[31mred text\x1b[0m")
            path = os.path.join(str(tmp_path), "session_test3.log")
            content = open(path).read()
            assert "\x1b[31m" not in content
            assert "red text" in content


# --- 세션 메타데이터 ---


class TestSessionMeta:
    def test_load_empty(self, tmp_path):
        fake_path = str(tmp_path / "sessions.json")
        with patch("backend.app.SESSIONS_FILE", fake_path):
            assert load_session_meta() == {}

    def test_save_and_load(self, tmp_path):
        fake_path = str(tmp_path / "sessions.json")
        with patch("backend.app.SESSIONS_FILE", fake_path), \
             patch("backend.app.STORAGE_DIR", str(tmp_path)):
            meta = {"1": {"name": "test", "cwd": "/tmp"}}
            save_session_meta(meta)
            loaded = load_session_meta()
            assert loaded == meta

    def test_load_corrupted(self, tmp_path):
        fake_path = str(tmp_path / "sessions.json")
        with open(fake_path, "w") as f:
            f.write("{invalid json")
        with patch("backend.app.SESSIONS_FILE", fake_path):
            assert load_session_meta() == {}


class TestRecentSessions:
    def test_load_empty(self, tmp_path):
        fake_path = str(tmp_path / "recent.json")
        with patch("backend.app.RECENT_SESSIONS_FILE", fake_path):
            assert load_recent_sessions() == []

    def test_save_and_load(self, tmp_path):
        fake_path = str(tmp_path / "recent.json")
        with patch("backend.app.RECENT_SESSIONS_FILE", fake_path), \
             patch("backend.app.STORAGE_DIR", str(tmp_path)):
            data = [{"original_id": "1", "name": "test"}]
            save_recent_sessions(data)
            assert load_recent_sessions() == data

    def test_load_corrupted(self, tmp_path):
        fake_path = str(tmp_path / "recent.json")
        with open(fake_path, "w") as f:
            f.write("not json")
        with patch("backend.app.RECENT_SESSIONS_FILE", fake_path):
            assert load_recent_sessions() == []


class TestAddRecentSession:
    def test_adds_entry(self, tmp_path):
        fake_path = str(tmp_path / "recent.json")
        with patch("backend.app.RECENT_SESSIONS_FILE", fake_path), \
             patch("backend.app.STORAGE_DIR", str(tmp_path)), \
             patch("backend.app.LOGS_DIR", str(tmp_path)):
            add_recent_session("5", {"name": "코인", "cwd": "/tmp/coin", "preset": "both", "model": "opus"})
            recent = load_recent_sessions()
            assert len(recent) == 1
            assert recent[0]["original_id"] == "5"
            assert recent[0]["name"] == "코인"

    def test_replaces_duplicate(self, tmp_path):
        fake_path = str(tmp_path / "recent.json")
        with patch("backend.app.RECENT_SESSIONS_FILE", fake_path), \
             patch("backend.app.STORAGE_DIR", str(tmp_path)), \
             patch("backend.app.LOGS_DIR", str(tmp_path)):
            add_recent_session("1", {"name": "a", "cwd": "/x"})
            add_recent_session("2", {"name": "a", "cwd": "/x"})
            recent = load_recent_sessions()
            assert len(recent) == 1
            assert recent[0]["original_id"] == "2"


class TestGroupMeta:
    def test_load_empty(self, tmp_path):
        fake_path = str(tmp_path / "groups.json")
        with patch("backend.app.GROUPS_FILE", fake_path):
            assert load_group_meta() == {}

    def test_load_corrupted(self, tmp_path):
        fake_path = str(tmp_path / "groups.json")
        with open(fake_path, "w") as f:
            f.write("broken")
        with patch("backend.app.GROUPS_FILE", fake_path):
            assert load_group_meta() == {}


# --- Usage 출력 파서 ---


class TestParseUsageOutput:
    def test_full_output(self):
        text = (
            "Current session                          42% used\n"
            "Current week (all models)                15% used\n"
            "Current week (Sonnet only)               10% used\n"
            "Resets in 3 days\n"
        )
        result = _parse_usage_output(text)
        assert result["session_used"] == 42
        assert result["week_used"] == 15
        assert result["sonnet_used"] == 10
        assert result["resets"] == "in 3 days"

    def test_partial_output(self):
        result = _parse_usage_output("Current session  80% used\n")
        assert result["session_used"] == 80
        assert "week_used" not in result

    def test_empty(self):
        result = _parse_usage_output("")
        assert "session_used" not in result
        assert result["raw"] == ""

    def test_strips_ansi(self):
        text = "\x1b[32mCurrent session  50% used\x1b[0m"
        result = _parse_usage_output(text)
        assert result["session_used"] == 50


# --- trust 다이얼로그 ---


class TestIsTrustDialog:
    def test_safety_check(self):
        assert _is_trust_dialog("Do you want to trust? Safety check required")

    def test_trust_folder(self):
        assert _is_trust_dialog("❯ 1. Yes, I trust this folder")

    def test_normal_prompt(self):
        assert not _is_trust_dialog("❯ help me fix this bug")

    def test_empty(self):
        assert not _is_trust_dialog("")


# --- 프리셋 명령어 ---


class TestResolvePresetCmd:
    def test_default(self):
        cmd = _resolve_preset_cmd("default")
        assert cmd == ["claude"]

    def test_with_model(self):
        cmd = _resolve_preset_cmd("default", "opus")
        assert cmd == ["claude", "--model", "opus"]

    def test_auto_model_no_flag(self):
        cmd = _resolve_preset_cmd("default", "auto")
        assert "--model" not in cmd

    def test_both_preset(self):
        cmd = _resolve_preset_cmd("both")
        assert "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1" in cmd
        assert "--dangerously-skip-permissions" in cmd

    def test_unknown_preset_falls_back(self):
        cmd = _resolve_preset_cmd("nonexistent")
        assert cmd == ["claude"]


# --- 좀비 세션 정리 ---


class TestCleanupZombieSessions:
    def test_kills_orphans(self):
        meta = {"1": {"name": "a"}, "2": {"name": "b"}}
        alive = [f"{PREFIX}1", f"{PREFIX}2", f"{PREFIX}99", f"{PREFIX}100"]
        with patch("backend.app.load_session_meta", return_value=meta), \
             patch("backend.app.list_tmux_sessions", return_value=alive), \
             patch("backend.app.kill_tmux_session") as mock_kill:
            killed = _cleanup_zombie_sessions()
        assert killed == 2
        mock_kill.assert_any_call(f"{PREFIX}99")
        mock_kill.assert_any_call(f"{PREFIX}100")

    def test_no_orphans(self):
        meta = {"1": {"name": "a"}}
        alive = [f"{PREFIX}1"]
        with patch("backend.app.load_session_meta", return_value=meta), \
             patch("backend.app.list_tmux_sessions", return_value=alive), \
             patch("backend.app.kill_tmux_session") as mock_kill:
            killed = _cleanup_zombie_sessions()
        assert killed == 0
        mock_kill.assert_not_called()

    def test_no_sessions(self):
        with patch("backend.app.load_session_meta", return_value={}), \
             patch("backend.app.list_tmux_sessions", return_value=[]), \
             patch("backend.app.kill_tmux_session") as mock_kill:
            killed = _cleanup_zombie_sessions()
        assert killed == 0
        mock_kill.assert_not_called()

    def test_all_orphans(self):
        with patch("backend.app.load_session_meta", return_value={}), \
             patch("backend.app.list_tmux_sessions", return_value=[f"{PREFIX}5"]), \
             patch("backend.app.kill_tmux_session") as mock_kill:
            killed = _cleanup_zombie_sessions()
        assert killed == 1
        mock_kill.assert_called_once_with(f"{PREFIX}5")
