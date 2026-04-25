// Tests for src/04e_ssp_value.js — pure value iteration over a synthetic
// AND-OR graph that mimics the shape of 06_edges.js's eg.

const { describe, it, assert, eq, near } = require('./_harness');
const ssp = require('../src/04e_ssp_value.js');

// ── Synthetic graph builders ────────────────────────────────────────────────
// node({...}) returns an eg-shaped node; mkGraph(...) returns {nodes, unlockedBy}.
function node(opts) {
    return Object.assign({
        id: opts.id,
        kind: opts.kind || 'tech',
        name: opts.name || opts.id.split(':')[1] || opts.id,
        state: opts.state || 'ready',
        price: opts.price || null,
        unlockPrice: opts.unlockPrice || null,
        prereqs: opts.prereqs || [],
        provides: { resources: [], storage: [], ratios: [], con: [],
                    unlocks: opts.unlocks || [] }
    }, opts);
}
function mkGraph(nodes, unlockedBy) {
    const idx = {};
    for (const n of nodes) idx[n.id] = n;
    return { nodes: idx, unlockedBy: unlockedBy || {} };
}

// Mock symbolic state — `secs` returned per node is configurable.
function mockDeps(secsByNode, applyMap) {
    return {
        timeToAffordInState: (state, prices /*, idx*/) => {
            // Walk prices: if secsByNode[state.__lookupId] is defined use it; else 0.
            if (!prices || prices.length === 0) return { secs: 0, capLimited: false };
            // Convention: tests stuff secs into prices[0].val so we can vary by node.
            return { secs: prices[0].val, capLimited: false };
        },
        applyActionSymbolic: (state, node /*, idx*/) => {
            // Return a child state with node marked done.
            const next = Object.assign({}, state);
            next.unlocks = Object.assign({}, state.unlocks || {});
            next.unlocks[node.id] = true;
            return next;
        },
        craftsByOutput: {},
        getBias: () => 1.0,
        rewardWeight: 0  // disable reward bonus by default; tests opt-in
    };
}

// Helper: build node whose price is [{name:'science', val: secs}] so
// timeToAffordInState() returns those secs.
function readyNode(id, secs, unlocks) {
    return node({
        id, state: 'ready',
        price: [{ name: 'science', val: secs }],
        unlocks: unlocks || []
    });
}

// ── 1. Fanout ───────────────────────────────────────────────────────────────
describe('fanout', () => {
    it('counts transitive descendants via provides.unlocks', () => {
        const eg = mkGraph([
            readyNode('tech:a', 10, ['tech:b', 'tech:c']),
            readyNode('tech:b', 10, ['tech:d']),
            readyNode('tech:c', 10, []),
            readyNode('tech:d', 10, [])
        ]);
        const fan = ssp._sspComputeFanout(eg);
        eq(fan['tech:a'], 3, 'a unlocks {b,c,d} transitively');
        eq(fan['tech:b'], 1, 'b unlocks {d}');
        eq(fan['tech:c'], 0);
        eq(fan['tech:d'], 0);
    });

    it('handles cycles without infinite recursion', () => {
        const eg = mkGraph([
            readyNode('tech:a', 1, ['tech:b']),
            readyNode('tech:b', 1, ['tech:a'])
        ]);
        const fan = ssp._sspComputeFanout(eg);
        // Cycle stub: no double-counting of self.
        assert(fan['tech:a'] >= 1 && fan['tech:a'] <= 2);
        assert(fan['tech:b'] >= 1 && fan['tech:b'] <= 2);
    });

    it('returns 0 for leaves with no unlocks field', () => {
        const eg = mkGraph([readyNode('tech:leaf', 5)]);
        eq(ssp._sspComputeFanout(eg)['tech:leaf'], 0);
    });
});

