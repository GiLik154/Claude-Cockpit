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
            field.placeholder = App.DEFAULT_PLACEHOLDER;
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

    // 모달 오버레이 클릭 닫기
    document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    });

    // 글로벌 단축키
    document.addEventListener('keydown', function(e) {
        // ESC: 열린 모달 닫기
        if (e.key === 'Escape') {
            var modals = document.querySelectorAll('.modal-overlay.active');
            if (modals.length) { modals[modals.length - 1].classList.remove('active'); return; }
        }

        // 입력 필드에 포커스 중이면 대부분 무시
        var active = document.activeElement;
        var inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');

        // Alt+1~9: 세션 빠른 전환
        if (e.altKey && e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            var idx = parseInt(e.key) - 1;
            var items = document.querySelectorAll('.session-item .session-info');
            if (items[idx]) items[idx].click();
            return;
        }

        // 입력 필드 안이면 나머지 단축키 무시
        if (inInput) return;

        // Ctrl+N: 새 세션
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            App.openNewSession();
            return;
        }

        // Ctrl+L: 로그 뷰어
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
            e.preventDefault();
            App.viewLog();
            return;
        }

        // Ctrl+P: Panes 토글
        if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
            e.preventDefault();
            App.togglePanesView();
            return;
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
