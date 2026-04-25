// End-to-end SSP-Dynamic flow against real KittensGame data.
//
// Pipeline exercised:
//   1. Load science.js + workshop.js from kittensgame-master/.
//   2. Build an edge graph from the real techs/upgrades.
//   3. Pick a top goal via computeSspValueTable (proxy for pickTerminalGoalSSP).
//   4. Pretend the pick takes 2× longer than predicted → record observation.
//   5. Re-pick: the same tech's V should rise (bias × predicted-time grew).
//   6. Hammer it 30× → confirm the ranking actually shifts a slot.
//   7. Replay the feedback tick state machine end-to-end (start → finish → record).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, it, assert, eq, near } = require('./_harness');

const ssp_value  = require('../src/04e_ssp_value.js');
const ssp_belief = require('../src/04f_ssp_belief.js');

// ── Load a real game module via dojo stubs ────────────────────────────────
function loadDojoModule(rel) {
    const p = path.join(__dirname, '..', 'kittensgame-master', 'js', rel);
    if (!fs.existsSync(p)) return null;
    const src = fs.readFileSync(p, 'utf8');
    let captured = null;
    const sandbox = {
        dojo: { declare: (n, parent, body) => { if (!captured) captured = body; }, isArray: Array.isArray },
        com:     { nuclearunicorn: { core: { TabManager: function () {} } } },
        classes: { managers: {}, ui: { TabManager: function () {} } },
        $I:      (k) => k, console
    };
    vm.createContext(sandbox);
    try { vm.runInContext(src, sandbox, { timeout: 1000 }); } catch (e) { }
    return captured;
}

// ── Build an eg from real upgrade arrays ─────────────────────────────────
function buildEg(items, kind) {
    const nodes = {}, unlockedBy = {};
    for (const u of items) {
        const id = kind + ':' + u.name;
        const sub = (u.unlocks && (u.unlocks.tech || u.unlocks.upgrades)) || [];
        const ulist = sub.map(n => kind + ':' + n);
        nodes[id] = {
            id, kind, name: u.name, state: 'ready',
            price: u.prices || [{ name: 'science', val: 1 }],
            provides: { resources: [], storage: [], ratios: [], con: [], unlocks: ulist }
        };
    }
    for (const id in nodes)
        for (const child of nodes[id].provides.unlocks)
            (unlockedBy[child] = unlockedBy[child] || []).push({ id });
    return { nodes, unlockedBy };
}

function mockDeps() {
    return {
        timeToAffordInState: (state, prices) => {
            let s = 0;
            for (const p of (prices || [])) s += p.val;
            return { secs: s, capLimited: false };
        },
        applyActionSymbolic: (s, n) => Object.assign({}, s,
            { unlocks: Object.assign({}, s.unlocks, { [n.id]: true }) }),
        craftsByOutput: {},
        getBias: (id) => ssp_belief.getSspBias(id),
        rewardWeight: 0
    };
}

function memStorage() {
    const m = {};
    return {
        getItem: k => k in m ? m[k] : null,
        setItem: (k, v) => { m[k] = String(v); },
        removeItem: k => { delete m[k]; }
    };
}

// ── Load 04g via vm sandbox so we can drive the feedback state machine ───
function loadPolicyModule() {
    const sandbox = {
        computeSspValueTable: ssp_value.computeSspValueTable,
        getSspBias:           ssp_belief.getSspBias,
        recordSspObservation: ssp_belief.recordSspObservation,
        snapshotAlgebraicState: () => ({ unlocks: {}, resources: {}, rates: {}, caps: {} }),
        timeToAffordInState:    () => ({ secs: 1 }),
        applyActionSymbolic:    (s, n) => s,
        scrapeGraph:            () => ({}),
        _indexCraftsByOutput:   () => ({}),
        getCachedEdgeGraph:     () => null,
        gamePage: {}, cfg: {}, _sspBeliefLoad: () => ({}),
        console, module: { exports: {} }
    };
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'src', '04g_ssp_policy.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: '04g_ssp_policy.js' });
    return sandbox.module.exports;
}

