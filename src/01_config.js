    // =========================================================================
    //  [B] CONFIGURATION & STATE
    // =========================================================================
    var cfg = {
        mctsEnabled: false,
        autoObserve: true,
        clicksPerSec: 0,
        decisionIntervalMs: 3000,
        goldTradeReserve: 0,
        faithPraiseReserve: 0,
        speedMultiplier: 1,
        terminalGoal: null,
        // ── Beam search ──────────────────────────────────────────────────────
        beamEnabled:        true,
        beamDepth:          3,
        beamWidth:          4,
        beamBudgetMs:       400,
        beamCandidateMode:  'goalAware',   // 'goalAware' | 'frontier'
        beamMaxCandidates:  10,
        // ── OR-picker fanout weighting ───────────────────────────────────────
        // _leafCount's OR selector divides each option's leaf-cost by
        // (1 + fanoutWeight × effectiveFanout). 0 recovers the legacy
        // cheapest-chain-by-count behavior; 1 biases strongly toward gateways.
        fanoutWeight:       1.0,
    };

    function saveCfg() {
        try { localStorage.setItem('mctsAuto_cfg', JSON.stringify(cfg)); } catch (e) { }
    }
    function loadCfg() {
        try {
            var saved = JSON.parse(localStorage.getItem('mctsAuto_cfg'));
            if (saved) {
                for (var key in cfg) {
                    if (key === 'clicksPerSec') continue;
                    if (key in saved) cfg[key] = saved[key];
                }
            }
        } catch (e) { }
    }
    loadCfg();

    var mctsRunning = false;
    var lastDecisionTime = 0;
    var decisionLog = [];
    var clickerWorker = null;
    var speedWorker = null;

    // Instant-buy dedupe key set, reset each orchestrator cycle.
    var instantBoughtKeys = {};
    // Snapshot of the last planNextAction() result — consumed by UI.
    var lastPlan = null;

    // Shared resolve-context hint for one orchestrator cycle (ratio/craft-price caches).
    var _cycleCtx = null;
