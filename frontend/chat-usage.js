// 사용량 배지, 사용량 모달, 컨텍스트 폴링, 토큰 재시도
(function() {
    var App = window.ChatApp;

    // NOTE: 백엔드 WebSocket에서 usage_update 메시지로 대체됨. 폴백용으로 유지.
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

    // NOTE: 백엔드 WebSocket에서 token_expiry 메시지로 대체됨. 폴백용으로 유지.
    App.detectTokenExpiry = function(text) {
        var clean = App.stripAnsi(text);
        var lines = clean.split('\n');
        var patterns = [
            /(?:rate.?limit|token.?limit|too many requests).*?(\d+)\s*(?:second|sec|s\b|분)/i,
            /(?:retry|retrying|waiting).*?(\d+)\s*(?:second|sec|s\b|분)/i,
            /(\d+)\s*(?:second|sec|s\b|분).*?(?:retry|wait)/i,
            /⏳.*?(\d+)/,
        ];
        for (var li = 0; li < lines.length; li++) {
            var line = lines[li].trim();
            // 사용자 입력, thinking/working, 일반 진행 상태는 건너뛰기
            if (!line || /^❯/.test(line) || /^[✻✳✶✽✢⏺⎿]/.test(line)) continue;
            for (var p = 0; p < patterns.length; p++) {
                var m = line.match(patterns[p]);
                if (m) {
                    var secs = parseInt(m[1], 10);
                    if (secs < 5 || secs > 3600) continue; // 5초 미만 또는 1시간 초과는 무시
                    if (line.includes('분')) secs *= 60;
                    return secs;
                }
            }
        }
        if (/(?:session.?expired|token.?expired|세션.*만료|토큰.*만료)/i.test(clean)) {
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
                msg.textContent = '재시도 중...';
                App.doTokenRetry();
            } else {
                msg.textContent = '토큰 갱신까지 ' + remaining + '초... 자동 재시도';
            }
        }, 1000);
        msg.textContent = '토큰 갱신까지 ' + remaining + '초... 자동 재시도';
    };

    App.doTokenRetry = function() {
        var bar = document.getElementById('tokenRetryBar');
        bar.style.display = 'none';
        if (!App.currentSession || !App.terminals[App.currentSession]) return;
        // 세션 사용량 재확인 — 98% 미만이면 재시도 취소
        var u = App.sessionUsage[App.currentSession];
        if (u && u.sessionUsed != null && u.sessionUsed < 98) return;
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
                // 모델이 감지되면 세션 목록 갱신 (메타데이터가 업데이트됨)
                if (data.model && !App._lastDetectedModel) {
                    App._lastDetectedModel = data.model;
                    App.loadSessions();
                } else if (data.model && data.model !== App._lastDetectedModel) {
                    App._lastDetectedModel = data.model;
                    App.loadSessions();
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
        var safePct = function(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : Math.max(0, Math.min(100, n)); };

        var html = '';
        if (data.session_used != null) {
            var su = safePct(data.session_used);
            html += '<div class="usage-meter">' +
                '<div class="usage-meter-label"><span>Session</span><span>' + su + '% used</span></div>' +
                '<div class="usage-meter-bar"><div class="usage-meter-fill ' + colorClass(su) + '" style="width:' + su + '%"></div></div>' +
                '</div>';
        }
        if (data.week_used != null) {
            var wu = safePct(data.week_used);
            html += '<div class="usage-meter">' +
                '<div class="usage-meter-label"><span>Week (All Models)</span><span>' + wu + '% used</span></div>' +
                '<div class="usage-meter-bar"><div class="usage-meter-fill ' + colorClass(wu) + '" style="width:' + wu + '%"></div></div>' +
                '</div>';
        }
        if (data.sonnet_used != null) {
            var sou = safePct(data.sonnet_used);
            html += '<div class="usage-meter">' +
                '<div class="usage-meter-label"><span>Week (Sonnet Only)</span><span>' + sou + '% used</span></div>' +
                '<div class="usage-meter-bar"><div class="usage-meter-fill ' + colorClass(sou) + '" style="width:' + sou + '%"></div></div>' +
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
