// 앱 초기화 및 이벤트 리스너 (모든 모듈 로드 후 마지막에 실행)
(function() {
    var App = window.ChatApp;

    App.healthCheck = function() {
        return fetch('/api/health', { signal: AbortSignal.timeout(App.HEALTH_CHECK_TIMEOUT_MS) })
            .then(function(res) {
                if (res.ok) {
                    if (App._serverDown) {
                        App._serverDown = false;
                        App.showStatus('\uC11C\uBC84 \uC7AC\uC5F0\uACB0\uB428', true);
                        App.loadSessions();
                    }
                    return true;
                }
                throw new Error('not ok');
            })
            .catch(function() {
                if (!App._serverDown) {
                    App._serverDown = true;
                    App.showStatus('\uC11C\uBC84 \uC5F0\uACB0 \uB04A\uAE40');
                }
                return false;
            });
    };

    document.addEventListener('DOMContentLoaded', function() {
        var field = document.getElementById('inputField');
        if (field) {
            // 모바일: readonly로 페이지 로드 시 키보드 방지, focus/blur로 토글
            field.addEventListener('focus', function() { field.removeAttribute('readonly'); });
            field.addEventListener('blur', function() { field.setAttribute('readonly', ''); });

            // IME 조합 상태 추적 (한글 입력 중 전송 방지)
            field.addEventListener('compositionstart', function() { App.isComposing = true; });
            field.addEventListener('compositionend', function() {
                App.isComposing = false;
                // Chrome: Enter로 조합 확정 시 keydown이 먼저 발생해 전송 누락 → 여기서 처리
                if (!App.isMobile && App._enterEndedComposition) {
                    App._enterEndedComposition = false;
                    setTimeout(function() { App.doSend(); }, 0);
                }
            });

            // 데스크톱: Enter=전송, Shift+Enter=개행 / 모바일: 더블엔터=전송
            field.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    // IME 조합 중이면 전송 보류 (조합 확정 후 compositionend에서 처리)
                    // isComposing 지원 브라우저는 isComposing만 사용, 미지원 시 keyCode 229 폴백
                    var composing = e.isComposing !== undefined ? e.isComposing : (e.keyCode === 229);
                    if (composing) {
                        if (!App.isMobile) App._enterEndedComposition = true;
                        return;
                    }
                    if (App.isMobile) {
                        if (field.value.endsWith('\n')) { e.preventDefault(); App.doSend(); }
                    } else {
                        e.preventDefault(); App.doSend();
                    }
                }
            });
            field.addEventListener('input', function() { App.autoResizeField(); });
        }
    });

    App.loadSessions();

    // 주기적 폴링 (헬스체크, 세션 목록, panes, 컨텍스트 사용량)
    setInterval(function() {
        App.healthCheck().then(function(ok) {
            if (!ok) return;
            fetch('/api/sessions').then(function(r) { return r.json(); }).then(function(sessions) {
                App.renderSessions(sessions);
                sessions.forEach(function(s) {
                    if (s.alive && !App.terminals[s.session_id]) App.createTerminal(s.session_id);
                });
            }).catch(function() {});
            App.checkPanes();
            App.pollContextLeft();
        });
    }, App.POLL_INTERVAL_MS);
})();
