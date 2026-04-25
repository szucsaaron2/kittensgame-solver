    // =========================================================================
    //  [SSP-D] POLICY GLUE  (Phase 1: shadow mode)
    //
    //  Wires computeSspValueTable() to live game state via the existing
    //  04c_symbolic snapshot.  Phase 1 NEVER changes behaviour — it only
    //  produces a ranking that the orchestrator logs alongside the user's
    //  cfg.terminalGoal.  The console hook window.__sspDebug() lets you
    //  inspect what SSP would pick on demand.
    // =========================================================================

    var _sspShadowLog       = [];   // [{ts, userGoal, sspTop, agree, top3}]
    var SSP_SHADOW_LOG_MAX  = 200;

    function _sspBuildDeps(eg) {
        var craftsByOutput = {};
        try {
            if (typeof _indexCraftsByOutput === 'function') {
                var scrape = (eg && eg.__scrape) ? eg.__scrape
                    : (typeof scrapeGraph === 'function' ? scrapeGraph(gamePage) : null);
                if (scrape) craftsByOutput = _indexCraftsByOutput(scrape, gamePage) || {};
            }
        } catch (e) { }
        return {
            applyActionSymbolic: (typeof applyActionSymbolic === 'function')
                ? applyActionSymbolic : null,
            timeToAffordInState: (typeof timeToAffordInState === 'function')
                ? timeToAffordInState : null,
            craftsByOutput: craftsByOutput,
            getBias: getSspBias,
            rewardWeight: 1.0
        };
    }

    // Run one shadow ranking pass.  Safe to call any time; returns null if
    // the prerequisites aren't loaded yet (game still booting).
    function pickTerminalGoalSSP(game, eg) {
        if (!eg || !eg.nodes) return null;
        if (typeof snapshotAlgebraicState !== 'function') return null;
        if (typeof timeToAffordInState !== 'function') return null;

        var algState;
        try { algState = snapshotAlgebraicState(game, eg); }
        catch (e) { return null; }

        var deps = _sspBuildDeps(eg);
        if (!deps.timeToAffordInState) return null;

        var result;
        try { result = computeSspValueTable(eg, algState, deps); }
        catch (e) { console.warn('[SSP] valueTable failed', e); return null; }

        return result;
    }

    function _sspShadowTick(game, eg, userGoal) {
        if (typeof cfg === 'undefined' || !cfg.sspShadow) return;
        var startMs = Date.now();
        var result  = pickTerminalGoalSSP(game, eg);
        var elapsed = Date.now() - startMs;
        if (!result) return;

        var top3 = result.ranking.slice(0, 3).map(function (r) {
            return {
                id: r.id,
                V: isFinite(r.V) ? +r.V.toFixed(1) : null,
                fanout: r.fanout,
                score: isFinite(r.score) ? +r.score.toFixed(1) : null
            };
        });
        var sspTop = top3.length > 0 ? top3[0].id : null;
        var entry = {
            ts: Date.now(),
            elapsedMs: elapsed,
            userGoal: userGoal || null,
            sspTop: sspTop,
            agree: !!(userGoal && sspTop && userGoal === sspTop),
            top3: top3,
            reachable: result.ranking.filter(function (r) { return r.reachable; }).length,
            total: result.ranking.length
        };
        _sspShadowLog.unshift(entry);
        if (_sspShadowLog.length > SSP_SHADOW_LOG_MAX) _sspShadowLog.pop();

        if (elapsed > 50) {
            console.log('[SSP] shadow tick took ' + elapsed + 'ms ('
                + entry.reachable + '/' + entry.total + ' reachable)');
        }
    }

    function _sspAgreementStats() {
        var n = _sspShadowLog.length;
        if (n === 0) return { samples: 0, agreeRate: null };
        var agree = 0, withUser = 0;
        for (var i = 0; i < n; i++) {
            if (_sspShadowLog[i].userGoal) {
                withUser++;
                if (_sspShadowLog[i].agree) agree++;
            }
        }
        return {
            samples: n,
            withUserGoal: withUser,
            agreeRate: withUser > 0 ? +(agree / withUser).toFixed(3) : null
        };
    }

    // ── Phase 4: feedback loop ────────────────────────────────────────────────
    // Tracks the current SSP-picked goal so that when it transitions to 'done'
    // we can compare predicted vs actual elapsed time and feed the ratio into
    // recordSspObservation().  Single-slot tracking — if SSP shifts to a new
    // pick before the old one completes, we abandon the in-flight observation.
    // In-memory only; a page reload loses any in-flight tracking.
    var _sspObservation = null;  // { goalId, predictedSecs, startedAtMs }

    function _sspFeedbackTick(eg, sspPickedGoal, predictedSecs) {
        try {
            // (1) Did the goal we were tracking just complete?  Record + clear.
            if (_sspObservation && eg && eg.nodes
                && eg.nodes[_sspObservation.goalId]
                && eg.nodes[_sspObservation.goalId].state === 'done') {
                var elapsedSecs = (Date.now() - _sspObservation.startedAtMs) / 1000;
                if (elapsedSecs > 0 && typeof recordSspObservation === 'function') {
                    recordSspObservation(_sspObservation.goalId,
                        _sspObservation.predictedSecs, elapsedSecs);
                }
                _sspObservation = null;
            }

            // (2) Start tracking the current pick (or switch tracking if SSP
            // changed its mind — the prior in-flight observation is dropped).
            // Skip nodes that are already 'done' — recording would be a no-op
            // and we'd just keep re-tracking a completed goal forever.
            var pickedNode = (eg && eg.nodes) ? eg.nodes[sspPickedGoal] : null;
            var pickedDone = pickedNode && pickedNode.state === 'done';
            if (sspPickedGoal && !pickedDone && typeof predictedSecs === 'number'
                && isFinite(predictedSecs) && predictedSecs > 0) {
                if (!_sspObservation || _sspObservation.goalId !== sspPickedGoal) {
                    _sspObservation = {
                        goalId: sspPickedGoal,
                        predictedSecs: predictedSecs,
                        startedAtMs: Date.now()
                    };
                }
            } else if (!sspPickedGoal) {
                // SSP didn't pick anything this cycle — abandon tracking.
                _sspObservation = null;
            }
        } catch (e) { console.warn('[SSP] feedback tick failed', e); }
    }

    function _sspAbandonObservation() { _sspObservation = null; }
    function _sspPendingObservation() { return _sspObservation; }

    // ── Console hooks ────────────────────────────────────────────────────────
    if (typeof window !== 'undefined') {
        window.__sspDebug = function () {
            var eg = (typeof getCachedEdgeGraph === 'function')
                ? getCachedEdgeGraph(gamePage) : null;
            if (!eg) { console.warn('[SSP] no edge graph yet'); return null; }
            var result = pickTerminalGoalSSP(gamePage, eg);
            if (!result) { console.warn('[SSP] could not compute'); return null; }
            console.log('[SSP] terminal-goal ranking (top 10):');
            console.table(result.ranking.slice(0, 10).map(function (r) {
                return {
                    id: r.id,
                    V_secs: isFinite(r.V) ? +r.V.toFixed(1) : '∞',
                    fanout: r.fanout,
                    score: isFinite(r.score) ? +r.score.toFixed(1) : '∞'
                };
            }));
            return result;
        };

        window.__sspShadowLog  = function () { return _sspShadowLog; };
        window.__sspAgreement = _sspAgreementStats;
        window.__sspBeliefDump = function () {
            var t = _sspBeliefLoad();
            console.table(t);
            return t;
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            pickTerminalGoalSSP: pickTerminalGoalSSP,
            _sspShadowTick: _sspShadowTick,
            _sspAgreementStats: _sspAgreementStats,
            _sspFeedbackTick: _sspFeedbackTick,
            _sspAbandonObservation: _sspAbandonObservation,
            _sspPendingObservation: _sspPendingObservation
        };
    }
