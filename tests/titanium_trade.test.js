// Titanium burst trading: doAutoTrade fires up to cfg.titaniumTradeBatch
// trades with zebras when ships ≥ floor and titanium not near cap.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, it, assert, eq } = require('./_harness');

const AUTO_SRC = fs.readFileSync(
    path.join(__dirname, '..', 'src', '08_automation.js'), 'utf8');

// Build a sandbox with everything 08_automation.js touches stubbed out.
function loadAutomation(cfgOverride) {
    const cfg = Object.assign({
        goldTradeReserve: 0,
        faithPraiseReserve: 0,
        titaniumTradeBatch: 25,
        titaniumTradeShipFloor: 1
    }, cfgOverride || {});

    // Track tradeMultiple calls.
    const tradeCalls = [];

    const sandbox = {
        cfg,
        ActionType: { TRADE: 'TRADE' },
        createAction: (t, n, x) => Object.assign({ type: t, name: n }, x || {}),
        executeAction: () => true,
        canAffordTrade: (game, race, amt) => {
            // Mirror real logic: gold + manpower + buy resources.
            const g  = game.resPool.get('gold');
            const mp = game.resPool.get('manpower');
            const reserve = cfg.goldTradeReserve || 0;
            if (!g || g.value < game.diplomacy.getGoldCost() * amt + reserve) return false;
            if (!mp || mp.value < game.diplomacy.getManpowerCost() * amt) return false;
            if (race.buys) for (const b of race.buys) {
                const r = game.resPool.get(b.name);
                if (!r || r.value < b.val * amt) return false;
            }
            return true;
        },
        canAffordWithCrafting: () => ({ affordable: false }),
        progressCraftChain: () => 0,
        gamePage: null,
        clickerWorker: null,
        speedWorker: null,
        instantBoughtKeys: {},
        decisionLog: [],
        logDecision: () => {},
        setStatus: () => {},
        setSpeedMultiplier: () => {},
        setClickerRate: () => {},
        Worker: function () {},
        Blob: function () {},
        URL: { createObjectURL: () => '' },
        console,
        module: { exports: {} },
        _tradeCalls: tradeCalls
    };
    vm.createContext(sandbox);
    vm.runInContext(AUTO_SRC, sandbox, { filename: '08_automation.js' });
    sandbox.__exports = vm.runInContext(
        '({ doAutoTrade, _titaniumBurstAmount })', sandbox);
    sandbox.tradeCalls = tradeCalls;
    return sandbox;
}

function makeGame(opts) {
    opts = opts || {};
    const tradeCalls = opts.tradeCalls;
    const res = Object.assign({
        gold:     { value: 1000, maxValue: 5000 },
        manpower: { value: 1000, maxValue: 5000 },
        titanium: { value: 0,    maxValue: 100 },
        ship:     { value: opts.ships != null ? opts.ships : 5 },
        slab:     { value: 9999, maxValue: 99999 }
    }, opts.res || {});
    return {
        resPool: { get: (n) => res[n] || null },
        diplomacy: {
            get: (n) => (n === 'zebras' ? opts.zebras : null),
            getGoldCost:     () => 15,
            getManpowerCost: () => 50,
            getMaxTradeAmt:  (race) => opts.maxTradeAmt != null ? opts.maxTradeAmt : 100,
            tradeMultiple:   (race, amt) => { tradeCalls.push({ race: race.name, amt }); }
        },
        updateCaches: () => {}
    };
}

const ZEBRAS_BASE = {
    name: 'zebras', unlocked: true,
    buys:  [{ name: 'slab', val: 5 }],
    sells: [{ name: 'titanium', val: 1.5 }, { name: 'iron', val: 300 }]
};

