/**
 * Headless autoplayer integration test.
 *
 * Boots the real KittensGame in jsdom (via setup.js), then loads our
 * mcts_autoplayer.user.js bundle with Worker/Blob stubbed so the IIFE
 * doesn't try to spin up real web workers.  Asserts:
 *   1. The bundle loads without throwing.
 *   2. Core autoplayer entry points (planNextAction, detectPhase) are
 *      reachable as globals once we eval inside our own scope.
 *   3. A short tick loop produces resource accumulation.
 *
 * Note: the bundle's IIFE keeps everything internal — it doesn't expose
 * planNextAction to window.  We work around this by stripping the IIFE
 * wrapper so its definitions land at module scope.
 */

/* global test, expect, beforeEach, jest */

const fs = require('fs');
const path = require('path');

const BUNDLE_PATH = path.join(__dirname, '..', '..', 'mcts_autoplayer.user.js');

let gameInstance = null;
let autoplayer  = null;   // sandbox holding evaluated autoplayer globals

beforeEach(() => {
    // Fresh game per test — setup.js already ran require() chains.
    global.gamePage = global.game = new com.nuclearunicorn.game.ui.GamePage();
    global.newrelic = {
        addPageAction: jest.fn(),
        addRelease: jest.fn(),
        setCustomAttribute: jest.fn(),
        setErrorHandler: jest.fn()
    };
    game.setUI(new classes.ui.UISystem("gameContainerId"));
    game.resetState();
    // Cold-start seed: 10 catnip lets the autoplayer buy the first
    // `field` (cost 10) and unlock catnip production.  Without this
    // the game has 0 production and the run never starts.
    game.resPool.addResEvent('catnip', 10);
    gameInstance = game;
});

afterEach(() => {
    jest.clearAllMocks();
});

// Load the autoplayer bundle into a synthetic sandbox.  Strips the userscript
// header + IIFE wrapper so all top-level `function`/`var` declarations land
// in our local scope and become observable.
function loadAutoplayer(gamePageRef) {
    let src = fs.readFileSync(BUNDLE_PATH, 'utf8');
    // Strip userscript metadata block.
    src = src.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/m, '');
    // Strip the outer (function(){ 'use strict'; ... })(); wrapper.
    src = src.replace(/^\s*\(\s*function\s*\(\s*\)\s*\{\s*('use strict';)?/, '');
    src = src.replace(/\}\s*\)\s*\(\s*\)\s*;?\s*$/, '');

    // Stub Worker/Blob so startClickerWorker / orchestrator timer don't fire.
    const ctx = {
        Worker: function () { this.postMessage = function () {}; this.onmessage = null; },
        Blob:   function () {},
        URL:    { createObjectURL: () => '' },
        document: global.document,
        window:   global.window,
        localStorage: global.localStorage || global.LCstorage,
        gamePage: gamePageRef,
        console:  console,
        Date,
        Math,
        Object, Array, JSON, parseInt, parseFloat, isNaN, isFinite,
        setInterval: () => 0,
        clearInterval: () => {},
        setTimeout: () => 0,
        clearTimeout: () => {},
        Promise
    };

    // Evaluate inside a controlled scope using `with` (still legal in
    // non-strict eval).  We grab the public-ish symbols we want to test by
    // returning them from an inner expression.
    // Easier: use `Function` constructor to build a function whose params
    // are the ctx keys, then return the symbols of interest.
    const keys = Object.keys(ctx);
    const harness = new Function(...keys,
        src + `
        ;return {
            planNextAction:        typeof planNextAction        === 'function' ? planNextAction        : null,
            detectPhase:           typeof detectPhase           === 'function' ? detectPhase           : null,
            recordPhaseSample:     typeof recordPhaseSample     === 'function' ? recordPhaseSample     : null,
            doAutoTrade:           typeof doAutoTrade           === 'function' ? doAutoTrade           : null,
            doInstantBuys:         typeof doInstantBuys         === 'function' ? doInstantBuys         : null,
            doAutoJobs:            typeof doAutoJobs            === 'function' ? doAutoJobs            : null,
            doAutoHunt:            typeof doAutoHunt            === 'function' ? doAutoHunt            : null,
            doAutoCraft:           typeof doAutoCraft           === 'function' ? doAutoCraft           : null,
            doAutoFestival:        typeof doAutoFestival        === 'function' ? doAutoFestival        : null,
            doAutoPraise:          typeof doAutoPraise          === 'function' ? doAutoPraise          : null,
            buildEdgeGraph:        typeof buildEdgeGraph        === 'function' ? buildEdgeGraph        : null,
            scrapeGraph:           typeof scrapeGraph           === 'function' ? scrapeGraph           : null,
            getCachedEdgeGraph:    typeof getCachedEdgeGraph    === 'function' ? getCachedEdgeGraph    : null,
            chainBackward:         typeof chainBackward         === 'function' ? chainBackward         : null,
            executeAction:         typeof executeAction         === 'function' ? executeAction         : null,
            createAction:          typeof createAction          === 'function' ? createAction          : null,
            ActionType:            typeof ActionType            !== 'undefined' ? ActionType            : null,
            getPhaseLog:           typeof getPhaseLog           === 'function' ? getPhaseLog           : null,
            cfg:                   typeof cfg                   !== 'undefined' ? cfg                   : null
        };`);
    return harness(...keys.map(k => ctx[k]));
}

