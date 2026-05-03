"""backend.parsers 모듈 테스트."""

import pytest

from backend.parsers import (
    strip_ansi,
    parse_token_count,
    format_tokens,
    parse_usage_from_output,
    detect_token_expiry,
    parse_log_entries,
    group_by_command,
    build_summary,
    extract_agent_status,
    extract_last_message,
    ansi_to_html,
)


# ---------------------------------------------------------------------------
# strip_ansi
# ---------------------------------------------------------------------------
class TestStripAnsi:
    def test_basic_color(self):
        assert strip_ansi("\x1b[31mhello\x1b[0m") == "hello"

    def test_complex_sequences(self):
        assert strip_ansi("\x1b[1;32;48;5;16mtext\x1b[0m") == "text"

    def test_osc_sequence(self):
        """OSC (Operating System Command) 시퀀스 제거."""
        assert strip_ansi("\x1b]0;title\x07rest") == "rest"

    def test_empty_string(self):
        assert strip_ansi("") == ""

    def test_no_ansi(self):
        assert strip_ansi("plain text") == "plain text"

    def test_mixed(self):
        assert strip_ansi("a\x1b[31mb\x1b[0mc") == "abc"

    def test_mode_set(self):
        """'\x1b(B' 같은 charset 전환 시퀀스 제거."""
        assert strip_ansi("\x1b(Bhello") == "hello"


# ---------------------------------------------------------------------------
# parse_token_count
# ---------------------------------------------------------------------------
class TestParseTokenCount:
    def test_k_suffix(self):
        assert parse_token_count("1.5k") == 1500

    def test_K_suffix(self):
        assert parse_token_count("1.5K") == 1500

    def test_m_suffix(self):
        assert parse_token_count("2M") == 2_000_000

    def test_m_lower(self):
        assert parse_token_count("2m") == 2_000_000

    def test_plain_number(self):
        assert parse_token_count("500") == 500

    def test_fractional_k(self):
        assert parse_token_count("0.5k") == 500

    def test_fractional_m(self):
        assert parse_token_count("1.5M") == 1_500_000

    def test_large_k(self):
        assert parse_token_count("15.2k") == 15200


# ---------------------------------------------------------------------------
# format_tokens
# ---------------------------------------------------------------------------
class TestFormatTokens:
    def test_millions(self):
        assert format_tokens(2_000_000) == "2.0M"

    def test_thousands(self):
        assert format_tokens(1500) == "1.5k"

    def test_small(self):
        assert format_tokens(500) == "500"

    def test_exact_thousand(self):
        assert format_tokens(1000) == "1.0k"

    def test_exact_million(self):
        assert format_tokens(1_000_000) == "1.0M"

    def test_zero(self):
        assert format_tokens(0) == "0"


# ---------------------------------------------------------------------------
# parse_usage_from_output
# ---------------------------------------------------------------------------
class TestParseUsageFromOutput:
    def test_progress_with_tokens(self):
        text = "✢ Reading… (5s · ↓ 10k tokens · cost)"
        result = parse_usage_from_output(text)
        assert result is not None
        assert result["tokens"] == 10000
        assert result["status"] == "working"

    def test_done_with_tools(self):
        text = "Done (3 tool uses · 15.2k tokens · 1m 30s)"
        result = parse_usage_from_output(text)
        assert result is not None
        assert result["toolUses"] == 3
        assert result["tokens"] == 15200
        assert result["time"] == "1m 30s"
        assert result["status"] == "done"

    def test_simple_done(self):
        text = "Done (5k tokens · 30s)"
        result = parse_usage_from_output(text)
        assert result is not None
        assert result["tokens"] == 5000
        assert result["time"] == "30s"
        assert result["status"] == "done"

    def test_no_match(self):
        assert parse_usage_from_output("hello world") is None

    def test_empty(self):
        assert parse_usage_from_output("") is None

    def test_progress_with_ansi(self):
        text = "\x1b[33m✢ Writing… (12s · ↓ 8.5k tokens · $0.01)\x1b[0m"
        result = parse_usage_from_output(text)
        assert result is not None
        assert result["tokens"] == 8500
        assert result["status"] == "working"

    def test_done_single_tool(self):
        text = "Done (1 tool use · 2k tokens · 5s)"
        result = parse_usage_from_output(text)
        assert result is not None
        assert result["toolUses"] == 1
        assert result["tokens"] == 2000

    def test_progress_variant_star(self):
        """다양한 star 문자(✳, ✶, ✽, ✻)도 매칭."""
        text = "✳ Analyzing… (3s · ↓ 1k tokens · cost)"
        result = parse_usage_from_output(text)
        assert result is not None
        assert result["tokens"] == 1000
        assert result["status"] == "working"


