// Cap-horizon redirect: when the recommended frontier entry is cap-limited,
// the planner should reroute to the cheapest cap-raiser whose own ETA is
// finite. We test the helper _findCapHorizonRaiser in a vm sandbox.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, it, assert, eq } = require('./_harness');

const CHAIN_SRC = fs.readFileSync(
    path.join(__dirname, '..', 'src', '07_chain.js'), 'utf8');

// Build a vm sandbox with the chain module's external dependencies stubbed.
function loadChain() {
    const sandbox = {
        // External symbols 07_chain.js uses.
        cfg: { capHorizon: true },
        ActionType: {
            BUILD: 'BUILD', RESEARCH: 'RESEARCH', WORKSHOP_UPGRADE: 'WS_UPG',
            RELIGION_UPGRADE: 'REL', SPACE_MISSION: 'MIS',
            SPACE_BUILDING: 'SBLD', EMBASSY: 'EMB', CRAFT: 'CRAFT'
        },
        createAction: (t, n, x) => Object.assign({ type: t, name: n, key: t + ':' + n }, x || {}),
        scrapeGraph: () => ({}),
        buildEdgeGraph: () => ({ nodes: {}, unlockedBy: {} }),
        snapshotAlgebraicState: () => null,
        collectGoalAwareCandidates: () => [],
        pruneCandidates: (a, b, c, cand) => cand,
        beamSearchFrontier: () => null,
        getTerminalGoal: () => null,
        getCachedEdgeGraph: () => null,
        gamePage: {},
        // chainBackward's inner expand() reads `game` as a free variable from
        // the IIFE closure. Expose it at sandbox scope; tests overwrite per-call.
        game: null,
        console,
        module: { exports: {} }
    };
    vm.createContext(sandbox);
    vm.runInContext(CHAIN_SRC, sandbox, { filename: '07_chain.js' });
    // Capture the helpers we need by stashing them via a runInContext eval:
    sandbox.__exports = vm.runInContext(
        '({ planNextAction, _findCapHorizonRaiser, chainBackward, annotateChainETA })',
        sandbox);
    return sandbox;
}

// ── Build a minimal eg with a cap-limited goal + cap-raiser ──────────────
function makeEg() {
    const nodes = {
        // Goal: needs 100 science to research, but cap is 10.
        'tech:goal': {
            id: 'tech:goal', kind: 'tech', name: 'goal', state: 'ready',
            price: [{ name: 'science', val: 100 }],
            prereqs: [],
            options: [],
            provides: { resources: [], storage: [], ratios: [], con: [], unlocks: [] },
            perUnitProvides: { resources: [], storage: [], ratios: [], con: [] }
        },
        // Cheap library: cap-raiser, ready, no prereq.
        'bld:library': {
            id: 'bld:library', kind: 'bld', name: 'library', state: 'ready',
            price: [{ name: 'wood', val: 25 }],
            prereqs: [],
            options: [],
            provides: { resources: [], storage: [{ res: 'science', amount: 250 }],
                        ratios: [], con: [], unlocks: [] },
            perUnitProvides: { resources: [], storage: [{ res: 'science', amount: 250 }],
                               ratios: [], con: [] }
        },
        // Decoy raiser: also raises science cap but more expensive.
        'bld:academy': {
            id: 'bld:academy', kind: 'bld', name: 'academy', state: 'ready',
            price: [{ name: 'wood', val: 50 }, { name: 'minerals', val: 70 }],
            prereqs: [], options: [],
            provides: { resources: [], storage: [{ res: 'science', amount: 500 }],
                        ratios: [], con: [], unlocks: [] },
            perUnitProvides: { resources: [], storage: [{ res: 'science', amount: 500 }],
                               ratios: [], con: [] }
        }
    };
    return {
        nodes,
        unlockedBy: {},
        capRaisersOf: { science: ['bld:library', 'bld:academy'] }
    };
}