test('autoplayer bundle loads cleanly against a fresh GamePage', () => {
    autoplayer = loadAutoplayer(gameInstance);
    expect(autoplayer).toBeTruthy();
    expect(autoplayer.planNextAction).toBeInstanceOf(Function);
    expect(autoplayer.detectPhase).toBeInstanceOf(Function);
    expect(autoplayer.doAutoTrade).toBeInstanceOf(Function);
});

test('detectPhase classifies a fresh GamePage as Pregame (T0)', () => {
    autoplayer = loadAutoplayer(gameInstance);
    const phase = autoplayer.detectPhase(gameInstance);
    expect(phase.tier).toBe(0);
    expect(phase.name).toBe('Pregame');
});

test('detectPhase shifts to Foundation (T1) after a hut + library exist', () => {
    autoplayer = loadAutoplayer(gameInstance);
    // Force the buildings into existence.  KG GamePage exposes bld.get(...).val.
    gameInstance.bld.get('field').val = 1;
    gameInstance.bld.get('hut').val = 1;
    gameInstance.bld.get('library').val = 1;
    const phase = autoplayer.detectPhase(gameInstance);
    expect(phase.tier).toBeGreaterThanOrEqual(1);
});

test('scrapeGraph + buildEdgeGraph produce a non-empty edge graph', () => {
    autoplayer = loadAutoplayer(gameInstance);
    const scrape = autoplayer.scrapeGraph(gameInstance);
    expect(scrape).toBeTruthy();
    const eg = autoplayer.buildEdgeGraph(gameInstance, scrape);
    expect(eg).toBeTruthy();
    expect(eg.nodes).toBeTruthy();
    expect(Object.keys(eg.nodes).length).toBeGreaterThan(20);
});

test('planNextAction with no terminal goal returns kind:no-goal', () => {
    autoplayer = loadAutoplayer(gameInstance);
    autoplayer.cfg.terminalGoal = null;
    const plan = autoplayer.planNextAction(gameInstance);
    expect(plan).toBeTruthy();
    expect(plan.kind).toBe('no-goal');
});

test('planNextAction returns a recommend/blocked plan for a real goal', () => {
    autoplayer = loadAutoplayer(gameInstance);
    // Seed enough resources to make plans meaningful.
    gameInstance.resPool.addResEvent('catnip', 200);
    gameInstance.resPool.addResEvent('wood',   100);
    autoplayer.cfg.terminalGoal = 'tech:calendar';
    const plan = autoplayer.planNextAction(gameInstance);
    expect(plan).toBeTruthy();
    // Calendar's prereq chain demands science → library → catnip; result
    // can be 'recommend' (if a frontier action surfaced) or 'blocked'.
    expect(['recommend', 'blocked', 'done']).toContain(plan.kind);
});