# ---------------------------------------------------------------------------
# detect_token_expiry
# ---------------------------------------------------------------------------
class TestDetectTokenExpiry:
    def test_rate_limit(self):
        assert detect_token_expiry("rate limit exceeded, retry in 30 seconds") == 30

    def test_retrying(self):
        assert detect_token_expiry("retrying in 60 seconds") == 60

    def test_timer_emoji(self):
        assert detect_token_expiry("⏳ 45") == 45

    def test_skip_user_input(self):
        """❯ 로 시작하는 사용자 입력 라인은 건너뛴다."""
        assert detect_token_expiry("❯ rate limit exceeded, retry in 30 seconds") == 0

    def test_skip_progress(self):
        """✢ 로 시작하는 진행 상태 라인은 건너뛴다."""
        assert detect_token_expiry("✢ retry in 30 seconds") == 0

    def test_too_short(self):
        """5초 미만은 무시."""
        assert detect_token_expiry("rate limit exceeded, retry in 3 seconds") == 0

    def test_too_long(self):
        """3600초 초과는 무시."""
        assert detect_token_expiry("rate limit exceeded, retry in 5000 seconds") == 0

    def test_session_expired(self):
        assert detect_token_expiry("session expired") == 60

    def test_token_expired(self):
        assert detect_token_expiry("token expired") == 60

    def test_no_match(self):
        assert detect_token_expiry("hello world") == 0

    def test_empty(self):
        assert detect_token_expiry("") == 0

    def test_multiline_skips_prompt(self):
        text = "❯ some command\nrate limit exceeded, retry in 20 seconds"
        assert detect_token_expiry(text) == 20

    def test_skip_thinking_star(self):
        """✻, ✳ 등 thinking 문자로 시작하는 라인도 건너뛴다."""
        assert detect_token_expiry("✻ retry in 30 seconds") == 0

    def test_boundary_5_seconds(self):
        """정확히 5초는 유효."""
        assert detect_token_expiry("rate limit exceeded, retry in 5 seconds") == 5

    def test_boundary_3600_seconds(self):
        """정확히 3600초는 유효."""
        assert detect_token_expiry("rate limit exceeded, retry in 3600 seconds") == 3600


# ---------------------------------------------------------------------------
# parse_log_entries
# ---------------------------------------------------------------------------
class TestParseLogEntries:
    def test_user_input(self):
        entries = parse_log_entries("❯ hello world")
        assert len(entries) == 1
        assert entries[0]["type"] == "user"
        assert entries[0]["text"] == "hello world"

    def test_thinking_block(self):
        entries = parse_log_entries("✻ Thinking about the problem...")
        assert len(entries) == 1
        assert entries[0]["type"] == "thinking"

    def test_tool_call(self):
        raw = "⏺ Bash(ls -la)\n  ⎿ total 42\n    file1.txt"
        entries = parse_log_entries(raw)
        tools = [e for e in entries if e["type"] == "tool"]
        assert len(tools) == 1
        assert "Bash" in tools[0]["name"]
        assert "total 42" in tools[0]["result"]

    def test_text_output(self):
        entries = parse_log_entries("⏺ Here is my response to your question.")
        texts = [e for e in entries if e["type"] == "text"]
        assert len(texts) == 1
        assert "response" in texts[0]["text"]

    def test_empty_input(self):
        assert parse_log_entries("") == []

    def test_skip_separator_lines(self):
        """구분선(─━)은 건너뛴다."""
        entries = parse_log_entries("──────────────")
        assert entries == []

    def test_skip_permission_notice(self):
        """bypass permissions 안내 라인은 건너뛴다."""
        entries = parse_log_entries("Press Shift+Tab to bypass permissions")
        assert entries == []

    def test_bare_prompt(self):
        """빈 프롬프트 '❯' 만 있는 경우 무시."""
        entries = parse_log_entries("❯")
        assert entries == []

    def test_result_line(self):
        entries = parse_log_entries("⎿ some result")
        assert len(entries) == 1
        assert entries[0]["type"] == "result"
        assert entries[0]["text"] == "some result"

    def test_mixed(self):
        raw = "❯ show files\n✻ Thinking...\n⏺ Bash(ls)\n  ⎿ file.txt\n⏺ Here are the files."
        entries = parse_log_entries(raw)
        types = [e["type"] for e in entries]
        assert "user" in types
        assert "thinking" in types
        assert "tool" in types
        assert "text" in types


