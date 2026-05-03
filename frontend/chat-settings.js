// 설정 모달: 로그 보관일수 + 즉시 정리
(function() {
    var App = window.ChatApp;

    function fmtBytes(n) {
        if (!n || n < 1024) return (n || 0) + ' B';
        var units = ['KB', 'MB', 'GB'];
        var v = n / 1024;
        for (var i = 0; i < units.length; i++) {
            if (v < 1024) return v.toFixed(1) + ' ' + units[i];
            v /= 1024;
        }
        return v.toFixed(1) + ' TB';
    }

    function refreshStats() {
        var el = document.getElementById('settingsStats');
        if (!el) return;
        el.textContent = '로그 사용량 확인 중...';
        fetch('/api/logs/stats')
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(d) {
                if (!d) { el.textContent = '사용량 조회 실패'; return; }
                el.textContent = '현재 로그: ' + d.file_count + '개 · ' + fmtBytes(d.total_bytes);
            })
            .catch(function() { el.textContent = '사용량 조회 실패'; });
    }

    App.openSettingsModal = function() {
        var modal = document.getElementById('settingsModal');
        if (!modal) return;
        var input = document.getElementById('settingsRetentionDays');
        modal.classList.add('active');
        refreshStats();
        fetch('/api/settings')
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(d) {
                if (d && typeof d.log_retention_days === 'number') {
                    input.value = d.log_retention_days;
                }
            })
            .catch(function() {});
    };

    App.closeSettingsModal = function() {
        var modal = document.getElementById('settingsModal');
        if (modal) modal.classList.remove('active');
    };

    App.saveSettings = function() {
        var input = document.getElementById('settingsRetentionDays');
        var val = parseInt(input.value, 10);
        if (!Number.isFinite(val) || val < 1 || val > 90) {
            App.showStatus('보관일수는 1~90 사이여야 합니다');
            return;
        }
        fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ log_retention_days: val }),
        })
            .then(function(r) {
                if (!r.ok) throw new Error('save failed');
                return r.json();
            })
            .then(function() {
                App.showStatus('설정이 저장되었습니다', true);
                App.closeSettingsModal();
            })
            .catch(function() { App.showStatus('설정 저장 실패'); });
    };

    App.cleanupLogsNow = function() {
        var btn = event && event.target;
        if (btn) btn.disabled = true;
        fetch('/api/logs/cleanup', { method: 'POST' })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(d) {
                if (!d) { App.showStatus('정리 실패'); return; }
                App.showStatus('회전 ' + d.rotated + '개, 삭제 ' + d.deleted + '개', true);
                refreshStats();
            })
            .catch(function() { App.showStatus('정리 실패'); })
            .then(function() { if (btn) btn.disabled = false; });
    };

    window.openSettingsModal = App.openSettingsModal;
    window.closeSettingsModal = App.closeSettingsModal;
    window.saveSettings = App.saveSettings;
    window.cleanupLogsNow = App.cleanupLogsNow;
})();
