    // =========================================================================
    //  [P] INIT
    // =========================================================================
    var checkReady = setInterval(function () {
        if (typeof gamePage !== 'undefined' && gamePage.bld && gamePage.resPool) {
            clearInterval(checkReady);
            init();
        }
    }, 1000);

    function init() {
        console.log('[Auto] v5.0 (queue planner + linear value model) initializing...');
        window.__cfg       = cfg;
        window.__lastPlan  = function () { return lastPlan; };
        window.__execBuild = executeBuild;
        if (gamePage.ui && typeof gamePage.ui.confirm === 'function') {
            gamePage.ui.confirm = function (t, m, cb) { if (cb) cb(); return true; };
        }
        startClickerWorker();
        startSpeedWorker();
        setupUI();
        startOrchestrator();
        setStatus('Ready. Enable the planner to start.');
    }
