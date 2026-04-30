## 0. Reference Material

**Consult [Powell's Reinforcement Learning and Stochastic Optimization.MD](Powell's Reinforcement Learning and Stochastic Optimization.MD) before working on RL, planning, or stochastic-optimization code.** Use it as the authoritative reference for terminology, formulations, and algorithm choices in this project.

**[Kittens Game model.MD](Kittens Game model.MD) is a living document modeling the current game.** Read it to ground any work that depends on game mechanics (resources, buildings, jobs, prices, production, events). Update it whenever you learn or change something about the model — new mechanics, corrected formulas, refined assumptions, or removed/obsolete entries. Keep it accurate and current; do not let it drift from the code or from observed game behavior.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## 5. Project-Specific Knowledge

**Read [DIARY.MD](DIARY.MD) for chronological context** — what plans have been executed, which bugs have been found, what was tried and discarded. New chats should consult it before assuming anything about the codebase's history.

### 5.1 Layout

```
src/
├── model/                  Pure types and predicates. No gamePage access.
│   ├── catalogs/           AUTO-GENERATED from the live game by scripts/generate-catalogs.ts.
│   ├── action.ts           Discriminated Action union (29 variants).
│   ├── state.ts            State = { physical, info, belief }.
│   ├── feasibility.ts      Pure feasible(s, a) predicate.
│   ├── enumerate.ts        Discrete-payload action enumeration.
│   ├── goal.ts             Pure goal(s) predicate.
│   └── invariants.ts       checkInvariants(s).
├── simulator/              The bridge to the live game. Allowed to touch gamePage.
│   ├── extract.ts          extract(gamePage) → State. Reads only.
│   ├── apply.ts            apply(gamePage, action). Mutates the game.
│   └── verifyCatalogs.ts   Diff our catalog names against the live game.
├── driver/                 Loop runner + browser userscript.
├── policy/                 Action selection. Currently noop + random.
└── testdriver/             Boot the game in Node (mirrors upstream test/setup.js).
kittensgame-master/         Vendored game source, treated read-only.
scripts/                    Generators + ad-hoc inspection helpers.
tests/{unit,integration,property}/   Vitest tests.
```

### 5.2 Architectural rules to never break

- **`extract` is the only place that reads gamePage.** Feasibility, goal, invariants, and enumerate must be pure functions of State.
- **`apply` is the only place that mutates gamePage.** Tests, scripts, and the driver should not bypass it.
- **Catalogs are generated, never hand-edited.** `scripts/generate-catalogs.ts` writes them. Re-run after any change to `kittensgame-master/`. Headers say `AUTO-GENERATED`.
- **Use the upstream high-level wrapper, not the low-level `sim.X`.** `village.assignJob`, `village.unassignJob`, controller `buyItem` — these update display fields and trigger UI refreshes that the underlying methods skip.

### 5.3 Boot harness gotchas

- **Use `test/setup.js` style boot, not JSDOM(index.html).** Upstream's dojo XHR loader doesn't work in jsdom; the maintainers themselves abandoned that path. We mock dojo and `require()` modules directly. See `src/testdriver/setupGame.ts`.
- **In Tampermonkey, controller classes live on `unsafeWindow`, not `globalThis`.** `apply.ts`'s `ns()` helper handles this — try `unsafeWindow` first, fall back to `globalThis` for jsdom.
- **`g.update()` advances tick logic** (kittens can starve, etc.). Never call it from `apply` — only from the driver loop.

### 5.4 Adding a new action variant

1. Add interface to `src/model/action.ts`, add to the `Action` union.
2. Re-export from `src/model/index.ts`.
3. Add the case to `feasibility.ts` (must compile — `assertNever` flags missing cases).
4. Add the case to `apply.ts`. Prefer the upstream controller (`buyViaController`); fall back to manager method (`g.bld.X`) if the controller chain breaks under standalone instantiation.
5. Add to `enumerate.ts` if it has a discrete payload.
6. Add the case to the exhaustiveness switch in `tests/unit/action.test.ts`.
7. Write integration tests for both the apply happy path and at least one feasibility-rejection case.

### 5.5 Common failure modes (and what fixed each)

| Symptom | Root cause | Fix |
|---|---|---|
| `apply` succeeds but UI shows nothing | Used `sim.X` instead of `village.X` | Route through high-level wrapper |
| `apply` says `cannot-afford` despite feasibility | Cost lives on `entry.stages[0].prices` | Generator falls through to stages[0] |
| Controller `buyItem` throws "Cannot read property of undefined (reading 'apply')" | Standalone-instantiated controller fails dojo's `inherited(arguments)` chain | Call manager method directly (e.g. `g.bld.refineCatnip()`) |
| Controller class missing in Tampermonkey | Looked it up via `globalThis.classes` | Use `unsafeWindow.classes` |
| Action stays "feasible" forever and errors on apply | Hardcoded cost differs from upstream | Snapshot live cost from gamePage at extract time, compare in feasibility |
| Goal predicate unsatisfiable | Required every policy researched, but pairs mutually block | Satisfied = researched OR blocked |

### 5.6 Live debugging

The browser userscript exposes a panel and console hooks:
- `[start]/[stop]` — run random policy at 2s steps
- `[state]/[actions]/[goal]/[probe]/[step]/[assign]/[verify]` — inspection buttons
- `window.autoplayer.{start,stop,assign,assignAll,state,actions,stats}` — programmatic access

`[verify]` is the most powerful: cross-checks every enumerated action against the live game's own affordability/unlock flags. Use it when fixing predicate bugs.

### 5.7 When new actions/concepts come from live testing

The live-test cycle has been finding ~1 bug per session. The pattern is: run, watch `stats.errors`, fix the predicate or apply path, repeat. Don't try to be exhaustive in advance — let the runs surface what's broken.