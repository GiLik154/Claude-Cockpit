/**
 * chat-utils.js — Pure utility functions extracted for testability (ES module).
 *
 * These functions are duplicated in the IIFE-based module files (chat-core.js, etc.)
 * to keep the non-module <script> loading intact. Any logic changes should be synced
 * in both places.
 *
 * This file is NOT loaded in index.html — it exists solely for vitest imports.
 */

/**
 * Strip ANSI escape sequences from a string.
 */
export function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?[@-~]|\x1b\(B/g, '');
}

/**
 * Parse a token count string like "3.2k" → 3200, "1.5M" → 1500000, "500" → 500.
 */
export function parseTokenCount(str) {
    const num = parseFloat(str);
    if (/[kK]/.test(str)) return Math.round(num * 1000);
    if (/[mM]/.test(str)) return Math.round(num * 1000000);
    return Math.round(num);
}

/**
 * Format a token number: 1000 → "1.0k", 1500000 → "1.5M", 500 → "500".
 */
export function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
}

/**
 * Parse CLI output for token usage information.
 * Returns { tokens, toolUses?, time?, status } or null.
 */
export function parseUsageFromOutput(text) {
    const clean = stripAnsi(text);

    // Pattern 1: In-progress "✢ Verb… (Xs · ↓ N tokens · ...)" or "↑N tokens"
    const progressMatch = clean.match(/[✢✳✶✽✻]\s*\S+…?\s*\(([^)]*?(\d+[\d.]*[kKmM]?)\s*tokens[^)]*)\)/);
    if (progressMatch) {
        const tokenStr = progressMatch[2];
        const tokens = parseTokenCount(tokenStr);
        const timeMatch = progressMatch[1].match(/^([\dm\s]+s)/);
        return { tokens, time: timeMatch ? timeMatch[1].trim() : '', status: 'working' };
    }

    // Pattern 2: Done "(N tool uses · N tokens · Xs)"
    const doneMatch = clean.match(/Done\s*\((\d+)\s*tool\s*uses?\s*·\s*([\d.]+[kKmM]?)\s*tokens?\s*·\s*([^)]+)\)/);
    if (doneMatch) {
        return {
            toolUses: parseInt(doneMatch[1]),
            tokens: parseTokenCount(doneMatch[2]),
            time: doneMatch[3].trim(),
            status: 'done'
        };
    }

    // Pattern 3: Simple done "(N tokens · Xs)"
    const simpleDone = clean.match(/Done\s*\(([\d.]+[kKmM]?)\s*tokens?\s*·\s*([^)]+)\)/);
    if (simpleDone) {
        return {
            tokens: parseTokenCount(simpleDone[1]),
            time: simpleDone[2].trim(),
            status: 'done'
        };
    }

    return null;
}

/**
 * Detect token/rate limit expiry from CLI output.
 * Returns wait seconds (>0 if detected, 0 otherwise).
 */
export function detectTokenExpiry(text) {
    const patterns = [
        /(?:rate.?limit|token.?limit|too many requests).*?(\d+)\s*(?:second|sec|s\b|분)/i,
        /(?:retry|retrying|waiting|재시도|대기).*?(\d+)\s*(?:second|sec|s\b|분)/i,
        /(\d+)\s*(?:second|sec|s\b|분).*?(?:retry|wait|대기|재시도)/i,
        /⏳.*?(\d+)/,
    ];
    for (const pat of patterns) {
        const m = text.match(pat);
        if (m) {
            let secs = parseInt(m[1], 10);
            if (text.includes('분')) secs *= 60;
            return secs;
        }
    }
    if (/(?:session.?expired|token.?expired|세션.*만료|토큰.*만료)/i.test(text)) {
        return 60;
    }
    return 0;
}

/**
 * Extract agent status from tmux capture text.
 * Returns { s: 'thinking'|'working'|'idle', t: string }.
 */
export function extractStatus(captureText) {
    const lines = captureText.split('\n').map(l =>
        l.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?[@-~]/g, '').trim()
    ).filter(Boolean);
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
        const l = lines[i];
        if (l.match(/^[✻✳].*thought/i)) return { s: 'thinking', t: '깊이 생각하는 중...' };
        if (l.match(/^[✻✳]/)) return { s: 'thinking', t: '생각하는 중...' };
        if (l.includes('Bash(')) { const m = l.match(/Bash\(([^)]{0,50})/); return { s: 'working', t: `실행: ${m?.[1] || '명령어'}` }; }
        if (l.includes('Read') && l.includes('file')) return { s: 'working', t: '파일 읽는 중...' };
        if (l.includes('Edit(') || l.includes('Edit ')) return { s: 'working', t: '코드 수정 중...' };
        if (l.includes('Write(') || l.includes('Write ')) return { s: 'working', t: '파일 작성 중...' };
        if (l.match(/Running \d+ agents/)) return { s: 'working', t: '에이전트 실행 중...' };
        if (l.match(/Grep|Glob/)) return { s: 'working', t: '코드 검색 중...' };
        if (l.startsWith('❯') && l.length < 5) return { s: 'idle', t: '대기 중' };
        if (l.startsWith('⏺ ') && !l.includes('⎿')) {
            const msg = l.replace(/^⏺\s*/, '').slice(0, 50);
            if (msg.length > 3) return { s: 'working', t: msg };
        }
    }
    return { s: 'idle', t: '시작 대기 중...' };
}

