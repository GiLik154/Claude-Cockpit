// 터미널 생성, xterm.js, WebSocket 연결, 리사이즈
(function() {
    var App = window.ChatApp;

    App.cleanupTerminal = function(sessionId) {
        if (!App.terminals[sessionId]) return;
        if (App.terminals[sessionId].ws) App.terminals[sessionId].ws.close();
        if (App.terminals[sessionId].term) App.terminals[sessionId].term.dispose();
        if (App.terminals[sessionId].resizeObserver) App.terminals[sessionId].resizeObserver.disconnect();
        clearTimeout(App.terminals[sessionId].reconnectTimer);
        var el = document.getElementById('term-' + sessionId);
        if (el) el.remove();
        delete App.terminals[sessionId];
    };

    App.createTerminal = function(sessionId) {
        var area = document.getElementById('terminalArea');
        var container = document.getElementById('term-' + sessionId);
        if (!container) {
            container = document.createElement('div');
            container.id = 'term-' + sessionId;
            container.className = 'terminal-container';
            area.appendChild(container);
        }
        container.style.display = App.currentSession === sessionId ? 'block' : 'none';

        var fontSize = App.isMobile ? 11 : 14;
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
        term.open(container);
        setTimeout(function() { fitAddon.fit(); }, App.FIT_DELAY_MS);

        // 모바일: xterm.js 숨겨진 textarea 비활성화 (입력은 #inputField로 처리)
        if (App.isMobile) {
            var xt = container.querySelector('.xterm-helper-textarea');
            if (xt) {
                xt.setAttribute('readonly', 'readonly');
                xt.inputMode = 'none';
                xt.addEventListener('focus', function() { xt.blur(); });
            }
        }

        var entry = { term: term, ws: null, fitAddon: fitAddon, resizeObserver: null, reconnectTimer: null };
        App.terminals[sessionId] = entry;
        App.connectWS(sessionId);

        // 데스크톱: 터미널 키보드 입력을 WebSocket으로 직접 전달
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
        resizeObserver.observe(container);
        entry.resizeObserver = resizeObserver;
    };

    App.connectWS = function(sessionId) {
        var entry = App.terminals[sessionId];
        if (!entry) return;
        clearTimeout(entry.reconnectTimer);
        if (entry.ws) { entry.ws.onclose = null; entry.ws.close(); }
        entry._reconnectDelay = App.RECONNECT_INTERVAL_MS;

        var wsProto = location.protocol === 'https:' ? 'wss://' : 'ws://';
        var ws = new WebSocket(wsProto + location.host + '/ws/terminal/' + sessionId);
        entry.ws = ws;

        ws.onopen = function() {
            entry._reconnectDelay = App.RECONNECT_INTERVAL_MS;
            App.showConnectionOverlay(sessionId, false);
            if (App.currentSession === sessionId) App.showStatus('연결됨', true);
            App.updateSendButton();
            App.flushPendingInput();
            setTimeout(function() {
                if (ws.readyState !== WebSocket.OPEN) return;
                entry.fitAddon.fit();
                ws.send(JSON.stringify({ type: 'resize', rows: entry.term.rows, cols: entry.term.cols }));
            }, App.FIT_DELAY_MS);
        };
        ws.onmessage = function(event) {
            var p;
            try { p = JSON.parse(event.data); } catch (_) { return; }
            if (p.type === 'output') {
                entry.term.write(p.data);
                var usage = App.parseUsageFromOutput(p.data);
                if (usage) App.updateUsageBadge(sessionId, usage);
                var waitSecs = App.detectTokenExpiry(p.data);
                if (waitSecs > 0 && sessionId === App.currentSession) {
                    // 사용량이 실제로 높을 때만 재시도 (오탐 방지)
                    var u = App.sessionUsage[sessionId];
                    var contextExhausted = u && u.contextLeft != null && u.contextLeft <= 5;
                    var sessionExhausted = u && u.sessionUsed != null && u.sessionUsed >= 95;
                    if (contextExhausted || sessionExhausted || !u || u.contextLeft == null) {
                        App.startTokenRetry(waitSecs);
                    }
                }
                if (App.viewMode !== 'terminal' && sessionId === App.currentSession) {
                    App.scheduleLiveRefresh();
                }
            }
            else if (p.type === 'exit') entry.term.write('\r\n\x1b[31m[Session ended]\x1b[0m\r\n');
            else if (p.type === 'error') entry.term.write('\r\n\x1b[31m[Error: ' + p.data + ']\x1b[0m\r\n');
        };
        ws.onclose = function() {
            App.showConnectionOverlay(sessionId, true);
            App.updateSendButton();
            var delay = entry._reconnectDelay || App.RECONNECT_INTERVAL_MS;
            entry.reconnectTimer = setTimeout(function() {
                if (App.terminals[sessionId]) App.connectWS(sessionId);
            }, delay);
            entry._reconnectDelay = Math.min(delay * 1.5, App.RECONNECT_MAX_INTERVAL_MS);
        };
    };
})();
