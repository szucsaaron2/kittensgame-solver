// Phase 3 — UI surface for SSP. Source-level checks: the toggle exists in
// the markup, is wired to cfg.sspEnabled, the checkbox state is initialised
// from cfg, and the decision panel has the SSP badge branch.

const fs = require('fs');
const path = require('path');
const { describe, it, assert } = require('./_harness');

const UI_SRC = fs.readFileSync(
    path.join(__dirname, '..', 'src', '10_ui.js'), 'utf8');
const ORCH_SRC = fs.readFileSync(
    path.join(__dirname, '..', 'src', '09_orchestrator.js'), 'utf8');

describe('Phase 3 / SSP toggle in panel markup', () => {
    it('checkbox element with id mcts_cb_ssp exists', () => {
        assert(/id="mcts_cb_ssp"/.test(UI_SRC));
    });

    it('toggle is wired to cfg.sspEnabled', () => {
        assert(/wireToggle\(\s*['"]mcts_cb_ssp['"]\s*,\s*['"]sspEnabled['"]\s*\)/.test(UI_SRC),
            'wireToggle must bind mcts_cb_ssp to sspEnabled');
    });

    it('checkbox initial state is read from cfg.sspEnabled', () => {
        assert(/getElementById\(['"]mcts_cb_ssp['"]\)\.checked\s*=\s*!!\s*cfg\.sspEnabled/.test(UI_SRC),
            'checkbox must initialise from cfg.sspEnabled');
    });
});

describe('Phase 3 / decision panel renders SSP badge', () => {
    it('UI inspects __goalSource === "ssp" to render badge', () => {
        const occurrences = (UI_SRC.match(/__goalSource\s*===\s*['"]ssp['"]/g) || []).length;
        assert(occurrences >= 2, 'badge logic should be in both recommend & blocked branches');
    });

    it('badge HTML contains the SSP label', () => {
        assert(/>SSP<\/span>/.test(UI_SRC), 'visible SSP label must be in panel HTML');
    });
});

describe('Phase 3 / orchestrator stamps goal source', () => {
    it('plan carries __goalSource', () => {
        assert(/plan\.__goalSource\s*=/.test(ORCH_SRC));
    });

    it('plan carries __sspPickedGoal when SSP picks', () => {
        assert(/plan\.__sspPickedGoal\s*=/.test(ORCH_SRC));
    });
});
