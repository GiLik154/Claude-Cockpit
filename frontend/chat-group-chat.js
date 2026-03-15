// 그룹 채팅 모드: 에이전트 카드 스타일 대화 타임라인
(function() {
    var App = window.ChatApp;

    // 채팅 뷰 초기화
    App.initGroupChat = function(group) {
        App._groupChatState = { members: {}, lastMessages: {} };

        group.members.forEach(function(m, idx) {
            if (!m.exists) return;
            App._groupChatState.members[m.session_id] = {
                lastHash: '',
                role: m.role || m.name,
                avatar: App.AGENT_AVATARS[idx % App.AGENT_AVATARS.length],
                idx: idx,
            };
        });

        // DOM 생성
        var area = document.getElementById('terminalArea');
        var container = document.getElementById('groupChatContainer');
        if (container) container.remove();

        container = document.createElement('div');
        container.id = 'groupChatContainer';
        container.className = 'group-chat-container';

        var scroll = document.createElement('div');
        scroll.id = 'groupChatScroll';
        scroll.className = 'group-chat-scroll';

        var grid = document.createElement('div');
        grid.id = 'groupChatGrid';
        grid.className = 'group-chat-grid';

        // 멤버별 카드 생성
        group.members.forEach(function(m, idx) {
            if (!m.exists) return;
            var mem = App._groupChatState.members[m.session_id];

            var card = document.createElement('div');
            card.className = 'gc-card';
            card.id = 'gc-card-' + m.session_id;
            card.setAttribute('data-session-id', m.session_id);

            card.innerHTML =
                '<div class="gc-bubble" id="gc-bubble-' + m.session_id + '">대기 중...</div>' +
                '<div class="gc-character">' +
                    '<div class="gc-person">' + mem.avatar + '</div>' +
                    '<div class="gc-workspace">' +
                        '<span class="gc-monitor">🖥️</span>' +
                        '<div class="gc-desk"></div>' +
                    '</div>' +
                '</div>' +
                '<div class="gc-name">' + App.esc(mem.role) + '</div>' +
                '<div class="gc-status"><span class="gc-dot idle" id="gc-dot-' + m.session_id + '"></span><span id="gc-stxt-' + m.session_id + '">대기</span></div>';

            // 클릭 시 콘솔 모달 열기
            (function(sid, role) {
                card.addEventListener('click', function() {
                    App.openGroupSessionLog(sid, role);
                });
            })(m.session_id, m.role);

            grid.appendChild(card);
        });

        scroll.appendChild(grid);
        container.appendChild(scroll);
        area.appendChild(container);
    };

    // 폴링
    App.startGroupChatPolling = function() {
        App.stopGroupChatPolling();
        App.refreshGroupChat();
        App._groupChatTimer = setInterval(App.refreshGroupChat, App.CHAT_POLL_INTERVAL_MS);
    };

    App.stopGroupChatPolling = function() {
        clearInterval(App._groupChatTimer);
        App._groupChatTimer = null;
        App._refreshGroupChatRunning = false;
    };

    // 각 멤버 순차 캡처 → 상태 추출 → 카드 업데이트
    App.refreshGroupChat = function() {
        if (!App.currentGroup || App.groupViewMode !== 'chat' || App._refreshGroupChatRunning) return;
        App._refreshGroupChatRunning = true;

        var state = App._groupChatState;
        if (!state) { App._refreshGroupChatRunning = false; return; }

        var sids = Object.keys(state.members);

        var processNext = function(idx) {
            if (idx >= sids.length) {
                App._refreshGroupChatRunning = false;
                return;
            }

            var sid = sids[idx];
            var mem = state.members[sid];

            fetch('/api/sessions/' + sid + '/capture?lines=50')
                .then(function(res) { return res.ok ? res.text() : ''; })
                .then(function(text) {
                    var hash = text.length + ':' + text.slice(-200);
                    if (hash === mem.lastHash) return;
                    mem.lastHash = hash;

                    // 상태 추출 (panes의 extractStatus 재활용)
                    var status = App.extractStatus(text);

                    // 마지막 의미 있는 메시지 추출
                    var lastMsg = _extractLastMessage(text);

                    // 카드 업데이트
                    var card = document.getElementById('gc-card-' + sid);
                    var bubble = document.getElementById('gc-bubble-' + sid);
                    var dot = document.getElementById('gc-dot-' + sid);
                    var stxt = document.getElementById('gc-stxt-' + sid);

                    if (bubble) bubble.textContent = lastMsg || status.t;
                    if (dot) dot.className = 'gc-dot ' + status.s;
                    if (stxt) stxt.textContent = status.s === 'working' ? '작업 중' : status.s === 'thinking' ? '사고 중' : '대기';
                    if (card) card.className = 'gc-card ' + status.s + (App.groupFocusedSession === sid ? ' focused' : '');
                })
                .catch(function() {})
                .finally(function() { processNext(idx + 1); });
        };

        processNext(0);
    };

    // 터미널 출력에서 마지막 의미 있는 메시지 추출
    function _extractLastMessage(raw) {
        var entries = App.parseEntries(raw);
        // 뒤에서부터 의미 있는 텍스트 찾기
        for (var i = entries.length - 1; i >= 0; i--) {
            var e = entries[i];
            if (e.type === 'text' && e.text && e.text.length > 3) {
                var msg = e.text.split('\n')[0];
                if (msg.length > 120) msg = msg.slice(0, 117) + '...';
                return msg;
            }
            if (e.type === 'tool') {
                return '🔧 ' + (e.name || '도구 실행 중');
            }
        }
        return '';
    }

    // 그리드 ↔ 채팅 토글
    App.toggleGroupViewMode = function() {
        if (!App.currentGroup) return;

        if (App.groupViewMode === 'grid') {
            App.groupViewMode = 'chat';
            _showChatMode();
        } else {
            App.groupViewMode = 'grid';
            _showGridMode();
        }
        _updateToggleBtn();
    };

    function _showChatMode() {
        var grid = document.getElementById('groupGrid');
        if (grid) grid.style.display = 'none';

        var group = App.groups[App.currentGroup];
        if (!group) return;
        App.initGroupChat(group);
        App.startGroupChatPolling();
    }

    function _showGridMode() {
        App.stopGroupChatPolling();
        var chatContainer = document.getElementById('groupChatContainer');
        if (chatContainer) chatContainer.remove();
        App._groupChatState = null;

        var grid = document.getElementById('groupGrid');
        if (grid) {
            grid.style.display = '';
            var group = App.groups[App.currentGroup];
            if (group) {
                group.members.forEach(function(m) {
                    if (App.terminals[m.session_id]) {
                        App.safeFit(App.terminals[m.session_id].fitAddon);
                    }
                });
            }
        }
    }

    function _updateToggleBtn() {
        var btn = document.getElementById('groupViewToggle');
        if (!btn) return;
        if (App.groupViewMode === 'chat') {
            btn.textContent = '🖥️ Grid';
            btn.title = '터미널 그리드로 전환';
        } else {
            btn.textContent = '💬 Chat';
            btn.title = '채팅 모드로 전환';
        }
    }

    // 그룹 뷰 헤더 생성
    App.createGroupViewHeader = function(group) {
        var header = document.createElement('div');
        header.id = 'groupViewHeader';
        header.className = 'group-view-header';

        var info = document.createElement('span');
        info.className = 'group-view-title';
        info.textContent = group.name + ' (' + group.members.filter(function(m) { return m.exists; }).length + '명)';

        var toggle = document.createElement('button');
        toggle.id = 'groupViewToggle';
        toggle.className = 'group-view-toggle-btn';
        toggle.textContent = '💬 Chat';
        toggle.title = '채팅 모드로 전환';
        toggle.addEventListener('click', App.toggleGroupViewMode);

        header.appendChild(info);
        header.appendChild(toggle);
        return header;
    };

    // 채팅 모드 정리
    App.cleanupGroupChat = function() {
        App.stopGroupChatPolling();
        App._groupChatState = null;
        App.groupViewMode = 'chat';
        var chatContainer = document.getElementById('groupChatContainer');
        if (chatContainer) chatContainer.remove();
        var header = document.getElementById('groupViewHeader');
        if (header) header.remove();
    };

    // 그룹 세션 콘솔 모달 열기 (로그 뷰어 재활용)
    App.openGroupSessionLog = function(sessionId, role) {
        App._groupLogSessionId = sessionId;
        clearInterval(App.logRefreshTimer);
        document.getElementById('copyModal').classList.add('active');

        // 모달 제목 변경
        var titleEl = document.querySelector('#copyModal .modal-header-row h3');
        if (titleEl) titleEl.textContent = (role || 'Session') + ' Console';

        // 입력 행 표시
        var inputRow = document.getElementById('paneInputRow');
        if (inputRow) {
            inputRow.style.display = 'flex';
            document.getElementById('paneInputField').value = '';
        }

        App.lastLogHash = '';
        var div = App.initLogDiv();
        div.innerHTML = '';

        var refresh = function() {
            if (!App._groupLogSessionId) return;
            fetch('/api/sessions/' + App._groupLogSessionId + '/capture?lines=2000')
                .then(function(res) { return res.ok ? res.text() : ''; })
                .then(function(text) {
                    var hash = text.length + ':' + text.slice(-300);
                    if (hash === App.lastLogHash) return;
                    App.lastLogHash = hash;
                    var container = document.getElementById('logTerminal');
                    var scrollGap = container.scrollHeight - container.scrollTop - container.clientHeight;
                    var wasAtBottom = scrollGap < App.SCROLL_THRESHOLD_PX;
                    var prevScrollTop = container.scrollTop;

                    var detailsState = App._saveDetailsState(div);
                    div.innerHTML = App.parseLogToHtml(text);
                    App._restoreDetailsState(div, detailsState);

                    if (wasAtBottom) {
                        container.scrollTop = container.scrollHeight;
                    } else {
                        container.scrollTop = prevScrollTop;
                    }
                })
                .catch(function() {});
        };

        refresh();
        App.logRefreshTimer = setInterval(refresh, App.LOG_REFRESH_INTERVAL_MS);

        // pane 입력을 이 세션으로 리다이렉트
        App._viewingPaneId = null; // pane이 아니라 세션 전체
        App._groupLogSendOverride = function() {
            var field = document.getElementById('paneInputField');
            var text = field.value.trim();
            if (!text) return;
            var t = App.terminals[sessionId];
            if (t && t.ws && t.ws.readyState === WebSocket.OPEN) {
                t.ws.send(JSON.stringify({ type: 'input', data: text + '\r' }));
                field.value = '';
                App.showStatus('전송됨', true);
            } else {
                App.showStatus('세션이 연결되지 않았습니다');
            }
        };
    };

    // sendPaneCommand 오버라이드: 그룹 로그 모드일 때 직접 전송
    var _origSendPaneCommand = App.sendPaneCommand;
    App.sendPaneCommand = function() {
        if (App._groupLogSendOverride) {
            App._groupLogSendOverride();
            return;
        }
        _origSendPaneCommand();
    };

    // closeCopyModal 확장: 그룹 로그 상태 정리
    var _origCloseCopyModal = App.closeCopyModal;
    App.closeCopyModal = function() {
        App._groupLogSessionId = null;
        App._groupLogSendOverride = null;
        // 제목 복원
        var titleEl = document.querySelector('#copyModal .modal-header-row h3');
        if (titleEl) titleEl.textContent = 'Terminal Log';
        _origCloseCopyModal();
    };
    window.closeCopyModal = App.closeCopyModal;

    window.toggleGroupViewMode = App.toggleGroupViewMode;
})();