/**
 * HTML-escape a string. Uses DOM-based escaping in browser, manual replacement in Node/test.
 */
export function esc(str) {
    if (typeof document !== 'undefined') {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    // Fallback for non-DOM environments (shouldn't happen with jsdom)
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Parse raw CLI log text into structured HTML.
 */
export function parseLogToHtml(raw) {
    const clean = stripAnsi(raw);
    const lines = clean.split('\n');
    let html = '';
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip empty lines and separator lines
        if (!trimmed || /^[─━─]+/.test(trimmed) || /^▪/.test(trimmed)) { i++; continue; }

        // User input: ❯ ...
        if (/^❯\s/.test(trimmed)) {
            const text = esc(trimmed.replace(/^❯\s*/, ''));
            html += `<div class="log-entry log-user"><span class="log-prompt">❯</span>${text}</div>`;
            i++;
            continue;
        }

        // Thinking: ✻✳✶✽✢ Verb... (time)
        if (/^[✻✳✶✽✢]/.test(trimmed)) {
            html += `<div class="log-entry log-thinking">${esc(trimmed)}</div>`;
            i++;
            continue;
        }

        // Tool call: ⏺ ToolName(...) — generic pattern for all tools including MCP
        if (/^⏺\s*[\w][\w_]*(?:__[\w]+)*\s*\(/.test(trimmed)) {
            const nameMatch = trimmed.match(/^⏺\s*([\w][\w_]*(?:__[\w]+)*\s*\([^)]*\)?)/);
            const toolName = nameMatch ? nameMatch[1] : trimmed.replace(/^⏺\s*/, '');
            i++;
            // Collect result lines (⎿ ... or indented)
            const resultLines = [];
            while (i < lines.length) {
                const rl = lines[i];
                const rt = rl.trim();
                if (rt.startsWith('⎿')) {
                    resultLines.push(rt.replace(/^⎿\s*/, ''));
                    i++;
                } else if (/^\s{2,}/.test(rl) && rt && !rt.startsWith('⏺') && !rt.startsWith('❯') && !/^[✻✳✶✽✢]/.test(rt)) {
                    resultLines.push(rt);
                    i++;
                } else { break; }
            }
            html += `<details class="log-entry log-tool-group"><summary><span class="log-tool-name">${esc(toolName)}</span></summary>`;
            if (resultLines.length > 0) {
                html += `<div class="log-result">${esc(resultLines.join('\n'))}</div>`;
            }
            html += `</details>`;
            continue;
        }

        // Claude response text: ⏺ ...
        if (/^⏺\s/.test(trimmed)) {
            const textLines = [trimmed.replace(/^⏺\s*/, '')];
            i++;
            while (i < lines.length) {
                const cl = lines[i];
                const ct = cl.trim();
                if (ct.startsWith('⏺') || ct.startsWith('❯') || /^[✻✳✶✽✢]/.test(ct) || /^[─━]+/.test(ct) || ct.startsWith('⎿')) break;
                if (!ct) {
                    if (i + 1 < lines.length) {
                        const next = lines[i + 1].trim();
                        if (next && !next.startsWith('⏺') && !next.startsWith('❯') && !/^[✻✳✶✽✢]/.test(next) && !/^[─━]+/.test(next)) {
                            textLines.push('');
                            i++;
                            continue;
                        }
                    }
                    break;
                }
                textLines.push(ct);
                i++;
            }
            html += `<div class="log-entry log-text">${esc(textLines.join('\n'))}</div>`;
            continue;
        }

        // Result lines (⎿) without a preceding tool
        if (trimmed.startsWith('⎿')) {
            html += `<div class="log-entry log-result">${esc(trimmed.replace(/^⎿\s*/, ''))}</div>`;
            i++;
            continue;
        }

        // Status bar / other
        if (/bypass permissions|shift\+tab|esc to interrupt|Context left/.test(trimmed)) { i++; continue; }

        // Fallback: plain text
        html += `<div class="log-entry log-text">${esc(trimmed)}</div>`;
        i++;
    }
    return html;
}
