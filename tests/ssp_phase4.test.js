// Phase 4 — SSP-Dynamic feedback loop. Verifies that _sspFeedbackTick
// records observations when tracked goals complete, abandons stale
// in-flight observations when SSP shifts pick, and is a no-op without
// SSP being active.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, it, assert, eq, near } = require('./_harness');

const ssp_value  = require('../src/04e_ssp_value.js');
const ssp_belief = require('../src/04f_ssp_belief.js');

function makeSandbox(overrides) {
    const recorded = [];
    const base = {
        computeSspValueTable: ssp_value.computeSspValueTable,
        getSspBias:           ssp_belief.getSspBias,
        recordSspObservation: (id, predicted, actual) => {
            recorded.push({ id, predicted, actual });
            ssp_belief.recordSspObservation(id, predicted, actual);
        },
        snapshotAlgebraicState: () => ({ unlocks: {}, resources: {}, rates: {}, caps: {} }),
        timeToAffordInState:    () => ({ secs: 1, capLimited: false }),
        applyActionSymbolic:    (s, n) => Object.assign({}, s, { unlocks: Object.assign({}, s.unlocks, { [n.id]: true }) }),
        scrapeGraph:            () => ({}),
        _indexCraftsByOutput:   () => ({}),
        getCachedEdgeGraph:     () => null,
        gamePage:               {},
        cfg:                    { sspShadow: false },
        _sspBeliefLoad:         () => ({}),
        console,
        module:                 { exports: {} }
    };
    Object.assign(base, overrides || {});
    base.__recorded = recorded;
    return base;
}
function loadPolicy(sandbox) {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'src', '04g_ssp_policy.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: '04g_ssp_policy.js' });
    return sandbox.module.exports;
}

function eg(goalState) {
    return {
        nodes: {
            'tech:a': { id: 'tech:a', kind: 'tech', state: goalState || 'ready',
                        price: [{ name: 's', val: 100 }],
                        provides: { resources: [], storage: [], ratios: [], con: [], unlocks: [] } },
            'tech:b': { id: 'tech:b', kind: 'tech', state: 'ready',
                        price: [{ name: 's', val: 50 }],
                        provides: { resources: [], storage: [], ratios: [], con: [], unlocks: [] } }
        },
        unlockedBy: {}
    };
}

describe('Phase 4 / _sspFeedbackTick — start tracking', () => {
    it('records nothing on first call (just starts tracking)', () => {
        const sb = makeSandbox();
        const p = loadPolicy(sb);
        p._sspFeedbackTick(eg('ready'), 'tech:a', 100);
        eq(sb.__recorded.length, 0);
        const pending = p._sspPendingObservation();
        assert(pending && pending.goalId === 'tech:a');
        eq(pending.predictedSecs, 100);
    });

    it('does not start tracking when sspPickedGoal is null', () => {
        const sb = makeSandbox();
        const p = loadPolicy(sb);
        p._sspFeedbackTick(eg('ready'), null, null);
        eq(p._sspPendingObservation(), null);
    });

    it('does not start tracking with non-finite predictedSecs', () => {
        const sb = makeSandbox();
        const p = loadPolicy(sb);
        p._sspFeedbackTick(eg('ready'), 'tech:a', Infinity);
        eq(p._sspPendingObservation(), null);
        p._sspFeedbackTick(eg('ready'), 'tech:a', NaN);
        eq(p._sspPendingObservation(), null);
        p._sspFeedbackTick(eg('ready'), 'tech:a', 0);
        eq(p._sspPendingObservation(), null);
    });
});

describe('Phase 4 / _sspFeedbackTick — completion records observation', () => {
    it('records an observation when tracked goal becomes done', () => {
        const sb = makeSandbox();
        const p = loadPolicy(sb);
        p._sspFeedbackTick(eg('ready'), 'tech:a', 100);
        // Force measurable elapsed without going async.
        p._sspPendingObservation().startedAtMs = Date.now() - 5;
        // Goal completes — same pick, new state.
        p._sspFeedbackTick(eg('done'), 'tech:a', 100);
        eq(sb.__recorded.length, 1);
        eq(sb.__recorded[0].id, 'tech:a');
        eq(sb.__recorded[0].predicted, 100);
        assert(sb.__recorded[0].actual > 0,
            'actual elapsed should be positive: ' + sb.__recorded[0].actual);
        // Tracking cleared after recording.
        eq(p._sspPendingObservation(), null);
    });

    it('starts a fresh observation if a different goal is picked next', () => {
        const sb = makeSandbox();
        const p = loadPolicy(sb);
        p._sspFeedbackTick(eg('ready'), 'tech:a', 100);
        // Force a measurable elapsed (two ticks in same ms otherwise).
        p._sspPendingObservation().startedAtMs = Date.now() - 1000;
        // Goal completes AND SSP shifts to a new pick in the same cycle.
        p._sspFeedbackTick(eg('done'), 'tech:b', 50);
        eq(sb.__recorded.length, 1, 'old goal recorded');
        eq(sb.__recorded[0].id, 'tech:a');
        const pending = p._sspPendingObservation();
        assert(pending && pending.goalId === 'tech:b', 'now tracking tech:b');
    });
});

