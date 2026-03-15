// 공유 상수, 상태, 유틸리티 함수
(function() {
    var App = window.ChatApp = window.ChatApp || {};

    App.RECONNECT_INTERVAL_MS = 2000;
    App.POLL_INTERVAL_MS = 10000;
    App.LOG_REFRESH_INTERVAL_MS = 3000;
    App.LIVE_LOG_REFRESH_INTERVAL_MS = 1000;
    App.PANES_REFRESH_INTERVAL_MS = 2000;
    App.STATUS_DISPLAY_DURATION_MS = 2000;
    App.FIT_DELAY_MS = 100;
    App.SCROLL_THRESHOLD_PX = 60;
    App.TERMINAL_SCROLLBACK = 5000;
    App.TEXTAREA_MAX_HEIGHT_PX = 120;
    App.TOKEN_RETRY_BUFFER_SECS = 5;
    App.TOKEN_EXPIRY_DEFAULT_SECS = 60;
    App.SIDEBAR_MIN_WIDTH_PX = 180;
    App.MOBILE_BREAKPOINT_PX = 768;
    App.HEALTH_CHECK_TIMEOUT_MS = 5000;
    App.PANE_SCAN_LINES = 20;
    App.STATUS_MSG_TRUNCATE = 50;
    App.RECONNECT_MAX_INTERVAL_MS = 30000;

    App.isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || window.innerWidth < App.MOBILE_BREAKPOINT_PX;

    App.DEFAULT_PLACEHOLDER = App.isMobile ? 'Enter 두 번 = 전송' : 'Enter=전송, Shift+Enter=개행 (Alt+1~9 세션전환)';
    App.FONT_FAMILY = "'SF Mono', 'Menlo', 'Consolas', monospace";
    App.TERMINAL_THEME = {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#4f8cff',
        selectionBackground: '#4f8cff44',
        black: '#1a1a2e', red: '#e74c3c', green: '#2ecc71',
        yellow: '#f39c12', blue: '#4f8cff', magenta: '#9b59b6',
        cyan: '#1abc9c', white: '#ecf0f1',
    };
    App.AGENT_AVATARS = ['\u{1F9D1}\u200D\u{1F4BC}', '\u{1F468}\u200D\u{1F4BB}', '\u{1F469}\u200D\u{1F4BB}', '\u{1F9D1}\u200D\u{1F3A8}', '\u{1F527}', '\u{1F4CA}', '\u{1F9EA}', '\u{1F4DD}'];

    App.terminals = {};
    App.currentSession = null;
    App.logRefreshTimer = null;
    App.lastLogHash = '';
    App.logDiv = null;
    App.panesMode = 'off'; // 'off' | 'both' | 'cards'
    App.panesTimer = null;
    App.paneStates = {};
    App.pendingInput = null;
    App.isComposing = false;
    App.tokenRetryTimer = null;
    App.tokenRetryCountdown = null;
    App.lastSentInput = null;
    App.sessionUsage = {};

    // 동시 fetch 방지 플래그
    App._refreshLogRunning = false;
    App._refreshPanesRunning = false;
    App._fetchingUsage = false;
    App._serverDown = false;
    App._statusTimer = null;
    App._panesAutoShown = false;
    App._lastDetectedModel = null;

    App.safeFit = function(addon) { try { addon.fit(); } catch (_) {} };

    App.esc = function(str) {
        var d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    };

    App.stripAnsi = function(str) {
        return str.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?[@-~]|\x1b\(B/g, '');
    };

    App.parseTokenCount = function(str) {
        var num = parseFloat(str);
        if (/[kK]/.test(str)) return Math.round(num * 1000);
        if (/[mM]/.test(str)) return Math.round(num * 1000000);
        return Math.round(num);
    };

    App.formatTokens = function(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return String(n);
    };
})();