// ── 2. Edge time ────────────────────────────────────────────────────────────
describe('_sspEdgeTime', () => {
    it('returns 0 for already-unlocked node', () => {
        const eg = mkGraph([readyNode('tech:a', 10)]);
        const state = { unlocks: { 'tech:a': true } };
        const r = ssp._sspEdgeTime(eg.nodes['tech:a'], state, mockDeps());
        eq(r.secs, 0);
    });

    it('returns price-derived secs for ready nodes', () => {
        const eg = mkGraph([readyNode('tech:a', 42)]);
        const r = ssp._sspEdgeTime(eg.nodes['tech:a'], { unlocks: {} }, mockDeps());
        eq(r.secs, 42);
    });

    it('uses unlockPrice for locked-ui nodes', () => {
        const n = node({ id: 'tech:x', state: 'locked-ui',
                         unlockPrice: [{ name: 's', val: 7 }],
                         price: [{ name: 's', val: 100 }] });
        const eg = mkGraph([n]);
        const r = ssp._sspEdgeTime(eg.nodes['tech:x'], { unlocks: {} }, mockDeps());
        eq(r.secs, 7);
    });

    it('returns Infinity when timeToAfford returns Infinity', () => {
        const deps = mockDeps();
        deps.timeToAffordInState = () => ({ secs: Infinity });
        const eg = mkGraph([readyNode('tech:a', 10)]);
        const r = ssp._sspEdgeTime(eg.nodes['tech:a'], { unlocks: {} }, deps);
        eq(r.secs, Infinity);
        eq(r.nextState, null);
    });
});

// ── 3. Bellman cost ─────────────────────────────────────────────────────────
describe('_sspCost', () => {
    it('ready node: cost == edge time', () => {
        const eg = mkGraph([readyNode('tech:a', 30)]);
        const c = ssp._sspCost('tech:a', { unlocks: {} }, eg, mockDeps(), 5, {});
        eq(c, 30);
    });

    it('locked-prereq node: chains through unlockedBy', () => {
        const eg = mkGraph([
            readyNode('tech:pre', 10, ['tech:goal']),
            node({ id: 'tech:goal', state: 'locked-prereq',
                   price: [{ name: 's', val: 20 }] })
        ], { 'tech:goal': [{ id: 'tech:pre', mode: 'or' }] });
        const c = ssp._sspCost('tech:goal', { unlocks: {} }, eg, mockDeps(), 5, {});
        eq(c, 30, 'should be pre(10) + goal(20) = 30');
    });

    it('locked-prereq with multiple OR sources picks min', () => {
        const eg = mkGraph([
            readyNode('tech:fast', 5,  ['tech:goal']),
            readyNode('tech:slow', 50, ['tech:goal']),
            node({ id: 'tech:goal', state: 'locked-prereq',
                   price: [{ name: 's', val: 10 }] })
        ], { 'tech:goal': [
            { id: 'tech:fast', mode: 'or' },
            { id: 'tech:slow', mode: 'or' }
        ]});
        const c = ssp._sspCost('tech:goal', { unlocks: {} }, eg, mockDeps(), 5, {});
        eq(c, 15, 'min over OR options: 5 + 10');
    });

    it('returns Infinity when goal has no sources and is locked-prereq', () => {
        const eg = mkGraph([
            node({ id: 'tech:orphan', state: 'locked-prereq',
                   price: [{ name: 's', val: 1 }] })
        ]);
        const c = ssp._sspCost('tech:orphan', { unlocks: {} }, eg, mockDeps(), 5, {});
        eq(c, Infinity);
    });

    it('respects horizon depth', () => {
        // a → b → c → goal chain, but horizon=2 caps it.
        const eg = mkGraph([
            readyNode('tech:a', 1, ['tech:b']),
            node({ id: 'tech:b', state: 'locked-prereq', price: [{ name: 's', val: 1 }] }),
            node({ id: 'tech:c', state: 'locked-prereq', price: [{ name: 's', val: 1 }] }),
            node({ id: 'tech:goal', state: 'locked-prereq', price: [{ name: 's', val: 1 }] })
        ], {
            'tech:b':    [{ id: 'tech:a', mode: 'or' }],
            'tech:c':    [{ id: 'tech:b', mode: 'or' }],
            'tech:goal': [{ id: 'tech:c', mode: 'or' }]
        });
        const c = ssp._sspCost('tech:goal', { unlocks: {} }, eg, mockDeps(), 2, {});
        eq(c, Infinity, 'depth 2 not enough to walk 4-deep chain');
    });

    it('returns 0 for already-done node', () => {
        const eg = mkGraph([
            node({ id: 'tech:done', state: 'done', price: [{ name: 's', val: 100 }] })
        ]);
        const c = ssp._sspCost('tech:done', { unlocks: {} }, eg, mockDeps(), 5, {});
        eq(c, 0);
    });
});

