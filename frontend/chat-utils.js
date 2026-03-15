// Pure utility functions extracted for testability (ES module).
// Duplicated in IIFE modules (chat-core.js, etc.) — sync logic changes in both places.
// NOT loaded in index.html — exists solely for vitest imports.

export function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?[@-~]|\x1b\(B/g, '');
}

export function parseTokenCount(str) {
    const num = parseFloat(str);
    if (/[kK]/.test(str)) return Math.round(num * 1000);
    if (/[mM]/.test(str)) return Math.round(num * 1000000);
    return Math.round(num);
}

export function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
}

export function parseUsageFromOutput(text) {
    const clean = stripAnsi(text);

    const progressMatch = clean.match(/[✢✳✶✽✻]\s*\S+…?\s*\(([^)]*?(\d+[\d.]*[kKmM]?)\s*tokens[^)]*)\)/);
    if (progressMatch) {
        const tokenStr = progressMatch[2];
        const tokens = parseTokenCount(tokenStr);
        const timeMatch = progressMatch[1].match(/^([\dm\s]+s)/);
        return { tokens, time: timeMatch ? timeMatch[1].trim() : '', status: 'working' };
    }

    const doneMatch = clean.match(/Done\s*\((\d+)\s*tool\s*uses?\s*·\s*([\d.]+[kKmM]?)\s*tokens?\s*·\s*([^)]+)\)/);
    if (doneMatch) {
        return {
            toolUses: parseInt(doneMatch[1]),
            tokens: parseTokenCount(doneMatch[2]),
            time: doneMatch[3].trim(),
            status: 'done'
        };
    }

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

export function esc(str) {
    if (typeof document !== 'undefined') {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function parseLogToHtml(raw) {
    const clean = stripAnsi(raw);
    const lines = clean.split('\n');
    let html = '';
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed || /^[─━─]+/.test(trimmed) || /^▪/.test(trimmed)) { i++; continue; }

        if (/^❯\s/.test(trimmed)) {
            const text = esc(trimmed.replace(/^❯\s*/, ''));
            html += `<div class="log-entry log-user"><span class="log-prompt">❯</span>${text}</div>`;
            i++;
            continue;
        }

        if (/^[✻✳✶✽✢]/.test(trimmed)) {
            html += `<div class="log-entry log-thinking">${esc(trimmed)}</div>`;
            i++;
            continue;
        }

        if (/^⏺\s*[\w][\w_]*(?:__[\w]+)*\s*\(/.test(trimmed)) {
            const nameMatch = trimmed.match(/^⏺\s*([\w][\w_]*(?:__[\w]+)*\s*\([^)]*\)?)/);
            const toolName = nameMatch ? nameMatch[1] : trimmed.replace(/^⏺\s*/, '');
            i++;
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

        if (trimmed.startsWith('⎿')) {
            html += `<div class="log-entry log-result">${esc(trimmed.replace(/^⎿\s*/, ''))}</div>`;
            i++;
            continue;
        }

        if (/bypass permissions|shift\+tab|esc to interrupt|Context left/.test(trimmed)) { i++; continue; }

        html += `<div class="log-entry log-text">${esc(trimmed)}</div>`;
        i++;
    }
    return html;
}
