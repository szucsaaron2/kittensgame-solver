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
        // ── SSP-Dynamic shadow mode (Phase 1) ────────────────────────────────
        // When true, every queue cycle computes a Bellman ranking over
        // candidate terminal goals and logs it to _sspShadowLog.  Pure
        // observation — does NOT change the user-selected cfg.terminalGoal.
        // Inspect with window.__sspDebug() / window.__sspAgreement().
        sspShadow:          true,
        // ── SSP-Dynamic active mode (Phase 2) ────────────────────────────────
        // When true, the orchestrator overrides cfg.terminalGoal with the SSP
        // top pick each cycle.  When false, the user's goal selection is used
        // as before (legacy behaviour).  Default false — opt-in.
        sspEnabled:         false,
        // ── Cap-horizon guard ────────────────────────────────────────────────
        // When the chosen action is cap-limited (price > storage with no craft
        // escape), redirect to the cheapest cap-raiser. Default on; flip to
        // false to fall back to legacy stall-and-wait behaviour.
        capHorizon:         true,
        // ── Titanium burst trading ───────────────────────────────────────────
        // Zebras give titanium per trade (0.35% + 0.35% per ship). Background
        // trading at 1/cycle is too slow for speedrunning the iron→industry
        // hop. When zebras are unlocked and ships ≥ ShipFloor, fire up to
        // Batch trades per cycle (capped by the game's getMaxTradeAmt).
        // Set Batch=0 to disable.
        titaniumTradeBatch:    25,
        titaniumTradeShipFloor: 1,
        // ── OR-picker fanout weighting ───────────────────────────────────────
        // _leafCount's OR selector divides each option's leaf-cost by
        // (1 + fanoutWeight × effectiveFanout). 0 recovers the legacy
        // cheapest-chain-by-count behavior; 1 biases strongly toward gateways.
        fanoutWeight:       1.0,
        // ── Prod-helper horizon ──────────────────────────────────────────────
        // When chain backward sees a positive but tiny resource rate, it can
        // declare the cost "satisfied" and skip surfacing producers — even if
        // the real time-to-afford is hours.  This horizon (seconds) is the cap:
        // if deficit / rate > horizon, treat as prod-limited and surface
        // producers anyway.  600s = 10 min keeps early-game catnip aggressive.
        prodHelperHorizonSecs: 600,
        // ── Housing safety headroom ──────────────────────────────────────────
        // Multiplier on the bare per-kitten catnip burn (0.85/s) that the
        // post-occupancy projection demands before allowing a housing build.
        // 1.0 = knife-edge (rate plateaus at 0), 1.25 = 25% surplus headroom.
        // Higher values push the planner toward more fields per hut.
        housingHeadroom: 2.0,
        // ── Catnip-spend safety horizon ──────────────────────────────────────
        // Any build whose price includes catnip is gated on a post-spend
        // projection: stock - price + rate*horizon must stay > 0. If not,
        // redirect to a catnip producer instead of stalling at 0 stock.
        // 0 disables the check.
        catnipSpendSafetyHorizonSecs: 30,
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
    // Snapshot of the last SSP ranking — consumed by UI debug panel.
    var lastSspResult = null;

    // Shared resolve-context hint for one orchestrator cycle (ratio/craft-price caches).
    var _cycleCtx = null;