# ---------------------------------------------------------------------------
# group_by_command
# ---------------------------------------------------------------------------
class TestGroupByCommand:
    def test_single_command(self):
        entries = [
            {"type": "user", "text": "hello"},
            {"type": "text", "text": "response"},
        ]
        groups = group_by_command(entries)
        assert len(groups) == 1
        assert groups[0]["command"] == "hello"
        assert len(groups[0]["items"]) == 1

    def test_multiple_commands(self):
        entries = [
            {"type": "user", "text": "cmd1"},
            {"type": "text", "text": "resp1"},
            {"type": "user", "text": "cmd2"},
            {"type": "tool", "name": "Bash(ls)", "result": "ok"},
        ]
        groups = group_by_command(entries)
        assert len(groups) == 2
        assert groups[0]["command"] == "cmd1"
        assert groups[1]["command"] == "cmd2"

    def test_orphan_entries(self):
        """user 없이 시작하는 항목은 command=None 그룹에 모인다."""
        entries = [
            {"type": "text", "text": "orphan"},
            {"type": "thinking", "text": "thinking"},
        ]
        groups = group_by_command(entries)
        assert len(groups) == 1
        assert groups[0]["command"] is None
        assert len(groups[0]["items"]) == 2

    def test_empty(self):
        assert group_by_command([]) == []


# ---------------------------------------------------------------------------
# build_summary
# ---------------------------------------------------------------------------
class TestBuildSummary:
    def test_tools_and_text(self):
        items = [
            {"type": "tool", "name": "Bash(ls)", "result": "ok"},
            {"type": "tool", "name": "Read(file)", "result": "content"},
            {"type": "text", "text": "Here is the result"},
        ]
        summary = build_summary(items)
        assert "2" in summary  # 2개 도구
        assert "Here is the result" in summary

    def test_only_tools(self):
        items = [{"type": "tool", "name": "Bash(ls)", "result": "ok"}]
        summary = build_summary(items)
        assert "1" in summary

    def test_only_text(self):
        items = [{"type": "text", "text": "Just a response"}]
        summary = build_summary(items)
        assert "Just a response" in summary

    def test_empty(self):
        summary = build_summary([])
        # 비어있으면 "(작업 내용 없음)" 반환
        assert summary != ""

    def test_long_text_truncated(self):
        items = [{"type": "text", "text": "A" * 100}]
        summary = build_summary(items)
        assert len(summary) < 100 or "..." in summary


