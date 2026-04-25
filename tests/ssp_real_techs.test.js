// Integration test: load the real techs[] array out of kittensgame-master/js/
// /science.js and run computeSspValueTable over a synthetic eg built from it.
//
// Goal: prove that the value-iteration scales to the actual KG tech graph
// (~50 techs) and produces a sensible ranking — cheap early techs ahead of
// expensive late ones, no exceptions, no Infinities for reachable nodes.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, it, assert, eq } = require('./_harness');
const ssp = require('../src/04e_ssp_value.js');

// ── Extract `techs:` array from kittensgame-master/js/science.js ────────────
function loadRealTechs() {
    const sciencePath = path.join(__dirname, '..',
        'kittensgame-master', 'js', 'science.js');
    if (!fs.existsSync(sciencePath)) return null;
    const src = fs.readFileSync(sciencePath, 'utf8');

    let captured = null;
    const sandbox = {
        dojo: {
            declare: (name, parent, body) => { if (!captured) captured = body; },
            isArray: Array.isArray
        },
        com: { nuclearunicorn: { core: { TabManager: function () {} } } },
        classes: { managers: {} },
        $I: (k) => k,
        console
    };
    vm.createContext(sandbox);
    try { vm.runInContext(src, sandbox, { timeout: 1000 }); }
    catch (e) { /* fine; we may have grabbed techs already */ }
    return (captured && Array.isArray(captured.techs)) ? captured.techs : null;
}

// ── Convert techs[] to an eg-shaped subgraph ────────────────────────────────
function buildEgFromTechs(techs) {
    const nodes = {};
    const unlockedBy = {};

    for (const t of techs) {
        const id = 'tech:' + t.name;
        const ulist = (t.unlocks && Array.isArray(t.unlocks.tech))
            ? t.unlocks.tech.map(n => 'tech:' + n) : [];
        nodes[id] = {
            id, kind: 'tech', name: t.name,
            state: 'ready',                // simplest assumption — every tech reachable
            price: t.prices || [{ name: 'science', val: 1 }],
            unlockPrice: t.prices || null,
            prereqs: [],
            provides: { resources: [], storage: [], ratios: [], con: [], unlocks: ulist }
        };
    }
    // Build inverse index from the unlocks graph for completeness.
    for (const id in nodes) {
        for (const child of nodes[id].provides.unlocks) {
            (unlockedBy[child] = unlockedBy[child] || [])
                .push({ id, mode: 'or' });
        }
    }
    return { nodes, unlockedBy };
}

// Mock symbolic deps that read price[0].val as time-cost (science cost as proxy
// for time — what matters is monotonic ordering, not units).
function mockDeps() {
    return {
        timeToAffordInState: (state, prices) => {
            if (!prices || prices.length === 0) return { secs: 0, capLimited: false };
            // Sum across resources for a deterministic cost.
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

// ── Tests ───────────────────────────────────────────────────────────────────
describe('integration / real KG tech tree', () => {
    const techs = loadRealTechs();
    if (!techs) {
        it('SKIP — kittensgame-master/js/science.js not found or unparseable', () => {});
        return;
    }

    it('extracted at least 30 techs from science.js', () => {
        assert(techs.length >= 30, `got ${techs.length}`);
    });

    it('every tech has a name and prices', () => {
        for (const t of techs) {
            assert(typeof t.name === 'string' && t.name.length > 0, `bad name: ${JSON.stringify(t)}`);
            assert(Array.isArray(t.prices), `bad prices for ${t.name}`);
        }
    });

    it('value table computes for the full real graph', () => {
        const eg = buildEgFromTechs(techs);
        const result = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        eq(result.ranking.length, techs.length);
        // No exceptions, all reachable (since we set every node's state='ready').
        for (const r of result.ranking) {
            assert(r.reachable, `${r.id} unreachable`);
            assert(isFinite(r.V) && r.V >= 0, `bad V for ${r.id}: ${r.V}`);
        }
    });

    it('cheapest known tech (calendar, 30 science) ranks at the top', () => {
        const eg = buildEgFromTechs(techs);
        const result = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        // Calendar at 30 science is the cheapest first-tier tech in vanilla KG.
        eq(result.ranking[0].id, 'tech:calendar');
    });

    it('reward weight reorders by fanout when costs are similar', () => {
        const eg = buildEgFromTechs(techs);
        const noBonus  = ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        const deps = mockDeps(); deps.rewardWeight = 50;
        const withBonus = ssp.computeSspValueTable(eg, { unlocks: {} }, deps);
        // The two rankings should differ — fanout bonus must move *something*.
        const a = noBonus.ranking.map(r => r.id).slice(0, 10).join(',');
        const b = withBonus.ranking.map(r => r.id).slice(0, 10).join(',');
        assert(a !== b, 'reward bonus had no effect on top-10');
    });

    it('runs in <100ms on the real graph', () => {
        const eg = buildEgFromTechs(techs);
        const t0 = Date.now();
        for (let i = 0; i < 10; i++) {
            ssp.computeSspValueTable(eg, { unlocks: {} }, mockDeps());
        }
        const avg = (Date.now() - t0) / 10;
        assert(avg < 100, `avg cycle ${avg}ms exceeds 100ms budget`);
        process.stdout.write(`      [perf] avg cycle: ${avg.toFixed(2)}ms over ${techs.length} techs\n`);
    });
});