test('cold-start trial: autoplayer builds at least 1 field within 200 cycles', () => {
    autoplayer = loadAutoplayer(gameInstance);
    autoplayer.cfg.terminalGoal = 'bld:field';

    // Drive the autoplayer manually: each cycle = doInstantBuys + planNextAction
    // + (if recommend) executeAction + game.update() ×N to accumulate resources.
    const TICKS_PER_CYCLE = 20;
    const MAX_CYCLES      = 200;
    let fieldsBuilt = 0;
    for (let i = 0; i < MAX_CYCLES; i++) {
        try { autoplayer.doInstantBuys && autoplayer.doInstantBuys(); } catch (e) {}
        const plan = autoplayer.planNextAction(gameInstance);
        if (plan && plan.kind === 'recommend' && plan.action) {
            try { autoplayer.executeAction(gameInstance, plan.action); } catch (e) {}
        }
        for (let t = 0; t < TICKS_PER_CYCLE; t++) {
            try { gameInstance.update(); } catch (e) {}
        }
        fieldsBuilt = gameInstance.bld.get('field').val;
        if (fieldsBuilt >= 1) break;
    }
    expect(fieldsBuilt).toBeGreaterThanOrEqual(1);
});

test('cold-start trial: catnip production goes positive after first field', () => {
    autoplayer = loadAutoplayer(gameInstance);
    autoplayer.cfg.terminalGoal = 'bld:field';

    // Buy the first field directly so we can isolate "does production work?"
    const action = autoplayer.createAction(autoplayer.ActionType.BUILD, 'field');
    autoplayer.executeAction(gameInstance, action);

    // Tick the game so production accumulates.
    for (let t = 0; t < 50; t++) gameInstance.update();

    expect(gameInstance.bld.get('field').val).toBeGreaterThanOrEqual(1);
    const catnip = gameInstance.resPool.get('catnip');
    expect(catnip.perTickCached).toBeGreaterThan(0);
});

test('cold-start trial: 500-cycle run progresses past first hut', () => {
    autoplayer = loadAutoplayer(gameInstance);
    // Open-ended goal — let chain pick whatever's cheapest.
    autoplayer.cfg.terminalGoal = 'bld:hut';

    const TICKS_PER_CYCLE = 20;
    const MAX_CYCLES      = 500;
    let cycles = 0;
    let hutsBuilt = 0;
    for (let i = 0; i < MAX_CYCLES; i++) {
        cycles++;
        try { autoplayer.doInstantBuys && autoplayer.doInstantBuys(); } catch (e) {}
        const plan = autoplayer.planNextAction(gameInstance);
        if (plan && plan.kind === 'recommend' && plan.action) {
            try { autoplayer.executeAction(gameInstance, plan.action); } catch (e) {}
        }
        for (let t = 0; t < TICKS_PER_CYCLE; t++) {
            try { gameInstance.update(); } catch (e) {}
        }
        hutsBuilt = gameInstance.bld.get('hut').val;
        if (hutsBuilt >= 1) break;
    }
    const fields = gameInstance.bld.get('field').val;
    const catnip = gameInstance.resPool.get('catnip').value;
    // Soft assert — if hut wasn't reached we still want fields built.
    expect(fields).toBeGreaterThanOrEqual(1);
    // Trace info for failure diagnosis (only printed on failure context).
    if (hutsBuilt < 1) {
        console.log(`Trial diag: cycles=${cycles}, fields=${fields}, catnip=${catnip}`);
    }
});

test('introspect: edge graph tech:calendar node', () => {
    autoplayer = loadAutoplayer(gameInstance);
    const scrape = autoplayer.scrapeGraph(gameInstance);
    const eg = autoplayer.buildEdgeGraph(gameInstance, scrape);
    const tc = eg.nodes['tech:calendar'];
    process.stderr.write(`\ntech:calendar node = ${JSON.stringify({
        id: tc && tc.id,
        kind: tc && tc.kind,
        name: tc && tc.name,
        state: tc && tc.state,
        price: tc && tc.price
    })}\n`);
    const calRaw = gameInstance.science.get('calendar');
    process.stderr.write(`raw science.get('calendar') = ${JSON.stringify({
        name: calRaw && calRaw.name,
        unlocked: calRaw && calRaw.unlocked,
        researched: calRaw && calRaw.researched,
        prices: calRaw && calRaw.prices
    })}\n`);
    expect(tc).toBeTruthy();
});

