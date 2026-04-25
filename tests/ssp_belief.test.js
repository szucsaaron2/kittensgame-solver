// Tests for src/04f_ssp_belief.js — bias table.

const { describe, it, assert, eq, near } = require('./_harness');
const belief = require('../src/04f_ssp_belief.js');

// In-memory storage that mimics localStorage's three methods we use.
function memStorage() {
    const m = {};
    return {
        getItem:    (k) => (k in m ? m[k] : null),
        setItem:    (k, v) => { m[k] = String(v); },
        removeItem: (k) => { delete m[k]; },
        _dump:      () => Object.assign({}, m)
    };
}

function freshStorage() {
    const s = memStorage();
    belief._setSspBeliefStorage(s);
    return s;
}

describe('getSspBias', () => {
    it('returns 1.0 by default (cold start)', () => {
        freshStorage();
        eq(belief.getSspBias('tech:any'), 1.0);
    });

    it('returns 1.0 for null / undefined goalId', () => {
        freshStorage();
        eq(belief.getSspBias(null),      1.0);
        eq(belief.getSspBias(undefined), 1.0);
        eq(belief.getSspBias(''),        1.0);
    });

    it('reads back persisted values (legacy numeric → 1 sample)', () => {
        const s = freshStorage();
        s.setItem(belief.SSP_BELIEF_KEY, JSON.stringify({ 'tech:a': 1.5 }));
        belief._setSspBeliefStorage(s);
        // Raw EWMA preserved.
        near(belief.getSspBeliefRecord('tech:a').bias, 1.5, 1e-9);
        eq(belief.getSspBeliefRecord('tech:a').count, 1);
        // Effective bias: (5*1 + 1*1.5)/(5+1) = 6.5/6 ≈ 1.0833.
        near(belief.getSspBias('tech:a'), 6.5 / 6, 1e-9);
    });

    it('falls back to 1.0 for non-finite stored values', () => {
        const s = freshStorage();
        s.setItem(belief.SSP_BELIEF_KEY, JSON.stringify({ 'bad': 'oops', 'neg': -1, 'zero': 0 }));
        belief._setSspBeliefStorage(s);
        eq(belief.getSspBias('bad'),  1.0);
        eq(belief.getSspBias('neg'),  1.0);
        eq(belief.getSspBias('zero'), 1.0);
    });
});

describe('recordSspObservation (Phase 3 hook)', () => {
    it('updates raw bias toward observed ratio via EWMA', () => {
        freshStorage();
        belief.recordSspObservation('tech:a', 100, 200);
        near(belief.getSspBeliefRecord('tech:a').bias, 1.2, 1e-9);
        eq(belief.getSspBeliefRecord('tech:a').count, 1);

        belief.recordSspObservation('tech:a', 100, 200);
        near(belief.getSspBeliefRecord('tech:a').bias, 1.36, 1e-9);
        eq(belief.getSspBeliefRecord('tech:a').count, 2);
    });

    it('clips ratio to configured bounds (raw EWMA)', () => {
        freshStorage();
        belief.recordSspObservation('tech:big', 1, 100);
        near(belief.getSspBeliefRecord('tech:big').bias, 1.6, 1e-9);

        belief.recordSspObservation('tech:tiny', 100, 0.1);
        near(belief.getSspBeliefRecord('tech:tiny').bias, 0.85, 1e-9);
    });

    it('ignores invalid inputs', () => {
        freshStorage();
        belief.recordSspObservation('tech:x', 100, 0);
        belief.recordSspObservation('tech:x', 0,   100);
        belief.recordSspObservation('tech:x', NaN, 100);
        belief.recordSspObservation('tech:x', 100, Infinity);
        belief.recordSspObservation('',       100, 100);
        belief.recordSspObservation(null,     100, 100);
        eq(belief.getSspBias('tech:x'), 1.0, 'no update on bad inputs');
    });

    it('persists across cache invalidation', () => {
        const s = freshStorage();
        belief.recordSspObservation('tech:p', 50, 100);  // ratio=2 → bias 1.2
        belief._setSspBeliefStorage(s);  // forces reload
        near(belief.getSspBeliefRecord('tech:p').bias, 1.2, 1e-9);
        eq(belief.getSspBeliefRecord('tech:p').count, 1);
    });
});

describe('resetSspBelief', () => {
    it('clears all stored biases', () => {
        freshStorage();
        belief.recordSspObservation('tech:a', 100, 200);
        belief.recordSspObservation('tech:b', 100, 50);
        assert(belief.getSspBias('tech:a') !== 1.0);
        belief.resetSspBelief();
        eq(belief.getSspBias('tech:a'), 1.0);
        eq(belief.getSspBias('tech:b'), 1.0);
    });
});
