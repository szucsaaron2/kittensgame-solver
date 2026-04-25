// Edge-case coverage for src/04e_ssp_value.js beyond the happy paths in
// ssp_value.test.js: diamond graphs, deep recursion, mixed kinds, degenerate
// bias values, ranking stability, idempotence, etc.

const { describe, it, assert, eq, near } = require('./_harness');
const ssp = require('../src/04e_ssp_value.js');

function node(opts) {
    return Object.assign({
        id: opts.id, kind: opts.kind || 'tech',
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
function ready(id, secs, unlocks) {
    return node({
        id, state: 'ready',
        price: [{ name: 'science', val: secs }],
        unlocks: unlocks || []
    });
}
function locked(id, secs) {
    return node({ id, state: 'locked-prereq',
                  price: [{ name: 'science', val: secs }] });
}
function mockDeps(overrides) {
    return Object.assign({
        timeToAffordInState: (state, prices) => {
            if (!prices || prices.length === 0) return { secs: 0 };
            let s = 0;
            for (const p of prices) s += p.val;
            return { secs: s, capLimited: false };
        },
        applyActionSymbolic: (state, n) => {
            const next = Object.assign({}, state);
            next.unlocks = Object.assign({}, state.unlocks || {});
            next.unlocks[n.id] = true;
            return next;
        },
        craftsByOutput: {},
        getBias: () => 1.0,
        rewardWeight: 0
    }, overrides || {});
}

// ── Diamond graph: two paths to the same goal, ensure cheaper one wins ─────
describe('diamond graph', () => {
    //        root → fast(5) → goal(10)        total 15
    //        root → slow(50)→ goal(10)        total 60
    //   * goal is locked-prereq with two OR sources (fast, slow), each ready.
    it('picks the cheaper path through OR', () => {
        const eg = mkGraph([
            ready('tech:fast', 5,  ['tech:goal']),
            ready('tech:slow', 50, ['tech:goal']),
            locked('tech:goal', 10)
        ], { 'tech:goal': [
            { id: 'tech:fast', mode: 'or' },
            { id: 'tech:slow', mode: 'or' }
        ]});
        const c = ssp._sspCost('tech:goal', { unlocks: {} }, eg, mockDeps(), 5, {});
        eq(c, 15, 'min over OR');
    });

    it('still works with three OR sources of varying cost', () => {
        const eg = mkGraph([
            ready('tech:a', 30, ['tech:goal']),
            ready('tech:b', 5,  ['tech:goal']),
            ready('tech:c', 17, ['tech:goal']),
            locked('tech:goal', 1)
        ], { 'tech:goal': [
            { id: 'tech:a' }, { id: 'tech:b' }, { id: 'tech:c' }
        ]});
        const c = ssp._sspCost('tech:goal', { unlocks: {} }, eg, mockDeps(), 5, {});
        eq(c, 6, 'should pick b (5) + goal (1)');
    });
});

// ── Two-deep prereq chain ──────────────────────────────────────────────────
describe('multi-level locked-prereq', () => {
    it('cost(goal) = sum of edges along the OR-min path', () => {
        // root(2) → mid(3) → goal(7)   total 12
        const eg = mkGraph([
            ready('tech:root', 2, ['tech:mid']),
            locked('tech:mid', 3),
            locked('tech:goal', 7)
        ], {
            'tech:mid':  [{ id: 'tech:root' }],
            'tech:goal': [{ id: 'tech:mid' }]
        });
        const c = ssp._sspCost('tech:goal', { unlocks: {} }, eg, mockDeps(), 5, {});
        eq(c, 12);
    });

    it('horizon=4 walks a 4-deep chain', () => {
        const eg = mkGraph([
            ready('tech:t0', 1, ['tech:t1']),
            locked('tech:t1', 1),
            locked('tech:t2', 1),
            locked('tech:t3', 1)
        ], {
            'tech:t1': [{ id: 'tech:t0' }],
            'tech:t2': [{ id: 'tech:t1' }],
            'tech:t3': [{ id: 'tech:t2' }]
        });
        const c = ssp._sspCost('tech:t3', { unlocks: {} }, eg, mockDeps(), 4, {});
        eq(c, 4, '4 edges of cost 1');
    });
});

// ── Mixed terminal kinds ───────────────────────────────────────────────────
describe('mixed candidate kinds', () => {
    it('ranks tech, ws_upg, mission, space_bld together', () => {
        const eg = mkGraph([
            ready('tech:a',           30),
            node({ id: 'ws_upg:b', kind: 'ws_upg', state: 'ready',
                   price: [{ name: 'culture', val: 10 }] }),
            node({ id: 'mission:c', kind: 'mission', state: 'ready',
                   price: [{ name: 'oil', val: 20 }] }),
            node({ id: 'space_bld:d', kind: 'space_bld', state: 'ready',
                   price: [{ name: 'kero', val: 100 }] }),
            // Should be excluded:
            node({ id: 'bld:e',  kind: 'bld',  state: 'ready',
                   price: [{ name: 'wood', val: 1 }] }),
            node({ id: 'craft:f', kind: 'craft', state: 'ready',
                   price: [{ name: 'wood', val: 1 }] }),
            node({ id: 'job:g',   kind: 'job',   state: 'ready', price: null })
        ]);
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        const ids = r.ranking.map(x => x.id);
        eq(ids.length, 4);
        assert(ids.includes('tech:a'));
        assert(ids.includes('ws_upg:b'));
        assert(ids.includes('mission:c'));
        assert(ids.includes('space_bld:d'));
        assert(!ids.includes('bld:e'));
        assert(!ids.includes('craft:f'));
        assert(!ids.includes('job:g'));
    });

    it('respects custom terminalKinds opt', () => {
        const eg = mkGraph([
            ready('tech:a', 5),
            node({ id: 'bld:b', kind: 'bld', state: 'ready',
                   price: [{ name: 'wood', val: 5 }] })
        ]);
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { bld: true } });
        eq(r.ranking.length, 1);
        eq(r.ranking[0].id, 'bld:b');
    });
});

// ── Degenerate bias / reward weight values ─────────────────────────────────
describe('degenerate inputs', () => {
    it('bias=0 / negative / NaN / null all fall back to 1.0', () => {
        const eg = mkGraph([
            ready('tech:zero',     100),
            ready('tech:negative', 100),
            ready('tech:nan',      100),
            ready('tech:null',     100),
            ready('tech:undef',    100)
        ]);
        const biases = {
            'tech:zero':     0,
            'tech:negative': -1.5,
            'tech:nan':      NaN,
            'tech:null':     null,
            'tech:undef':    undefined
        };
        const deps = mockDeps({ getBias: id => biases[id] });
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, deps);
        for (const id of Object.keys(biases)) {
            eq(r.V[id], 100, `${id} should fall back to bias=1.0`);
        }
    });

    it('valid finite positive bias scales V linearly', () => {
        const eg = mkGraph([ready('tech:a', 100)]);
        for (const b of [0.1, 0.5, 1.0, 2.0, 7.5]) {
            const deps = mockDeps({ getBias: () => b });
            const r = ssp.computeSspValueTable(eg, { unlocks: {} }, deps);
            near(r.V['tech:a'], 100 * b, 1e-9, `bias ${b}`);
        }
    });

    it('huge bias does not cause overflow or NaN', () => {
        const eg = mkGraph([ready('tech:a', 100)]);
        const deps = mockDeps({ getBias: () => 1e6 });
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, deps);
        assert(isFinite(r.V['tech:a']));
        eq(r.V['tech:a'], 1e8);
    });

    it('negative reward weight penalises high-fanout nodes', () => {
        const eg = mkGraph([
            ready('tech:gateway', 20, ['tech:x', 'tech:y']),
            ready('tech:leaf',    20, []),
            ready('tech:x', 1), ready('tech:y', 1)
        ]);
        const deps = mockDeps({ rewardWeight: -10 });
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, deps);
        const gw = r.ranking.find(x => x.id === 'tech:gateway');
        const lf = r.ranking.find(x => x.id === 'tech:leaf');
        assert(gw.score > lf.score, 'leaf preferred when reward is negative');
    });

    it('empty graph: ranking is []', () => {
        const r = ssp.computeSspValueTable({ nodes: {}, unlockedBy: {} },
            { unlocks: {} }, mockDeps());
        eq(r.ranking.length, 0);
    });

    it('candidates=[]: ranking is []', () => {
        const eg = mkGraph([ready('tech:a', 5)]);
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { candidates: [] });
        eq(r.ranking.length, 0);
    });

    it('unknown candidate id: produces unreachable entry', () => {
        const eg = mkGraph([ready('tech:a', 5)]);
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { candidates: ['tech:does-not-exist'] });
        eq(r.ranking.length, 1);
        eq(r.ranking[0].reachable, false);
    });
});

