// Robustness coverage for src/04f_ssp_belief.js: storage failures, malformed
// persisted JSON, multi-goal isolation, EWMA convergence, and re-entrant
// caching behaviour.

const { describe, it, assert, eq, near } = require('./_harness');
const belief = require('../src/04f_ssp_belief.js');

function memStorage(opts) {
    const m = {};
    return {
        getItem: (k) => {
            if (opts && opts.throwOnGet) throw new Error('getItem boom');
            return (k in m ? m[k] : null);
        },
        setItem: (k, v) => {
            if (opts && opts.throwOnSet) throw new Error('setItem boom');
            m[k] = String(v);
        },
        removeItem: (k) => { delete m[k]; },
        _dump: () => Object.assign({}, m),
        _seed: (k, v) => { m[k] = String(v); }
    };
}
function fresh(opts) {
    const s = memStorage(opts);
    belief._setSspBeliefStorage(s);
    return s;
}

describe('storage failures', () => {
    it('getItem throwing → cold-start with bias 1.0', () => {
        fresh({ throwOnGet: true });
        eq(belief.getSspBias('tech:a'), 1.0);
    });

    it('setItem throwing during persist does not propagate', () => {
        fresh({ throwOnSet: true });
        belief.recordSspObservation('tech:a', 100, 200);
        // In-memory cache holds the raw EWMA update even if persist failed.
        near(belief.getSspBeliefRecord('tech:a').bias, 1.2, 1e-9);
    });

    it('null storage (no localStorage, no inject) returns 1.0 always', () => {
        belief._setSspBeliefStorage(null);
        eq(belief.getSspBias('tech:any'), 1.0);
        // Calls don't throw even though there's nowhere to persist.
        belief.recordSspObservation('tech:any', 100, 200);
    });
});

describe('malformed persisted state', () => {
    it('corrupt JSON in storage falls back to empty table', () => {
        const s = memStorage();
        s._seed(belief.SSP_BELIEF_KEY, '{not valid json');
        belief._setSspBeliefStorage(s);
        eq(belief.getSspBias('tech:a'), 1.0);
        belief.recordSspObservation('tech:a', 100, 200);
        near(belief.getSspBeliefRecord('tech:a').bias, 1.2, 1e-9);
    });

    it('non-object JSON falls back to empty table', () => {
        const cases = ['null', 'true', '42', '"string"', '[]'];
        for (const c of cases) {
            const s = memStorage();
            s._seed(belief.SSP_BELIEF_KEY, c);
            belief._setSspBeliefStorage(s);
            eq(belief.getSspBias('tech:a'), 1.0, `JSON ${c}`);
        }
    });
});

describe('multi-goal isolation', () => {
    it('updates to one goal do not leak into another', () => {
        fresh();
        belief.recordSspObservation('tech:a', 100, 200);  // ratio 2 → bias 1.2
        belief.recordSspObservation('tech:b', 100, 50);   // ratio 0.5 → bias 0.9
        near(belief.getSspBeliefRecord('tech:a').bias, 1.2, 1e-9);
        near(belief.getSspBeliefRecord('tech:b').bias, 0.9, 1e-9);
        eq(belief.getSspBias('tech:c'), 1.0);  // cold-start
    });

    it('handles many goals without performance issue', () => {
        fresh();
        const t0 = Date.now();
        for (let i = 0; i < 1000; i++) {
            belief.recordSspObservation('tech:n' + i, 100, 100 + i);
        }
        const elapsed = Date.now() - t0;
        assert(elapsed < 500, `1k records took ${elapsed}ms`);
        near(belief.getSspBeliefRecord('tech:n200').bias, 1.4, 1e-9);
    });
});

describe('EWMA convergence', () => {
    it('converges toward observed ratio under repeated identical observations', () => {
        fresh();
        for (let i = 0; i < 200; i++) {
            belief.recordSspObservation('tech:x', 100, 250);  // ratio 2.5
        }
        // Raw EWMA converges to 2.5; effective is essentially raw at count=200.
        near(belief.getSspBeliefRecord('tech:x').bias, 2.5, 1e-3);
        near(belief.getSspBias('tech:x'), 2.5, 0.05);
    });

    it('drifts back toward 1.0 if observations switch back', () => {
        fresh();
        for (let i = 0; i < 50; i++)
            belief.recordSspObservation('tech:x', 100, 200);
        const peak = belief.getSspBeliefRecord('tech:x').bias;
        assert(peak > 1.5, 'should have biased up first');
        for (let i = 0; i < 50; i++)
            belief.recordSspObservation('tech:x', 100, 100);
        const after = belief.getSspBeliefRecord('tech:x').bias;
        assert(after < peak, 'should drift back');
        near(after, 1.0, 0.01);
    });

    it('clip bound prevents single outlier from dominating', () => {
        fresh();
        belief.recordSspObservation('tech:a', 100, 100);
        belief.recordSspObservation('tech:a', 1, 10000);
        // Raw EWMA: 0.2*4 + 0.8*1 = 1.6 (clip ratio at 4).
        near(belief.getSspBeliefRecord('tech:a').bias, 1.6, 1e-9);
        assert(belief.getSspBeliefRecord('tech:a').bias < 4.0,
            'clip prevents bias from hitting 4');
    });
});

describe('reset semantics', () => {
    it('reset clears the in-memory cache as well as storage', () => {
        const s = fresh();
        belief.recordSspObservation('tech:a', 100, 200);
        belief.resetSspBelief();
        eq(belief.getSspBias('tech:a'), 1.0);
        // Storage should be empty / cleared.
        const dump = s._dump();
        const persisted = dump[belief.SSP_BELIEF_KEY];
        // Either absent or empty-object string.
        if (persisted) eq(persisted, '{}');
    });
});
