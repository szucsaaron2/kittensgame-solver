# Project Diary

Chronological log of what's been done, why, and what was learned. Written so a fresh chat can pick up the thread without re-discovering everything.

The earliest commit `66e2593` (the previous "Initial commit: KittensGame MCTS autoplayer solver") is from a different solver iteration; the current repo started over with the infrastructure plan below. The KittensGame source lives at `kittensgame-master/` (a snapshot, not a submodule).

---

## Session 1 — Infrastructure plan (Phases 0–12)

**Goal:** scaffold a TypeScript project that can boot Kittens Game deterministically in Node, extract a typed `State` from the running game, identify a goal predicate, and emit an installable Tampermonkey userscript.

### What landed

- TS + ESLint (flat config) + Vitest + fast-check + vite-plugin-monkey toolchain.
- `setupGame({seed}) → GameHandle` boots the game via the upstream `test/setup.js` pattern (mocked dojo + sequential `require()`).
- Seeded RNG via `Math.random` override, deterministic across reruns.
- `extract(gamePage) → State` reads every catalog substate.
- `goal(s) / goalReport(s)` returns true when every in-scope item is satisfied.
- 19 catalog files in `src/model/catalogs/` auto-generated from the live game (resources × 58, buildings × 39, techs × 62, workshop × 138, policies × 64, etc.). Generator scripts: `dump-catalogs.ts` and `generate-catalogs.ts`.
- `dist/kittens-autoplayer.user.js` Tampermonkey artifact with no-op driver.
- GitHub Actions CI workflow.

### Plan deviations

1. **Used existing `kittensgame-master/`** instead of adding a new `vendor/kittensgame` submodule.
2. **Boot via upstream `test/setup.js`** (mocked dojo + `require()`) instead of `JSDOM(index.html)`. Upstream maintainers themselves abandoned the HTML-boot path because dojo.xd's XHR loader doesn't work in jsdom. This is the most consequential deviation — every following design decision flows from it.
3. **Catalogs auto-generated** rather than hand-written.
4. **ESLint relaxed** from `recommended-type-checked` to `recommended`. Type-checked rules clashed with the `any` boundary at the gamePage interface; TS strict already covers in-app safety.
5. **Stale Husky v4 hooks deleted** from `.git/hooks/` (inherited from another project — they were trying to invoke `yarn` from a path that no longer existed).

### Gotchas discovered

- Tampermonkey's `setTimeout` chain gets reordered by Cloudflare's `rocket-loader.min.js`. Userscript must poll `unsafeWindow.gamePage` rather than `window.gamePage`.
- ESLint 10 requires flat config (`eslint.config.js`); `.eslintrc.cjs` is gone.

---

## Session 2 — Pre-policy verification

User asked me to manually verify three load-bearing concerns before starting the policy plan. Two real bugs surfaced and were fixed:

1. **Goal predicate was unsatisfiable.** Required every in-scope policy to be researched, but pairs like `liberty`/`tradition` mutually block via `blocks: [...]`. Goal now satisfied if researched OR blocked. Two regression tests added.
2. **Religion-upgrade and ziggurat appliers used direct mutation.** Located the actual upstream controllers `com.nuclearunicorn.game.ui.ZigguratBtnController` and `ReligionBtnController` (distinct from `classes.ui.religion.TransformBtnController` which handles sacrifice/refine). Replaced direct mutation with controller calls so cost deduction and side-effects fire through the game's logic.

The first one would have made the policy plan loop forever thinking it was done.

---

## Session 3 — Actions plan (Phases 13–21)

**Goal:** define `Action` union, `feasible(s, a)`, `apply(gamePage, a)`, `enumerateFeasibleActions(s)`. Random policy that runs without crashing.

### What landed