# ---------------------------------------------------------------------------
# extract_agent_status
# ---------------------------------------------------------------------------
class TestExtractAgentStatus:
    def test_thinking_star(self):
        result = extract_agent_status("line1\n✻ deep thought\nlast")
        assert result["status"] == "thinking"

    def test_thinking_with_thought(self):
        result = extract_agent_status("✳ extended thought process")
        assert result["status"] == "thinking"

    def test_working_bash(self):
        result = extract_agent_status("Bash(npm install)")
        assert result["status"] == "working"
        assert "npm install" in result["message"]

    def test_working_read(self):
        result = extract_agent_status("Read file src/main.py")
        assert result["status"] == "working"

    def test_working_edit(self):
        result = extract_agent_status("Edit(src/main.py)")
        assert result["status"] == "working"

    def test_working_write(self):
        result = extract_agent_status("Write(output.txt)")
        assert result["status"] == "working"

    def test_working_grep(self):
        result = extract_agent_status("Grep pattern")
        assert result["status"] == "working"

    def test_working_glob(self):
        result = extract_agent_status("Glob **/*.py")
        assert result["status"] == "working"

    def test_working_agents(self):
        result = extract_agent_status("Running 3 agents in parallel")
        assert result["status"] == "working"

    def test_idle_prompt(self):
        result = extract_agent_status("❯")
        assert result["status"] == "idle"

    def test_idle_short_prompt(self):
        """짧은 프롬프트 '❯ ' 도 idle."""
        result = extract_agent_status("❯ ")
        assert result["status"] == "idle"

    def test_working_response_text(self):
        result = extract_agent_status("⏺ I'll help you with that task")
        assert result["status"] == "working"

    def test_empty(self):
        result = extract_agent_status("")
        assert result["status"] == "idle"

    def test_multiline_last_wins(self):
        """마지막 의미 있는 라인이 상태를 결정."""
        text = "✻ thinking\nBash(ls)\n❯"
        result = extract_agent_status(text)
        assert result["status"] == "idle"


# ---------------------------------------------------------------------------
# extract_last_message
# ---------------------------------------------------------------------------
class TestExtractLastMessage:
    def test_text_entry(self):
        raw = "❯ hello\n⏺ Here is my answer to your question."
        result = extract_last_message(raw)
        assert result is not None
        assert "answer" in result

    def test_tool_entry(self):
        raw = "⏺ Bash(ls -la)\n  ⎿ file.txt"
        result = extract_last_message(raw)
        assert result is not None
        assert "Bash" in result

    def test_empty(self):
        assert extract_last_message("") is None

    def test_only_user_input(self):
        """user 타입만 있으면 None (text/tool 없음)."""
        result = extract_last_message("❯ hello")
        assert result is None

    def test_long_message_truncated(self):
        raw = "⏺ " + "A" * 200
        result = extract_last_message(raw)
        assert result is not None
        assert len(result) <= 123  # 120 + "..."

    def test_short_text_skipped(self):
        """3자 이하 텍스트는 건너뛴다."""
        raw = "⏺ ok\n⏺ This is the real answer"
        result = extract_last_message(raw)
        assert result is not None
        assert "real answer" in result


# ---------------------------------------------------------------------------
# ansi_to_html
# ---------------------------------------------------------------------------
class TestAnsiToHtml:
    def test_red_text(self):
        html = ansi_to_html("\x1b[31mhello\x1b[0m")
        assert "color:" in html
        assert "hello" in html

    def test_bold(self):
        html = ansi_to_html("\x1b[1mtext\x1b[0m")
        assert "font-weight:bold" in html
        assert "text" in html

    def test_no_ansi(self):
        assert ansi_to_html("plain text") == "plain text"

    def test_empty(self):
        assert ansi_to_html("") == ""

    def test_html_entities_escaped(self):
        html = ansi_to_html("<script>alert('xss')</script>")
        assert "<script>" not in html
        assert "&lt;script&gt;" in html

    def test_ampersand_escaped(self):
        html = ansi_to_html("a & b")
        assert "&amp;" in html

    def test_dim(self):
        html = ansi_to_html("\x1b[2mdimmed\x1b[0m")
        assert "opacity:0.6" in html

    def test_italic(self):
        html = ansi_to_html("\x1b[3mitalic\x1b[0m")
        assert "font-style:italic" in html

    def test_underline(self):
        html = ansi_to_html("\x1b[4munderlined\x1b[0m")
        assert "text-decoration:underline" in html

    def test_256_color(self):
        html = ansi_to_html("\x1b[38;5;196mred\x1b[0m")
        assert "color:" in html
        assert "red" in html

    def test_bright_color(self):
        html = ansi_to_html("\x1b[91mbright red\x1b[0m")
        assert "color:" in html

    def test_newline_preserved(self):
        html = ansi_to_html("line1\nline2")
        assert "\n" in html
