# Tests

```
node tests/run.js
```

## Files

- `_harness.js` — zero-dep test runner (`describe`/`it`/`assert`/`eq`/`near`).
- `run.js` — discovers and runs every `*.test.js` in this folder.
- `ssp_value.test.js` — pure value-iteration over synthetic AND-OR graphs.
- `ssp_belief.test.js` — bias table (Phase 1 stub + Phase 3 EWMA hook).
- `ssp_real_techs.test.js` — extracts the real `techs[]` array from
  `kittensgame-master/js/science.js` via a stubbed `dojo`/`$I` vm context
  and runs the full value table over it.

The SSP source modules (`src/04e`, `src/04f`, `src/04g`) export their
public functions when `module` is defined (Node) and stay quiet otherwise
(browser). The userscript build (`build.py`) is unaffected — the
`if (typeof module !== 'undefined')` guard fails in browser context.
