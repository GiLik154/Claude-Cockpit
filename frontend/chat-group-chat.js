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

    // 그룹 세션 콘솔 모달 열기 (실제 xterm.js 터미널)
    App.openGroupSessionLog = function(sessionId, role) {
        var t = App.terminals[sessionId];
        var termEl = document.getElementById('term-' + sessionId);
        if (!t || !termEl) return;

        App._gcConsoleSessionId = sessionId;
        App._gcConsoleReturnParent = termEl.parentNode;

        // 모달 생성
        var overlay = document.getElementById('gcConsoleOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'gcConsoleOverlay';
            overlay.className = 'gc-console-overlay';
            overlay.innerHTML =
                '<div class="gc-console-modal">' +
                    '<div class="gc-console-header">' +
                        '<span class="gc-console-title"></span>' +
                        '<button class="btn btn-sm gc-console-close">Close</button>' +
                    '</div>' +
                    '<div class="gc-console-body"></div>' +
                    '<div class="gc-console-input">' +
                        '<input type="text" class="gc-console-field" placeholder="명령 입력...">' +
                        '<button class="btn btn-primary btn-sm gc-console-send">Send</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(overlay);

            // 오버레이 클릭으로 닫기
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) App.closeGroupConsole();
            });
            overlay.querySelector('.gc-console-close').addEventListener('click', App.closeGroupConsole);

            // 입력 전송
            var sendBtn = overlay.querySelector('.gc-console-send');
            var inputField = overlay.querySelector('.gc-console-field');
            function doSend() {
                var text = inputField.value.trim();
                if (!text || !App._gcConsoleSessionId) return;
                var t = App.terminals[App._gcConsoleSessionId];
                if (t && t.ws && t.ws.readyState === WebSocket.OPEN) {
                    t.ws.send(JSON.stringify({ type: 'input', data: text + '\r' }));
                    inputField.value = '';
                    inputField.focus();
                }
            }
            sendBtn.addEventListener('click', doSend);
            inputField.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); doSend(); }
                e.stopPropagation(); // ESC 캡처와 충돌 방지
            });
        }

        overlay.querySelector('.gc-console-title').textContent = (role || 'Session') + ' Console';
        var body = overlay.querySelector('.gc-console-body');
        body.innerHTML = '';

        // 터미널을 모달로 이동
        termEl.style.display = 'block';
        body.appendChild(termEl);
        overlay.classList.add('active');

        // ESC 캡처 (xterm.js보다 먼저 잡기) — 중복 등록 방지
        if (App._gcEscHandler) {
            document.removeEventListener('keydown', App._gcEscHandler, true);
        }
        App._gcEscHandler = function(e) {
            if (e.key === 'Escape') {
                e.stopPropagation();
                e.preventDefault();
                App.closeGroupConsole();
            }
        };
        document.addEventListener('keydown', App._gcEscHandler, true);

        // 리사이즈
        setTimeout(function() { App.safeFit(t.fitAddon); }, 50);
    };

    App.closeGroupConsole = function() {
        if (App._gcEscHandler) {
            document.removeEventListener('keydown', App._gcEscHandler, true);
            App._gcEscHandler = null;
        }
        var overlay = document.getElementById('gcConsoleOverlay');
        if (overlay) overlay.classList.remove('active');

        var sid = App._gcConsoleSessionId;
        if (!sid) return;

        var termEl = document.getElementById('term-' + sid);
        var returnTo = App._gcConsoleReturnParent;

        if (termEl && returnTo) {
            // 그리드 셀이면 보이게, 아니면 숨기기
            var inGrid = returnTo.closest('.group-grid-cell');
            termEl.style.display = inGrid ? 'block' : 'none';
            returnTo.appendChild(termEl);
            if (App.terminals[sid]) {
                setTimeout(function() { App.safeFit(App.terminals[sid].fitAddon); }, 50);
            }
        }

        App._gcConsoleSessionId = null;
        App._gcConsoleReturnParent = null;
    };

    window.toggleGroupViewMode = App.toggleGroupViewMode;
})();

