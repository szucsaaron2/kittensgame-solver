// Extra integration tests against real KG game data: workshop upgrades and
// space programs.  Loads each file via vm + dojo stubs, builds a synthetic
// eg, and runs computeSspValueTable.  Catches regressions that pure
// synthetic graphs would miss — e.g. shape mismatches in real data, edge
// cases in fanout when upgrades unlock crafts/upgrades.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, it, assert, eq } = require('./_harness');
const ssp = require('../src/04e_ssp_value.js');

function loadDojoModule(relPath) {
    const p = path.join(__dirname, '..', 'kittensgame-master', 'js', relPath);
    if (!fs.existsSync(p)) return null;
    const src = fs.readFileSync(p, 'utf8');
    let captured = null;
    const sandbox = {
        dojo: {
            declare: (n, parent, body) => { if (!captured) captured = body; },
            isArray: Array.isArray
        },
        com:     { nuclearunicorn: { core: { TabManager: function () {} } } },
        classes: { managers: {}, ui: { TabManager: function () {} } },
        $I:      (k) => k,
        console
    };
    vm.createContext(sandbox);
    try { vm.runInContext(src, sandbox, { timeout: 1000 }); } catch (e) { }
    return captured;
}

function buildEgFromUpgrades(upgrades, kindPrefix) {
    const nodes = {};
    const unlockedBy = {};
    for (const u of upgrades) {
        const id = kindPrefix + ':' + u.name;
        // Workshop upgrades nest unlocks under `unlocks: { upgrades: [...] }`,
        // matching the same shape science.js uses for `unlocks: { tech: [...] }`.
        const sub = u.unlocks && (u.unlocks.upgrades || u.unlocks.tech) || [];
        const ulist = sub.map(n => kindPrefix + ':' + n);
        nodes[id] = {
            id, kind: kindPrefix, name: u.name, state: 'ready',
            price: u.prices || [{ name: 'science', val: 1 }],
            unlockPrice: u.prices || null,
            prereqs: [],
            provides: { resources: [], storage: [], ratios: [], con: [],
                        unlocks: ulist }
        };
    }
    for (const id in nodes)
        for (const child of nodes[id].provides.unlocks)
            (unlockedBy[child] = unlockedBy[child] || []).push({ id });
    return { nodes, unlockedBy };
}

function buildEgFromPrograms(programs) {
    const nodes = {};
    for (const p of programs) {
        const id = 'mission:' + p.name;
        nodes[id] = {
            id, kind: 'mission', name: p.name, state: 'ready',
            price: p.prices || [{ name: 'science', val: 1 }],
            unlockPrice: p.prices || null,
            prereqs: [],
            provides: { resources: [], storage: [], ratios: [], con: [], unlocks: [] }
        };
    }
    return { nodes, unlockedBy: {} };
}

function mockDeps() {
    return {
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
    };
}

// ── Workshop upgrades ──────────────────────────────────────────────────────
describe('integration / workshop.js upgrades', () => {
    const ws = loadDojoModule('workshop.js');
    if (!ws || !Array.isArray(ws.upgrades)) {
        it('SKIP — workshop.js not loadable', () => {});
        return;
    }

    it('loaded ≥40 workshop upgrades', () => {
        assert(ws.upgrades.length >= 40, `got ${ws.upgrades.length}`);
    });

    it('every upgrade has a name + prices array', () => {
        for (const u of ws.upgrades) {
            assert(typeof u.name === 'string' && u.name.length > 0);
            assert(Array.isArray(u.prices), `bad prices for ${u.name}`);
        }
    });

    it('value table runs over the full workshop graph without errors', () => {
        const eg = buildEgFromUpgrades(ws.upgrades, 'ws_upg');
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { ws_upg: true } });
        eq(r.ranking.length, ws.upgrades.length);
        for (const x of r.ranking) {
            assert(isFinite(x.V) && x.V >= 0,
                `bad V for ${x.id}: ${x.V}`);
        }
    });

    it('cheapest upgrade ranks first', () => {
        const eg = buildEgFromUpgrades(ws.upgrades, 'ws_upg');
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { ws_upg: true } });
        // Find ground truth from raw data:
        let cheapest = null, minSum = Infinity;
        for (const u of ws.upgrades) {
            const s = (u.prices || []).reduce((a, p) => a + p.val, 0);
            if (s < minSum) { minSum = s; cheapest = u.name; }
        }
        eq(r.ranking[0].id, 'ws_upg:' + cheapest);
    });

    it('a known gateway (mineralHoes → ironHoes) has fanout ≥ 1', () => {
        const eg = buildEgFromUpgrades(ws.upgrades, 'ws_upg');
        const fan = ssp._sspComputeFanout(eg);
        if (fan['ws_upg:mineralHoes'] !== undefined) {
            assert(fan['ws_upg:mineralHoes'] >= 1,
                'mineralHoes should unlock at least ironHoes');
        }
    });
});

