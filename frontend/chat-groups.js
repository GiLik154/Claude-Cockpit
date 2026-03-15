// 그룹 CRUD, 그룹 뷰, broadcast
(function() {
    var App = window.ChatApp;

    // --- 데이터 ---

    App.loadGroups = function() {
        return fetch('/api/groups')
            .then(function(res) { return res.json(); })
            .then(function(groups) {
                App.groups = {};
                groups.forEach(function(g) { App.groups[g.group_id] = g; });
                App.renderGroups(groups);
            })
            .catch(function() {});
    };

    // --- 사이드바 렌더링 ---

    App.renderGroups = function(groups) {
        var list = document.getElementById('groupList');
        if (!list) return;
        list.innerHTML = '';
        if (!groups.length) {
            list.innerHTML = '<div class="group-empty-hint">+ 버튼으로 그룹 생성</div>';
            return;
        }
        groups.forEach(function(g) {
            var div = document.createElement('div');
            div.className = 'group-item' + (App.currentGroup === g.group_id ? ' active' : '');
            var aliveCount = g.members.filter(function(m) { return m.alive; }).length;
            var totalCount = g.members.length;
            div.innerHTML =
                '<div class="group-info" onclick="switchToGroup(\'' + App.esc(g.group_id) + '\')">' +
                    '<div class="group-name">' + App.esc(g.name) +
                        ' <span class="member-count">(' + aliveCount + '/' + totalCount + ')</span>' +
                    '</div>' +
                    '<div class="group-members-preview">' +
                        g.members.slice(0, 4).map(function(m) {
                            var dot = m.alive ? '<span style="color:var(--success)">\u25CF</span>' : '<span style="color:var(--danger)">\u25CF</span>';
                            return '<span class="group-member-tag">' + dot + ' ' + App.esc(m.role || m.name) + '</span>';
                        }).join('') +
                        (g.members.length > 4 ? '<span class="group-member-tag">+' + (g.members.length - 4) + '</span>' : '') +
                    '</div>' +
                '</div>' +
                '<div class="group-actions">' +
                    '<button class="edit-btn" onclick="event.stopPropagation();editGroup(\'' + App.esc(g.group_id) + '\')" title="Edit">\u270E</button>' +
                    '<button class="delete-btn" onclick="event.stopPropagation();deleteGroup(\'' + App.esc(g.group_id) + '\')" title="Delete">&times;</button>' +
                '</div>';
            list.appendChild(div);
        });
    };

    // --- 그룹 뷰 전환 ---

    App.switchToGroup = function(groupId) {
        var group = App.groups[groupId];
        if (!group) return;

        // 기존 단일 세션 뷰 정리
        if (App.viewMode !== 'terminal') { App.exitLiveView(); App.viewMode = 'terminal'; App.updateViewModeBtn(); }
        App.setPanesOff();
        App.cleanupPanes();
        App.cancelTokenRetry();

        // 모든 개별 터미널 숨기기
        Object.keys(App.terminals).forEach(function(sid) {
            var el = document.getElementById('term-' + sid);
            if (el) el.style.display = 'none';
        });

        App.currentSession = null;
        App.currentGroup = groupId;

        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('inputBar').style.display = 'flex';
        if (App.isMobile) document.getElementById('sidebar').classList.add('collapsed');

        // 그룹 그리드 생성
        var area = document.getElementById('terminalArea');
        var grid = document.getElementById('groupGrid');
        if (grid) grid.remove();

        grid = document.createElement('div');
        grid.id = 'groupGrid';
        grid.className = 'group-grid';

        // 그리드 열 수 결정
        var memberCount = group.members.length;
        var cols = memberCount <= 2 ? memberCount : memberCount <= 4 ? 2 : 3;
        grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';

        group.members.forEach(function(m) {
            if (!m.exists) return;
            var cell = document.createElement('div');
            cell.className = 'group-grid-cell';
            cell.setAttribute('data-session-id', m.session_id);

            var header = document.createElement('div');
            header.className = 'group-cell-header';
            header.innerHTML =
                '<span class="group-cell-role">' + App.esc(m.role || 'Agent') + '</span>' +
                '<span class="group-cell-name">' + App.esc(m.name) + '</span>' +
                (m.alive ? '<span style="color:var(--success)">\u25CF</span>' : '<span style="color:var(--danger)">\u25CF</span>');
            // 셀 헤더 클릭 → 해당 세션으로 전환 (개별 모드)
            header.addEventListener('click', function() {
                App.exitGroupView();
                App.switchSession(m.session_id);
            });
            cell.appendChild(header);

            var termWrap = document.createElement('div');
            termWrap.className = 'group-cell-terminal';
            cell.appendChild(termWrap);
            grid.appendChild(cell);

            // 터미널 생성 또는 이동
            if (!App.terminals[m.session_id]) {
                App.createTerminalInContainer(m.session_id, termWrap);
            } else {
                var existing = document.getElementById('term-' + m.session_id);
                if (existing) {
                    existing.style.display = 'block';
                    termWrap.appendChild(existing);
                    App.safeFit(App.terminals[m.session_id].fitAddon);
                }
            }
        });

        area.appendChild(grid);

        // placeholder, 버튼 업데이트
        var field = document.getElementById('inputField');
        if (field) field.placeholder = '\uBE0C\uB85C\uB4DC\uCE90\uC2A4\uD2B8: \uADF8\uB8F9 \uC804\uCCB4\uC5D0 \uC804\uC1A1 (' + memberCount + '\uBA85)';
        App.updateSendButton();
        App.renderGroupsList();
        App.renderSessionsList();
    };

    // 그리드 셀 안에 터미널 생성 (기존 createTerminal 변형)
    App.createTerminalInContainer = function(sessionId, container) {
        var termDiv = document.createElement('div');
        termDiv.id = 'term-' + sessionId;
        termDiv.className = 'terminal-container';
        termDiv.style.display = 'block';
        container.appendChild(termDiv);

        var fontSize = App.isMobile ? 10 : 12;
        var term = new window.Terminal({
            cursorBlink: true,
            fontSize: fontSize,
            fontFamily: App.FONT_FAMILY,
            theme: App.TERMINAL_THEME,
            allowProposedApi: true,
            scrollback: App.TERMINAL_SCROLLBACK,
        });

        var fitAddon = new window.FitAddon.FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new window.WebLinksAddon.WebLinksAddon());
        term.open(termDiv);
        setTimeout(function() { fitAddon.fit(); }, App.FIT_DELAY_MS);

        if (App.isMobile) {
            var xt = termDiv.querySelector('.xterm-helper-textarea');
            if (xt) {
                xt.setAttribute('readonly', 'readonly');
                xt.inputMode = 'none';
                xt.addEventListener('focus', function() { xt.blur(); });
            }
        }

        var entry = { term: term, ws: null, fitAddon: fitAddon, resizeObserver: null, reconnectTimer: null };
        App.terminals[sessionId] = entry;
        App.connectWS(sessionId);

        if (!App.isMobile) {
            term.onData(function(data) {
                var t = App.terminals[sessionId];
                if (t && t.ws && t.ws.readyState === WebSocket.OPEN) {
                    t.ws.send(JSON.stringify({ type: 'input', data: data }));
                }
            });
        }

        term.onResize(function(size) {
            var t = App.terminals[sessionId];
            if (t && t.ws && t.ws.readyState === WebSocket.OPEN) {
                t.ws.send(JSON.stringify({ type: 'resize', rows: size.rows, cols: size.cols }));
            }
        });

        var resizeObserver = new ResizeObserver(function() { App.safeFit(fitAddon); });
        resizeObserver.observe(termDiv);
        entry.resizeObserver = resizeObserver;
    };

    App.exitGroupView = function() {
        App.currentGroup = null;
        var grid = document.getElementById('groupGrid');
        if (grid) {
            // 터미널을 원래 terminalArea로 복귀
            var area = document.getElementById('terminalArea');
            grid.querySelectorAll('.terminal-container').forEach(function(termEl) {
                termEl.style.display = 'none';
                area.appendChild(termEl);
            });
            grid.remove();
        }
        // placeholder 복원
        var field = document.getElementById('inputField');
        if (field) field.placeholder = App.DEFAULT_PLACEHOLDER;
        App.renderGroupsList();
    };

    // --- Broadcast ---

    App.broadcastToGroup = function(text) {
        if (!App.currentGroup) return;
        fetch('/api/groups/' + App.currentGroup + '/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text }),
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.ok) {
                var success = data.results.filter(function(r) { return r.success; }).length;
                App.showStatus(success + '/' + data.results.length + '\uAC1C \uC138\uC158\uC5D0 \uC804\uC1A1 \uC644\uB8CC', true);
            }
        })
        .catch(function() {
            App.showStatus('\uBE0C\uB85C\uB4DC\uCE90\uC2A4\uD2B8 \uC804\uC1A1 \uC2E4\uD328');
        });
    };

    // --- 그룹 CRUD 모달 ---

    App._editingGroupId = null;

    App.openNewGroupModal = function() {
        App._editingGroupId = null;
        document.getElementById('groupName').value = '';
        document.getElementById('groupModalTitle').textContent = '\uC0C8 \uADF8\uB8F9';
        document.getElementById('groupSubmitBtn').textContent = 'Create';
        // 세션 목록을 최신으로 가져온 뒤 모달 표시
        fetch('/api/sessions').then(function(r) { return r.json(); }).then(function(sessions) {
            App._cachedSessions = sessions;
            App._populateGroupMemberEditor([{ session_id: '', role: '' }]);
            document.getElementById('groupModal').classList.add('active');
            document.getElementById('groupName').focus();
        }).catch(function() {
            App._populateGroupMemberEditor([{ session_id: '', role: '' }]);
            document.getElementById('groupModal').classList.add('active');
        });
    };

    App.editGroup = function(groupId) {
        var g = App.groups[groupId];
        if (!g) return;
        App._editingGroupId = groupId;
        document.getElementById('groupName').value = g.name;
        document.getElementById('groupModalTitle').textContent = '\uADF8\uB8F9 \uC218\uC815';
        document.getElementById('groupSubmitBtn').textContent = 'Save';
        fetch('/api/sessions').then(function(r) { return r.json(); }).then(function(sessions) {
            App._cachedSessions = sessions;
            App._populateGroupMemberEditor(g.members.map(function(m) {
                return { session_id: m.session_id, role: m.role };
            }));
            document.getElementById('groupModal').classList.add('active');
        }).catch(function() {
            App._populateGroupMemberEditor(g.members.map(function(m) {
                return { session_id: m.session_id, role: m.role };
            }));
            document.getElementById('groupModal').classList.add('active');
        });
    };

    App.closeGroupModal = function() {
        document.getElementById('groupModal').classList.remove('active');
        App._editingGroupId = null;
    };

    App._populateGroupMemberEditor = function(members) {
        var editor = document.getElementById('groupMemberEditor');
        editor.innerHTML = '';
        members.forEach(function(m) { App._addMemberRow(editor, m.session_id, m.role); });
    };

    App._cachedSessions = [];

    App._addMemberRow = function(editor, sessionId, role) {
        var row = document.createElement('div');
        row.className = 'group-member-row';

        var select = document.createElement('select');
        select.className = 'member-session-select';
        select.innerHTML = '<option value="">-- \uC138\uC158 \uC120\uD0DD --</option>';
        App._cachedSessions.forEach(function(s) {
            var opt = document.createElement('option');
            opt.value = s.session_id;
            opt.textContent = s.name + (s.alive ? '' : ' (stopped)');
            if (s.session_id === sessionId) opt.selected = true;
            select.appendChild(opt);
        });

        var roleInput = document.createElement('input');
        roleInput.type = 'text';
        roleInput.className = 'member-role-input';
        roleInput.placeholder = '\uC5ED\uD560 (e.g. \uD504\uB860\uD2B8\uC5D4\uB4DC)';
        roleInput.value = role || '';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn-remove-member';
        removeBtn.innerHTML = '&times;';
        removeBtn.addEventListener('click', function() { row.remove(); });

        row.appendChild(select);
        row.appendChild(roleInput);
        row.appendChild(removeBtn);
        editor.appendChild(row);
    };

    App.addGroupMemberRow = function() {
        var editor = document.getElementById('groupMemberEditor');
        App._addMemberRow(editor, '', '');
    };

    App.submitGroup = function() {
        var name = document.getElementById('groupName').value.trim();
        if (!name) { App.showStatus('\uADF8\uB8F9 \uC774\uB984\uC744 \uC785\uB825\uD558\uC138\uC694'); return; }

        var rows = document.querySelectorAll('#groupMemberEditor .group-member-row');
        var members = [];
        rows.forEach(function(row) {
            var select = row.querySelector('.member-session-select');
            var roleInput = row.querySelector('.member-role-input');
            if (select.value) {
                members.push({ session_id: select.value, role: roleInput.value.trim() });
            }
        });

        if (!members.length) { App.showStatus('\uBA4C\uBC84\uB97C 1\uBA85 \uC774\uC0C1 \uCD94\uAC00\uD558\uC138\uC694'); return; }

        var body = { name: name, members: members };
        var url, method;
        if (App._editingGroupId) {
            url = '/api/groups/' + App._editingGroupId;
            method = 'PUT';
        } else {
            url = '/api/groups';
            method = 'POST';
        }

        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.error || data.detail) {
                App.showStatus('Error: ' + (data.error || data.detail));
                return;
            }
            App.closeGroupModal();
            App.showStatus(App._editingGroupId ? '\uADF8\uB8F9 \uC218\uC815\uB428' : '\uADF8\uB8F9 \uC0DD\uC131\uB428', true);
            App.loadGroups();
        })
        .catch(function() {
            App.showStatus('\uADF8\uB8F9 \uC800\uC7A5 \uC2E4\uD328');
        });
    };

    App.deleteGroup = function(groupId) {
        if (!confirm('\uC774 \uADF8\uB8F9\uC744 \uC0AD\uC81C\uD560\uAE4C\uC694? (\uC138\uC158\uC740 \uC720\uC9C0\uB429\uB2C8\uB2E4)')) return;
        fetch('/api/groups/' + groupId, { method: 'DELETE' })
            .then(function() {
                if (App.currentGroup === groupId) {
                    App.exitGroupView();
                    App.goHome();
                }
                App.loadGroups();
                App.showStatus('\uADF8\uB8F9 \uC0AD\uC81C\uB428', true);
            })
            .catch(function() { App.showStatus('\uADF8\uB8F9 \uC0AD\uC81C \uC2E4\uD328'); });
    };

    // 사이드바 그룹 active 상태 갱신
    App.renderGroupsList = function() {
        document.querySelectorAll('.group-item').forEach(function(el) {
            var info = el.querySelector('.group-info');
            if (!info) return;
            var onclick = info.getAttribute('onclick') || '';
            var m = onclick.match(/'([^']+)'/);
            if (m) el.classList.toggle('active', m[1] === App.currentGroup);
        });
    };

    // --- 전역 노출 ---
    window.switchToGroup = App.switchToGroup;
    window.openNewGroupModal = App.openNewGroupModal;
    window.editGroup = App.editGroup;
    window.closeGroupModal = App.closeGroupModal;
    window.addGroupMemberRow = App.addGroupMemberRow;
    window.submitGroup = App.submitGroup;
    window.deleteGroup = App.deleteGroup;
})();
