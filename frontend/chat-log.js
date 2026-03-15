// 로그 뷰어: 파싱, 렌더링, 모달, 복사, ANSI 변환
(function() {
    var App = window.ChatApp;

    function _parseEntries(raw) {
        var clean = App.stripAnsi(raw);
        var lines = clean.split('\n');
        var entries = [];
        var i = 0;
        while (i < lines.length) {
            var line = lines[i];
            var trimmed = line.trim();

            if (!trimmed || /^[─━─]+/.test(trimmed) || /^▪/.test(trimmed)) { i++; continue; }
            if (/bypass permissions|shift\+tab|esc to interrupt|Context left/i.test(trimmed)) { i++; continue; }

            // 사용자 입력
            if (/^❯\s/.test(trimmed)) {
                var userText = trimmed.replace(/^❯\s*/, '');
                if (userText) entries.push({ type: 'user', text: userText });
                i++; continue;
            }
            if (trimmed === '❯') { i++; continue; }

            // 사고 중
            if (/^[✻✳✶✽✢]/.test(trimmed)) {
                entries.push({ type: 'thinking', text: trimmed });
                i++; continue;
            }

            // 도구 호출
            if (/^⏺\s*[\w][\w_]*(?:__[\w]+)*\s*\(/.test(trimmed)) {
                var nameMatch = trimmed.match(/^⏺\s*([\w][\w_]*(?:__[\w]+)*\s*\([^)]*\)?)/);
                var toolName = nameMatch ? nameMatch[1] : trimmed.replace(/^⏺\s*/, '');
                i++;
                var resultLines = [];
                while (i < lines.length) {
                    var rl = lines[i]; var rt = rl.trim();
                    if (rt.startsWith('⎿')) { resultLines.push(rt.replace(/^⎿\s*/, '')); i++; }
                    else if (/^\s{2,}/.test(rl) && rt && !rt.startsWith('⏺') && !rt.startsWith('❯') && !/^[✻✳✶✽✢]/.test(rt)) { resultLines.push(rt); i++; }
                    else break;
                }
                entries.push({ type: 'tool', name: toolName, result: resultLines.join('\n') });
                continue;
            }

            // Claude 응답 텍스트
            if (/^⏺\s/.test(trimmed)) {
                var textLines = [trimmed.replace(/^⏺\s*/, '')];
                i++;
                while (i < lines.length) {
                    var cl = lines[i]; var ct = cl.trim();
                    if (ct.startsWith('⏺') || ct.startsWith('❯') || /^[✻✳✶✽✢]/.test(ct) || /^[─━]+/.test(ct) || ct.startsWith('⎿')) break;
                    if (!ct) {
                        if (i + 1 < lines.length) {
                            var next = lines[i + 1].trim();
                            if (next && !next.startsWith('⏺') && !next.startsWith('❯') && !/^[✻✳✶✽✢]/.test(next) && !/^[─━]+/.test(next)) {
                                textLines.push(''); i++; continue;
                            }
                        }
                        break;
                    }
                    textLines.push(ct); i++;
                }
                entries.push({ type: 'text', text: textLines.join('\n') });
                continue;
            }

            // 도구 없는 결과 라인
            if (trimmed.startsWith('⎿')) {
                entries.push({ type: 'result', text: trimmed.replace(/^⎿\s*/, '') });
                i++; continue;
            }

            entries.push({ type: 'text', text: trimmed });
            i++;
        }
        return entries;
    }

    // 외부 모듈에서 파싱 재활용
    App.parseEntries = _parseEntries;

    function _groupByCommand(entries) {
        var groups = [];
        var current = null;
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e.type === 'user') {
                current = { command: e.text, items: [] };
                groups.push(current);
            } else {
                if (!current) {
                    current = { command: null, items: [] };
                    groups.push(current);
                }
                current.items.push(e);
            }
        }
        return groups;
    }

    function _buildSummary(items) {
        var tools = 0, response = '';
        for (var i = 0; i < items.length; i++) {
            if (items[i].type === 'tool') tools++;
            if (items[i].type === 'text' && !response) {
                response = items[i].text.split('\n')[0];
                if (response.length > 80) response = response.slice(0, 77) + '...';
            }
        }
        var parts = [];
        if (tools > 0) parts.push('🔧 ' + tools + '개 도구');
        if (response) parts.push('💬 ' + response);
        return parts.join(' · ') || '(작업 내용 없음)';
    }

    function _renderEntry(e) {
        switch (e.type) {
            case 'thinking':
                return '<div class="log-entry log-thinking">' + App.esc(e.text) + '</div>';
            case 'tool':
                var h = '<details class="log-entry log-tool-group"><summary><span class="log-tool-name">' + App.esc(e.name) + '</span></summary>';
                if (e.result) h += '<div class="log-result">' + App.esc(e.result) + '</div>';
                return h + '</details>';
            case 'text':
                return '<div class="log-entry log-text">' + App.esc(e.text) + '</div>';
            case 'result':
                return '<div class="log-entry log-result">' + App.esc(e.text) + '</div>';
            default:
                return '<div class="log-entry log-text">' + App.esc(e.text || '') + '</div>';
        }
    }

    App.parseLogToHtml = function(raw) {
        var entries = _parseEntries(raw);
        var groups = _groupByCommand(entries);

        // 명령 인덱스(목차) 구성
        var commandGroups = [];
        var cmdIdx = 0;
        for (var g = 0; g < groups.length; g++) {
            if (groups[g].command !== null) {
                commandGroups.push({ idx: cmdIdx, group: groups[g] });
                cmdIdx++;
            }
        }

        var indexHtml = '';
        if (commandGroups.length > 1) {
            for (var c = 0; c < commandGroups.length; c++) {
                var cg = commandGroups[c];
                var toolCount = 0;
                for (var ti = 0; ti < cg.group.items.length; ti++) {
                    if (cg.group.items[ti].type === 'tool') toolCount++;
                }
                var cmdPreview = cg.group.command;
                if (cmdPreview.length > 60) cmdPreview = cmdPreview.slice(0, 57) + '...';
                var isLatest = (c === commandGroups.length - 1);
                indexHtml += '<div class="log-index-item' + (isLatest ? ' latest' : '') + '" onclick="ChatApp.scrollToLogCmd(' + cg.idx + ')">';
                indexHtml += '<span class="log-index-num">' + (c + 1) + '</span>';
                indexHtml += '<span class="log-index-text">' + App.esc(cmdPreview) + '</span>';
                if (toolCount > 0) indexHtml += '<span class="log-index-badge">🔧' + toolCount + '</span>';
                indexHtml += '</div>';
            }
        }
        App._logIndexHtml = indexHtml;
        App._logIndexCount = commandGroups.length;

        var indexPanel = document.getElementById('logIndexDropdown');
        var indexBtn = document.getElementById('logIndexBtn');
        if (indexPanel) indexPanel.querySelector('.log-index-list').innerHTML = indexHtml;
        if (indexBtn) indexBtn.style.display = commandGroups.length > 1 ? '' : 'none';

        // 마지막 실제 명령 그룹 인덱스 계산 (빈/null 그룹 제외)
        var lastRealIdx = -1;
        for (var li = groups.length - 1; li >= 0; li--) {
            if (groups[li].command !== null && groups[li].command !== '' && groups[li].items.length > 0) {
                lastRealIdx = li; break;
            }
        }

        var html = '';
        cmdIdx = 0;
        for (var g = 0; g < groups.length; g++) {
            var group = groups[g];

            if (group.command === null) {
                for (var j = 0; j < group.items.length; j++) {
                    html += _renderEntry(group.items[j]);
                }
                continue;
            }

            var summary = _buildSummary(group.items);
            var isLast = (g === lastRealIdx);

            html += '<div class="log-command-group' + (isLast ? ' latest' : '') + '" id="logCmd' + cmdIdx + '">';

            if (group.items.length > 0) {
                html += '<details class="log-command-details"' + (isLast ? ' open' : '') + '>';
                html += '<summary class="log-command-header">';
                html += '<div class="log-user"><span class="log-prompt">❯</span>' + App.esc(group.command) + '</div>';
                html += '<div class="log-command-summary">' + App.esc(summary) + '</div>';
                html += '</summary>';
                html += '<div class="log-command-body">';
                for (var k = 0; k < group.items.length; k++) {
                    html += _renderEntry(group.items[k]);
                }
                html += '</div></details>';
            } else {
                html += '<div class="log-command-header">';
                html += '<div class="log-user"><span class="log-prompt">❯</span>' + App.esc(group.command) + '</div>';
                html += '</div>';
            }

            html += '</div>';
            cmdIdx++;
        }

        return html;
    };

    App.initLogDiv = function() {
        var container = document.getElementById('logTerminal');
        if (!App.logDiv) {
            App.logDiv = document.createElement('div');
            App.logDiv.className = 'log-content';
            container.appendChild(App.logDiv);
        }
        return App.logDiv;
    };

    App.viewLog = function() {
        if (!App.currentSession) { App.showStatus('세션을 먼저 선택하세요'); return; }
        clearInterval(App.logRefreshTimer);
        App._viewingPaneId = null;
        document.getElementById('copyModal').classList.add('active');
        var inputRow = document.getElementById('paneInputRow');
        if (inputRow) inputRow.style.display = 'none';
        App.lastLogHash = '';
        var div = App.initLogDiv();
        div.innerHTML = '';
        App.refreshLog();
        App.logRefreshTimer = setInterval(App.refreshLog, App.LOG_REFRESH_INTERVAL_MS);
    };

    App._saveDetailsState = _saveDetailsState;
    App._restoreDetailsState = _restoreDetailsState;
    App._findVisibleAnchor = _findVisibleAnchor;
    App._restoreScrollAnchor = _restoreScrollAnchor;

    function _saveDetailsState(container) {
        var state = {};
        container.querySelectorAll('details.log-command-details').forEach(function(d, idx) {
            var userEl = d.querySelector('.log-user');
            var key = userEl ? userEl.textContent.trim() : ('_idx_' + idx);
            state[key] = d.open;
        });
        return state;
    }

    function _restoreDetailsState(container, state) {
        if (!state || !Object.keys(state).length) return;
        container.querySelectorAll('details.log-command-details').forEach(function(d, idx) {
            var userEl = d.querySelector('.log-user');
            var key = userEl ? userEl.textContent.trim() : ('_idx_' + idx);
            if (state.hasOwnProperty(key)) d.open = state[key];
        });
    }

    function _findVisibleAnchor(container) {
        var groups = container.querySelectorAll('.log-command-group');
        var containerTop = container.scrollTop;
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].offsetTop + groups[i].offsetHeight > containerTop) {
                return { id: groups[i].id, offset: containerTop - groups[i].offsetTop };
            }
        }
        return null;
    }

    function _restoreScrollAnchor(container, anchor) {
        if (!anchor || !anchor.id) return false;
        var el = document.getElementById(anchor.id);
        if (!el) return false;
        container.scrollTop = el.offsetTop + anchor.offset;
        return true;
    }

    App.refreshLog = function() {
        if (!App.currentSession || App._refreshLogRunning) return;
        App._refreshLogRunning = true;

        fetch('/api/sessions/' + App.currentSession + '/capture?lines=2000')
            .then(function(res) { return res.ok ? res.text() : ''; })
            .then(function(text) {
                if (!text.trim()) {
                    return fetch('/api/sessions/' + App.currentSession + '/logs?tail=500')
                        .then(function(res) { return res.ok ? res.text() : ''; });
                }
                return text;
            })
            .then(function(text) {
                var hash = text.length + ':' + text.slice(-300);
                if (hash !== App.lastLogHash) {
                    App.lastLogHash = hash;
                    var container = document.getElementById('logTerminal');
                    var div = App.initLogDiv();
                    var scrollGap = container.scrollHeight - container.scrollTop - container.clientHeight;
                    var wasAtBottom = scrollGap < App.SCROLL_THRESHOLD_PX;
                    var prevScrollTop = container.scrollTop;
                    var anchor = wasAtBottom ? null : _findVisibleAnchor(container);

                    var detailsState = _saveDetailsState(div);
                    div.innerHTML = App.parseLogToHtml(text);
                    _restoreDetailsState(div, detailsState);

                    if (wasAtBottom) {
                        container.scrollTop = container.scrollHeight;
                    } else if (!_restoreScrollAnchor(container, anchor)) {
                        container.scrollTop = prevScrollTop;
                    }
                }
            })
            .catch(function() {})
            .finally(function() { App._refreshLogRunning = false; });
    };

    App.closeCopyModal = function() {
        document.getElementById('copyModal').classList.remove('active');
        clearInterval(App.logRefreshTimer);
        App.logRefreshTimer = null;
        var inputRow = document.getElementById('paneInputRow');
        if (inputRow) inputRow.style.display = 'none';
        App._viewingPaneId = null;
        var dropdown = document.getElementById('logIndexDropdown');
        if (dropdown) dropdown.classList.remove('active');
        var indexBtn = document.getElementById('logIndexBtn');
        if (indexBtn) indexBtn.style.display = 'none';
    };

    App.doCopyClipboard = function() {
        var el = App.logDiv;
        if (!el) return;
        var text = el.innerText;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() { App.showStatus('복사됨!', true); }).catch(function() { App._fallbackCopy(text); });
        } else { App._fallbackCopy(text); }
    };

    App._fallbackCopy = function(text) {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;opacity:0;';
        document.body.appendChild(ta); ta.focus(); ta.select();
        try { document.execCommand('copy'); App.showStatus('복사됨!', true); }
        catch (_) { App.showStatus('복사 실패'); }
        document.body.removeChild(ta);
    };

    App.scrollToLogCmd = function(idx) {
        var dropdown = document.getElementById('logIndexDropdown');
        if (dropdown) dropdown.classList.remove('active');
        var el = document.getElementById('logCmd' + idx);
        if (!el) return;
        var details = el.querySelector('.log-command-details');
        if (details && !details.open) details.open = true;
        // DOM 갱신 후 스크롤
        setTimeout(function() {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            el.classList.add('log-highlight');
            setTimeout(function() { el.classList.remove('log-highlight'); }, 1500);
        }, 50);
    };

    App.ansiToHtml = function(raw) {
        var t = App.TERMINAL_THEME;
        var c8 = [t.black, t.red, t.green, t.yellow, t.blue, t.magenta, t.cyan, t.white];
        var b8 = ['#686868', '#ff5555', '#55ff55', '#ffff55', '#5555ff', '#ff55ff', '#55ffff', '#ffffff'];

        function c256(n) {
            if (n < 8) return c8[n];
            if (n < 16) return b8[n - 8];
            if (n < 232) { n -= 16; return 'rgb(' + (Math.floor(n/36)*51) + ',' + (Math.floor((n%36)/6)*51) + ',' + ((n%6)*51) + ')'; }
            var g = (n - 232) * 10 + 8; return 'rgb(' + g + ',' + g + ',' + g + ')';
        }

        var fg = null, bg = null, bold = false, dim = false, italic = false, ul = false;
        var html = '', open = false;

        function emit() {
            if (open) html += '</span>';
            var s = [];
            if (fg) s.push('color:' + fg);
            if (bg) s.push('background:' + bg);
            if (bold) s.push('font-weight:bold');
            if (dim) s.push('opacity:0.6');
            if (italic) s.push('font-style:italic');
            if (ul) s.push('text-decoration:underline');
            html += s.length ? '<span style="' + s.join(';') + '">' : '<span>';
            open = true;
        }

        var i = 0;
        while (i < raw.length) {
            if (raw[i] === '\x1b' && raw[i + 1] === '[') {
                var j = i + 2;
                while (j < raw.length && !/[A-Za-z~]/.test(raw[j])) j++;
                if (raw[j] === 'm') {
                    var ps = raw.slice(i + 2, j).split(';').map(Number);
                    for (var k = 0; k < ps.length; k++) {
                        var p = ps[k];
                        if (p === 0) { fg = bg = null; bold = dim = italic = ul = false; }
                        else if (p === 1) bold = true;
                        else if (p === 2) dim = true;
                        else if (p === 3) italic = true;
                        else if (p === 4) ul = true;
                        else if (p === 22) { bold = false; dim = false; }
                        else if (p === 23) italic = false;
                        else if (p === 24) ul = false;
                        else if (p >= 30 && p <= 37) fg = bold ? b8[p - 30] : c8[p - 30];
                        else if (p === 38 && ps[k + 1] === 5) { k += 2; fg = c256(ps[k]); }
                        else if (p === 38 && ps[k + 1] === 2) { var _r=Math.max(0,Math.min(255,ps[k+2]||0)),_g=Math.max(0,Math.min(255,ps[k+3]||0)),_b=Math.max(0,Math.min(255,ps[k+4]||0)); fg = 'rgb(' + _r + ',' + _g + ',' + _b + ')'; k += 4; }
                        else if (p === 39) fg = null;
                        else if (p >= 40 && p <= 47) bg = c8[p - 40];
                        else if (p === 48 && ps[k + 1] === 5) { k += 2; bg = c256(ps[k]); }
                        else if (p === 48 && ps[k + 1] === 2) { var _r2=Math.max(0,Math.min(255,ps[k+2]||0)),_g2=Math.max(0,Math.min(255,ps[k+3]||0)),_b2=Math.max(0,Math.min(255,ps[k+4]||0)); bg = 'rgb(' + _r2 + ',' + _g2 + ',' + _b2 + ')'; k += 4; }
                        else if (p === 49) bg = null;
                        else if (p >= 90 && p <= 97) fg = b8[p - 90];
                        else if (p >= 100 && p <= 107) bg = b8[p - 100];
                    }
                    emit();
                }
                i = j + 1;
            } else if (raw[i] === '\x1b') {
                var j = i + 1;
                while (j < raw.length && !/[a-zA-Z~]/.test(raw[j])) j++;
                i = j + 1;
            } else {
                var ch = raw[i];
                if (ch === '<') html += '&lt;';
                else if (ch === '>') html += '&gt;';
                else if (ch === '&') html += '&amp;';
                else if (ch === '\n') html += '\n';
                else html += ch;
                i++;
            }
        }
        if (open) html += '</span>';
        return html;
    };

    // 라이브 뷰 모드 (terminal / log / ansi)
    App.viewMode = 'terminal';
    App._liveLogTimer = null;
    App._liveLogHash = '';
    App._refreshLiveLogRunning = false;

    var VIEW_MODES = ['terminal', 'log', 'ansi'];
    var VIEW_LABELS = { terminal: '🖥️', log: '📋', ansi: '📺' };
    var VIEW_TITLES = { terminal: '정리된 로그', log: '원본 ANSI', ansi: '실시간 터미널' };
    var VIEW_CURRENT = { terminal: '터미널', log: '로그', ansi: 'ANSI' };

    App.toggleViewMode = function() {
        var idx = VIEW_MODES.indexOf(App.viewMode);
        var next = VIEW_MODES[(idx + 1) % VIEW_MODES.length];

        if (App.viewMode !== 'terminal') App.exitLiveView();

        App.viewMode = next;

        if (next !== 'terminal') App.enterLiveView();

        App.updateViewModeBtn();
    };

    App.updateViewModeBtn = function() {
        var btn = document.getElementById('viewModeBtn');
        if (!btn) return;
        btn.textContent = VIEW_LABELS[App.viewMode] + (App.viewMode !== 'terminal' ? ' ' + VIEW_CURRENT[App.viewMode] : '');
        btn.title = VIEW_TITLES[App.viewMode] + '로 전환 (클릭)';
        if (App.viewMode === 'terminal') btn.classList.remove('active');
        else btn.classList.add('active');
    };

    App.enterLiveView = function() {
        if (!App.currentSession) { App.showStatus('세션을 먼저 선택하세요'); App.viewMode = 'terminal'; return; }

        var termEl = document.getElementById('term-' + App.currentSession);
        if (termEl) termEl.style.display = 'none';
        var container = document.getElementById('liveLogContainer');
        container.style.display = 'block';
        container.className = 'live-log-container' + (App.viewMode === 'ansi' ? ' ansi-mode' : '');

        App._liveLogHash = '';
        App.refreshLiveView();
        // WebSocket 출력 시 scheduleLiveRefresh()로 실시간 갱신, 폴링은 유휴 시 폴백
        App._liveLogTimer = setInterval(App.refreshLiveView, App.LIVE_LOG_REFRESH_INTERVAL_MS);
    };

    App.exitLiveView = function() {
        clearInterval(App._liveLogTimer);
        App._liveLogTimer = null;
        clearTimeout(App._liveRefreshDebounce);
        App._liveRefreshDebounce = null;

        document.getElementById('liveLogContainer').style.display = 'none';
        if (App.currentSession) {
            var termEl = document.getElementById('term-' + App.currentSession);
            if (termEl) {
                termEl.style.display = 'block';
                if (App.terminals[App.currentSession]) App.safeFit(App.terminals[App.currentSession].fitAddon);
            }
        }
    };

    App.refreshLiveView = function() {
        if (!App.currentSession || App._refreshLiveLogRunning) return;
        App._refreshLiveLogRunning = true;

        fetch('/api/sessions/' + App.currentSession + '/capture?lines=2000')
            .then(function(res) { return res.ok ? res.text() : ''; })
            .then(function(text) {
                if (!text.trim()) {
                    return fetch('/api/sessions/' + App.currentSession + '/logs?tail=500')
                        .then(function(res) { return res.ok ? res.text() : ''; });
                }
                return text;
            })
            .then(function(text) {
                var hash = App.viewMode + ':' + text.length + ':' + text.slice(-300);
                if (hash !== App._liveLogHash) {
                    App._liveLogHash = hash;
                    var scroll = document.querySelector('.live-log-scroll');
                    var content = document.getElementById('liveLogContent');
                    var scrollGap = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
                    var wasAtBottom = scrollGap < App.SCROLL_THRESHOLD_PX;
                    var prevScrollTop = scroll.scrollTop;
                    var anchor = wasAtBottom ? null : _findVisibleAnchor(scroll);

                    var detailsState = _saveDetailsState(content);
                    content.innerHTML = App.viewMode === 'ansi' ? App.ansiToHtml(text) : App.parseLogToHtml(text);
                    if (App.viewMode !== 'ansi') _restoreDetailsState(content, detailsState);

                    if (wasAtBottom) {
                        scroll.scrollTop = scroll.scrollHeight;
                    } else if (!_restoreScrollAnchor(scroll, anchor)) {
                        scroll.scrollTop = prevScrollTop;
                    }
                }
            })
            .catch(function() {})
            .finally(function() { App._refreshLiveLogRunning = false; });
    };

    // 50ms 디바운스 — WebSocket 출력 시 실시간에 가까운 갱신
    App._liveRefreshDebounce = null;
    App.scheduleLiveRefresh = function() {
        if (App._liveRefreshDebounce) return;
        App._liveRefreshDebounce = setTimeout(function() {
            App._liveRefreshDebounce = null;
            App.refreshLiveView();
        }, 50);
    };

    App.toggleLogIndex = function() {
        var dropdown = document.getElementById('logIndexDropdown');
        if (dropdown) dropdown.classList.toggle('active');
    };

    // index.html onclick 핸들러용 전역 노출
    window.toggleLogIndex = App.toggleLogIndex;
    window.toggleViewMode = App.toggleViewMode;
    window.viewLog = App.viewLog;
    window.closeCopyModal = App.closeCopyModal;
    window.doCopyClipboard = App.doCopyClipboard;
})();
