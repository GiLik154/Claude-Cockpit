// 그룹 채팅 모드: 멤버별 출력을 채팅 버블로 표시
(function() {
    var App = window.ChatApp;

    var ROLE_EMOJIS = {
        '프론트엔드': '🎨', 'frontend': '🎨', 'fe': '🎨',
        '백엔드': '⚙️', 'backend': '⚙️', 'be': '⚙️',
        'api': '🔌', 'API': '🔌',
        '테스트': '🧪', 'test': '🧪', 'qa': '🧪',
        '디자인': '🖌️', 'design': '🖌️', 'ui': '🖌️', 'ux': '🖌️',
        '인프라': '🏗️', 'infra': '🏗️', 'devops': '🏗️',
        '데이터': '📊', 'data': '📊', 'db': '📊',
        '보안': '🔒', 'security': '🔒',
        '리더': '👑', 'leader': '👑', 'pm': '👑',
        '코드리뷰': '🔍', 'review': '🔍',
    };

    function getEmoji(role, idx) {
        if (!role) return App.AGENT_AVATARS[idx % App.AGENT_AVATARS.length];
        var lower = role.toLowerCase();
        for (var key in ROLE_EMOJIS) {
            if (lower.includes(key)) return ROLE_EMOJIS[key];
        }
        return App.AGENT_AVATARS[idx % App.AGENT_AVATARS.length];
    }

    // 채팅 뷰 초기화
    App.initGroupChat = function(group) {
        App._groupChatState = { members: {}, messages: [] };

        group.members.forEach(function(m, idx) {
            if (!m.exists) return;
            App._groupChatState.members[m.session_id] = {
                lastHash: '',
                lastEntryCount: 0,
                role: m.role || m.name,
                emoji: getEmoji(m.role, idx),
                color: _memberColor(idx),
            };
        });

        // DOM 생성
        var area = document.getElementById('terminalArea');
        var container = document.getElementById('groupChatContainer');
        if (container) container.remove();

        container = document.createElement('div');
        container.id = 'groupChatContainer';
        container.className = 'group-chat-container';
        container.innerHTML =
            '<div class="group-chat-scroll" id="groupChatScroll">' +
                '<div class="group-chat-messages" id="groupChatMessages"></div>' +
            '</div>';
        area.appendChild(container);
    };

    function _memberColor(idx) {
        var colors = ['#4f8cff', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#3498db'];
        return colors[idx % colors.length];
    }

    // 폴링 시작/중지
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

    // 각 멤버 순차 캡처 → 파싱 → 새 메시지 추출
    App.refreshGroupChat = function() {
        if (!App.currentGroup || App.groupViewMode !== 'chat' || App._refreshGroupChatRunning) return;
        App._refreshGroupChatRunning = true;

        var state = App._groupChatState;
        if (!state) { App._refreshGroupChatRunning = false; return; }

        var sids = Object.keys(state.members);
        var newMessages = [];

        var processNext = function(idx) {
            if (idx >= sids.length) {
                if (newMessages.length > 0) {
                    App._appendChatMessages(newMessages);
                }
                App._refreshGroupChatRunning = false;
                return;
            }

            var sid = sids[idx];
            var mem = state.members[sid];

            fetch('/api/sessions/' + sid + '/capture?lines=500')
                .then(function(res) { return res.ok ? res.text() : ''; })
                .then(function(text) {
                    var hash = text.length + ':' + text.slice(-300);
                    if (hash === mem.lastHash) return;
                    mem.lastHash = hash;

                    var entries = App.parseEntries(text);
                    var prevCount = mem.lastEntryCount;

                    // 새 엔트리만 추출
                    if (entries.length > prevCount) {
                        var newEntries = entries.slice(prevCount);
                        newEntries.forEach(function(e) {
                            // thinking은 마지막 것만 유지 (중복 방지)
                            if (e.type === 'thinking') return;
                            newMessages.push({
                                sessionId: sid,
                                role: mem.role,
                                emoji: mem.emoji,
                                color: mem.color,
                                type: e.type,
                                text: e.text || '',
                                toolName: e.name || '',
                                toolResult: e.result || '',
                                ts: Date.now() + idx, // 순서 보존
                            });
                        });
                    }
                    mem.lastEntryCount = entries.length;
                })
                .catch(function() {})
                .finally(function() { processNext(idx + 1); });
        };

        processNext(0);
    };

    // 새 메시지 DOM append + 자동 스크롤
    App._appendChatMessages = function(msgs) {
        var container = document.getElementById('groupChatMessages');
        var scroll = document.getElementById('groupChatScroll');
        if (!container || !scroll) return;

        var scrollGap = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
        var wasAtBottom = scrollGap < App.SCROLL_THRESHOLD_PX;

        var lastSid = container.getAttribute('data-last-sid') || '';

        msgs.forEach(function(msg) {
            var isSameAuthor = (msg.sessionId === lastSid);

            var wrapper = document.createElement('div');
            wrapper.className = 'chat-msg';

            if (!isSameAuthor) {
                // 새 저자 헤더
                var header = document.createElement('div');
                header.className = 'chat-msg-header';
                header.innerHTML =
                    '<span class="chat-avatar">' + msg.emoji + '</span>' +
                    '<span class="chat-role" style="color:' + msg.color + '">' + App.esc(msg.role) + '</span>';
                wrapper.appendChild(header);
            }

            var bubble = document.createElement('div');
            bubble.className = 'chat-bubble chat-type-' + msg.type;

            if (msg.type === 'user') {
                bubble.innerHTML = '<span class="chat-prompt">&gt;</span> ' + App.esc(msg.text);
            } else if (msg.type === 'tool') {
                var details = document.createElement('details');
                details.className = 'chat-tool-details';
                details.innerHTML =
                    '<summary class="chat-tool-name">' + App.esc(msg.toolName) + '</summary>' +
                    (msg.toolResult ? '<div class="chat-tool-result">' + App.esc(msg.toolResult) + '</div>' : '');
                bubble.appendChild(details);
            } else if (msg.type === 'result') {
                bubble.classList.add('chat-type-result');
                bubble.textContent = msg.text;
            } else {
                bubble.textContent = msg.text;
            }

            wrapper.appendChild(bubble);
            container.appendChild(wrapper);
            lastSid = msg.sessionId;
        });

        container.setAttribute('data-last-sid', lastSid);

        if (wasAtBottom) {
            scroll.scrollTop = scroll.scrollHeight;
        }
    };

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
            // 터미널 refit
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

    // 그룹 뷰 헤더 (토글 바) 생성
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