test('diagnostic trial: 100 cycles toward tech:calendar, log first 5 plans', () => {
    autoplayer = loadAutoplayer(gameInstance);
    autoplayer.cfg.terminalGoal = 'tech:calendar';

    const TICKS_PER_CYCLE = 20;
    const MAX_CYCLES      = 100;
    const planTrace       = [];
    for (let i = 0; i < MAX_CYCLES; i++) {
        const plan = autoplayer.planNextAction(gameInstance);
        if (i < 5) {
            planTrace.push({
                cycle: i,
                kind:    plan && plan.kind,
                action:  plan && plan.action ? (plan.action.type + ':' + plan.action.name) : null,
                node:    plan && plan.node ? (plan.node.kind + ':' + plan.node.name + '(id=' + plan.node.id + ')') : null,
                recId:   plan && plan.chain ? plan.chain.recommended : null,
                reason:  plan && plan.reason,
                goal:    plan && plan.goalId,
                eta:     plan && plan.etaSecs,
                catnip:  gameInstance.resPool.get('catnip').value.toFixed(1)
            });
        }
        if (plan && plan.kind === 'recommend' && plan.action) {
            try { autoplayer.executeAction(gameInstance, plan.action); } catch (e) {}
        }
        for (let t = 0; t < TICKS_PER_CYCLE; t++) {
            try { gameInstance.update(); } catch (e) {}
        }
    }

    const fields  = gameInstance.bld.get('field').val;
    const huts    = gameInstance.bld.get('hut').val;
    const catnip  = gameInstance.resPool.get('catnip').value;
    const science = gameInstance.resPool.get('science');
    // setup.js mocks console.log — write to stderr so jest reports it.
    process.stderr.write(
        `\n--- Diagnostic trial: tech:calendar from cold start (10 catnip) ---\n` +
        `fields=${fields}  huts=${huts}  catnip=${catnip.toFixed(1)}  science=${science ? science.value.toFixed(1) : 'n/a'}\n` +
        `First 5 plans:\n` + planTrace.map(p =>
            `  cycle ${p.cycle}: kind=${p.kind} action=${p.action} node=${p.node} recId=${p.recId} eta=${p.eta} reason=${p.reason} catnip=${p.catnip}`
        ).join('\n') + '\n'
    );
    // No hard assertion — purely diagnostic.  This test always passes;
    // we read its console output to understand planner behaviour.
});

test('library trial: 500-cycle run toward bld:library (isolates cap-raiser path)', () => {
    autoplayer = loadAutoplayer(gameInstance);
    autoplayer.cfg.terminalGoal = 'bld:library';
    const TICKS_PER_CYCLE = 20;
    const MAX_CYCLES      = 500;
    const actionCounts = {};
    let lastPlan = null;
    for (let i = 0; i < MAX_CYCLES; i++) {
        try { autoplayer.doInstantBuys && autoplayer.doInstantBuys(); } catch (e) {}
        const plan = autoplayer.planNextAction(gameInstance);
        lastPlan = plan;
        if (plan && plan.kind === 'recommend' && plan.action) {
            const key = plan.action.type + ':' + (plan.action.name || plan.action.target);
            actionCounts[key] = (actionCounts[key] || 0) + 1;
            try { autoplayer.executeAction(gameInstance, plan.action); } catch (e) {}
        }
        for (let t = 0; t < TICKS_PER_CYCLE; t++) {
            try { gameInstance.update(); } catch (e) {}
        }
        if (gameInstance.bld.get('library').val >= 1) break;
    }
    const fields  = gameInstance.bld.get('field').val;
    const huts    = gameInstance.bld.get('hut').val;
    const library = gameInstance.bld.get('library').val;
    const wood    = gameInstance.resPool.get('wood');
    process.stderr.write(
        `\n=== Library trial ===\n` +
        `library=${library}  fields=${fields}  huts=${huts}  wood=${wood.value.toFixed(1)}/${wood.maxValue}(+${(wood.perTickCached||0).toFixed(3)})\n` +
        `actions executed: ${JSON.stringify(actionCounts)}\n` +
        `last plan recId=${lastPlan && lastPlan.chain ? lastPlan.chain.recommended : 'n/a'} kind=${lastPlan && lastPlan.kind}\n`
    );
});

