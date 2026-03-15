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
        if (entry.ws) { entry.ws.onclose = null; entry.ws.close(); }

        var ws = new WebSocket('ws://' + location.host + '/ws/terminal/' + sessionId);
        entry.ws = ws;

        ws.onopen = function() {
            App.showConnectionOverlay(sessionId, false);
            if (App.currentSession === sessionId) App.showStatus('Connected', true);
            App.updateSendButton();
            App.flushPendingInput();
            setTimeout(function() {
                entry.fitAddon.fit();
                ws.send(JSON.stringify({ type: 'resize', rows: entry.term.rows, cols: entry.term.cols }));
            }, App.FIT_DELAY_MS);
        };
        ws.onmessage = function(event) {
            var p = JSON.parse(event.data);
            if (p.type === 'output') {
                entry.term.write(p.data);
                var usage = App.parseUsageFromOutput(p.data);
                if (usage) App.updateUsageBadge(sessionId, usage);
                var waitSecs = App.detectTokenExpiry(p.data);
                if (waitSecs > 0 && sessionId === App.currentSession) {
                    App.startTokenRetry(waitSecs);
                }
                // WebSocket 출력 시 라이브 뷰 갱신 트리거 (디바운스)
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
            entry.reconnectTimer = setTimeout(function() {
                if (App.terminals[sessionId]) App.connectWS(sessionId);
            }, App.RECONNECT_INTERVAL_MS);
        };
    };
})();