// ── Idempotence and stability ──────────────────────────────────────────────
describe('idempotence & stability', () => {
    it('repeated calls on same input produce identical rankings', () => {
        const eg = mkGraph([
            ready('tech:a', 30, ['tech:b']),
            ready('tech:b', 10)
        ]);
        const a = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        const b = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        eq(JSON.stringify(a.ranking), JSON.stringify(b.ranking));
    });

    it('does not mutate the input algState', () => {
        const eg = mkGraph([ready('tech:a', 5)]);
        const state = { unlocks: { 'preexisting': true } };
        const before = JSON.stringify(state);
        ssp.computeSspValueTable(eg, state, mockDeps());
        eq(JSON.stringify(state), before);
    });

    it('does not mutate the input edge graph', () => {
        const eg = mkGraph([ready('tech:a', 5, ['tech:b']), ready('tech:b', 1)]);
        const before = JSON.stringify(eg);
        ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        eq(JSON.stringify(eg), before);
    });
});

// ── Reachability gating ────────────────────────────────────────────────────
describe('partial reachability', () => {
    it('Infinity from timeToAffordInState propagates to ranking', () => {
        const eg = mkGraph([ready('tech:a', 5), ready('tech:b', 10)]);
        // Only tech:b unreachable.
        const deps = mockDeps({
            timeToAffordInState: (state, prices) =>
                prices[0].val === 10 ? { secs: Infinity } : { secs: prices[0].val }
        });
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, deps);
        const a = r.ranking.find(x => x.id === 'tech:a');
        const b = r.ranking.find(x => x.id === 'tech:b');
        eq(a.reachable, true);
        eq(b.reachable, false);
        // Reachable goals always rank ahead of unreachable ones.
        eq(r.ranking[0].id, 'tech:a');
    });

    it('locked-prereq goal becomes reachable after its prereq node', () => {
        const eg = mkGraph([
            ready('tech:enabler', 5, ['tech:gated']),
            locked('tech:gated', 10)
        ], { 'tech:gated': [{ id: 'tech:enabler' }] });
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        const gated = r.ranking.find(x => x.id === 'tech:gated');
        eq(gated.reachable, true);
        eq(gated.V, 15);
    });

    it('unlocks already in algState short-circuit edge cost to 0', () => {
        const eg = mkGraph([ready('tech:a', 1000)]);
        const r = ssp.computeSspValueTable(eg,
            { unlocks: { 'tech:a': true } }, mockDeps());
        eq(r.V['tech:a'], 0);
    });
});

// ── Fanout corner cases ────────────────────────────────────────────────────
describe('fanout corners', () => {
    it('shared descendants are not double-counted', () => {
        // Diamond: a unlocks b and c; both unlock d.  fanout(a) should be 3.
        const eg = mkGraph([
            ready('tech:a', 1, ['tech:b', 'tech:c']),
            ready('tech:b', 1, ['tech:d']),
            ready('tech:c', 1, ['tech:d']),
            ready('tech:d', 1)
        ]);
        const fan = ssp._sspComputeFanout(eg);
        eq(fan['tech:a'], 3, 'b, c, d — d counted once');
        eq(fan['tech:b'], 1);
        eq(fan['tech:c'], 1);
        eq(fan['tech:d'], 0);
    });

    it('unknown unlock targets are still counted as descendants', () => {
        // The graph has a dangling reference to a node not in nodes[].
        const eg = mkGraph([ready('tech:a', 1, ['tech:ghost'])]);
        const fan = ssp._sspComputeFanout(eg);
        eq(fan['tech:a'], 1, 'dangling target counts in fanout');
    });
});
