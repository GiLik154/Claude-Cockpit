// 세션 CRUD, 세션 목록 렌더링, 세션 전환
(function() {
    var App = window.ChatApp;

    App.loadSessions = function() {
        return fetch('/api/sessions')
            .then(function(res) { return res.json(); })
            .then(function(sessions) {
                App.renderSessions(sessions);
                sessions.forEach(function(s) {
                    if (s.alive && !App.terminals[s.session_id]) {
                        App.createTerminal(s.session_id);
                    }
                });
            })
            .catch(function() {});
    };

    App.renderSessions = function(sessions) {
        var list = document.getElementById('sessionList');
        list.innerHTML = '';
        var modelLabels = { 'opus': 'Opus', 'sonnet': 'Sonnet', 'haiku': 'Haiku' };
        var modelColors = { 'opus': '#c084fc', 'sonnet': '#60a5fa', 'haiku': '#34d399' };
        sessions.forEach(function(s) {
            var div = document.createElement('div');
            var isActive = App.currentSession === s.session_id;
            var entry = App.terminals[s.session_id];
            var wsState = entry && entry.ws ? entry.ws.readyState : null;
            var connected = wsState === WebSocket.OPEN;
            var sid = App.esc(s.session_id);
            var preset = s.preset || 'default';
            var dangerBadge = s.danger_mode ? ' <span class="danger-badge" title="⚠ Skip Permissions 모드 — Claude가 확인 없이 모든 작업을 수행합니다">&#9888;</span>' : '';
            var model = s.model || 'auto';
            var modelBadge = '';
            if (model !== 'auto' && modelLabels[model]) {
                modelBadge = ' <span class="model-badge" style="color:' + modelColors[model] + '" title="Model: ' + modelLabels[model] + '">' + modelLabels[model] + '</span>';
            }
            var connDot = connected
                ? '<span style="color:var(--success)" title="WebSocket 연결됨">\u25CF</span>'
                : '<span style="color:var(--danger)" title="연결 끊김 — 재연결 시도 중">\u25CF</span>';
            div.className = 'session-item' + (isActive ? ' active' : '');
            div.innerHTML =
                '<div class="session-info" onclick="switchSession(\'' + sid + '\')">' +
                    '<div class="name">' + App.esc(s.name) + modelBadge + dangerBadge + ' ' + connDot + '</div>' +
                    '<div class="status ' + (s.alive ? 'alive' : 'dead') + '">' + (s.alive ? 'Running' : 'Stopped') + '</div>' +
                '</div>' +
                '<div class="session-actions">' +
                    (!s.alive ? '<button class="restart-btn" onclick="event.stopPropagation();restartSession(\'' + sid + '\')" title="Restart">&#x21bb;</button>' : '') +
                    '<button class="delete-btn" onclick="event.stopPropagation();deleteSession(\'' + sid + '\')" title="Delete">&times;</button>' +
                '</div>';
            list.appendChild(div);
        });
    };

    App.createSession = function() {
        var name = document.getElementById('sessionName').value.trim() || 'Claude';
        var preset = document.getElementById('sessionPreset').value;
        var model = document.getElementById('sessionModel').value;
        var cwd = document.getElementById('sessionCwd').value.trim() || undefined;
        var body = { name: name, preset: preset, model: model, cwd: cwd };
        fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.error) { App.showStatus('Error: ' + data.error); return; }
            App.closeModal();
            if (data.danger_mode) {
                App.showStatus('\u26A0 Skip Permissions 모드로 생성됨 — 주의 필요');
            } else {
                App.showStatus('세션 생성됨', true);
            }
            App.loadSessions().then(function() {
                App.switchSession(data.session_id);
            });
        })
        .catch(function() {
            App.showStatus('세션 생성 실패');
        });
    };

    App.deleteSession = function(sessionId) {
        if (!confirm('이 세션을 삭제할까요?')) return;
        fetch('/api/sessions/' + sessionId, { method: 'DELETE' })
            .then(function() {
                App.cleanupTerminal(sessionId);
                if (App.currentSession === sessionId) {
                    App.currentSession = null;
                    document.getElementById('emptyState').style.display = 'flex';
                    document.getElementById('inputBar').style.display = 'none';
                }
                App.loadSessions();
            })
            .catch(function() {
                App.showStatus('세션 삭제 실패');
            });
    };

    App.restartSession = function(sessionId) {
        fetch('/api/sessions/' + sessionId + '/restart', { method: 'POST' })
            .then(function() {
                App.cleanupTerminal(sessionId);
                App.loadSessions().then(function() {
                    App.switchSession(sessionId);
                });
            })
            .catch(function() {
                App.showStatus('세션 재시작 실패');
            });
    };

    App.restartCurrent = function() {
        if (!App.currentSession) { App.showStatus('세션을 먼저 선택하세요'); return; }
        if (!confirm('이 세션을 재시작할까요?')) return;
        App.restartSession(App.currentSession);
        App.showStatus('Restarted', true);
    };

    App.restartAllSessions = function() {
        if (!confirm('모든 세션을 재시작할까요?')) return;
        fetch('/api/sessions')
            .then(function(res) { return res.json(); })
            .then(function(sessions) {
                var alive = sessions.filter(function(s) { return s.alive; });
                if (!alive.length) { App.showStatus('실행 중인 세션 없음'); return; }
                App.showStatus(alive.length + '개 세션 재시작 중...');
                var done = 0;
                alive.forEach(function(s) {
                    fetch('/api/sessions/' + s.session_id + '/restart', { method: 'POST' })
                        .then(function() {
                            App.cleanupTerminal(s.session_id);
                            done++;
                            if (done === alive.length) {
                                App.loadSessions().then(function() {
                                    if (App.currentSession) App.switchSession(App.currentSession);
                                });
                                App.showStatus(done + '개 세션 재시작 완료', true);
                            }
                        })
                        .catch(function() { done++; });
                });
            })
            .catch(function() { App.showStatus('세션 목록 로드 실패'); });
    };

    App.switchSession = function(sessionId) {
        // 세션 전환 시 라이브 뷰/panes 모드 해제 + 타이머 정리
        if (App.viewMode !== 'terminal') { App.exitLiveView(); App.viewMode = 'terminal'; App.updateViewModeBtn(); }
        App._lastDetectedModel = null;
        App.cancelTokenRetry();
        App.setPanesOff();
        App.cleanupPanes();

        Object.keys(App.terminals).forEach(function(sid) {
            var el = document.getElementById('term-' + sid);
            if (el) el.style.display = 'none';
        });
        App.currentSession = sessionId;
        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('inputBar').style.display = 'flex';
        if (App.isMobile) document.getElementById('sidebar').classList.add('collapsed');

        if (!App.terminals[sessionId]) {
            App.createTerminal(sessionId);
        } else {
            var el = document.getElementById('term-' + sessionId);
            if (el) {
                el.style.display = 'block';
                App.terminals[sessionId].fitAddon.fit();
            }
        }
        if (!App.isMobile) document.getElementById('inputField').focus();
        App.updateSendButton();
        App.refreshUsageBadge();
        App.renderSessionsList();
        App.checkPanes();
    };

    // index.html onclick 핸들러용 전역 노출
    window.switchSession = App.switchSession;
    window.createSession = App.createSession;
    window.deleteSession = App.deleteSession;
    window.restartSession = App.restartSession;
    window.restartCurrent = App.restartCurrent;
    window.restartAllSessions = App.restartAllSessions;
})();