// ── 4. Public entry: computeSspValueTable ───────────────────────────────────
describe('computeSspValueTable', () => {
    it('produces ascending-score ranking', () => {
        const eg = mkGraph([
            readyNode('tech:cheap',     10),
            readyNode('tech:moderate', 100),
            readyNode('tech:dear',    1000)
        ]);
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        eq(r.ranking[0].id, 'tech:cheap');
        eq(r.ranking[1].id, 'tech:moderate');
        eq(r.ranking[2].id, 'tech:dear');
    });

    it('skips done nodes from candidates', () => {
        const eg = mkGraph([
            node({ id: 'tech:done', state: 'done', price: [{ name: 's', val: 1 }] }),
            readyNode('tech:open', 10)
        ]);
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        eq(r.ranking.length, 1);
        eq(r.ranking[0].id, 'tech:open');
    });

    it('only considers terminal kinds', () => {
        const eg = mkGraph([
            readyNode('tech:a', 5),
            node({ id: 'bld:hut',  kind: 'bld',  state: 'ready',
                   price: [{ name: 's', val: 1 }] }),
            node({ id: 'job:scholar', kind: 'job', state: 'ready',
                   price: [{ name: 's', val: 1 }] })
        ]);
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        eq(r.ranking.length, 1);
        eq(r.ranking[0].id, 'tech:a');
    });

    it('reward bonus prefers high-fanout gateways at equal cost', () => {
        const eg = mkGraph([
            readyNode('tech:gateway', 20, ['tech:a', 'tech:b', 'tech:c']),
            readyNode('tech:leaf',    20, []),
            readyNode('tech:a', 10), readyNode('tech:b', 10), readyNode('tech:c', 10)
        ]);
        const deps = mockDeps(); deps.rewardWeight = 5;
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, deps);
        // Gateway: 20 - 5*(1+3) = 0; leaf: 20 - 5*(1+0) = 15.
        const gw = r.ranking.find(x => x.id === 'tech:gateway');
        const lf = r.ranking.find(x => x.id === 'tech:leaf');
        assert(gw.score < lf.score, 'gateway should rank above leaf with reward weight');
        near(gw.score, 0,  1e-6);
        near(lf.score, 15, 1e-6);
    });

    it('marks unreachable goals correctly', () => {
        const deps = mockDeps();
        deps.timeToAffordInState = () => ({ secs: Infinity });
        const eg = mkGraph([readyNode('tech:wall', 1)]);
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, deps);
        eq(r.ranking[0].reachable, false);
        eq(r.ranking[0].V, Infinity);
    });

    it('respects custom candidate list', () => {
        const eg = mkGraph([
            readyNode('tech:a', 1),
            readyNode('tech:b', 1),
            readyNode('tech:c', 1)
        ]);
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { candidates: ['tech:b', 'tech:c'] });
        eq(r.ranking.length, 2);
        const ids = r.ranking.map(x => x.id).sort();
        eq(JSON.stringify(ids), JSON.stringify(['tech:b', 'tech:c']));
    });

    it('integrates bias function: doubles V when bias=2', () => {
        const eg = mkGraph([readyNode('tech:a', 10)]);
        const deps = mockDeps();
        deps.getBias = (id) => id === 'tech:a' ? 2.0 : 1.0;
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, deps);
        eq(r.V['tech:a'], 20);
    });
});