- 27 action kinds covering build/research/religion/diplomacy/labor/craft/field/policy/time-skip/space-launch.
- Pure `feasibility.ts` covering all 27. Reads cost from regenerated catalog meta (`basePrices` + `priceRatio`); reads runtime gates from `state.info.unlocked.*` (populated by extract from each entry's `.unlocked` flag).
- Single `apply.ts` dispatcher (rejected the plan's 24-files-per-applier layout — discriminated dispatch reads more clearly with all variants in one file).
- `enumerateFeasibleActions(s)` returns every legal discrete-payload action; assign/craft/time-skip etc. are policy-generated on demand.
- Property tests for the feasibility contract (apply never throws on a feasible action; invariants always hold post-apply).
- Random policy + driver-random integration test.

### Plan deviations

1. **Consolidated `apply` into a single file** instead of 24 single-function files in an `appliers/` directory.
2. **No catalog meta for prereq graphs.** Read `unlocked` flags via extract instead — the game already maintains the prereq graph dynamically; transcribing the flag is more accurate than reimplementing the logic.
3. **`ActionPolicy` uses `policy: PolicyName`, not `{slot, value}`.** Policies in this game are independent one-time researches with `blocks: [...]` mutual-exclusion, not slot-based choices.

### Gotchas discovered

- Catalog generator was reading `entry.prices` only — but staged buildings (library, pasture, ziggurat) carry their costs on `entry.stages[0].prices`. So feasibility thought every staged building was free. Generator now falls through to stages[0].

---

## Session 4 — Live testing iteration

Iterative cycle: install userscript, run random policy, watch panel for failures, fix one bug, rebuild, reload. Each round caught a real bug.

### Bugs found via live runs (in order)

1. **`BuildingBtnModernController not available`** — root cause: in Tampermonkey, controller classes live on `unsafeWindow.classes`, not the userscript's sandboxed `globalThis.classes`. Fixed `apply.ts`'s `ns()` to check `unsafeWindow` first.
2. **Fresh game stuck with no actions** — missing the `gather-catnip` bootstrap action. Added it.
3. **`refine-catnip` threw "Cannot read properties of undefined (reading 'apply')"** — dojo's `this.inherited(arguments)` chain fails when we instantiate a controller standalone outside the rendered button tree. Switched to calling the manager method directly (`g.bld.refineCatnip()`) and deducting cost manually. Same treatment for `gather-catnip`.
4. **`build:library` `cannot-afford` despite being feasible** — library's prices live on `stages[0].prices`. Fixed catalog generator (see Session 3 gotcha).
5. **`share-knowledge` errored on every pick** — wasn't a real game action. `knowledgeSharing` is a *policy*, not a button. Removed the action variant entirely.
6. **Crafts ignored runtime unlock** — added `info.unlocked.crafts` extracted from `g.workshop.getCraft(name).unlocked`, gated craft feasibility on it.
7. **Crafts ignored resource cost** — added `info.craftRecipes[name].prices` snapshot via `g.workshop.getCraftPrice(recipe)` (post-discount). Feasibility runs `affordCheck` against it.
8. **`assign` data updated but village UI showed stale per-job counts.** Root cause: `village.sim.assignJob` only sets `kitten.job`. The high-level wrapper `village.assignJob(jobRef, amt)` *also* increments `jobRef.value` (the field the UI displays) and calls `villageTab.updateTab()`. Same for unassign. Routed `applyAssign` through `village.unassignJob(kitten)` then `village.assignJob(jobRef, count)` — exactly what the in-game `+` buttons do.
9. **Embassy feasibility used wrong currency.** Hardcoded 100 culture + 500 gold; the real cost per upstream is `race.embassyPrices` (just culture, varies per race) scaled by `(1 - embassyCostReduction) * 1.15^(embassyLevel + embassyFakeBought)`. State now snapshots `embassyPrices[civ]` from `r.embassyPrices` plus the live discount effects.
10. **Crafting included items the workshop tree hadn't unlocked** (ship/kerosene/thorium/tMythril) before introducing the unlock-flag check. Fixed in (6).

### Pre-policy preemptive feasibility tightening

After (8) was fixed and the autoplayer was clearly making real progress, tightened additional predicates that were likely wrong by the same pattern:

- **Trade tribute resources** — was missing entirely. Now extracts `race.buys[0]` + `g.diplomacy.getManpowerCost()` / `getGoldCost()` (post-discount); feasibility matches `diplomacy.hasMultipleResources` exactly.
- **Time-skip prereq** — switched from `chronoforge.temporalBattery >= 1` proxy to `chronosphere` building + `chronophysics` tech.
- **Praise** — added `theology` tech requirement.
- **Space-launch** — added `rocketry` tech requirement.

### Diagnostic tooling added

The Tampermonkey panel grew over the session. Current buttons:
- `[start]/[stop]` — run/halt random policy at 2s/step
- `[state]` — log filtered state + full state object
- `[actions]` — every feasible action grouped by kind
- `[goal]` — what's still unsatisfied for completion
- `[probe]` — controller-class availability on the live page
- `[step]` — apply exactly one random-policy action
- `[assign]` — distribute every kitten evenly across unlocked jobs
- `[verify]` — cross-check every enumerated action against the live game's own `unlocked`/`hasRes`/`researched` flags

`window.autoplayer.{start,stop,assign,assignAll,state,actions,stats}` exposed for console use. Auto-resume across reloads via localStorage flag.

---

## Session 5 — Layered policy pipeline (Phases 0–6)

**Goal:** lay down the 4-layer policy architecture (NetFlowGuard / Reflexes / Subsystems / Strategic) as scaffolding so each layer can land independently. Replace the random Layer-3 fallback piecemeal as reflexes / subsystems / scorer come online.

### What landed

Six commits, each leaves the autoplayer end-to-end runnable:

- **Phase 0 (`7e3703f`)** — pipeline plumbing: `runPipeline(s, ctx)`, REFLEXES/SUBSYSTEMS empty registries, `[trace]` panel button. Behavior unchanged.
- **Phase 1 (`21bea1f`)** — `info.flow` snapshot from engine's `getResourcePerTick`, catnip seasonal projection (`netFlowAt`). Guard still identity. New Appendix A in `Kittens Game model.MD` with file:line citations.
- **Phase 2 (`8cceef3`)** — Guard activated. Per-building flow deltas in `flowDeltas.ts` for smelter/calciner/magneto/reactor/factory/accelerator/chronosphere/biolab/oilWell/quarry/field. Margin schedule per spec. "Veto only when this action is the cause" rule prevents freeze-everything failure mode. Random fallback now goes through `guardActions`.
- **Phase 3 (`f...`)** — trivial reflexes: observe / hunt / praise / festival.
- **Phase 4** — refine-catnip reflex with winter-survival buffer (500-tick conservative approximation).
- **Phase 5** — narrow catpower-overflow trade reflex (first-feasible civ; civ-strategy belongs to Layer 3).
- **Phase 6** — JobAssignment subsystem. Pure `chooseJobs(s)`: binary-search the farmer floor that keeps catnip ≥ 0 in winter+cold; reserve 1 hunter post-archery; even-distribute the rest down a phase-keyed priority ladder. Trigger: season change OR kitten delta OR new-job-unlocked.

### Plan deviations

- **Energy is tracked outside the resource maps** (`flow.energyNet`, separate from `flow.perTick/production/consumption`). Energy is a flow, not a stockable resource, and `ResourceName` doesn't include it. Cleaner than wedging it into the typed map.
- **Conservative simplifications in `flowDeltas`**: static base rates only, no workshop/religion/policy ratio multipliers on consumer production, no conditional upgrade bonuses (smelter+coalFurnace, smelter+goldOre, etc.), no stage-1 buildings (solarFarm, hydroPlant, dataCenter). Underestimates production from consumers — correct safety bias for the guard.
- **`promote-leader` reflex deferred** to a later phase: it needs a manuscript-cost projection we haven't snapshotted.
- **Trade overflow uses first-feasible civ**, not a smarter pick. Strategic civ-selection (titanium-from-zebras, blueprints-from-spiders, etc.) is intentionally Layer 3.

### Gotchas discovered

- `ResourceName` does not include `energy` — it's tracked in `info.energy` (a flow). When trying to add energy to the per-resource flow maps, TypeScript caught it. Resolved by adding `flow.energyNet` as a separate scalar.
- The "veto only when action is the cause" rule was needed: without it, any state already in deficit (e.g., wood net = 0 < 0.1 margin) would block every action including recovery actions.
- `catnipPerFarmer` derivation needs a fallback for the 0-farmer bootstrap case (use `1.0 × seasonalFactor × happiness`, with happiness clamped to ≥ 0.25 for the worst-case happiness floor in upstream).
- The current Phase-1 `applyActionToFlow` shallow-copies the snapshot; when adding new fields to `FlowSnapshot` (`catnipPerFarmer` in Phase 6), the copy must be updated too. Caught by typecheck.

### Test count

199 tests passing at end of Phase 6 (was 115 at start of Session 5). All phases lint + typecheck + build green.

### Ready for next phase

Phase 7 onward goes back to Layer-3 design (the strategic policy). The Layer 0/1/2 substrate is now sufficient to make a non-completion-aware run survive without bricking, freeing Layer 3 to focus on goal-directed decisions.

---

## Current state

- **103-105 tests passing** (count fluctuates as actions are added/removed).
- **Lint, typecheck, build all green.**
- **Userscript ~133 kB** (gzip ~21 kB).
- **Random policy** runs end-to-end on the live game, makes visible progress (gather → refine → build library → research calendar → adopt liberty → discover sharks → trade → assign kittens to jobs → workshop → crafts...).

### What works

- All foundational pure functions: `extract`, `goal`, `feasible`, `enumerateFeasibleActions`, `checkInvariants`.
- Apply paths verified live for: gather-catnip, refine-catnip, build (general), research, workshop, religion-upgrade, build-ziggurat, praise, hunt, trade, embassy, policy, craft, assign.
- Live UI refreshes correctly after assign (now that we use `village.assignJob`).
- `[verify]` panel button surfaces predicate-vs-game disagreements without needing tests.

### What's untested live (apply paths likely fine but worth `[step]`-ing)

- `send-explorers`, `festival`, `pact`, `appoint-leader`, `promote-leader`, `engineer-assign`, `time-skip`, `space-launch`, `build-space`, `build-chronoforge`, `build-voidspace`, `refine-tears`, `refine-tc`.

### Ready for next plan

The action substrate is sound enough to build a real policy on:
- `enumerateFeasibleActions(s)` — candidate set
- `apply(gamePage, a)` — chosen action
- `setupGame({seed}) + tick(n)` — deterministic rollouts
- `goal(s)` / `goalReport(s)` — stopping & guidance

The plan after the actions plan is the **policy/solver plan**: defining a CFA scorer over enumerated candidates, optionally a DLA lookahead with deterministic rollouts, and wiring into the existing driver loop.

---

## Lessons (in priority order for future sessions)

1. **Read upstream code, don't guess formulas.** Embassy cost, trade tribute, festival cost, and multiple feasibility predicates all started wrong because I made them up. Live testing or grepping `kittensgame-master/js/` always finds the right answer in under five minutes.
2. **Use the upstream high-level wrapper, not `sim.X`.** The assign bug took a long time to find; the underlying mechanism (low-level method touches data, high-level method touches data + UI bookkeeping fields) is general and applies to any subsystem with a UI display.
3. **Live testing finds bugs faster than test-writing.** ~1 real bug per live-run session. Many wouldn't have been caught by jsdom tests because jsdom doesn't render UI tabs.
4. **Catalog generator is the source of truth.** When upstream changes (new building, new tech), regenerate; do not hand-edit catalogs.
5. **Tampermonkey `unsafeWindow` is mandatory** for anything that walks the game's `classes`/`com` namespaces. Userscript globalThis is sandboxed.
