    // =========================================================================
    //  [SSP-D] BELIEF TABLE  (Phase 1: cold-start stub)
    //
    //  Per-goal multiplicative bias on predicted edge times:
    //      time_actual ≈ b[g] · time_predicted
    //
    //  Phase 1 — getBias() always returns 1.0 (cold start; trust the registry).
    //  Phase 3 will wire recordObservation() into the orchestrator's completion
    //  callback to maintain an EWMA-updated bias persisted in localStorage.
    //  The API is set in stone now so callers don't change between phases.
    // =========================================================================

    var SSP_BELIEF_KEY    = 'mctsAuto_sspBelief';
    var SSP_BELIEF_ALPHA  = 0.2;
    var SSP_BELIEF_CLIP   = [0.25, 4.0];
    // Confidence weighting: getSspBias returns a blend of the raw EWMA bias
    // and the cold-start prior (1.0), tilting toward the prior until enough
    // observations have accumulated.
    //   effective = (WARMUP_N * 1.0 + count * raw) / (WARMUP_N + count)
    // With WARMUP_N=5: 0 obs → 1.0, 5 obs → halfway, 20 obs ≈ raw.
    var SSP_BELIEF_WARMUP = 5;

    var _sspBeliefStore = null;   // injected for tests; null → use localStorage
    var _sspBeliefCache = null;

    function _sspBeliefStorage() {
        if (_sspBeliefStore) return _sspBeliefStore;
        if (typeof localStorage !== 'undefined') return localStorage;
        return null;
    }

    function _sspBeliefLoad() {
        if (_sspBeliefCache) return _sspBeliefCache;
        var s = _sspBeliefStorage();
        if (!s) { _sspBeliefCache = {}; return _sspBeliefCache; }
        try {
            var raw = s.getItem(SSP_BELIEF_KEY);
            _sspBeliefCache = raw ? (JSON.parse(raw) || {}) : {};
        } catch (e) { _sspBeliefCache = {}; }
        return _sspBeliefCache;
    }

    function _sspBeliefPersist() {
        var s = _sspBeliefStorage();
        if (!s || !_sspBeliefCache) return;
        try { s.setItem(SSP_BELIEF_KEY, JSON.stringify(_sspBeliefCache)); } catch (e) { }
    }

    // Normalises a stored entry (legacy numeric or new {bias,count}) into
    // the canonical {bias, count} shape.  Returns null for invalid values
    // so the caller can default to {bias:1, count:0}.
    function _sspBeliefRead(goalId) {
        var t = _sspBeliefLoad();
        var v = t[goalId];
        if (typeof v === 'number' && isFinite(v) && v > 0) {
            // Legacy: treat a single persisted bias as 1 sample.
            return { bias: v, count: 1 };
        }
        if (v && typeof v === 'object'
            && typeof v.bias === 'number' && isFinite(v.bias) && v.bias > 0
            && typeof v.count === 'number' && v.count >= 0) {
            return { bias: v.bias, count: v.count };
        }
        return null;
    }

    function _sspEffectiveBias(rec) {
        if (!rec) return 1.0;
        var n = rec.count, w = SSP_BELIEF_WARMUP;
        return (w * 1.0 + n * rec.bias) / (w + n);
    }

    function getSspBias(goalId) {
        if (!goalId) return 1.0;
        return _sspEffectiveBias(_sspBeliefRead(goalId));
    }

    // Returns {bias, count, effective} for debug/UI surfaces.  Always returns
    // an object — cold-start goals get {bias:1, count:0, effective:1}.
    function getSspBeliefRecord(goalId) {
        var rec = _sspBeliefRead(goalId) || { bias: 1.0, count: 0 };
        return { bias: rec.bias, count: rec.count, effective: _sspEffectiveBias(rec) };
    }

    // Records a (predicted, actual) pair: updates EWMA bias and increments
    // sample count.  Bias is the long-run estimate; count drives confidence.
    function recordSspObservation(goalId, predictedSecs, actualSecs) {
        if (!goalId || !isFinite(predictedSecs) || !isFinite(actualSecs)) return;
        if (predictedSecs <= 0 || actualSecs <= 0) return;
        var ratio = actualSecs / predictedSecs;
        if (ratio < SSP_BELIEF_CLIP[0]) ratio = SSP_BELIEF_CLIP[0];
        if (ratio > SSP_BELIEF_CLIP[1]) ratio = SSP_BELIEF_CLIP[1];
        var t = _sspBeliefLoad();
        var rec = _sspBeliefRead(goalId);
        var priorBias  = rec ? rec.bias  : 1.0;
        var priorCount = rec ? rec.count : 0;
        t[goalId] = {
            bias:  SSP_BELIEF_ALPHA * ratio + (1 - SSP_BELIEF_ALPHA) * priorBias,
            count: priorCount + 1
        };
        _sspBeliefPersist();
    }

    function resetSspBelief() {
        _sspBeliefCache = {};
        _sspBeliefPersist();
    }

    // Test injection: pass a Map-backed object with getItem/setItem/removeItem.
    function _setSspBeliefStorage(impl) {
        _sspBeliefStore = impl || null;
        _sspBeliefCache = null;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            getSspBias: getSspBias,
            getSspBeliefRecord: getSspBeliefRecord,
            recordSspObservation: recordSspObservation,
            resetSspBelief: resetSspBelief,
            _setSspBeliefStorage: _setSspBeliefStorage,
            SSP_BELIEF_ALPHA: SSP_BELIEF_ALPHA,
            SSP_BELIEF_CLIP: SSP_BELIEF_CLIP,
            SSP_BELIEF_KEY: SSP_BELIEF_KEY,
            SSP_BELIEF_WARMUP: SSP_BELIEF_WARMUP
        };
    }
