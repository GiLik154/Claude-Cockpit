// Panes 뷰: Agent Teams 모드 에이전트 상태 카드
(function() {
    var App = window.ChatApp;

    App.extractStatus = function(captureText) {
        var lines = captureText.split('\n').map(function(l) {
            return l.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?[@-~]/g, '').trim();
        }).filter(Boolean);
        for (var i = lines.length - 1; i >= Math.max(0, lines.length - App.PANE_SCAN_LINES); i--) {
            var l = lines[i];
            if (l.match(/^[✻✳].*thought/i)) return { s: 'thinking', t: '깊이 생각하는 중...' };
            if (l.match(/^[✻✳]/)) return { s: 'thinking', t: '생각하는 중...' };
            if (l.includes('Bash(')) { var m = l.match(/Bash\(([^)]{0,50})/); return { s: 'working', t: '실행: ' + (m && m[1] ? m[1] : '명령어') }; }
            if (l.includes('Read') && l.includes('file')) return { s: 'working', t: '파일 읽는 중...' };
            if (l.includes('Edit(') || l.includes('Edit ')) return { s: 'working', t: '코드 수정 중...' };
            if (l.includes('Write(') || l.includes('Write ')) return { s: 'working', t: '파일 작성 중...' };
            if (l.match(/Running \d+ agents/)) return { s: 'working', t: '에이전트 실행 중...' };
            if (l.match(/Grep|Glob/)) return { s: 'working', t: '코드 검색 중...' };
            if (l.startsWith('❯') && l.length < 5) return { s: 'idle', t: '대기 중' };
            if (l.startsWith('⏺ ') && !l.includes('⎿')) {
                var msg = l.replace(/^⏺\s*/, '').slice(0, App.STATUS_MSG_TRUNCATE);
                if (msg.length > 3) return { s: 'working', t: msg };
            }
        }
        return { s: 'idle', t: '시작 대기 중...' };
    };

    // panesMode 사이클: off → both → cards → off
    App.togglePanesView = function() {
        var grid = document.getElementById('panesGrid');
        var btn = document.getElementById('panesBtn');
        var area = document.getElementById('terminalArea');

        // 다음 모드 결정
        if (App.panesMode === 'off') {
            App.panesMode = 'both';
        } else if (App.panesMode === 'both') {
            App.panesMode = 'cards';
        } else {
            App.panesMode = 'off';
        }

        // 클래스 초기화
        area.classList.remove('panes-active', 'panes-cards-only');

        if (App.panesMode === 'off') {
            grid.style.display = 'none';
            btn.classList.remove('active');
            btn.textContent = 'Panes';
            clearInterval(App.panesTimer);
            App.panesTimer = null;
            if (App.currentSession) {
                var el = document.getElementById('term-' + App.currentSession);
                if (el) { el.style.display = 'block'; }
                if (App.terminals[App.currentSession]) App.safeFit(App.terminals[App.currentSession].fitAddon);
            }
        } else {
            // both 또는 cards
            if (App.panesMode === 'both') {
                area.classList.add('panes-active');
                btn.textContent = 'Split';
            } else {
                area.classList.add('panes-cards-only');
                btn.textContent = 'Cards';
            }

            // 터미널 표시/숨김
            if (App.currentSession) {
                var termEl = document.getElementById('term-' + App.currentSession);
                if (termEl) termEl.style.display = App.panesMode === 'cards' ? 'none' : 'block';
            }

            grid.style.display = 'flex';
            btn.classList.add('active');

            // 폴링 시작 (아직 안 돌고 있으면)
            if (!App.panesTimer) {
                App.refreshPanes();
                App.panesTimer = setInterval(App.refreshPanes, App.PANES_REFRESH_INTERVAL_MS);
            }

            // both 모드: 분할 크기에 맞게 터미널 리핏
            if (App.panesMode === 'both') {
                setTimeout(function() {
                    if (App.currentSession && App.terminals[App.currentSession]) {
                        App.safeFit(App.terminals[App.currentSession].fitAddon);
                    }
                }, App.FIT_DELAY_MS);
            }
        }
    };

    // panesMode를 특정 값으로 직접 설정 (switchSession 등에서 사용)
    App.setPanesOff = function() {
        if (App.panesMode === 'off') return;
        var area = document.getElementById('terminalArea');
        var grid = document.getElementById('panesGrid');
        var btn = document.getElementById('panesBtn');
        area.classList.remove('panes-active', 'panes-cards-only');
        grid.style.display = 'none';
        btn.classList.remove('active');
        btn.textContent = 'Panes';
        clearInterval(App.panesTimer);
        App.panesTimer = null;
        App.panesMode = 'off';
    };

    App.refreshPanes = function() {
        if (!App.currentSession || App._refreshPanesRunning) return;
        App._refreshPanesRunning = true;
        var sessionId = App.currentSession;

        fetch('/api/sessions/' + sessionId + '/panes')
            .then(function(res) { return res.json(); })
            .then(function(panes) {
                if (App.currentSession !== sessionId) { App._refreshPanesRunning = false; return; }
                var btn = document.getElementById('panesBtn');
                if (panes.length <= 1) {
                    btn.style.display = 'none';
                    if (App.panesMode !== 'off') App.setPanesOff();
                    App._refreshPanesRunning = false;
                    return;
                }
                btn.style.display = '';
                if (App.panesMode === 'off') { App._refreshPanesRunning = false; return; }

                var grid = document.getElementById('panesGrid');
                var activePaneIds = {};
                panes.forEach(function(p) { activePaneIds[p.pane_id] = true; });

                // 사라진 pane 카드 제거
                Object.keys(App.paneStates).forEach(function(pid) {
                    if (!activePaneIds[pid]) {
                        delete App.paneStates[pid];
                        var staleCard = document.getElementById('agent-' + CSS.escape(pid));
                        if (staleCard) staleCard.remove();
                    }
                });

                // 리더 pane ID 저장
                if (panes.length > 0) App._leaderPaneId = panes[0].pane_id;

                // 각 pane 순차 캡처 및 갱신
                var processPane = function(idx) {
                    if (idx >= panes.length) {
                        App._refreshPanesRunning = false;
                        return;
                    }
                    var pane = panes[idx];
                    var safeId = CSS.escape(pane.pane_id);
                    var card = document.getElementById('agent-' + safeId);
                    var rawTitle = (pane.title || '').replace(/^[⠀-⣿✳✻]\s*/, '');
                    var title = rawTitle || (idx === 0 ? 'Team Leader' : 'Agent ' + idx);
                    var isLeader = (idx === 0);
                    var avatar = App.AGENT_AVATARS[idx % App.AGENT_AVATARS.length];

                    if (!card) {
                        card = document.createElement('div');
                        card.id = 'agent-' + safeId;
                        card.className = 'agent-card';
                        (function(pid, paneIdx) {
                            card.addEventListener('click', function(e) {
                                e.stopPropagation();
                                App.selectPane(pid, paneIdx);
                                App.viewPaneLog(pid);
                            });
                        })(pane.pane_id, idx);
                        card.innerHTML =
                            '<div class="agent-bubble" id="bubble-' + safeId + '">분석 준비 중...</div>' +
                            '<div class="agent-office">' +
                                '<div class="agent-person">' + avatar + '</div>' +
                                '<div class="agent-workspace">' +
                                    '<span class="agent-monitor">🖥️</span>' +
                                    '<div class="agent-desk-surface"></div>' +
                                '</div>' +
                            '</div>' +
                            '<div class="agent-name">' + (isLeader ? '👑 ' : '') + App.esc(title) + '</div>' +
                            '<div class="agent-status"><span class="status-dot idle" id="dot-' + safeId + '"></span><span id="stxt-' + safeId + '">대기</span></div>';
                        grid.appendChild(card);
                        App.paneStates[pane.pane_id] = { lastHash: '' };
                    }

                    fetch('/api/sessions/' + sessionId + '/capture?pane_id=' + encodeURIComponent(pane.pane_id) + '&lines=30')
                        .then(function(capRes) { return capRes.ok ? capRes.text() : ''; })
                        .then(function(content) {
                            if (App.currentSession !== sessionId) return;

                            var hash = content.length + ':' + content.slice(-200);
                            if (hash !== App.paneStates[pane.pane_id].lastHash) {
                                App.paneStates[pane.pane_id].lastHash = hash;
                                var status = App.extractStatus(content);

                                var bubble = document.getElementById('bubble-' + safeId);
                                var dot = document.getElementById('dot-' + safeId);
                                var stxt = document.getElementById('stxt-' + safeId);
                                if (bubble) bubble.textContent = status.t;
                                if (dot) dot.className = 'status-dot ' + status.s;
                                if (stxt) stxt.textContent = status.s === 'working' ? '작업 중' : status.s === 'thinking' ? '사고 중' : '대기';
                                card.className = 'agent-card ' + status.s;
                            }
                        })
                        .catch(function() {})
                        .finally(function() { processPane(idx + 1); });
                };
                processPane(0);
            })
            .catch(function() { App._refreshPanesRunning = false; });
    };

    App.viewPaneLog = function(paneId) {
        if (!App.currentSession) return;
        App._viewingPaneId = paneId;
        document.getElementById('copyModal').classList.add('active');
        App.lastLogHash = '';
        var div = App.initLogDiv();
        div.innerHTML = '';
        var inputRow = document.getElementById('paneInputRow');
        if (inputRow) {
            inputRow.style.display = 'flex';
            document.getElementById('paneInputField').value = '';
        }
        var paneRefresh = function() {
            fetch('/api/sessions/' + App.currentSession + '/capture?pane_id=' + encodeURIComponent(paneId) + '&lines=2000')
                .then(function(res) { return res.ok ? res.text() : ''; })
                .then(function(text) {
                    var hash = text.length + ':' + text.slice(-300);
                    if (hash === App.lastLogHash) return;
                    App.lastLogHash = hash;
                    var container = document.getElementById('logTerminal');
                    var scrollGap = container.scrollHeight - container.scrollTop - container.clientHeight;
                    var wasAtBottom = scrollGap < App.SCROLL_THRESHOLD_PX;
                    var prevScrollTop = container.scrollTop;
                    var anchor = wasAtBottom ? null : App._findVisibleAnchor(container);

                    var detailsState = App._saveDetailsState(div);
                    div.innerHTML = App.parseLogToHtml(text);
                    App._restoreDetailsState(div, detailsState);

                    if (wasAtBottom) {
                        container.scrollTop = container.scrollHeight;
                    } else if (!App._restoreScrollAnchor(container, anchor)) {
                        container.scrollTop = prevScrollTop;
                    }
                })
                .catch(function() {});
        };
        paneRefresh();
        clearInterval(App.logRefreshTimer);
        App.logRefreshTimer = setInterval(paneRefresh, App.LOG_REFRESH_INTERVAL_MS);
    };

    App.sendPaneCommand = function() {
        var field = document.getElementById('paneInputField');
        var text = field.value.trim();
        if (!text || !App._viewingPaneId || !App.currentSession) return;

        // 리더 pane이면 WebSocket으로 전송 (ink 기반 프롬프트 호환)
        if (App._viewingPaneId === App._leaderPaneId) {
            var t = App.terminals[App.currentSession];
            if (t && t.ws && t.ws.readyState === WebSocket.OPEN) {
                t.ws.send(JSON.stringify({ type: 'input', data: text + '\r' }));
                field.value = '';
                App.showStatus('리더에게 전송됨', true);
                return;
            }
        }

        fetch('/api/sessions/' + App.currentSession + '/send-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pane_id: App._viewingPaneId, text: text })
        }).then(function(res) {
            if (res.ok) {
                field.value = '';
                App.showStatus('명령 전송됨', true);
            }
        }).catch(function() {
            App.showStatus('명령 전송 실패');
        });
    };

    // pane 선택: 메인 입력바가 해당 pane으로 전송
    App.selectedPaneId = null;
    App._selectedPaneIdx = -1;

    App.selectPane = function(paneId, paneIdx) {
        // 같은 pane 다시 클릭 → 선택 해제
        if (App.selectedPaneId === paneId) {
            App.deselectPane();
            return;
        }
        App.selectedPaneId = paneId;
        App._selectedPaneIdx = paneIdx;

        // 카드 하이라이트
        document.querySelectorAll('.agent-card').forEach(function(c) { c.classList.remove('selected'); });
        var safeId = CSS.escape(paneId);
        var card = document.getElementById('agent-' + safeId);
        if (card) card.classList.add('selected');

        // 입력바 placeholder 변경
        var field = document.getElementById('inputField');
        var name = paneIdx === 0 ? 'Leader' : 'Agent ' + paneIdx;
        if (card) {
            var nameEl = card.querySelector('.agent-name');
            if (nameEl) name = nameEl.textContent;
        }
        if (field) field.placeholder = name + '에게 전송';
    };

    App.deselectPane = function() {
        App.selectedPaneId = null;
        App._selectedPaneIdx = -1;
        document.querySelectorAll('.agent-card').forEach(function(c) { c.classList.remove('selected'); });
        var field = document.getElementById('inputField');
        if (field) field.placeholder = App.isMobile ? 'Enter 두 번=전송' : 'Enter=전송, Shift+Enter=개행';
    };

    App.cleanupPanes = function() {
        App.paneStates = {};
        App.deselectPane();
        var grid = document.getElementById('panesGrid');
        if (grid) grid.innerHTML = '';
    };

    App.checkPanes = function() {
        if (!App.currentSession) return;
        var sessionId = App.currentSession;
        fetch('/api/sessions/' + sessionId + '/panes')
            .then(function(res) { return res.json(); })
            .then(function(panes) {
                if (App.currentSession !== sessionId) return;
                var btn = document.getElementById('panesBtn');
                var hasMultiple = panes.length > 1;
                btn.style.display = hasMultiple ? '' : 'none';
                if (hasMultiple && App.panesMode === 'off' && !App._panesAutoShown) {
                    App._panesAutoShown = true;
                    App.togglePanesView(); // off → both
                }
                if (!hasMultiple) App._panesAutoShown = false;
            })
            .catch(function() {});
    };

    // index.html onclick 핸들러용 전역 노출
    window.togglePanesView = App.togglePanesView;
    window.sendPaneCommand = App.sendPaneCommand;
})();