// ─────────────────────────────────────────────────────────────────────────
describe('e2e / real-data SSP picks shift under feedback', () => {
    const sci = loadDojoModule('science.js');
    if (!sci || !Array.isArray(sci.techs)) {
        it('SKIP — science.js unavailable', () => {});
        return;
    }

    it('cold-start pick is the cheapest tech (calendar)', () => {
        ssp_belief._setSspBeliefStorage(memStorage());
        ssp_belief.resetSspBelief();
        const eg = buildEg(sci.techs, 'tech');
        const r = ssp_value.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { tech: true } });
        eq(r.ranking[0].id, 'tech:calendar',
            'calendar (30 science) should be the cheapest cold-start pick');
    });

    it('one observation: V grows but ranking still calendar (warmup blunts it)', () => {
        ssp_belief._setSspBeliefStorage(memStorage());
        ssp_belief.resetSspBelief();
        const eg = buildEg(sci.techs, 'tech');

        const r1 = ssp_value.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { tech: true } });
        const v0 = r1.V['tech:calendar'];

        // Pretend calendar took 4× longer than predicted.
        ssp_belief.recordSspObservation('tech:calendar', v0, v0 * 4);

        const r2 = ssp_value.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { tech: true } });
        const v1 = r2.V['tech:calendar'];
        assert(v1 > v0, `calendar V should grow after over-run: ${v0} → ${v1}`);
        // But warmup still has it on top — single obs isn't enough.
        eq(r2.ranking[0].id, 'tech:calendar');
    });

    it('after 30 over-runs: ranking actually shifts off calendar', () => {
        ssp_belief._setSspBeliefStorage(memStorage());
        ssp_belief.resetSspBelief();
        const eg = buildEg(sci.techs, 'tech');

        const v0 = ssp_value.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { tech: true } }).V['tech:calendar'];

        // Hammer calendar with 30 over-runs (4× actual vs predicted).
        for (let i = 0; i < 30; i++) {
            ssp_belief.recordSspObservation('tech:calendar', v0, v0 * 4);
        }

        const rec = ssp_belief.getSspBeliefRecord('tech:calendar');
        assert(rec.bias > 2.5, 'raw bias should converge above 2.5: ' + rec.bias);
        assert(rec.effective > 2.0, 'effective bias should exceed 2 after 30 obs: ' + rec.effective);

        const r = ssp_value.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { tech: true } });
        // Calendar's effective price is now ~3× higher; another tech should win.
        assert(r.ranking[0].id !== 'tech:calendar',
            'top pick must shift: still ' + r.ranking[0].id);
        // Calendar should still be in the picture — just demoted.
        const calIdx = r.ranking.findIndex(x => x.id === 'tech:calendar');
        assert(calIdx > 0 && calIdx < 5, 'calendar should be demoted, not vanished: idx ' + calIdx);
    });
});

describe('e2e / feedback state machine over real picks', () => {
    const sci = loadDojoModule('science.js');
    if (!sci || !Array.isArray(sci.techs)) {
        it('SKIP — science.js unavailable', () => {});
        return;
    }

    it('full lifecycle: pick → start tracking → complete → record → re-pick reflects it', () => {
        ssp_belief._setSspBeliefStorage(memStorage());
        ssp_belief.resetSspBelief();
        const eg = buildEg(sci.techs, 'tech');
        const policy = loadPolicyModule();

        // 1. Pick.
        const r0 = ssp_value.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { tech: true } });
        const top = r0.ranking[0].id;
        const predV = r0.V[top];

        // 2. Start tracking via feedback tick.
        policy._sspFeedbackTick(eg, top, predV);
        const pending = policy._sspPendingObservation();
        assert(pending && pending.goalId === top, 'tracking started');
        eq(pending.predictedSecs, predV);

        // 3. Simulate completion: mark the node 'done' and force elapsed back.
        eg.nodes[top].state = 'done';
        pending.startedAtMs = Date.now() - (predV * 2 * 1000);  // 2× the prediction

        // 4. Feedback tick recognizes completion and records.
        policy._sspFeedbackTick(eg, null, null);
        eq(policy._sspPendingObservation(), null, 'tracking cleared after record');

        const rec = ssp_belief.getSspBeliefRecord(top);
        eq(rec.count, 1);
        // Ratio = 2 → EWMA: 0.2*2 + 0.8*1 = 1.2.
        near(rec.bias, 1.2, 1e-9);

        // 5. Re-pick: new V should be larger (bias is being applied).
        eg.nodes[top].state = 'ready';  // reset for re-pick
        const r1 = ssp_value.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { tech: true } });
        assert(r1.V[top] > r0.V[top],
            `V should grow after observation: ${r0.V[top]} → ${r1.V[top]}`);
    });
});

describe('e2e / belief survives realistic noise', () => {
    const ws = loadDojoModule('workshop.js');
    if (!ws || !Array.isArray(ws.upgrades)) {
        it('SKIP — workshop.js unavailable', () => {});
        return;
    }

    it('mixed under-/over-runs converge toward 1.0 (game randomness scenario)', () => {
        ssp_belief._setSspBeliefStorage(memStorage());
        ssp_belief.resetSspBelief();
        const eg = buildEg(ws.upgrades, 'ws_upg');
        const top = ssp_value.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { ws_upg: true } }).ranking[0].id;

        const predV = ssp_value.computeSspValueTable(eg, { unlocks: {} }, mockDeps(),
            { terminalKinds: { ws_upg: true } }).V[top];

        // Alternate over and under: ratios oscillate around 1.0.
        for (let i = 0; i < 80; i++) {
            const r = (i % 2 === 0) ? 1.3 : 0.77;  // geometric mean ~1.0
            ssp_belief.recordSspObservation(top, predV, predV * r);
        }
        const rec = ssp_belief.getSspBeliefRecord(top);
        // EWMA should land near the average (slightly noisy from clipping).
        near(rec.bias, 1.0, 0.15, 'mixed noise should average out: ' + rec.bias);
        assert(rec.count === 80);
    });
});
