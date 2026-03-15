// UI 헬퍼: 토스트, 사이드바, 모달, 레이아웃
(function() {
    var App = window.ChatApp;

    App.showStatus = function(msg, isSuccess, duration) {
        var el = document.getElementById('statusMsg');
        if (!el) {
            el = document.createElement('div');
            el.id = 'statusMsg';
            el.style.cssText = 'position:fixed;top:50px;left:50%;transform:translateX(-50%);color:#fff;padding:8px 20px;border-radius:20px;font-size:12px;z-index:200;max-width:90vw;cursor:pointer;';
            el.addEventListener('click', function() { el.style.display = 'none'; });
            document.body.appendChild(el);
        }
        el.textContent = msg;
        if (isSuccess) {
            el.style.background = 'rgba(46,204,113,0.9)';
            el.style.pointerEvents = 'none';
        } else {
            el.style.background = 'rgba(231,76,60,0.9)';
            el.style.pointerEvents = 'auto';
        }
        el.style.display = 'block';
        clearTimeout(App._statusTimer);
        var ms = duration || (isSuccess ? 2000 : 5000);
        App._statusTimer = setTimeout(function() { el.style.display = 'none'; }, ms);
    };

    App.toggleSidebar = function() {
        document.getElementById('sidebar').classList.toggle('collapsed');
    };

    // 사이드바 드래그 리사이즈 (데스크톱 전용, localStorage에 너비 저장)
    (function() {
        var handle = document.getElementById('sidebarResize');
        var sidebar = document.getElementById('sidebar');
        if (!handle || !sidebar) return;

        var startX, startW;

        function onMouseDown(e) {
            if (window.innerWidth < App.MOBILE_BREAKPOINT_PX) return;
            e.preventDefault();
            startX = e.clientX;
            startW = sidebar.getBoundingClientRect().width;
            handle.classList.add('active');
            document.body.classList.add('sidebar-resizing');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }

        function onMouseMove(e) {
            var newW = Math.max(App.SIDEBAR_MIN_WIDTH_PX, Math.min(window.innerWidth * 0.5, startW + (e.clientX - startX)));
            sidebar.style.setProperty('--sidebar-width', newW + 'px');
            if (App.currentSession && App.terminals[App.currentSession]) {
                App.safeFit(App.terminals[App.currentSession].fitAddon);
            }
        }

        function onMouseUp() {
            handle.classList.remove('active');
            document.body.classList.remove('sidebar-resizing');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            try { localStorage.setItem('sidebar-width', sidebar.style.getPropertyValue('--sidebar-width')); } catch (_) {}
        }

        handle.addEventListener('mousedown', onMouseDown);

        // 저장된 너비 복원
        try {
            var saved = localStorage.getItem('sidebar-width');
            if (saved) sidebar.style.setProperty('--sidebar-width', saved);
        } catch (_) {}
    })();

    App.DANGER_PRESETS = { 'skip-permissions': true, 'both': true };

    App.onPresetChange = function() {
        var preset = document.getElementById('sessionPreset').value;
        var warn = document.getElementById('presetDangerWarning');
        if (warn) warn.style.display = App.DANGER_PRESETS[preset] ? 'block' : 'none';
    };

    App.openNewSession = function() {
        document.getElementById('sessionName').value = '';
        document.getElementById('sessionCwd').value = '';
        document.getElementById('newSessionModal').classList.add('active');
        App.onPresetChange();
    };

    App.closeModal = function() {
        document.getElementById('newSessionModal').classList.remove('active');
    };

    App.openTeamModal = function() {
        if (!App.currentSession || !App.terminals[App.currentSession]) {
            App.showStatus('세션을 먼저 선택하세요');
            return;
        }
        document.getElementById('teamTask').value = '';
        document.getElementById('teamModal').classList.add('active');
        document.getElementById('teamTask').focus();
    };

    App.closeTeamModal = function() {
        document.getElementById('teamModal').classList.remove('active');
    };

    App.sendTeamRequest = function() {
        var task = document.getElementById('teamTask').value.trim();
        if (!task) { App.showStatus('작업 내용을 입력하세요'); return; }
        var count = document.getElementById('teamCount').value;

        var prompt = 'Use the TeamCreate tool to create an agent team (NOT subagents via the Agent tool). Task: ' + task;
        if (count) prompt += '\nCreate ' + count + ' teammates.';

        var t = App.terminals[App.currentSession];
        if (!t || !t.ws || t.ws.readyState !== WebSocket.OPEN) {
            App.showStatus('세션이 연결되지 않았습니다');
            return;
        }
        t.ws.send(JSON.stringify({ type: 'input', data: prompt + '\r' }));
        App.closeTeamModal();
        App.showStatus('에이전트 팀 요청 전송됨', true);

        // 팀 생성 시 Panes 버튼 자동 표시
        var panesBtn = document.getElementById('panesBtn');
        if (panesBtn) panesBtn.style.display = '';
    };

    App.showConnectionOverlay = function(sessionId, show) {
        var container = document.getElementById('term-' + sessionId);
        if (!container) return;
        var overlay = container.querySelector('.ws-overlay');
        if (show) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'ws-overlay';
                overlay.innerHTML = '<div class="ws-overlay-spinner"></div><div>Reconnecting...</div>';
                container.appendChild(overlay);
            }
        } else if (overlay) { overlay.remove(); }
    };

    App.updateSendButton = function() {
        var btn = document.querySelector('.input-bar .send-btn');
        if (!btn) return;
        var t = App.terminals[App.currentSession];
        if (t && t.ws && t.ws.readyState === WebSocket.OPEN) {
            btn.disabled = false; btn.textContent = 'Send';
        } else {
            btn.disabled = true; btn.textContent = '...';
        }
    };

    App.renderSessionsList = function() {
        document.querySelectorAll('.session-item').forEach(function(el) {
            var onclick = el.querySelector('.session-info');
            if (!onclick) return;
            var attr = onclick.getAttribute('onclick');
            if (!attr) return;
            var m = attr.match(/'([^']+)'/);
            if (m) el.classList.toggle('active', m[1] === App.currentSession);
        });
    };

    App.goHome = function() {
        if (App.viewMode !== 'terminal') { App.exitLiveView(); App.viewMode = 'terminal'; App.updateViewModeBtn(); }
        App.setPanesOff();
        App.cleanupPanes();
        Object.keys(App.terminals).forEach(function(sid) {
            var el = document.getElementById('term-' + sid);
            if (el) el.style.display = 'none';
        });
        App.currentSession = null;
        document.getElementById('emptyState').style.display = 'flex';
        document.getElementById('inputBar').style.display = 'none';
        App.renderSessionsList();
        App.refreshUsageBadge();
    };

    // 온보딩 캐러셀
    App._onboardingSlide = 0;
    var SLIDE_COUNT = 4;

    App.onboardingGo = function(idx) {
        if (idx < 0 || idx >= SLIDE_COUNT) return;
        App._onboardingSlide = idx;
        var slides = document.querySelectorAll('.onboarding-slide');
        var dots = document.querySelectorAll('.onboarding-dot');
        slides.forEach(function(s) { s.classList.remove('active'); });
        dots.forEach(function(d) { d.classList.remove('active'); });
        if (slides[idx]) slides[idx].classList.add('active');
        if (dots[idx]) dots[idx].classList.add('active');
    };

    App.onboardingNav = function(dir) {
        App.onboardingGo(App._onboardingSlide + dir);
    };

    // 터치 스와이프
    (function() {
        var carousel = document.getElementById('onboardingCarousel');
        if (!carousel) return;
        var startX = 0;
        carousel.addEventListener('touchstart', function(e) {
            startX = e.touches[0].clientX;
        }, { passive: true });
        carousel.addEventListener('touchend', function(e) {
            var diff = startX - e.changedTouches[0].clientX;
            if (Math.abs(diff) > 50) {
                App.onboardingNav(diff > 0 ? 1 : -1);
            }
        }, { passive: true });
    })();

    // index.html onclick 핸들러용 전역 노출
    window.goHome = App.goHome;
    window.toggleSidebar = App.toggleSidebar;
    window.openNewSession = App.openNewSession;
    window.closeModal = App.closeModal;
    window.onPresetChange = App.onPresetChange;
    window.openTeamModal = App.openTeamModal;
    window.closeTeamModal = App.closeTeamModal;
    window.sendTeamRequest = App.sendTeamRequest;
    window.onboardingGo = App.onboardingGo;
    window.onboardingNav = App.onboardingNav;
})();