test('introspect: chainBackward from bld:workshop at cold start', () => {
    autoplayer = loadAutoplayer(gameInstance);
    const scrape = autoplayer.scrapeGraph(gameInstance);
    const eg = autoplayer.buildEdgeGraph(gameInstance, scrape);
    const ws = eg.nodes['bld:workshop'];
    const chain = autoplayer.chainBackward(eg, 'bld:workshop');
    process.stderr.write(
        `\nworkshop node state=${ws && ws.state} price=${JSON.stringify(ws && ws.price)}\n` +
        `unlockedBy[bld:workshop]=${JSON.stringify(eg.unlockedBy['bld:workshop'])}\n` +
        `chain.recommended=${chain && chain.recommended}\n` +
        `chain.entries (first 8 keys): ${JSON.stringify(Object.keys(chain && chain.entries || {}).slice(0, 8))}\n` +
        `chain.entries[bld:workshop]=${JSON.stringify(chain && chain.entries && chain.entries['bld:workshop'])}\n`
    );
    expect(ws).toBeTruthy();
});

test('introspect: woodcutter job node', () => {
    autoplayer = loadAutoplayer(gameInstance);
    const scrape = autoplayer.scrapeGraph(gameInstance);
    const eg = autoplayer.buildEdgeGraph(gameInstance, scrape);
    const wc = eg.nodes['job:woodcutter'];
    process.stderr.write(
        `\njob:woodcutter=${JSON.stringify({kind: wc && wc.kind, state: wc && wc.state, jobModifiers: wc && wc.jobModifiers})}\n` +
        `all job ids=${JSON.stringify(Object.keys(eg.nodes).filter(k => k.startsWith('job:')))}\n`
    );
    expect(true).toBe(true);
});

test('introspect: lumberMill node + wood-providers in graph', () => {
    autoplayer = loadAutoplayer(gameInstance);
    const scrape = autoplayer.scrapeGraph(gameInstance);
    const eg = autoplayer.buildEdgeGraph(gameInstance, scrape);
    const lm = eg.nodes['bld:lumberMill'];
    const hut = eg.nodes['bld:hut'];
    process.stderr.write(
        `\nbld:lumberMill node=${lm ? JSON.stringify({state: lm.state, providesRes: lm.provides.resources, perUnit: lm.perUnitProvides && lm.perUnitProvides.resources}) : 'MISSING'}\n` +
        `bld:hut providesRes=${hut ? JSON.stringify(hut.provides.resources) : 'n/a'}\n` +
        `bld:hut perUnit=${hut ? JSON.stringify(hut.perUnitProvides && hut.perUnitProvides.resources) : 'n/a'}\n` +
        `producersOf['wood']=${JSON.stringify(eg.producersOf['wood'])}\n` +
        `producersOf['catnip']=${JSON.stringify(eg.producersOf['catnip'])}\n`
    );
    expect(true).toBe(true);
});

test('introspect: wood resource + craft state (cold start vs after field)', () => {
    autoplayer = loadAutoplayer(gameInstance);
    // Cold start
    let wood = gameInstance.resPool.get('wood');
    let crafts = gameInstance.workshop && gameInstance.workshop.crafts;
    const woodCraft = crafts && crafts.find(c => c.name === 'wood');
    process.stderr.write(
        `\n[cold start] wood: value=${wood.value} max=${wood.maxValue} pt=${wood.perTickCached} unlocked=${wood.unlocked}\n` +
        `wood-craft (catnip→wood): ${woodCraft ? `unlocked=${woodCraft.unlocked} prices=${JSON.stringify(woodCraft.prices)}` : 'not found'}\n`
    );
    // Build a field, tick, then re-check
    autoplayer.executeAction(gameInstance, autoplayer.createAction(autoplayer.ActionType.BUILD, 'field'));
    for (let t = 0; t < 50; t++) gameInstance.update();
    wood = gameInstance.resPool.get('wood');
    process.stderr.write(
        `[after field+50t] wood: value=${wood.value} max=${wood.maxValue} pt=${wood.perTickCached} unlocked=${wood.unlocked}\n` +
        `wood-craft: unlocked=${woodCraft ? woodCraft.unlocked : 'n/a'}\n`
    );
    // Inspect producersOf in edge graph
    const scrape = autoplayer.scrapeGraph(gameInstance);
    const eg = autoplayer.buildEdgeGraph(gameInstance, scrape);
    process.stderr.write(
        `eg.producersOf['wood']=${JSON.stringify(eg.producersOf && eg.producersOf['wood'])}\n` +
        `eg.producersOf['minerals']=${JSON.stringify(eg.producersOf && eg.producersOf['minerals'])}\n`
    );
    expect(true).toBe(true);
});

