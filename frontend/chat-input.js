// 입력 처리: textarea, IME, 더블엔터 전송
(function() {
    var App = window.ChatApp;

    App.sendToCurrentSession = function(data) {
        if (!App.currentSession || !App.terminals[App.currentSession]) return;
        var t = App.terminals[App.currentSession];
        if (t.ws && t.ws.readyState === WebSocket.OPEN) {
            t.ws.send(JSON.stringify({ type: 'input', data: data }));
        }
    };

    App.sendCancel = function() { App.sendToCurrentSession('\x03'); };
    App.sendEsc = function() { App.sendToCurrentSession('\x1b'); };
    App.sendNumber = function(num) {
        App.sendToCurrentSession(num);
        setTimeout(function() { App.sendToCurrentSession('\r'); }, 50);
    };
    App.sendDelete = function() { App.sendToCurrentSession('\x7f'); };

    App.doSend = function() {
        if (App.isComposing) return;
        var field = document.getElementById('inputField');
        var text = field.value.replace(/\n+$/, '');
        if (!text) { field.value = ''; App.autoResizeField(); return; }

        // 그룹 broadcast 모드
        if (App.currentGroup) {
            App.broadcastToGroup(text);
            field.value = ''; App.autoResizeField(); field.focus();
            return;
        }

        if (!App.currentSession || !App.terminals[App.currentSession]) { App.showStatus('세션을 먼저 선택하세요'); return; }
        var t = App.terminals[App.currentSession];
        if (!t.ws || t.ws.readyState !== WebSocket.OPEN) {
            App.pendingInput = { sessionId: App.currentSession, text: text };
            field.value = ''; App.autoResizeField();
            App.showStatus('대기 중 — 연결되면 전송됩니다');
            return;
        }
        App.lastSentInput = text;
        App.cancelTokenRetry();

        // 선택된 pane이 있으면 해당 pane으로 전송
        if (App.selectedPaneId && App.selectedPaneId !== App._leaderPaneId) {
            fetch('/api/sessions/' + App.currentSession + '/send-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pane_id: App.selectedPaneId, text: text })
            }).then(function(res) {
                if (res.ok) App.showStatus('에이전트에게 전송됨', true);
            }).catch(function() { App.showStatus('전송 실패'); });
        } else {
            t.ws.send(JSON.stringify({ type: 'input', data: text + '\r' }));
        }
        field.value = ''; App.autoResizeField(); field.focus();
    };

    App.flushPendingInput = function() {
        if (!App.pendingInput) return;
        var sessionId = App.pendingInput.sessionId;
        var text = App.pendingInput.text;
        var t = App.terminals[sessionId];
        if (t && t.ws && t.ws.readyState === WebSocket.OPEN) {
            t.ws.send(JSON.stringify({ type: 'input', data: text + '\r' }));
            App.pendingInput = null;
        }
    };

    App.autoResizeField = function() {
        var field = document.getElementById('inputField');
        field.style.height = 'auto';
        field.style.height = Math.min(field.scrollHeight, App.TEXTAREA_MAX_HEIGHT_PX) + 'px';
    };

    App.clearTerminal = function() {
        // textarea 클리어
        var field = document.getElementById('inputField');
        if (field) {
            field.removeAttribute('readonly');
            field.value = '';
            App.isComposing = false;
            App.autoResizeField();
        }
        // 터미널 입력줄 클리어 (Ctrl+U)
        App.sendToCurrentSession('\x15');
        if (App.selectedPaneId) App.deselectPane();
        App.showStatus('입력 초기화', true);
    };

    // index.html onclick 핸들러용 전역 노출
    window.sendCancel = App.sendCancel;
    window.sendEsc = App.sendEsc;
    window.sendNumber = App.sendNumber;
    window.sendDelete = App.sendDelete;
    window.doSend = App.doSend;
    window.clearTerminal = App.clearTerminal;
})();