describe('Phase 4 / _sspFeedbackTick — abandon on pick shift', () => {
    it('drops in-flight tracking when SSP changes pick before completion', () => {
        const sb = makeSandbox();
        const p = loadPolicy(sb);
        p._sspFeedbackTick(eg('ready'), 'tech:a', 100);
        // Pick shifts (e.g. fanout shifted) — tech:a not done yet.
        p._sspFeedbackTick(eg('ready'), 'tech:b', 50);
        eq(sb.__recorded.length, 0, 'no record — tech:a never completed');
        const pending = p._sspPendingObservation();
        assert(pending && pending.goalId === 'tech:b');
    });

    it('_sspAbandonObservation clears tracking', () => {
        const sb = makeSandbox();
        const p = loadPolicy(sb);
        p._sspFeedbackTick(eg('ready'), 'tech:a', 100);
        p._sspAbandonObservation();
        eq(p._sspPendingObservation(), null);
    });

    it('null pick on a cycle abandons tracking (SSP turned off)', () => {
        const sb = makeSandbox();
        const p = loadPolicy(sb);
        p._sspFeedbackTick(eg('ready'), 'tech:a', 100);
        p._sspFeedbackTick(eg('ready'), null, null);
        eq(p._sspPendingObservation(), null);
    });
});

describe('Phase 4 / belief learns from feedback', () => {
    it('repeated under-estimates push bias > 1 over time', () => {
        const sb = makeSandbox();
        // Use real injected storage so the bias actually persists.
        const memStore = { _m: {}, getItem(k){return this._m[k]||null;},
                           setItem(k,v){this._m[k]=String(v);},
                           removeItem(k){delete this._m[k];} };
        ssp_belief._setSspBeliefStorage(memStore);
        ssp_belief.resetSspBelief();

        const p = loadPolicy(sb);
        for (let i = 0; i < 30; i++) {
            // Predicted 100 but actual is 200 (under-estimate by 2x).
            p._sspFeedbackTick(eg('ready'), 'tech:a', 100);
            // Force startedAt back so elapsed is exactly 200s.
            const pending = p._sspPendingObservation();
            pending.startedAtMs = Date.now() - 200000;
            p._sspFeedbackTick(eg('done'), 'tech:a', 100);
        }
        // Raw EWMA bias converges to 2.0 over 30 under-estimates; the
        // effective (warmup-blended) bias trails slightly below.
        const raw = ssp_belief.getSspBeliefRecord('tech:a').bias;
        const eff = ssp_belief.getSspBias('tech:a');
        assert(raw > 1.5, 'raw bias should converge above 1.5: ' + raw);
        near(raw, 2.0, 0.05, 'raw near 2.0 after EWMA convergence');
        assert(eff > 1.5 && eff < raw + 1e-9,
            'effective bias should be between 1.5 and raw: ' + eff);

        ssp_belief._setSspBeliefStorage(null);
        ssp_belief.resetSspBelief();
    });
});

describe('Phase 4 / orchestrator wiring', () => {
    const ORCH = fs.readFileSync(
        path.join(__dirname, '..', 'src', '09_orchestrator.js'), 'utf8');

    it('orchestrator calls _sspFeedbackTick when sspEnabled', () => {
        assert(/_sspFeedbackTick\s*\(/.test(ORCH));
    });

    it('orchestrator calls _sspAbandonObservation when SSP off', () => {
        assert(/_sspAbandonObservation\s*\(/.test(ORCH));
    });

    it('orchestrator passes predictedSecs from result.V[goalId]', () => {
        assert(/sspPredictedSecs\s*=\s*sspResult\.V\s*\?\s*sspResult\.V\[sspPickedGoal\]/.test(ORCH));
    });
});
