// Phase 2 — flag-gated SSP activation. Verifies that when cfg.sspEnabled is
// true, the orchestrator's plan call receives the SSP top pick as goal
// override; when false, the user's terminalGoal is used unchanged.
//
// We don't run the real orchestrator (it pulls in dojo/Worker/etc); instead
// we replay the orchestrator's goal-selection logic against the same module
// surface area (cfg, pickTerminalGoalSSP, planNextAction).

const { describe, it, assert, eq } = require('./_harness');

// Replays the orchestrator's Phase 2 branch in isolation.
function resolveActiveGoal(deps) {
    var cfg = deps.cfg, eg = deps.eg, gamePage = deps.gamePage;
    var pickTerminalGoalSSP = deps.pickTerminalGoalSSP;
    var getTerminalGoal = deps.getTerminalGoal;

    var sspPickedGoal = null;
    if (cfg.sspEnabled && typeof pickTerminalGoalSSP === 'function' && eg) {
        try {
            var r = pickTerminalGoalSSP(gamePage, eg);
            if (r && r.ranking && r.ranking.length > 0) sspPickedGoal = r.ranking[0].id;
        } catch (e) { /* swallow */ }
    }
    return sspPickedGoal || (getTerminalGoal ? getTerminalGoal() : null);
}

function fakeRanking(ids) {
    return { ranking: ids.map(function (id, i) { return { id: id, V: 10 + i }; }) };
}

describe('Phase 2 / sspEnabled goal override', () => {
    it('sspEnabled=false: uses user-selected terminal goal', () => {
        const goal = resolveActiveGoal({
            cfg: { sspEnabled: false },
            eg: { nodes: {} },
            gamePage: {},
            pickTerminalGoalSSP: () => fakeRanking(['tech:a', 'tech:b']),
            getTerminalGoal: () => 'tech:user-pick'
        });
        eq(goal, 'tech:user-pick');
    });

    it('sspEnabled=true: uses SSP top pick over user goal', () => {
        const goal = resolveActiveGoal({
            cfg: { sspEnabled: true },
            eg: { nodes: {} },
            gamePage: {},
            pickTerminalGoalSSP: () => fakeRanking(['tech:cheap', 'tech:b']),
            getTerminalGoal: () => 'tech:user-pick'
        });
        eq(goal, 'tech:cheap');
    });

    it('sspEnabled=true with no eg: falls back to user goal', () => {
        const goal = resolveActiveGoal({
            cfg: { sspEnabled: true },
            eg: null,
            gamePage: {},
            pickTerminalGoalSSP: () => fakeRanking(['tech:cheap']),
            getTerminalGoal: () => 'tech:user'
        });
        eq(goal, 'tech:user');
    });

    it('sspEnabled=true but pickTerminalGoalSSP returns null: falls back', () => {
        const goal = resolveActiveGoal({
            cfg: { sspEnabled: true },
            eg: { nodes: {} },
            gamePage: {},
            pickTerminalGoalSSP: () => null,
            getTerminalGoal: () => 'tech:user'
        });
        eq(goal, 'tech:user');
    });

    it('sspEnabled=true with empty ranking: falls back to user goal', () => {
        const goal = resolveActiveGoal({
            cfg: { sspEnabled: true },
            eg: { nodes: {} },
            gamePage: {},
            pickTerminalGoalSSP: () => ({ ranking: [] }),
            getTerminalGoal: () => 'tech:user'
        });
        eq(goal, 'tech:user');
    });

    it('sspEnabled=true with throwing picker: falls back silently', () => {
        const goal = resolveActiveGoal({
            cfg: { sspEnabled: true },
            eg: { nodes: {} },
            gamePage: {},
            pickTerminalGoalSSP: () => { throw new Error('boom'); },
            getTerminalGoal: () => 'tech:user'
        });
        eq(goal, 'tech:user');
    });

    it('sspEnabled=true and no user goal: returns SSP pick', () => {
        const goal = resolveActiveGoal({
            cfg: { sspEnabled: true },
            eg: { nodes: {} },
            gamePage: {},
            pickTerminalGoalSSP: () => fakeRanking(['tech:cheap']),
            getTerminalGoal: () => null
        });
        eq(goal, 'tech:cheap');
    });

    it('sspEnabled=true and both null: returns null (no-goal)', () => {
        const goal = resolveActiveGoal({
            cfg: { sspEnabled: true },
            eg: { nodes: {} },
            gamePage: {},
            pickTerminalGoalSSP: () => null,
            getTerminalGoal: () => null
        });
        eq(goal, null);
    });
});

// Also verify that planNextAction itself accepts goalIdOverride. We don't
// run the full chain (heavy deps), but we can grep the source to confirm
// the new signature is in place.
describe('Phase 2 / planNextAction signature', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'src', '07_chain.js'), 'utf8');

    it('planNextAction accepts opts.goalIdOverride', () => {
        assert(/function\s+planNextAction\s*\(\s*game\s*,\s*eg\s*,\s*opts\s*\)/.test(src),
            'planNextAction signature should include opts');
        assert(src.indexOf('goalIdOverride') !== -1,
            'planNextAction body should reference goalIdOverride');
    });
});

describe('Phase 2 / config defaults', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'src', '01_config.js'), 'utf8');

    it('cfg.sspEnabled defaults to false (opt-in)', () => {
        assert(/sspEnabled\s*:\s*false/.test(src),
            'sspEnabled must default to false');
    });
});