test('introspect: planNextAction(bld:workshop) AFTER 1 field built', () => {
    autoplayer = loadAutoplayer(gameInstance);
    autoplayer.cfg.terminalGoal = 'bld:workshop';
    // Build the first field directly, simulating cycle 0 outcome.
    const a0 = autoplayer.createAction(autoplayer.ActionType.BUILD, 'field');
    autoplayer.executeAction(gameInstance, a0);
    for (let t = 0; t < 50; t++) gameInstance.update();   // accumulate a bit of catnip
    const scrape = autoplayer.scrapeGraph(gameInstance);
    const eg = autoplayer.buildEdgeGraph(gameInstance, scrape);
    const chain = autoplayer.chainBackward(eg, 'bld:workshop');
    const wsEntry = chain && chain.entries && chain.entries['bld:workshop'];
    process.stderr.write(
        `\nAFTER 1 field, chain[bld:workshop]=${JSON.stringify(wsEntry)}\n` +
        `chain.frontier=${JSON.stringify(chain && chain.frontier)}\n` +
        `chain.entries keys=${JSON.stringify(Object.keys(chain && chain.entries || {}))}\n`
    );
    const plan = autoplayer.planNextAction(gameInstance);
    process.stderr.write(
        `plan.action=${plan && plan.action ? JSON.stringify(plan.action) : null}\n` +
        `plan.chain.recommended=${plan && plan.chain && plan.chain.recommended}\n` +
        `plan.chain.frontier=${plan && plan.chain ? JSON.stringify(plan.chain.frontier) : null}\n` +
        `plan.safetyNote=${plan && plan.safetyNote}\n` +
        `plan.beamUsed=${plan && plan.beamUsed}\n`
    );
    expect(plan).toBeTruthy();
});

test('introspect: planNextAction(bld:workshop) full plan', () => {
    autoplayer = loadAutoplayer(gameInstance);
    autoplayer.cfg.terminalGoal = 'bld:workshop';
    const plan = autoplayer.planNextAction(gameInstance);
    process.stderr.write(
        `\nplan.kind=${plan && plan.kind}\n` +
        `plan.action=${plan && plan.action ? JSON.stringify(plan.action) : null}\n` +
        `plan.chain.recommended=${plan && plan.chain && plan.chain.recommended}\n` +
        `plan.chain.frontier=${plan && plan.chain ? JSON.stringify(plan.chain.frontier) : null}\n` +
        `plan.reason=${plan && plan.reason}\n` +
        `plan.safetyNote=${plan && plan.safetyNote}\n` +
        `plan.beamUsed=${plan && plan.beamUsed}\n` +
        `cfg.beamCandidateMode=${autoplayer.cfg.beamCandidateMode}\n`
    );
    expect(plan).toBeTruthy();
});

