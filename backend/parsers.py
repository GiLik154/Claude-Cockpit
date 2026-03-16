"""프론트엔드 JS 파서들의 Python 포팅. 테스트 가능하고 백엔드에서 재사용 가능."""

import re
from typing import Any, Dict, List, Optional

# strip_ansi: chat-core.js App.stripAnsi 와 동일
_ANSI_RE = re.compile(
    r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?[@-~]|\x1b\(B'
)


def strip_ansi(s: str) -> str:
    return _ANSI_RE.sub('', s)


# parse_token_count: chat-core.js App.parseTokenCount
def parse_token_count(s: str) -> int:
    num = float(re.match(r'[\d.]+', s).group())  # type: ignore[union-attr]
    if re.search(r'[kK]', s):
        return round(num * 1000)
    if re.search(r'[mM]', s):
        return round(num * 1_000_000)
    return round(num)


# format_tokens: chat-core.js App.formatTokens
def format_tokens(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1000:
        return f"{n / 1000:.1f}k"
    return str(n)


# parse_usage_from_output: chat-usage.js App.parseUsageFromOutput
_PROGRESS_RE = re.compile(
    r'[✢✳✶✽✻]\s*\S+…?\s*\(([^)]*?([\d.]+[kKmM]?)\s*tokens[^)]*)\)'
)
_DONE_TOOLS_RE = re.compile(
    r'Done\s*\((\d+)\s*tool\s*uses?\s*·\s*([\d.]+[kKmM]?)\s*tokens?\s*·\s*([^)]+)\)'
)
_DONE_SIMPLE_RE = re.compile(
    r'Done\s*\(([\d.]+[kKmM]?)\s*tokens?\s*·\s*([^)]+)\)'
)


def parse_usage_from_output(text: str) -> Optional[Dict[str, Any]]:
    clean = strip_ansi(text)

    m = _PROGRESS_RE.search(clean)
    if m:
        tokens = parse_token_count(m.group(2))
        time_m = re.match(r'^([\dm\s]+s)', m.group(1))
        return {
            'tokens': tokens,
            'time': time_m.group(1).strip() if time_m else '',
            'status': 'working',
        }

    m = _DONE_TOOLS_RE.search(clean)
    if m:
        return {
            'toolUses': int(m.group(1)),
            'tokens': parse_token_count(m.group(2)),
            'time': m.group(3).strip(),
            'status': 'done',
        }

    m = _DONE_SIMPLE_RE.search(clean)
    if m:
        return {
            'tokens': parse_token_count(m.group(1)),
            'time': m.group(2).strip(),
            'status': 'done',
        }

    return None


# detect_token_expiry: chat-usage.js App.detectTokenExpiry
TOKEN_EXPIRY_DEFAULT_SECS = 60

_EXPIRY_PATTERNS = [
    re.compile(r'(?:rate.?limit|token.?limit|too many requests).*?(\d+)\s*(?:second|sec|s\b|분)', re.I),
    re.compile(r'(?:retry|retrying|waiting).*?(\d+)\s*(?:second|sec|s\b|분)', re.I),
    re.compile(r'(\d+)\s*(?:second|sec|s\b|분).*?(?:retry|wait)', re.I),
    re.compile(r'⏳.*?(\d+)'),
]
_SKIP_LINE_RE = re.compile(r'^[❯✻✳✶✽✢⏺⎿]')
_SESSION_EXPIRED_RE = re.compile(
    r'(?:session.?expired|token.?expired|세션.*만료|토큰.*만료)', re.I
)


def detect_token_expiry(text: str) -> int:
    clean = strip_ansi(text)
    lines = clean.split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if _SKIP_LINE_RE.match(line):
            continue
        for pat in _EXPIRY_PATTERNS:
            m = pat.search(line)
            if m:
                secs = int(m.group(1))
                if secs < 5 or secs > 3600:
                    continue
                if '분' in line:
                    secs *= 60
                return secs
    if _SESSION_EXPIRED_RE.search(clean):
        return TOKEN_EXPIRY_DEFAULT_SECS
    return 0


# parse_log_entries: chat-log.js _parseEntries
_SEPARATOR_RE = re.compile(r'^[─━─]+')
_SKIP_NOTICE_RE = re.compile(r'bypass permissions|shift\+tab|esc to interrupt|Context left', re.I)
_THINKING_RE = re.compile(r'^[✻✳✶✽✢]')
_TOOL_RE = re.compile(r'^⏺\s*[\w][\w_]*(?:__[\w]+)*\s*\(')
_TOOL_NAME_RE = re.compile(r'^⏺\s*([\w][\w_]*(?:__[\w]+)*\s*\([^)]*\)?)')
_TEXT_START_RE = re.compile(r'^⏺\s')


def parse_log_entries(raw: str) -> List[Dict[str, Any]]:
    clean = strip_ansi(raw)
    lines = clean.split('\n')
    entries: List[Dict[str, Any]] = []
    i = 0

    while i < len(lines):
        line = lines[i]
        trimmed = line.strip()

        if not trimmed or _SEPARATOR_RE.match(trimmed) or trimmed.startswith('▪'):
            i += 1
            continue
        if _SKIP_NOTICE_RE.search(trimmed):
            i += 1
            continue

        # 사용자 입력
        if trimmed.startswith('❯ '):
            user_text = re.sub(r'^❯\s*', '', trimmed)
            if user_text:
                entries.append({'type': 'user', 'text': user_text})
            i += 1
            continue
        if trimmed == '❯':
            i += 1
            continue

        # 사고 중
        if _THINKING_RE.match(trimmed):
            entries.append({'type': 'thinking', 'text': trimmed})
            i += 1
            continue

        # 도구 호출
        if _TOOL_RE.match(trimmed):
            name_m = _TOOL_NAME_RE.match(trimmed)
            tool_name = name_m.group(1) if name_m else re.sub(r'^⏺\s*', '', trimmed)
            i += 1
            result_lines: List[str] = []
            while i < len(lines):
                rl = lines[i]
                rt = rl.strip()
                if rt.startswith('⎿'):
                    result_lines.append(re.sub(r'^⎿\s*', '', rt))
                    i += 1
                elif re.match(r'^\s{2,}', rl) and rt and not rt.startswith('⏺') and not rt.startswith('❯') and not _THINKING_RE.match(rt):
                    result_lines.append(rt)
                    i += 1
                else:
                    break
            entries.append({'type': 'tool', 'name': tool_name, 'result': '\n'.join(result_lines)})
            continue

        # Claude 응답 텍스트
        if _TEXT_START_RE.match(trimmed):
            text_lines = [re.sub(r'^⏺\s*', '', trimmed)]
            i += 1
            while i < len(lines):
                cl = lines[i]
                ct = cl.strip()
                if ct.startswith('⏺') or ct.startswith('❯') or _THINKING_RE.match(ct) or re.match(r'^[─━]+', ct) or ct.startswith('⎿'):
                    break
                if not ct:
                    if i + 1 < len(lines):
                        nxt = lines[i + 1].strip()
                        if nxt and not nxt.startswith('⏺') and not nxt.startswith('❯') and not _THINKING_RE.match(nxt) and not re.match(r'^[─━]+', nxt):
                            text_lines.append('')
                            i += 1
                            continue
                    break
                text_lines.append(ct)
                i += 1
            entries.append({'type': 'text', 'text': '\n'.join(text_lines)})
            continue

        # 도구 없는 결과 라인
        if trimmed.startswith('⎿'):
            entries.append({'type': 'result', 'text': re.sub(r'^⎿\s*', '', trimmed)})
            i += 1
            continue

        entries.append({'type': 'text', 'text': trimmed})
        i += 1

    return entries


# group_by_command: chat-log.js _groupByCommand
def group_by_command(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    groups: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    for e in entries:
        if e['type'] == 'user':
            current = {'command': e['text'], 'items': []}
            groups.append(current)
        else:
            if current is None:
                current = {'command': None, 'items': []}
                groups.append(current)
            current['items'].append(e)

    return groups


# build_summary: chat-log.js _buildSummary
def build_summary(items: List[Dict[str, Any]]) -> str:
    tools = sum(1 for it in items if it.get('type') == 'tool')
    response = ''
    for it in items:
        if it.get('type') == 'text' and not response:
            response = it['text'].split('\n')[0]
            if len(response) > 80:
                response = response[:77] + '...'

    parts: List[str] = []
    if tools > 0:
        parts.append(f'\U0001f527 {tools}개 도구')
    if response:
        parts.append(f'\U0001f4ac {response}')

    return ' · '.join(parts) or '(작업 내용 없음)'


# extract_agent_status: chat-panes.js App.extractStatus
PANE_SCAN_LINES = 20
STATUS_MSG_TRUNCATE = 50


def extract_agent_status(capture_text: str) -> Dict[str, str]:
    lines = [
        strip_ansi(l).strip()
        for l in capture_text.split('\n')
    ]
    lines = [l for l in lines if l]

    start = max(0, len(lines) - PANE_SCAN_LINES)
    for i in range(len(lines) - 1, start - 1, -1):
        l = lines[i]
        if re.match(r'^[✻✳].*thought', l, re.I):
            return {'status': 'thinking', 'message': '깊이 생각하는 중...'}
        if re.match(r'^[✻✳]', l):
            return {'status': 'thinking', 'message': '생각하는 중...'}
        if 'Bash(' in l:
            m = re.search(r'Bash\(([^)]{0,50})', l)
            return {'status': 'working', 'message': '실행: ' + (m.group(1) if m else '명령어')}
        if 'Read' in l and 'file' in l:
            return {'status': 'working', 'message': '파일 읽는 중...'}
        if 'Edit(' in l or 'Edit ' in l:
            return {'status': 'working', 'message': '코드 수정 중...'}
        if 'Write(' in l or 'Write ' in l:
            return {'status': 'working', 'message': '파일 작성 중...'}
        if re.search(r'Running \d+ agents', l):
            return {'status': 'working', 'message': '에이전트 실행 중...'}
        if re.search(r'Grep|Glob', l):
            return {'status': 'working', 'message': '코드 검색 중...'}
        if l.startswith('❯') and len(l) < 5:
            return {'status': 'idle', 'message': '대기 중'}
        if l.startswith('⏺ ') and '⎿' not in l:
            msg = re.sub(r'^⏺\s*', '', l)[:STATUS_MSG_TRUNCATE]
            if len(msg) > 3:
                return {'status': 'working', 'message': msg}

    return {'status': 'idle', 'message': '시작 대기 중...'}


# extract_last_message: chat-group-chat.js _extractLastMessage
def extract_last_message(raw: str) -> Optional[str]:
    entries = parse_log_entries(raw)
    for i in range(len(entries) - 1, -1, -1):
        e = entries[i]
        if e['type'] == 'text' and e.get('text') and len(e['text']) > 3:
            msg = e['text'].split('\n')[0]
            if len(msg) > 120:
                msg = msg[:117] + '...'
            return msg
        if e['type'] == 'tool':
            return '\U0001f527 ' + (e.get('name') or '도구 실행 중')
    return None


# ansi_to_html: chat-log.js App.ansiToHtml
# 터미널 테마 색상 (chat-core.js TERMINAL_THEME)
_C8 = ['#1a1a2e', '#e74c3c', '#2ecc71', '#f39c12', '#4f8cff', '#9b59b6', '#1abc9c', '#ecf0f1']
_B8 = ['#686868', '#ff5555', '#55ff55', '#ffff55', '#5555ff', '#ff55ff', '#55ffff', '#ffffff']


def _color_256(n: int) -> str:
    if n < 8:
        return _C8[n]
    if n < 16:
        return _B8[n - 8]
    if n < 232:
        n -= 16
        r = (n // 36) * 51
        g = ((n % 36) // 6) * 51
        b = (n % 6) * 51
        return f'rgb({r},{g},{b})'
    g = (n - 232) * 10 + 8
    return f'rgb({g},{g},{g})'


def ansi_to_html(raw: str) -> str:
    fg = None
    bg = None
    bold = False
    dim = False
    italic = False
    ul = False
    result: List[str] = []
    span_open = False

    def _emit() -> None:
        nonlocal span_open
        if span_open:
            result.append('</span>')
        styles: List[str] = []
        if fg:
            styles.append(f'color:{fg}')
        if bg:
            styles.append(f'background:{bg}')
        if bold:
            styles.append('font-weight:bold')
        if dim:
            styles.append('opacity:0.6')
        if italic:
            styles.append('font-style:italic')
        if ul:
            styles.append('text-decoration:underline')
        if styles:
            result.append(f'<span style="{";".join(styles)}">')
        else:
            result.append('<span>')
        span_open = True

    i = 0
    while i < len(raw):
        if raw[i] == '\x1b' and i + 1 < len(raw) and raw[i + 1] == '[':
            j = i + 2
            while j < len(raw) and not re.match(r'[A-Za-z~]', raw[j]):
                j += 1
            if j < len(raw) and raw[j] == 'm':
                params_str = raw[i + 2:j]
                ps = [int(x) if x else 0 for x in params_str.split(';')]
                k = 0
                while k < len(ps):
                    p = ps[k]
                    if p == 0:
                        fg = bg = None
                        bold = dim = italic = ul = False
                    elif p == 1:
                        bold = True
                    elif p == 2:
                        dim = True
                    elif p == 3:
                        italic = True
                    elif p == 4:
                        ul = True
                    elif p == 22:
                        bold = False
                        dim = False
                    elif p == 23:
                        italic = False
                    elif p == 24:
                        ul = False
                    elif 30 <= p <= 37:
                        fg = _B8[p - 30] if bold else _C8[p - 30]
                    elif p == 38 and k + 1 < len(ps) and ps[k + 1] == 5:
                        k += 2
                        if k < len(ps):
                            fg = _color_256(ps[k])
                    elif p == 38 and k + 1 < len(ps) and ps[k + 1] == 2:
                        _r = max(0, min(255, ps[k + 2] if k + 2 < len(ps) else 0))
                        _g = max(0, min(255, ps[k + 3] if k + 3 < len(ps) else 0))
                        _b = max(0, min(255, ps[k + 4] if k + 4 < len(ps) else 0))
                        fg = f'rgb({_r},{_g},{_b})'
                        k += 4
                    elif p == 39:
                        fg = None
                    elif 40 <= p <= 47:
                        bg = _C8[p - 40]
                    elif p == 48 and k + 1 < len(ps) and ps[k + 1] == 5:
                        k += 2
                        if k < len(ps):
                            bg = _color_256(ps[k])
                    elif p == 48 and k + 1 < len(ps) and ps[k + 1] == 2:
                        _r = max(0, min(255, ps[k + 2] if k + 2 < len(ps) else 0))
                        _g = max(0, min(255, ps[k + 3] if k + 3 < len(ps) else 0))
                        _b = max(0, min(255, ps[k + 4] if k + 4 < len(ps) else 0))
                        bg = f'rgb({_r},{_g},{_b})'
                        k += 4
                    elif p == 49:
                        bg = None
                    elif 90 <= p <= 97:
                        fg = _B8[p - 90]
                    elif 100 <= p <= 107:
                        bg = _B8[p - 100]
                    k += 1
                _emit()
            i = j + 1
        elif raw[i] == '\x1b':
            # 기타 이스케이프 시퀀스 건너뛰기
            j = i + 1
            while j < len(raw) and not re.match(r'[a-zA-Z~]', raw[j]):
                j += 1
            i = j + 1
        else:
            ch = raw[i]
            if ch == '<':
                result.append('&lt;')
            elif ch == '>':
                result.append('&gt;')
            elif ch == '&':
                result.append('&amp;')
            elif ch == '\n':
                result.append('\n')
            else:
                result.append(ch)
            i += 1

    if span_open:
        result.append('</span>')
    return ''.join(result)
