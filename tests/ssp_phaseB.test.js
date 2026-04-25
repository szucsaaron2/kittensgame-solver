// Phase B — live SSP debug panel. Source-level checks: section exists in
// markup, updateSspDisplay reads pending observation + belief records,
// orchestrator stashes lastSspResult and calls the renderer each cycle.

const fs = require('fs');
const path = require('path');
const { describe, it, assert } = require('./_harness');

const UI    = fs.readFileSync(path.join(__dirname, '..', 'src', '10_ui.js'),    'utf8');
const ORCH  = fs.readFileSync(path.join(__dirname, '..', 'src', '09_orchestrator.js'), 'utf8');
const CFG   = fs.readFileSync(path.join(__dirname, '..', 'src', '01_config.js'), 'utf8');

describe('Phase B / SSP debug section markup', () => {
    it('mcts_ssp_section element is in the panel HTML', () => {
        assert(/id="mcts_ssp_section"/.test(UI));
    });

    it('section contains pending + table sub-elements', () => {
        assert(/id="mcts_ssp_pending"/.test(UI));
        assert(/id="mcts_ssp_table"/.test(UI));
    });

    it('section is hidden by default (display:none)', () => {
        assert(/id="mcts_ssp_section"[^>]*display:none/.test(UI),
            'section should default-hidden — only shown when cfg.sspEnabled');
    });
});

describe('Phase B / updateSspDisplay function', () => {
    it('function is defined', () => {
        assert(/function\s+updateSspDisplay\s*\(\s*\)/.test(UI));
    });

    it('hides section when cfg.sspEnabled is false', () => {
        assert(/if\s*\(\s*!cfg\.sspEnabled\s*\)\s*\{\s*section\.style\.display\s*=\s*['"]none['"]/.test(UI));
    });

    it('reads pending observation via _sspPendingObservation', () => {
        assert(/_sspPendingObservation\s*\(\s*\)/.test(UI));
    });

    it('reads per-goal belief via getSspBeliefRecord', () => {
        assert(/getSspBeliefRecord\s*\(/.test(UI));
    });

    it('renders top-5 from lastSspResult.ranking', () => {
        assert(/lastSspResult\.ranking\.slice\(0,\s*5\)/.test(UI));
    });
});

describe('Phase B / orchestrator integration', () => {
    it('lastSspResult declared as module-level state', () => {
        assert(/var\s+lastSspResult\s*=\s*null/.test(CFG));
    });

    it('orchestrator stashes sspResult to lastSspResult', () => {
        assert(/lastSspResult\s*=\s*sspResult/.test(ORCH));
    });

    it('orchestrator clears lastSspResult when SSP is off', () => {
        // The else branch under `if (cfg.sspEnabled && ...)` should null it.
        assert(/else\s*\{\s*lastSspResult\s*=\s*null/.test(ORCH));
    });

    it('orchestrator calls updateSspDisplay each cycle', () => {
        assert(/updateSspDisplay\s*\(\s*\)/.test(ORCH));
    });
});