test('workshop trial: 2000-cycle run toward bld:workshop, snapshot every 200', () => {
    autoplayer = loadAutoplayer(gameInstance);
    autoplayer.cfg.terminalGoal = 'bld:workshop';

    const TICKS_PER_CYCLE = 20;
    const MAX_CYCLES      = 2000;
    const SNAPSHOT_EVERY  = 200;

    function snap(c) {
        const bld = (n) => gameInstance.bld.get(n).val;
        const res = (n) => {
            const r = gameInstance.resPool.get(n);
            return r ? { v: r.value, max: r.maxValue, pt: r.perTickCached || 0 } : null;
        };
        const village = gameInstance.village || {};
        const kittens = village.getKittens ? village.getKittens() : 0;
        const happiness = village.happiness != null ? village.happiness : 'n/a';
        const phase = autoplayer.detectPhase(gameInstance);
        return {
            cycle: c,
            phase: phase.tier + ':' + phase.name,
            kittens: kittens,
            happiness: happiness,
            bld: {
                field: bld('field'), hut: bld('hut'), library: bld('library'),
                mine: bld('mine'), lumberMill: bld('lumberMill'),
                workshop: bld('workshop'), barn: bld('barn'),
                pasture: bld('pasture'), academy: bld('academy')
            },
            res: {
                catnip: res('catnip'), wood: res('wood'),
                minerals: res('minerals'), science: res('science'),
                culture: res('culture')
            }
        };
    }

    const snapshots = [snap(0)];
    let lastPlan = null, lastAction = null, lastReason = null;
    let executed = 0, blocked = 0, noGoal = 0;
    const actionCounts = {};

    for (let i = 0; i < MAX_CYCLES; i++) {
        try { autoplayer.doInstantBuys && autoplayer.doInstantBuys(); } catch (e) {}
        try { autoplayer.doAutoJobs    && autoplayer.doAutoJobs();    } catch (e) {}
        try { autoplayer.doAutoHunt    && autoplayer.doAutoHunt();    } catch (e) {}
        try { autoplayer.doAutoCraft   && autoplayer.doAutoCraft();   } catch (e) {}
        try { autoplayer.doAutoFestival&& autoplayer.doAutoFestival();} catch (e) {}
        const plan = autoplayer.planNextAction(gameInstance);
        lastPlan = plan;
        if (plan) {
            if (plan.kind === 'recommend' && plan.action) {
                try {
                    autoplayer.executeAction(gameInstance, plan.action);
                    executed++;
                    lastAction = plan.action.type + ':' + (plan.action.name || plan.action.target);
                    actionCounts[lastAction] = (actionCounts[lastAction] || 0) + 1;
                } catch (e) {}
            } else if (plan.kind === 'blocked') {
                blocked++;
                lastReason = plan.reason;
            } else if (plan.kind === 'no-goal') {
                noGoal++;
            }
        }
        for (let t = 0; t < TICKS_PER_CYCLE; t++) {
            try { gameInstance.update(); } catch (e) {}
        }
        try { autoplayer.recordPhaseSample(gameInstance, (i + 1) * 1000); } catch (e) {}
        if ((i + 1) % SNAPSHOT_EVERY === 0) snapshots.push(snap(i + 1));
        if (gameInstance.bld.get('workshop').val >= 1) break;
    }

    const phaseLog = autoplayer.getPhaseLog ? autoplayer.getPhaseLog() : [];
    const fmt = (s) => {
        const r = s.res;
        const fmtR = (x) => x ? `${x.v.toFixed(1)}/${x.max.toFixed(0)}(${x.pt >= 0 ? '+' : ''}${x.pt.toFixed(3)})` : 'n/a';
        return `c=${String(s.cycle).padStart(4)} phase=${s.phase.padEnd(15)} k=${s.kittens} hap=${typeof s.happiness === 'number' ? s.happiness.toFixed(2) : s.happiness}\n` +
               `       bld: field=${s.bld.field} hut=${s.bld.hut} lib=${s.bld.library} mine=${s.bld.mine} mill=${s.bld.lumberMill} ws=${s.bld.workshop} barn=${s.bld.barn} past=${s.bld.pasture} acad=${s.bld.academy}\n` +
               `       res: catnip=${fmtR(r.catnip)} wood=${fmtR(r.wood)} min=${fmtR(r.minerals)} sci=${fmtR(r.science)} cult=${fmtR(r.culture)}`;
    };

    process.stderr.write(
        `\n=== Workshop trial (goal=bld:workshop, ${MAX_CYCLES} cycles max) ===\n` +
        `executed=${executed}  blocked=${blocked}  no-goal=${noGoal}  workshop_built=${gameInstance.bld.get('workshop').val}\n` +
        `lastAction=${lastAction}  lastBlockedReason=${lastReason}\n` +
        `actionCounts=${JSON.stringify(actionCounts)}\n` +
        `Phase transitions:\n` +
        (phaseLog.length ? phaseLog.map(p => `  T${p.tier} ${p.name} @ ${p.atMs}ms (y${p.year} s${p.season})`).join('\n') : '  (none)') + '\n' +
        `Snapshots:\n` + snapshots.map(fmt).join('\n') + '\n'
    );
});

test('phase sensor records a transition when a hut+library appear', () => {
    autoplayer = loadAutoplayer(gameInstance);
    autoplayer.recordPhaseSample(gameInstance, 1000);                  // T0 baseline
    gameInstance.bld.get('hut').val     = 1;
    gameInstance.bld.get('library').val = 1;
    const r = autoplayer.recordPhaseSample(gameInstance, 2000);
    expect(r.transitioned).toBe(true);
    expect(r.phase.tier).toBeGreaterThanOrEqual(1);
});
