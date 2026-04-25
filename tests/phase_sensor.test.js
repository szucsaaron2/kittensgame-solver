// Phase sensor — exercises detectPhase + recordPhaseSample over a
// scripted progression from cold start to space.

const fs = require('fs');
const path = require('path');
const { describe, it, assert, eq } = require('./_harness');

const ps  = require('../src/08b_phase_sensor.js');
const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'src', '08b_phase_sensor.js'), 'utf8');

function game(blds, planetsBlds) {
    var bldMap = blds || {};
    return {
        bld: { get: function (n) { return bldMap[n] || { val: 0 }; } },
        space: planetsBlds ? {
            programs: [],
            planets: [{ buildings: planetsBlds.map(b => ({ val: b.val || 0 })) }]
        } : null,
        calendar: { year: 1, season: 0 }
    };
}

describe('phase sensor / detectPhase ladder', () => {
    it('cold-start (no buildings) → Pregame T0', () => {
        const p = ps.detectPhase(game({}));
        eq(p.tier, 0);
        eq(p.name, 'Pregame');
    });

    it('library + hut → Foundation T1', () => {
        const p = ps.detectPhase(game({ library: { val: 1 }, hut: { val: 1 } }));
        eq(p.tier, 1);
    });

    it('5 fields + 2 huts → Wood econ T2', () => {
        const p = ps.detectPhase(game({
            library: { val: 1 }, hut: { val: 1 },
            field: { val: 5 }, hut: { val: 2 }
        }));
        eq(p.tier, 2);
        eq(p.name, 'Wood econ');
    });

    it('mine present → Mineral T3', () => {
        const p = ps.detectPhase(game({ mine: { val: 1 } }));
        eq(p.tier, 3);
    });

    it('workshop → T4 even without lower-tier buildings (monotone signal)', () => {
        const p = ps.detectPhase(game({ workshop: { val: 1 } }));
        eq(p.tier, 4);
    });

    it('smelter → Iron age T5', () => {
        const p = ps.detectPhase(game({ smelter: { val: 1 }, workshop: { val: 1 } }));
        eq(p.tier, 5);
    });

    it('observatory → Astronomy T6', () => {
        const p = ps.detectPhase(game({ observatory: { val: 1 } }));
        eq(p.tier, 6);
    });

    it('steamworks OR magneto → Industry T7', () => {
        eq(ps.detectPhase(game({ steamworks: { val: 1 } })).tier, 7);
        eq(ps.detectPhase(game({ magneto:    { val: 1 } })).tier, 7);
    });

    it('any space planet building → Space T8', () => {
        const p = ps.detectPhase(game({}, [{ val: 0 }, { val: 1 }]));
        eq(p.tier, 8);
    });

    it('chronosphere → Endgame T9 (highest)', () => {
        const p = ps.detectPhase(game({
            chronosphere: { val: 1 },
            steamworks:   { val: 1 }   // would otherwise score T7
        }));
        eq(p.tier, 9);
    });

    it('survives missing game.bld / null game without throwing', () => {
        eq(ps.detectPhase(null).tier, 0);
        eq(ps.detectPhase({}).tier, 0);
        eq(ps.detectPhase({ bld: null }).tier, 0);
    });
});

describe('phase sensor / recordPhaseSample transitions', () => {
    it('first sample at Pregame does NOT log (startup, not a milestone)', () => {
        ps._resetPhaseSensor();
        const r = ps.recordPhaseSample(game({}), 1000);
        eq(r.transitioned, false);
        eq(ps.getPhaseLog().length, 0);
    });

    it('Pregame → Foundation logs a transition', () => {
        ps._resetPhaseSensor();
        ps.recordPhaseSample(game({}), 1000);                                  // T0, no log
        const r = ps.recordPhaseSample(
            game({ library: { val: 1 }, hut: { val: 1 } }), 2000);
        eq(r.transitioned, true);
        const log = ps.getPhaseLog();
        eq(log.length, 1);
        eq(log[0].tier, 1);
        eq(log[0].atMs, 2000);
    });

    it('repeated samples at same tier do NOT re-log', () => {
        ps._resetPhaseSensor();
        const g = game({ library: { val: 1 }, hut: { val: 1 } });
        ps.recordPhaseSample(g, 1000);
        ps.recordPhaseSample(g, 2000);
        ps.recordPhaseSample(g, 3000);
        eq(ps.getPhaseLog().length, 1, 'one transition (initial), no repeats');
    });

    it('skipping tiers logs only the highest reached (no fake intermediates)', () => {
        ps._resetPhaseSensor();
        ps.recordPhaseSample(game({}), 1000);                                  // T0
        ps.recordPhaseSample(game({ smelter: { val: 1 } }), 2000);             // T5 jump
        const log = ps.getPhaseLog();
        eq(log.length, 1);
        eq(log[0].tier, 5);
    });

    it('calendar year/season are recorded with each transition', () => {
        ps._resetPhaseSensor();
        ps.recordPhaseSample(game({}), 1000);
        const g = game({ library: { val: 1 }, hut: { val: 1 } });
        g.calendar = { year: 7, season: 2 };
        ps.recordPhaseSample(g, 2000);
        const e = ps.getPhaseLog()[0];
        eq(e.year, 7);
        eq(e.season, 2);
    });

    it('getCurrentPhase reflects last sampled tier', () => {
        ps._resetPhaseSensor();
        ps.recordPhaseSample(game({ workshop: { val: 1 } }), 1000);
        eq(ps.getCurrentPhase().tier, 4);
        eq(ps.getCurrentPhase().name, 'Workshop');
    });
});

describe('phase sensor / source wiring', () => {
    it('orchestrator calls recordPhaseSample each cycle', () => {
        const orch = fs.readFileSync(
            path.join(__dirname, '..', 'src', '09_orchestrator.js'), 'utf8');
        assert(/recordPhaseSample\s*\(\s*gamePage\s*\)/.test(orch));
    });

    it('orchestrator calls updatePhaseDisplay each cycle', () => {
        const orch = fs.readFileSync(
            path.join(__dirname, '..', 'src', '09_orchestrator.js'), 'utf8');
        assert(/updatePhaseDisplay\s*\(\s*\)/.test(orch));
    });

    it('UI defines mcts_phase_section markup', () => {
        const ui = fs.readFileSync(
            path.join(__dirname, '..', 'src', '10_ui.js'), 'utf8');
        assert(/id="mcts_phase_section"/.test(ui));
        assert(/id="mcts_phase_now"/.test(ui));
        assert(/id="mcts_phase_log"/.test(ui));
    });

    it('UI defines updatePhaseDisplay function', () => {
        const ui = fs.readFileSync(
            path.join(__dirname, '..', 'src', '10_ui.js'), 'utf8');
        assert(/function\s+updatePhaseDisplay\s*\(\s*\)/.test(ui));
    });

    it('PHASE_LADDER covers tiers 0-9', () => {
        const tiers = ps.PHASE_LADDER.map(p => p.tier).sort((a, b) => a - b);
        eq(tiers.length, 10);
        eq(tiers[0], 0);
        eq(tiers[9], 9);
    });
});
