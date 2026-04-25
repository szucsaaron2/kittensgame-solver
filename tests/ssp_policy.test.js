// Tests for src/04g_ssp_policy.js — the glue between value iteration, the
// belief table, and the orchestrator's shadow log.
//
// 04g references browser/userscript globals (cfg, gamePage, snapshotAlgebra-
// icState, etc.) that don't exist in Node.  We evaluate the file in a vm
// sandbox after seeding those globals — same trick as ssp_real_techs.test.js.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, it, assert, eq, near } = require('./_harness');

const ssp_value  = require('../src/04e_ssp_value.js');
const ssp_belief = require('../src/04f_ssp_belief.js');

// Build a sandbox that mimics what the concatenated userscript would expose
// to 04g: globals from earlier files, plus a `module` object so the file's
// dual-mode export hands its public API back to us.
function makeSandbox(overrides) {
    const base = {
        // From 04e/04f
        computeSspValueTable: ssp_value.computeSspValueTable,
        getSspBias:           ssp_belief.getSspBias,
        // From 04c (mocked)
        snapshotAlgebraicState: () => ({ unlocks: {}, resources: {}, rates: {}, caps: {} }),
        timeToAffordInState:    (state, prices) =>
            ({ secs: prices && prices[0] ? prices[0].val : 0, capLimited: false }),
        applyActionSymbolic:    (state, n) => {
            const next = Object.assign({}, state);
            next.unlocks = Object.assign({}, state.unlocks || {});
            next.unlocks[n.id] = true;
            return next;
        },
        // From 05/06 (mocked)
        scrapeGraph:           () => ({}),
        _indexCraftsByOutput:  () => ({}),
        getCachedEdgeGraph:    () => null,
        // Game / config
        gamePage: {},
        cfg:      { sspShadow: true },
        // Belief loader (private to 04g's window hook)
        _sspBeliefLoad: () => ({}),
        // Console + module + window stubs
        console,
        module: { exports: {} }
    };
    Object.assign(base, overrides || {});
    return base;
}

function loadPolicy(sandbox) {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'src', '04g_ssp_policy.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: '04g_ssp_policy.js' });
    return sandbox.module.exports;
}

// Synthetic eg used across tests.
function buildEg() {
    const nodes = {
        'tech:cheap':    { id: 'tech:cheap',    kind: 'tech', state: 'ready',
                           price: [{ name: 's', val: 5 }],
                           provides: { resources: [], storage: [], ratios: [],
                                       con: [], unlocks: ['tech:gateway'] } },
        'tech:gateway':  { id: 'tech:gateway',  kind: 'tech', state: 'locked-prereq',
                           price: [{ name: 's', val: 50 }],
                           provides: { resources: [], storage: [], ratios: [],
                                       con: [], unlocks: ['tech:a', 'tech:b'] } },
        'tech:a':        { id: 'tech:a',        kind: 'tech', state: 'ready',
                           price: [{ name: 's', val: 100 }],
                           provides: { resources: [], storage: [], ratios: [],
                                       con: [], unlocks: [] } },
        'tech:b':        { id: 'tech:b',        kind: 'tech', state: 'ready',
                           price: [{ name: 's', val: 100 }],
                           provides: { resources: [], storage: [], ratios: [],
                                       con: [], unlocks: [] } }
    };
    return {
        nodes,
        unlockedBy: { 'tech:gateway': [{ id: 'tech:cheap' }] }
    };
}

describe('pickTerminalGoalSSP', () => {
    it('returns ranking + V + fanout when prerequisites are present', () => {
        const sandbox = makeSandbox();
        const policy = loadPolicy(sandbox);
        const result = policy.pickTerminalGoalSSP(sandbox.gamePage, buildEg());
        assert(result, 'should return a result');
        assert(Array.isArray(result.ranking));
        assert(typeof result.V === 'object');
        assert(typeof result.fanout === 'object');
        eq(result.ranking.length, 4, 'all 4 techs are candidates');
    });

    it('returns null when eg is null/empty', () => {
        const sandbox = makeSandbox();
        const policy = loadPolicy(sandbox);
        eq(policy.pickTerminalGoalSSP(sandbox.gamePage, null), null);
        eq(policy.pickTerminalGoalSSP(sandbox.gamePage, {}), null);
    });

    it('returns null when snapshotAlgebraicState is missing', () => {
        const sandbox = makeSandbox({ snapshotAlgebraicState: undefined });
        const policy = loadPolicy(sandbox);
        eq(policy.pickTerminalGoalSSP(sandbox.gamePage, buildEg()), null);
    });

    it('returns null when timeToAffordInState is missing', () => {
        const sandbox = makeSandbox({ timeToAffordInState: undefined });
        const policy = loadPolicy(sandbox);
        eq(policy.pickTerminalGoalSSP(sandbox.gamePage, buildEg()), null);
    });

    it('catches errors from snapshotAlgebraicState and returns null', () => {
        const sandbox = makeSandbox({
            snapshotAlgebraicState: () => { throw new Error('boom'); }
        });
        const policy = loadPolicy(sandbox);
        eq(policy.pickTerminalGoalSSP(sandbox.gamePage, buildEg()), null);
    });

    it('respects bias function via getSspBias', () => {
        // Inject a bias table with known values.
        const memStore = { _m: {}, getItem(k){return this._m[k]||null;},
                           setItem(k,v){this._m[k]=String(v);} };
        ssp_belief._setSspBeliefStorage(memStore);
        ssp_belief.recordSspObservation('tech:cheap', 100, 200);  // bias 1.2

        const sandbox = makeSandbox();
        const policy = loadPolicy(sandbox);
        const result = policy.pickTerminalGoalSSP(sandbox.gamePage, buildEg());

        const cheap = result.ranking.find(r => r.id === 'tech:cheap');
        // After 1 obs raw bias=1.2, count=1; effective = (5+1.2)/6 ≈ 1.0333.
        const expectedBias = (5 + 1.2) / 6;
        near(cheap.V, 5 * expectedBias, 1e-9,
            'cheap V should be price * effective-bias');

        // Reset for downstream tests.
        ssp_belief._setSspBeliefStorage(null);
        ssp_belief.resetSspBelief();
    });
});