function makeGame() {
    return {
        ticksPerSecond: 5,
        resPool: {
            get: (name) => {
                const data = {
                    science:  { value: 5,  maxValue: 10, perTickCached: 0.2 },
                    wood:     { value: 30, maxValue: 200, perTickCached: 0.1 },
                    minerals: { value: 0,  maxValue: 200, perTickCached: 0.1 }
                };
                return data[name] || null;
            }
        }
    };
}

// ─────────────────────────────────────────────────────────────────────────
describe('cap-horizon / _findCapHorizonRaiser', () => {
    it('returns the cheapest cap-raiser when entry is cap-limited', () => {
        const sb = loadChain();
        const eg = makeEg();
        const game = makeGame();
        sb.game = game;
        const entry = { cost: [{ name: 'science', val: 100 }], capLimited: true };
        const id = sb.__exports._findCapHorizonRaiser(game, {}, eg, entry);
        eq(id, 'bld:library', 'cheapest by ETA — library has only wood cost');
    });

    it('returns null when the resource cap is already large enough', () => {
        const sb = loadChain();
        const eg = makeEg();
        const game = makeGame();
        // Cap (10) ≥ requirement (5) → not blocking.
        const entry = { cost: [{ name: 'science', val: 5 }], capLimited: true };
        const id = sb.__exports._findCapHorizonRaiser(game, {}, eg, entry);
        eq(id, null);
    });

    it('returns null when no cap-raisers are registered', () => {
        const sb = loadChain();
        const eg = makeEg();
        eg.capRaisersOf = {};  // none
        const game = makeGame();
        const entry = { cost: [{ name: 'science', val: 100 }], capLimited: true };
        const id = sb.__exports._findCapHorizonRaiser(game, {}, eg, entry);
        eq(id, null);
    });

    it('skips raisers that are themselves done', () => {
        const sb = loadChain();
        const eg = makeEg();
        eg.nodes['bld:library'].state = 'done';
        const game = makeGame();
        sb.game = game;
        const entry = { cost: [{ name: 'science', val: 100 }], capLimited: true };
        const id = sb.__exports._findCapHorizonRaiser(game, {}, eg, entry);
        // Falls back to academy.
        eq(id, 'bld:academy');
    });

    it('handles capRaisersOf entries as plain ids OR {id} objects', () => {
        const sb = loadChain();
        const eg = makeEg();
        eg.capRaisersOf = { science: [{ id: 'bld:library' }, { id: 'bld:academy' }] };
        const game = makeGame();
        sb.game = game;
        const entry = { cost: [{ name: 'science', val: 100 }], capLimited: true };
        const id = sb.__exports._findCapHorizonRaiser(game, {}, eg, entry);
        eq(id, 'bld:library');
    });

    it('returns null when entry has no cost', () => {
        const sb = loadChain();
        const id1 = sb.__exports._findCapHorizonRaiser(makeGame(), {}, makeEg(), { cost: [] });
        const id2 = sb.__exports._findCapHorizonRaiser(makeGame(), {}, makeEg(), {});
        eq(id1, null);
        eq(id2, null);
    });
});

describe('cap-horizon / source wiring', () => {
    it('planNextAction body checks cfg.capHorizon kill-switch', () => {
        assert(/capHorizon\s*!==\s*false/.test(CHAIN_SRC));
    });

    it('redirect block sets safetyNote starting "cap-horizon"', () => {
        assert(/safetyNote\s*=\s*['"]cap-horizon:/.test(CHAIN_SRC));
    });

    it('cap-horizon redirect runs after the runway-safety redirect', () => {
        const runwayIdx = CHAIN_SRC.indexOf('safety: routing via');
        const capIdx    = CHAIN_SRC.indexOf('cap-horizon: routing via');
        assert(runwayIdx > 0 && capIdx > 0);
        assert(capIdx > runwayIdx,
            'cap-horizon block must appear after runway block (runway has priority)');
    });

    it('cfg.capHorizon defaults to true', () => {
        const cfg = fs.readFileSync(
            path.join(__dirname, '..', 'src', '01_config.js'), 'utf8');
        assert(/capHorizon\s*:\s*true/.test(cfg));
    });
});
