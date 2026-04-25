    // =========================================================================
    //  [PS] PHASE SENSOR
    //
    //  A coarse classifier of "where in the run am I?" — keyed off signature
    //  buildings and techs.  Each cycle the orchestrator calls
    //  recordPhaseSample(); when the highest-reached tier changes, a
    //  transition entry is appended to _phaseLog.  Used by the UI panel and
    //  for post-run pacing analysis (speedrun timing).
    //
    //  Phases are intentionally chunky — we want ~10 visible milestones over
    //  a full run, not 50 micro-steps.  The ladder is monotonic: once a
    //  signal fires it stays fired (we read game state, never decrement).
    // =========================================================================

    // Tier ladder.  `signal(game)` returns true if THIS tier has been reached.
    // Order matters: classifier walks top-down and returns the first hit.
    var PHASE_LADDER = [
        { tier: 9, name: 'Endgame',    signal: function (g) { return _bldCount(g, 'chronosphere') > 0; } },
        { tier: 8, name: 'Space',      signal: function (g) { return _hasAnySpaceBuilding(g); } },
        { tier: 7, name: 'Industry',   signal: function (g) { return _bldCount(g, 'steamworks') > 0
                                                                    || _bldCount(g, 'magneto') > 0; } },
        { tier: 6, name: 'Astronomy',  signal: function (g) { return _bldCount(g, 'observatory') > 0; } },
        { tier: 5, name: 'Iron age',   signal: function (g) { return _bldCount(g, 'smelter') > 0; } },
        { tier: 4, name: 'Workshop',   signal: function (g) { return _bldCount(g, 'workshop') > 0; } },
        { tier: 3, name: 'Mineral',    signal: function (g) { return _bldCount(g, 'mine') > 0; } },
        { tier: 2, name: 'Wood econ',  signal: function (g) { return _bldCount(g, 'field') >= 5
                                                                    && _bldCount(g, 'hut') >= 2; } },
        { tier: 1, name: 'Foundation', signal: function (g) { return _bldCount(g, 'library') >= 1
                                                                    && _bldCount(g, 'hut') >= 1; } },
        { tier: 0, name: 'Pregame',    signal: function (g) { return true; } }   // always
    ];

    function _bldCount(g, name) {
        try {
            if (!g || !g.bld || typeof g.bld.get !== 'function') return 0;
            var b = g.bld.get(name);
            return (b && typeof b.val === 'number') ? b.val : 0;
        } catch (e) { return 0; }
    }

    function _hasAnySpaceBuilding(g) {
        try {
            if (!g || !g.space || !g.space.programs) return false;
            // Space programs are missions, not buildings; check planets' buildings.
            var planets = g.space.planets || [];
            for (var i = 0; i < planets.length; i++) {
                var blds = planets[i].buildings || [];
                for (var j = 0; j < blds.length; j++)
                    if (blds[j].val > 0) return true;
            }
        } catch (e) { }
        return false;
    }

    // Returns { tier, name } for the highest-reached phase.  Pure function.
    function detectPhase(game) {
        for (var i = 0; i < PHASE_LADDER.length; i++) {
            try {
                if (PHASE_LADDER[i].signal(game))
                    return { tier: PHASE_LADDER[i].tier, name: PHASE_LADDER[i].name };
            } catch (e) { }
        }
        return { tier: 0, name: 'Pregame' };
    }

    var _phaseLog       = [];     // [{tier, name, atMs, year, season}]
    var _lastPhaseTier  = -1;     // -1 sentinel = not sampled yet
    var PHASE_LOG_MAX   = 100;

    // Sample current phase.  If tier changed since last sample, append entry.
    // Returns {phase, transitioned} for the orchestrator/UI.
    function recordPhaseSample(game, nowMs) {
        var phase = detectPhase(game);
        var transitioned = false;
        if (phase.tier !== _lastPhaseTier) {
            // Skip the very first sample at tier 0 — that's just startup, not a
            // milestone.  (Real Pregame→Foundation transitions still log.)
            if (!(_lastPhaseTier === -1 && phase.tier === 0)) {
                var entry = {
                    tier: phase.tier,
                    name: phase.name,
                    atMs: nowMs || Date.now()
                };
                try {
                    if (game && game.calendar) {
                        entry.year   = game.calendar.year;
                        entry.season = game.calendar.season;
                    }
                } catch (e) { }
                _phaseLog.push(entry);
                if (_phaseLog.length > PHASE_LOG_MAX) _phaseLog.shift();
                transitioned = true;
            }
            _lastPhaseTier = phase.tier;
        }
        return { phase: phase, transitioned: transitioned };
    }

    function getPhaseLog()      { return _phaseLog.slice(); }
    function getCurrentPhase()  { return { tier: _lastPhaseTier, name: _phaseName(_lastPhaseTier) }; }
    function _phaseName(tier) {
        for (var i = 0; i < PHASE_LADDER.length; i++)
            if (PHASE_LADDER[i].tier === tier) return PHASE_LADDER[i].name;
        return '?';
    }
    function _resetPhaseSensor() { _phaseLog = []; _lastPhaseTier = -1; }

    if (typeof window !== 'undefined') {
        window.__phaseLog = getPhaseLog;
        window.__phaseNow = function () {
            return detectPhase(typeof gamePage !== 'undefined' ? gamePage : null);
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            detectPhase: detectPhase,
            recordPhaseSample: recordPhaseSample,
            getPhaseLog: getPhaseLog,
            getCurrentPhase: getCurrentPhase,
            _resetPhaseSensor: _resetPhaseSensor,
            PHASE_LADDER: PHASE_LADDER
        };
    }
