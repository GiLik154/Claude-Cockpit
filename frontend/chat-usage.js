// 사용량 배지, 사용량 모달, 컨텍스트 폴링, 토큰 재시도
(function() {
    var App = window.ChatApp;

    /**
     * CLI 출력에서 토큰 사용량 파싱 (진행 중 또는 완료 상태).
     * { tokens, toolUses?, time?, status } 또는 null 반환.
     */
    App.parseUsageFromOutput = function(text) {
        var clean = App.stripAnsi(text);

        // 진행 중: "✢ Verb… (Xs · ↓ N tokens · ...)" 또는 "↑N tokens"
        var progressMatch = clean.match(/[✢✳✶✽✻]\s*\S+…?\s*\(([^)]*?(\d+[\d.]*[kKmM]?)\s*tokens[^)]*)\)/);
        if (progressMatch) {
            var tokenStr = progressMatch[2];
            var tokens = App.parseTokenCount(tokenStr);
            var timeMatch = progressMatch[1].match(/^([\dm\s]+s)/);
            return { tokens: tokens, time: timeMatch ? timeMatch[1].trim() : '', status: 'working' };
        }

        // 완료: "(N tool uses · N tokens · Xs)"
        var doneMatch = clean.match(/Done\s*\((\d+)\s*tool\s*uses?\s*·\s*([\d.]+[kKmM]?)\s*tokens?\s*·\s*([^)]+)\)/);
        if (doneMatch) {
            return {
                toolUses: parseInt(doneMatch[1]),
                tokens: App.parseTokenCount(doneMatch[2]),
                time: doneMatch[3].trim(),
                status: 'done'
            };
        }

        // 간단한 완료: "(N tokens · Xs)"
        var simpleDone = clean.match(/Done\s*\(([\d.]+[kKmM]?)\s*tokens?\s*·\s*([^)]+)\)/);
        if (simpleDone) {
            return {
                tokens: App.parseTokenCount(simpleDone[1]),
                time: simpleDone[2].trim(),
                status: 'done'
            };
        }

        return null;
    };

    /**
     * 속도/토큰 제한 감지.
     * 대기 시간(초) 반환 (감지 시 >0, 미감지 시 0).
     */
    App.detectTokenExpiry = function(text) {
        var patterns = [
            /(?:rate.?limit|token.?limit|too many requests).*?(\d+)\s*(?:second|sec|s\b|분)/i,
            /(?:retry|retrying|waiting|재시도|대기).*?(\d+)\s*(?:second|sec|s\b|분)/i,
            /(\d+)\s*(?:second|sec|s\b|분).*?(?:retry|wait|대기|재시도)/i,
            /⏳.*?(\d+)/,
        ];
        for (var p = 0; p < patterns.length; p++) {
            var m = text.match(patterns[p]);
            if (m) {
                var secs = parseInt(m[1], 10);
                if (text.includes('분')) secs *= 60;
                return secs;
            }
        }
        if (/(?:session.?expired|token.?expired|세션.*만료|토큰.*만료)/i.test(text)) {
            return App.TOKEN_EXPIRY_DEFAULT_SECS;
        }
        return 0;
    };

    App.startTokenRetry = function(waitSecs) {
        App.cancelTokenRetry();
        var remaining = waitSecs + App.TOKEN_RETRY_BUFFER_SECS;
        var bar = document.getElementById('tokenRetryBar');
        var msg = document.getElementById('tokenRetryMsg');
        bar.style.display = 'flex';

        App.tokenRetryCountdown = setInterval(function() {
            remaining--;
            if (remaining <= 0) {
                clearInterval(App.tokenRetryCountdown);
                msg.textContent = 'Retrying...';
                App.doTokenRetry();
            } else {
                msg.textContent = 'Token refresh in ' + remaining + 's... auto-retry';
            }
        }, 1000);
        msg.textContent = 'Token refresh in ' + remaining + 's... auto-retry';
    };

    App.doTokenRetry = function() {
        var bar = document.getElementById('tokenRetryBar');
        bar.style.display = 'none';
        if (!App.currentSession || !App.terminals[App.currentSession]) return;
        var t = App.terminals[App.currentSession];
        if (t.ws && t.ws.readyState === WebSocket.OPEN) {
            if (App.lastSentInput) {
                t.ws.send(JSON.stringify({ type: 'input', data: App.lastSentInput + '\r' }));
                App.showStatus('Auto-retried!', true);
            } else {
                t.ws.send(JSON.stringify({ type: 'input', data: '\r' }));
                App.showStatus('Auto-retried (Enter)', true);
            }
            App.lastSentInput = null;
        }
    };

    App.cancelTokenRetry = function() {
        clearInterval(App.tokenRetryCountdown);
        clearTimeout(App.tokenRetryTimer);
        App.tokenRetryCountdown = null;
        App.tokenRetryTimer = null;
        var bar = document.getElementById('tokenRetryBar');
        if (bar) bar.style.display = 'none';
    };

    App.updateUsageBadge = function(sessionId, usage) {
        if (!usage) return;
        App.sessionUsage[sessionId] = Object.assign({}, App.sessionUsage[sessionId] || {}, usage);
        if (sessionId !== App.currentSession) return;

        var badge = document.getElementById('usageBadge');
        if (!badge) return;

        var u = App.sessionUsage[sessionId];
        if (!u || (!u.tokens && u.contextLeft == null && u.sessionUsed == null)) {
            badge.innerHTML = 'Usage';
            return;
        }

        var colorFor = function(remaining) { return remaining <= 10 ? 'var(--danger)' : remaining <= 30 ? 'var(--warning)' : 'var(--success)'; };

        if (App.isMobile) {
            var text = '', color = '';
            if (u.contextLeft != null) {
                color = colorFor(u.contextLeft);
                text = 'CTX ' + u.contextLeft + '%';
            } else if (u.sessionUsed != null) {
                var r = 100 - u.sessionUsed;
                color = colorFor(r);
                text = 'S ' + r + '%';
            }
            if (u.sessionUsed != null && u.contextLeft != null) {
                var sr = 100 - u.sessionUsed;
                text = 'S ' + sr + '% \u00B7 CTX ' + u.contextLeft + '%';
                color = colorFor(Math.min(sr, u.contextLeft));
            }
            badge.innerHTML = text ? '<span style="color:' + color + '">' + text + '</span>' : 'Usage';
        } else {
            var parts = [];
            if (u.sessionUsed != null) {
                var r2 = 100 - u.sessionUsed;
                parts.push('<span style="color:' + colorFor(r2) + '">Session ' + r2 + '%</span>');
            }
            if (u.weekUsed != null) {
                var r3 = 100 - u.weekUsed;
                parts.push('<span style="color:' + colorFor(r3) + '">Week ' + r3 + '%</span>');
            }
            if (u.contextLeft != null) {
                parts.push('<span style="color:' + colorFor(u.contextLeft) + '">CTX ' + u.contextLeft + '%</span>');
            }
            if (u.tokens) parts.push('<span class="token-total">' + App.formatTokens(u.tokens) + ' tok</span>');
            badge.innerHTML = parts.join(' \u00B7 ');
        }
    };

    App.refreshUsageBadge = function() {
        var badge = document.getElementById('usageBadge');
        if (!badge) return;
        if (!App.currentSession) {
            badge.innerHTML = 'Usage';
            return;
        }
        var u = App.sessionUsage[App.currentSession];
        if (u) App.updateUsageBadge(App.currentSession, {});
        else badge.innerHTML = 'Usage';
        App.pollContextLeft();
    };

    App.pollContextLeft = function() {
        if (!App.currentSession) return;
        fetch('/api/sessions/' + App.currentSession + '/status')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.context_left !== null && data.context_left !== undefined) {
                    if (!App.sessionUsage[App.currentSession]) App.sessionUsage[App.currentSession] = {};
                    App.sessionUsage[App.currentSession].contextLeft = data.context_left;
                    App.updateUsageBadge(App.currentSession, {});
                }
            })
            .catch(function() {});
    };

    App.fetchUsage = function() {
        document.getElementById('usageModal').classList.add('active');
        App.fetchUsageDetail();
    };

    App.fetchUsageDetail = function() {
        if (App._fetchingUsage) return;
        App._fetchingUsage = true;
        var content = document.getElementById('usageContent');
        content.innerHTML = '<div class="usage-loading">Loading... (\uCCAB \uD638\uCD9C\uC740 \uBA87 \uCD08 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4)</div>';
        fetch('/api/usage', { method: 'POST' })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                App.renderUsageModal(data);
                if (App.currentSession) {
                    if (!App.sessionUsage[App.currentSession]) App.sessionUsage[App.currentSession] = {};
                    if (data.session_used != null) App.sessionUsage[App.currentSession].sessionUsed = data.session_used;
                    if (data.week_used != null) App.sessionUsage[App.currentSession].weekUsed = data.week_used;
                    App.updateUsageBadge(App.currentSession, {});
                }
            })
            .catch(function() {
                content.innerHTML = '<div class="usage-loading">Failed to fetch usage</div>';
            })
            .finally(function() { App._fetchingUsage = false; });
    };

    App.renderUsageModal = function(data) {
        var content = document.getElementById('usageContent');
        var colorClass = function(pct) { return pct >= 80 ? 'red' : pct >= 50 ? 'yellow' : 'green'; };

        var html = '';
        if (data.session_used != null) {
            html += '<div class="usage-meter">' +
                '<div class="usage-meter-label"><span>Session</span><span>' + data.session_used + '% used</span></div>' +
                '<div class="usage-meter-bar"><div class="usage-meter-fill ' + colorClass(data.session_used) + '" style="width:' + data.session_used + '%"></div></div>' +
                '</div>';
        }
        if (data.week_used != null) {
            html += '<div class="usage-meter">' +
                '<div class="usage-meter-label"><span>Week (All Models)</span><span>' + data.week_used + '% used</span></div>' +
                '<div class="usage-meter-bar"><div class="usage-meter-fill ' + colorClass(data.week_used) + '" style="width:' + data.week_used + '%"></div></div>' +
                '</div>';
        }
        if (data.sonnet_used != null) {
            html += '<div class="usage-meter">' +
                '<div class="usage-meter-label"><span>Week (Sonnet Only)</span><span>' + data.sonnet_used + '% used</span></div>' +
                '<div class="usage-meter-bar"><div class="usage-meter-fill ' + colorClass(data.sonnet_used) + '" style="width:' + data.sonnet_used + '%"></div></div>' +
                '</div>';
        }
        if (data.resets) {
            html += '<div class="usage-reset-info">Resets: ' + App.esc(data.resets) + '</div>';
        }
        if (!html) {
            html = '<div class="usage-loading">\uC0AC\uC6A9\uB7C9 \uC815\uBCF4\uB97C \uD30C\uC2F1\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4</div>';
        }
        content.innerHTML = html;
    };

    App.closeUsageModal = function() {
        document.getElementById('usageModal').classList.remove('active');
    };

    // index.html onclick 핸들러용 전역 노출
    window.fetchUsage = App.fetchUsage;
    window.fetchUsageDetail = App.fetchUsageDetail;
    window.closeUsageModal = App.closeUsageModal;
    window.cancelTokenRetry = App.cancelTokenRetry;
})();
