// Confidence-weighted bias: getSspBias returns a warmup blend of the raw
// EWMA bias and the cold-start prior (1.0).  This test pins down the
// formula and the legacy-data migration path.

const { describe, it, assert, eq, near } = require('./_harness');
const belief = require('../src/04f_ssp_belief.js');

function memStorage() {
    const m = {};
    return {
        getItem:    (k) => (k in m ? m[k] : null),
        setItem:    (k, v) => { m[k] = String(v); },
        removeItem: (k) => { delete m[k]; },
        _seed:      (k, v) => { m[k] = String(v); }
    };
}
function fresh() {
    const s = memStorage();
    belief._setSspBeliefStorage(s);
    return s;
}

const W = belief.SSP_BELIEF_WARMUP;  // 5

function expectedEffective(rawBias, count) {
    return (W * 1.0 + count * rawBias) / (W + count);
}

describe('confidence weighting / cold start', () => {
    it('untouched goal: count=0, effective=1.0', () => {
        fresh();
        const r = belief.getSspBeliefRecord('tech:cold');
        eq(r.count, 0);
        eq(r.bias, 1.0);
        eq(r.effective, 1.0);
        eq(belief.getSspBias('tech:cold'), 1.0);
    });
});

describe('confidence weighting / one observation', () => {
    it('after 1 obs: raw=1.2, effective tilted toward 1.0', () => {
        fresh();
        belief.recordSspObservation('tech:a', 100, 200);  // ratio 2 → raw 1.2
        const r = belief.getSspBeliefRecord('tech:a');
        eq(r.count, 1);
        near(r.bias, 1.2, 1e-9);
        near(r.effective, expectedEffective(1.2, 1), 1e-9);
        near(belief.getSspBias('tech:a'), expectedEffective(1.2, 1), 1e-9);
        // Sanity: closer to 1.0 than to raw.
        assert(Math.abs(r.effective - 1.0) < Math.abs(r.effective - r.bias),
            'effective should be closer to prior than to raw at count=1');
    });
});

describe('confidence weighting / many observations', () => {
    it('after warmup samples: effective halfway between prior and raw', () => {
        fresh();
        for (let i = 0; i < W; i++) belief.recordSspObservation('tech:a', 100, 200);
        const r = belief.getSspBeliefRecord('tech:a');
        eq(r.count, W);
        near(r.effective, (1.0 + r.bias) / 2, 1e-9,
            'at count=warmup, effective is exact average of prior and raw');
    });

    it('after many obs: effective approaches raw', () => {
        fresh();
        for (let i = 0; i < 100; i++) belief.recordSspObservation('tech:a', 100, 200);
        const r = belief.getSspBeliefRecord('tech:a');
        eq(r.count, 100);
        // raw ≈ 2.0 (well-converged); effective = (5+100*2)/105 ≈ 1.952
        near(r.effective, expectedEffective(r.bias, 100), 1e-9);
        assert(Math.abs(r.effective - r.bias) < 0.05,
            'effective within 5% of raw at count=100');
    });
});

describe('confidence weighting / monotonic in count', () => {
    it('effective monotonically approaches raw as count grows', () => {
        fresh();
        const samples = [];
        for (let i = 1; i <= 30; i++) {
            belief.recordSspObservation('tech:a', 100, 200);
            const r = belief.getSspBeliefRecord('tech:a');
            samples.push({ raw: r.bias, eff: r.effective, count: r.count });
        }
        // |effective - raw| should never increase as count grows (since
        // raw moves toward 2.0 and the warmup weight stays fixed).
        // We check the gap shrinks at the tail.
        const gapEarly = Math.abs(samples[1].eff - samples[1].raw);
        const gapLate  = Math.abs(samples[29].eff - samples[29].raw);
        assert(gapLate < gapEarly,
            `gap should shrink: early=${gapEarly.toFixed(3)} late=${gapLate.toFixed(3)}`);
    });
});

describe('confidence weighting / legacy migration', () => {
    it('numeric-only persisted state is treated as 1 sample', () => {
        const s = fresh();
        s._seed(belief.SSP_BELIEF_KEY, JSON.stringify({ 'tech:legacy': 1.5 }));
        belief._setSspBeliefStorage(s);
        const r = belief.getSspBeliefRecord('tech:legacy');
        eq(r.count, 1);
        near(r.bias, 1.5, 1e-9);
        near(r.effective, expectedEffective(1.5, 1), 1e-9);
    });

    it('a recorded observation upgrades legacy entry to {bias,count}', () => {
        const s = fresh();
        s._seed(belief.SSP_BELIEF_KEY, JSON.stringify({ 'tech:legacy': 1.5 }));
        belief._setSspBeliefStorage(s);
        belief.recordSspObservation('tech:legacy', 100, 200);
        const r = belief.getSspBeliefRecord('tech:legacy');
        eq(r.count, 2, 'count = 1 (legacy) + 1 (new obs)');
        // EWMA from prior=1.5: 0.2*2 + 0.8*1.5 = 0.4 + 1.2 = 1.6
        near(r.bias, 1.6, 1e-9);
    });
});

describe('confidence weighting / reset clears count', () => {
    it('resetSspBelief brings count back to 0', () => {
        fresh();
        for (let i = 0; i < 10; i++) belief.recordSspObservation('tech:a', 100, 200);
        belief.resetSspBelief();
        const r = belief.getSspBeliefRecord('tech:a');
        eq(r.count, 0);
        eq(r.bias, 1.0);
        eq(r.effective, 1.0);
    });
});