describe('titanium burst / _titaniumBurstAmount', () => {
    it('returns 1 when batch=0 (disabled)', () => {
        const sb = loadAutomation({ titaniumTradeBatch: 0 });
        sb.gamePage = makeGame({ tradeCalls: sb.tradeCalls, zebras: ZEBRAS_BASE });
        eq(sb.__exports._titaniumBurstAmount(ZEBRAS_BASE), 1);
    });

    it('returns 1 when batch=1 (no burst)', () => {
        const sb = loadAutomation({ titaniumTradeBatch: 1 });
        sb.gamePage = makeGame({ tradeCalls: sb.tradeCalls, zebras: ZEBRAS_BASE });
        eq(sb.__exports._titaniumBurstAmount(ZEBRAS_BASE), 1);
    });

    it('returns 1 when ships below floor', () => {
        const sb = loadAutomation({ titaniumTradeBatch: 25, titaniumTradeShipFloor: 5 });
        sb.gamePage = makeGame({ tradeCalls: sb.tradeCalls, zebras: ZEBRAS_BASE, ships: 0 });
        eq(sb.__exports._titaniumBurstAmount(ZEBRAS_BASE), 1);
    });

    it('returns 1 when titanium near cap (>= 95%)', () => {
        const sb = loadAutomation();
        sb.gamePage = makeGame({
            tradeCalls: sb.tradeCalls, zebras: ZEBRAS_BASE,
            res: { titanium: { value: 96, maxValue: 100 } }
        });
        eq(sb.__exports._titaniumBurstAmount(ZEBRAS_BASE), 1);
    });

    it('returns batch when fully affordable', () => {
        const sb = loadAutomation({ titaniumTradeBatch: 25 });
        sb.gamePage = makeGame({ tradeCalls: sb.tradeCalls, zebras: ZEBRAS_BASE,
            maxTradeAmt: 100, res: { gold: { value: 5000, maxValue: 10000 } } });
        eq(sb.__exports._titaniumBurstAmount(ZEBRAS_BASE), 25);
    });

    it('caps at game.getMaxTradeAmt when game-bound is tighter', () => {
        const sb = loadAutomation({ titaniumTradeBatch: 100 });
        sb.gamePage = makeGame({ tradeCalls: sb.tradeCalls, zebras: ZEBRAS_BASE,
            maxTradeAmt: 7 });
        eq(sb.__exports._titaniumBurstAmount(ZEBRAS_BASE), 7);
    });

    it('honors goldTradeReserve (gold-bound becomes the cap)', () => {
        // gold=1000, cost=15, reserve=900 → (1000-900)/15 = 6
        const sb = loadAutomation({ titaniumTradeBatch: 50, goldTradeReserve: 900 });
        sb.gamePage = makeGame({ tradeCalls: sb.tradeCalls, zebras: ZEBRAS_BASE,
            maxTradeAmt: 100 });
        eq(sb.__exports._titaniumBurstAmount(ZEBRAS_BASE), 6);
    });

    it('returns 1 when getMaxTradeAmt returns 0', () => {
        const sb = loadAutomation();
        sb.gamePage = makeGame({ tradeCalls: sb.tradeCalls, zebras: ZEBRAS_BASE,
            maxTradeAmt: 0 });
        eq(sb.__exports._titaniumBurstAmount(ZEBRAS_BASE), 1);
    });
});

describe('titanium burst / doAutoTrade integration', () => {
    it('fires a burst trade with zebras when conditions met', () => {
        const sb = loadAutomation({ titaniumTradeBatch: 25 });
        sb.gamePage = makeGame({ tradeCalls: sb.tradeCalls, zebras: ZEBRAS_BASE });
        sb.__exports.doAutoTrade();
        const z = sb.tradeCalls.find(c => c.race === 'zebras');
        assert(z, 'zebras were traded');
        eq(z.amt, 25);
    });

    it('falls back to amount=1 with zebras when titanium burst conditions fail', () => {
        const sb = loadAutomation({ titaniumTradeBatch: 25, titaniumTradeShipFloor: 99 });
        sb.gamePage = makeGame({ tradeCalls: sb.tradeCalls, zebras: ZEBRAS_BASE, ships: 0 });
        sb.__exports.doAutoTrade();
        const z = sb.tradeCalls.find(c => c.race === 'zebras');
        assert(z, 'zebras still traded (background)');
        eq(z.amt, 1);
    });

    it('skips zebras entirely when not unlocked', () => {
        const sb = loadAutomation();
        sb.gamePage = makeGame({ tradeCalls: sb.tradeCalls,
            zebras: Object.assign({}, ZEBRAS_BASE, { unlocked: false }) });
        sb.__exports.doAutoTrade();
        eq(sb.tradeCalls.length, 0);
    });

    it('skips zebras when titanium near cap (wasteful guard)', () => {
        const sb = loadAutomation();
        sb.gamePage = makeGame({ tradeCalls: sb.tradeCalls, zebras: ZEBRAS_BASE,
            res: { titanium: { value: 100, maxValue: 100 } } });
        sb.__exports.doAutoTrade();
        eq(sb.tradeCalls.length, 0, 'wasteful trade skipped');
    });
});

describe('titanium burst / source wiring', () => {
    it('cfg.titaniumTradeBatch defaults to 25', () => {
        const cfgSrc = fs.readFileSync(
            path.join(__dirname, '..', 'src', '01_config.js'), 'utf8');
        assert(/titaniumTradeBatch\s*:\s*25/.test(cfgSrc));
    });

    it('cfg.titaniumTradeShipFloor defaults to 1', () => {
        const cfgSrc = fs.readFileSync(
            path.join(__dirname, '..', 'src', '01_config.js'), 'utf8');
        assert(/titaniumTradeShipFloor\s*:\s*1/.test(cfgSrc));
    });

    it('UI exposes mcts_input_ti_burst control', () => {
        const ui = fs.readFileSync(
            path.join(__dirname, '..', 'src', '10_ui.js'), 'utf8');
        assert(/id="mcts_input_ti_burst"/.test(ui));
    });
});