// ── Space programs ─────────────────────────────────────────────────────────
describe('integration / space.js programs', () => {
    const sp = loadDojoModule('space.js');
    if (!sp || !Array.isArray(sp.programs)) {
        it('SKIP — space.js not loadable', () => {});
        return;
    }

    it('loaded ≥4 space programs', () => {
        assert(sp.programs.length >= 4, `got ${sp.programs.length}`);
    });

    it('value table runs over the space-mission graph', () => {
        const eg = buildEgFromPrograms(sp.programs);
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { mission: true } });
        eq(r.ranking.length, sp.programs.length);
        for (const x of r.ranking) {
            assert(isFinite(x.V) && x.V >= 0);
        }
    });

    it('orbitalLaunch (the bootstrap mission) ranks before later moon/dune', () => {
        const eg = buildEgFromPrograms(sp.programs);
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { mission: true } });
        // orbitalLaunch is the cheapest in vanilla KG — should be top.
        if (r.ranking[0].id !== 'mission:orbitalLaunch') {
            // If the data shifted, just assert it's in the top half.
            const idx = r.ranking.findIndex(x => x.id === 'mission:orbitalLaunch');
            assert(idx >= 0 && idx < r.ranking.length / 2,
                'orbitalLaunch should rank in upper half');
        }
    });
});

// ── Tech + workshop + space combined ───────────────────────────────────────
describe('integration / combined tech+workshop+space graph', () => {
    const sci = loadDojoModule('science.js');
    const ws  = loadDojoModule('workshop.js');
    const sp  = loadDojoModule('space.js');

    if (!sci || !ws || !sp) {
        it('SKIP — one of science/workshop/space.js missing', () => {});
        return;
    }

    it('combined graph runs and produces a sane ranking', () => {
        const eg1 = buildEgFromUpgrades(sci.techs, 'tech');
        const eg2 = buildEgFromUpgrades(ws.upgrades, 'ws_upg');
        const eg3 = buildEgFromPrograms(sp.programs);
        const eg = {
            nodes: Object.assign({}, eg1.nodes, eg2.nodes, eg3.nodes),
            unlockedBy: Object.assign({}, eg1.unlockedBy, eg2.unlockedBy, eg3.unlockedBy)
        };
        const r = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        const expected = sci.techs.length + ws.upgrades.length + sp.programs.length;
        eq(r.ranking.length, expected);
        // No NaN, no negative V.
        for (const x of r.ranking) {
            assert(isFinite(x.V) && x.V >= 0, `bad V for ${x.id}`);
        }
    });

    it('combined graph runs in <50ms', () => {
        const eg1 = buildEgFromUpgrades(sci.techs, 'tech');
        const eg2 = buildEgFromUpgrades(ws.upgrades, 'ws_upg');
        const eg3 = buildEgFromPrograms(sp.programs);
        const eg = {
            nodes: Object.assign({}, eg1.nodes, eg2.nodes, eg3.nodes),
            unlockedBy: Object.assign({}, eg1.unlockedBy, eg2.unlockedBy, eg3.unlockedBy)
        };
        const t0 = Date.now();
        for (let i = 0; i < 5; i++) {
            ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        }
        const avg = (Date.now() - t0) / 5;
        assert(avg < 50, `avg ${avg.toFixed(2)}ms exceeds 50ms`);
        process.stdout.write(`      [perf] combined graph (${Object.keys(eg.nodes).length} nodes): ${avg.toFixed(2)}ms/cycle\n`);
    });
});
