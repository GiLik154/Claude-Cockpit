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

            // 클릭 시 포커스
            (function(sid, role) {
                card.addEventListener('click', function() {
                    if (App.groupFocusedSession === sid) {
                        App.unfocusGroupCell();
                    } else {
                        App.focusGroupCell(sid, role);
                    }
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
        App.groupViewMode = 'grid';
        var chatContainer = document.getElementById('groupChatContainer');
        if (chatContainer) chatContainer.remove();
        var header = document.getElementById('groupViewHeader');
        if (header) header.remove();
    };

    window.toggleGroupViewMode = App.toggleGroupViewMode;
})();