describe('_sspShadowTick', () => {
    it('appends an entry to the shadow log', () => {
        const sandbox = makeSandbox();
        const policy = loadPolicy(sandbox);
        policy._sspShadowTick(sandbox.gamePage, buildEg(), 'tech:a');
        const stats = policy._sspAgreementStats();
        eq(stats.samples, 1);
    });

    it('respects cfg.sspShadow=false', () => {
        const sandbox = makeSandbox({ cfg: { sspShadow: false } });
        const policy = loadPolicy(sandbox);
        policy._sspShadowTick(sandbox.gamePage, buildEg(), 'tech:a');
        eq(policy._sspAgreementStats().samples, 0);
    });

    it('detects agreement when user goal == SSP top pick', () => {
        const sandbox = makeSandbox();
        const policy = loadPolicy(sandbox);
        // tech:cheap has the lowest cost (5) → top SSP pick.
        policy._sspShadowTick(sandbox.gamePage, buildEg(), 'tech:cheap');
        const stats = policy._sspAgreementStats();
        eq(stats.withUserGoal, 1);
        eq(stats.agreeRate, 1.0);
    });

    it('detects disagreement when user goal differs', () => {
        const sandbox = makeSandbox();
        const policy = loadPolicy(sandbox);
        policy._sspShadowTick(sandbox.gamePage, buildEg(), 'tech:a');
        const stats = policy._sspAgreementStats();
        eq(stats.withUserGoal, 1);
        eq(stats.agreeRate, 0.0);
    });

    it('does not count cycles where user has no goal in agreement rate', () => {
        const sandbox = makeSandbox();
        const policy = loadPolicy(sandbox);
        policy._sspShadowTick(sandbox.gamePage, buildEg(), null);
        policy._sspShadowTick(sandbox.gamePage, buildEg(), null);
        const stats = policy._sspAgreementStats();
        eq(stats.samples, 2);
        eq(stats.withUserGoal, 0);
        eq(stats.agreeRate, null);
    });

    it('caps shadow log to SSP_SHADOW_LOG_MAX (200) entries', () => {
        const sandbox = makeSandbox();
        const policy = loadPolicy(sandbox);
        for (let i = 0; i < 250; i++) {
            policy._sspShadowTick(sandbox.gamePage, buildEg(), 'tech:cheap');
        }
        const stats = policy._sspAgreementStats();
        eq(stats.samples, 200, 'capped at 200');
    });

    it('null result from pickTerminalGoalSSP does not log', () => {
        const sandbox = makeSandbox({ snapshotAlgebraicState: undefined });
        const policy = loadPolicy(sandbox);
        policy._sspShadowTick(sandbox.gamePage, buildEg(), 'tech:a');
        eq(policy._sspAgreementStats().samples, 0);
    });

    it('survives valueTable throwing without polluting state', () => {
        // First tick succeeds; second one with broken deps must not poison the log.
        const sandbox = makeSandbox();
        // Silence the expected console.warn from the catch path so test
        // output stays clean.  We keep a real console for other code paths.
        sandbox.console = Object.assign({}, console, { warn: () => {} });
        const policy = loadPolicy(sandbox);
        policy._sspShadowTick(sandbox.gamePage, buildEg(), 'tech:cheap');
        const before = policy._sspAgreementStats().samples;

        // Break time-to-afford inside the same sandbox so the swallowed
        // exception fires through the policy's own try/catch.
        sandbox.timeToAffordInState = () => { throw new Error('breakage'); };
        let threw = false;
        try { policy._sspShadowTick(sandbox.gamePage, buildEg(), 'tech:a'); }
        catch (e) { threw = true; }
        assert(!threw, 'shadow tick must swallow internal failures');
        const after = policy._sspAgreementStats().samples;
        assert(after >= before);
    });
});
