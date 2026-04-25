// Minimal zero-dependency test harness.
// Use: const { describe, it, assert } = require('./_harness');

const _state = { fails: [], passed: 0, suite: '' };

function describe(name, fn) {
    _state.suite = name;
    try { fn(); }
    catch (e) {
        _state.fails.push({ suite: name, name: '<top-level>', err: e });
    }
    _state.suite = '';
}

function it(name, fn) {
    try {
        fn();
        _state.passed++;
        process.stdout.write(`  \x1b[32m✓\x1b[0m ${_state.suite} › ${name}\n`);
    } catch (e) {
        _state.fails.push({ suite: _state.suite, name, err: e });
        process.stdout.write(`  \x1b[31m✗\x1b[0m ${_state.suite} › ${name}\n`);
        process.stdout.write(`      ${e.message}\n`);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error((msg || 'eq') + `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}
function near(actual, expected, eps, msg) {
    eps = eps || 1e-6;
    if (Math.abs(actual - expected) > eps) {
        throw new Error((msg || 'near') + `: expected ≈${expected}, got ${actual} (eps ${eps})`);
    }
}
function throws(fn, msg) {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    if (!threw) throw new Error((msg || 'throws') + ': did not throw');
}

function summary() {
    const total = _state.passed + _state.fails.length;
    process.stdout.write(`\n${_state.passed}/${total} passed`);
    if (_state.fails.length) {
        process.stdout.write(`, \x1b[31m${_state.fails.length} failed\x1b[0m\n`);
        for (const f of _state.fails) {
            process.stdout.write(`\n  \x1b[31m${f.suite} › ${f.name}\x1b[0m\n`);
            process.stdout.write(`    ${f.err.stack || f.err.message}\n`);
        }
        process.exit(1);
    }
    process.stdout.write(' \x1b[32m✓\x1b[0m\n');
}

module.exports = { describe, it, assert, eq, near, throws, summary };
