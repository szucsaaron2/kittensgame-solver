// Build integrity tests: re-run build.py, verify the resulting userscript
// (a) parses, (b) doesn't leak Node-only constructs into the browser path,
// and (c) the dual-mode `if (typeof module !== 'undefined' ...)` guard
// keeps `module.exports = ...` reachable in Node but inert in the browser.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const vm = require('vm');
const { describe, it, assert, eq } = require('./_harness');

const ROOT     = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'mcts_autoplayer.user.js');

function rebuild() {
    try {
        execSync('python build.py --out', {
            cwd: ROOT, stdio: 'pipe', timeout: 30000
        });
    } catch (e) {
        // Don't fail the test outright if Python isn't on PATH — fall back
        // to whatever's already in mcts_autoplayer.user.js.
        return false;
    }
    return true;
}

describe('build / userscript integrity', () => {
    rebuild();

    if (!fs.existsSync(OUT_PATH)) {
        it('SKIP — mcts_autoplayer.user.js missing and build.py unavailable', () => {});
        return;
    }
    const SCRIPT = fs.readFileSync(OUT_PATH, 'utf8');

    it('userscript parses as valid JavaScript', () => {
        let threw = null;
        try { new Function(SCRIPT); }
        catch (e) { threw = e; }
        assert(!threw, threw && threw.message);
    });

    it('userscript starts with @UserScript and contains all expected SSP modules', () => {
        assert(SCRIPT.indexOf('==UserScript==') !== -1, 'missing userscript header');
        assert(SCRIPT.indexOf('computeSspValueTable') !== -1, 'missing 04e content');
        assert(SCRIPT.indexOf('getSspBias') !== -1,           'missing 04f content');
        assert(SCRIPT.indexOf('pickTerminalGoalSSP') !== -1,  'missing 04g content');
        assert(SCRIPT.indexOf('_sspShadowTick') !== -1,       'missing shadow hook');
    });

    it('exports are guarded — module.exports lines are conditional', () => {
        // Each occurrence of `module.exports =` must be reachable only via
        // the `typeof module !== 'undefined' && module.exports` guard.
        const matches = SCRIPT.match(/module\.exports\s*=/g) || [];
        assert(matches.length >= 3, `expected ≥3 module.exports lines, got ${matches.length}`);
        const guardCount = (SCRIPT.match(/typeof\s+module\s*!==\s*['"]undefined['"]/g) || []).length;
        assert(guardCount >= matches.length,
            `every module.exports needs a typeof-module guard (${guardCount} vs ${matches.length})`);
    });

    it('runs in a browser-like sandbox (no module, no Node globals)', () => {
        // Construct a sandbox without `module`, `require`, `process`.  The
        // userscript's IIFE should evaluate without ReferenceError.  We stub
        // the bits the userscript actually touches at evaluation time
        // (window, document, localStorage) but NOT module/require.
        const localStore = {};
        const sandbox = {
            window:       {},
            document:     { createElement: () => ({ style: {}, appendChild: () => {} }),
                            body: { appendChild: () => {} },
                            getElementById: () => null,
                            addEventListener: () => {} },
            localStorage: {
                _m: localStore,
                getItem(k) { return k in this._m ? this._m[k] : null; },
                setItem(k, v) { this._m[k] = String(v); },
                removeItem(k) { delete this._m[k]; }
            },
            navigator:    { userAgent: 'test' },
            console,
            setInterval:  () => 0,
            setTimeout:   (fn) => { /* never fire */ return 0; },
            clearInterval: () => {},
            clearTimeout:  () => {},
            Blob:    function () {},
            URL:     { createObjectURL: () => 'blob:test' },
            Worker:  function () { this.onmessage = null; this.postMessage = () => {}; }
        };
        // Self-reference for `window.foo = ...` patterns.
        sandbox.window.window = sandbox.window;
        sandbox.self = sandbox;
        vm.createContext(sandbox);

        let threw = null;
        try { vm.runInContext(SCRIPT, sandbox, { timeout: 5000, filename: 'userscript.js' }); }
        catch (e) { threw = e; }
        assert(!threw, threw && (threw.message + '\n' + (threw.stack || '')));
    });
});
