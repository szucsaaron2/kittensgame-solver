# Kittens Game Autoplayer — Conversation Summary

A condensed account of the design process and engineering decisions that shaped this codebase. For the full chronological log, see [`DIARY.md`](./DIARY.md). For the formal model, see [`Kittens Game model.MD`](./Kittens%20Game%20model.MD). For the framework reference, see [`Powell's Reinforcement Learning and Stochastic Optimization.MD`](./Powell's%20Reinforcement%20Learning%20and%20Stochastic%20Optimization.MD).

---

## 1. Project goal

Build an autoplayer that drives [Kittens Game](https://kittensgame.com/web/) to **goal completion** without using paragon, karma, or the Iron Will reset mechanic. "Goal completion" is concretely defined as a predicate over state: at least 1 of every in-scope building, every reachable tech / workshop / religion bit, a value selected in every policy slot, and max tier in every pact.

Total goal predicate: ~373 clauses. Run on actual game time scale: human players reach late-game in 100–300 game-years.

---

## 2. Modeling decisions (set early, before any policy code)

The first major decision was framing the problem in **Powell's Sequential Decision Analytics** vocabulary rather than picking an algorithm first. The model lives in [`Kittens Game model.MD`](./Kittens%20Game%20model.MD) as the five canonical elements:

- **State** $S_t = (R_t, I_t, B_t)$ — physical (resources / buildings / kittens / embassies), informational (calendar / techs / unlocks / multipliers / cached flow), belief (empty — game is fully observable for the autoplayer).
- **Decisions** $x_t$ — a tagged union of 29 action variants ranging from `gather-catnip` to `build-voidspace` to `pact`.
- **Exogenous information** $W_{t+1}$ — weather flips, hunt rolls, trade rolls, astro events. Small magnitude relative to building decisions; treated as essentially deterministic at planning timescales.
- **Transition** $S^M$ — the engine. We delegate to it via the `apply` adapter rather than re-implementing.
- **Objective** — minimize expected wall-clock time to flip every goal-clause.

Two architectural rules baked in from the start:

- **`extract` is the only place that reads `gamePage`.** Feasibility, goal, invariants, and enumerate must be pure functions of `State`.
- **`apply` is the only place that mutates `gamePage`.** Tests, scripts, and the driver should not bypass it.

These rules paid back repeatedly. They make the entire planner stack pure / testable / replayable.

---

## 3. Layer architecture (the design conversation that mattered most)

After several rounds of back-and-forth on policy design, we converged on a **four-layer pipeline**. The conversation went through several proposals before settling:

- **First proposal: hybrid CFA + DLA + PFA fast-path.** Rejected because the user disliked CFA hand-tuning and DLA implied a rollout simulator we'd have to maintain.
- **Second proposal: shortest-path planner over goal-bit-flip graph.** Closer to the user's intuition but underspecified — what's "next-flip TTA" doesn't account for state-dependent edge weights or production multiplier compounding.
- **Settled framing: aggregate time-to-completion** as the objective, with **single-step lookahead** as the policy class. T_remaining = sum of TTAs over unbought goal-clauses. Pick the action that most reduces this per unit time.

### Why aggregate-TTA, not next-flip or max-TTA

We worked through three candidate metrics:

| Metric | Failure mode |
|---|---|
| Cheapest-next-goal-flip TTA | Myopic. 10th lumberMill helps no current flip but compounds on every late-game flip. Misses production-multiplier value. |
| Max over goal TTAs | Brittle. A single far-away goal dominates; nothing else matters. Oscillates when multiple goals tie. |
| **Sum over goal TTAs (aggregate)** | Captures both production-multiplier compounding (sum reduces when many TTAs drop) and goal-flip benefit (term removed entirely). Late-game has concentrated long poles that dominate the sum naturally — sum is approximately max in the regimes that matter. |

We added two tunables to make the sum well-behaved:

- `perFlipBonus = 1` — every clause contributes "tta + 1" so that free flips (TTA = 0) score positive savings when removed (otherwise the metric is indifferent to taking a free flip).
- `infProxy = 86400` — finite stand-in for ∞-TTA clauses so that an action which finite-izes a previously-blocked goal yields large positive savings rather than appearing to *increase* T_remaining.

### Layer responsibilities (final form)

```
Layer 0  NetFlowGuard       Pre-filters actions that would tip a guarded
                            resource (wood / minerals / iron / coal / gold /
                            titanium / oil / uranium / energy / catnip-winter)
                            below safety. Guard is read-only on State; uses
                            applyActionToFlow + netFlowAt(s, season, weather)
                            for projection.

Layer 1  Reflexes           Stateless one-liners. Two tiers (lesson learned —
                            see §6): Tier 0 monotone permanent gains
                            (research / workshop / religion / policy / leader)
                            run BEFORE Tier 1 cap-drain captures (refine /
                            craft / hunt / praise) so cap-pinning can never
                            starve goal-flip progress.

Layer 2  Subsystems         Currently just JobAssignment. Pure
                            chooseJobs(s) → JobVector. Triggered on season
                            change / kitten count delta / new-job-unlocked.
                            Uses winter-worst-case farmer floor with a 75%
                            cap so non-farmer jobs are always reservable.

Layer 3  Strategic          chooseBuildingAction. Single-step lookahead.
                            For each guarded feasible build candidate,
                            score = (plannerScore(s) - plannerScore(s')) - cost.
                            Pick highest savings/cost ratio (zero-cost
                            positive-savings actions preempt). Random fallback
                            for non-build moves.
```

---

## 4. Build-up phases

Each phase landed as one focused commit. The DIARY.md has full details; here are the load-bearing decisions per phase.

| # | Phase | What landed | Why it mattered |
|---|---|---|---|
| 0 | Pipeline plumbing | 4-layer dispatch, trace ring, panel button | Lets each layer land independently |
| 1 | netFlow snapshot | `info.flow` populated from engine's `getResourcePerTick` | Flow projection without re-deriving multiplier stacks |
| 2 | NetFlowGuard active | Per-building delta tables + margin schedule | Smelter/calciner/etc. can't brick the run |
| 3 | Trivial reflexes | observe / hunt / praise / festival | Baseline leak-stoppers |
| 4 | refine-catnip reflex | Winter-survival buffer math | Captures cap overflow without starvation |
| 5 | Trade-overflow reflex | Catpower-cap leak-stopper, first-feasible civ | Strategic civ-choice deferred to Layer 3 |
| 6 | JobAssignment | Binary-search farmer floor + priority ladder | First non-trivial subsystem |
| 7 | Auto-craft + auto-buy reflexes | beam/slab cap-drain; research/workshop/religion auto-buy | One-time monotone purchases get bought ASAP |
| 8 | Hardcoded policy + leader | Curated PREFERRED_POLICIES list + appoint/promote | Removes irreversible-branch decisions from Layer 3 |
| 9 | TTA infrastructure | `costTTA`, `craftDagTTA`, `projectBuild`, `goalCompletionTTA` | Substrate for Layer 3 |
| 10 | Strategic planner | `chooseBuildingAction`, `plannerScore` | Real Layer 3, replaces random fallback for build |
| 11 | Headless harness | `pnpm headless`, JSON report | **Inflection point: I can self-test now** |
| 11.1 | Dojo Deferred / boughtByQueue / phantom goal | Three policy-related crashes | 2730 wasted policy actions per 500k ticks → 0 |
| 11.2 | Reflex tier reorder + paper craft + miner priority | Refine-catnip pinning blocked tech research | Currency + writing now research; parchment unlocks |
| 11.3 | Cap-bound deficit-finite TTA | Replace ∞ with finite weighted by deficit | Planner gradient for cap-raising builds |

---

## 5. The headless harness (force multiplier)

Phase 11's most consequential change wasn't a fix — it was [`scripts/headless-run.ts`](./scripts/headless-run.ts). Before it, every diagnostic cycle required: build userscript → install in Tampermonkey → load game → click [start] → watch panel for ~10 minutes → screenshot → narrate the bug. After it: `pnpm headless --seed N --max-ticks 200000 --out report.json`, parse the JSON, find what's stuck. Cycle time dropped from 10 minutes to ~30 seconds.

Every Phase 11.x bug was discovered and fixed via this harness.

The harness immediately surfaced **five distinct bugs** that manual testing would have taken many sessions to find:

1. Leader extraction null-job rejection (auto-appoint loop firing 841/1000 times).
2. `promote-leader` feasibility too loose (random fallback wasting 482/1000 actions on no-op promotes).
3. Dojo mock missing `create`/`style`/`Deferred`/etc. (crash on first astro event; all policies failed).
4. **Village job `calculateEffects` not fired at boot** — the killer bug. Scholars produced 0 science forever because their `modifiers` map starts empty and is only populated by `calculateEffects`, which the live UI calls implicitly during render but the headless harness skipped. Every science-bound tech was permanently stalled.
5. JobAssignment too greedy with farmers — needed `MAX_FARMER_FRACTION = 0.75` cap.

---

## 6. Insights that surprised us

**The reflex-priority ordering matters more than expected.** Original priority put cap-drain reflexes (refine-catnip, hunt) first, with auto-research/auto-workshop later. The thinking was "missing cap is irrecoverable, monotone gains can wait." Wrong: catnip cap pins constantly once you have decent fields, refine fires every tick, blocking every other Tier-0 reflex from getting a chance. Result was an indefinite tech-research stall despite plenty of science. **The correct ordering** is monotone permanent gains FIRST, time-sensitive captures SECOND. This is documented as a comment in `src/policy/reflexes/index.ts` so the failure mode doesn't get re-litigated.

**Live-game UI does work the headless mode skips.** `calculateEffects` on village jobs is called by the UI render path; without the UI we have to trigger it explicitly. We added a one-time post-boot pass in `setupGame.ts` to fire `calculateEffects` on every village job. The same pattern probably hides other latent issues in deeper game state.

**`buyItem` confirmation gate.** Upstream `PolicyBtnController.buyItem` takes the require-confirmation branch when the event is null. Build-queue-style flag `boughtByQueue: true` is the documented bypass. Our `apply.ts` initially passed `null`; took 2730 wasted policy attempts to discover.

**State-dependent edge weights make path planning hard.** We discussed this early as "the state-dependent shortest-path graph" and assumed single-step replanning would handle it. It doesn't, and that limitation is the current frontier — see §8.

---

## 7. Current state (as of last commit `a66134c0`)

**What works:**
- Headless run from fresh game reaches year 250 without crashing or starving kittens.
- Tests: 264/264 passing. Lint, typecheck, build all green.
- All 29 action variants have feasibility + apply + (most) flow-delta projections.
- Job assignment, leader appointment/promotion, policy adoption, religion-upgrade auto-buy, paper-craft chain, all working.

**Quantitative state at year 250 (seed=1):**
```
kittens 10  jobs {farmer:7, scholar:1, hunter:1, miner:1}
techs 12 of 62: ...calendar/agriculture/archery/mining/metal/animal/civil/
                math/construction/engineering/currency/writing
techs unlocked-not-researched: philosophy, machinery, steel
workshop 5 of 138    religion 0 of 64    policies 1 of 64
buildings: 9 distinct kinds of 39+    unbuilt-clauses 344 of 373
```

29 of 373 clauses flipped over 250 game-years ≈ **0.12 flips/year**. Far short of competitive completion speed.

---

## 8. Current frontier: the theology cap-bound stall

**The observable bug:** at year ~50 the autoplayer plateaus. Theology (the gate to religion) costs 20000 science but the cap maxes around 9000-10000.

**Root cause analysis (from the most recent conversation turn):**

The aggregate-TTA + single-step lookahead formulation is fundamentally insufficient for **threshold-crossing actions**. Library at count=16 costs ~47 sec, raises science cap by 250, reduces theology's deficit-weighted TTA by 250. Net score = 250 - 47 ≈ +200 — positive but small. Library #45 cost ≈ 300 sec, same +250 cap, score ≈ -50 — negative. Planner stops climbing.

But the actual completion path requires either 44 libraries OR 22 academies, costing ~150k seconds total but unlocking 30+ downstream religion goals worth ~2.6M seconds of T_remaining. Single-step lookahead **cannot see this reward** because it only realizes at the threshold-crossing step.

We rejected three proposed fixes:

- **Hand-rule reflex** (`autoCapRaiseReflex`): user explicitly asked for unified system, no per-tech rules.
- **Larger `CAP_DEFICIT_WEIGHT`**: tunable but arbitrary; can't be principled.
- **Full-path-TTA alone** (recompute TTA as time-to-traverse-cap-raise-sequence): traced through and found it gives 0 marginal savings per single library. Doesn't fix the issue.

The agreed fix: **K-step same-action lookahead.** For each candidate action, evaluate at K = 1, 2, 4, 8, 16, 32, 64, 128. Project K consecutive applications. Score the K-step chain as `(ΔplannerScore) - (cumulative cost)`. Pick the (candidate, K) pair with the best ratio. Take ONE step of that candidate.

This naturally:
- Reduces to single-step for actions with diminishing returns (K=1 wins).
- Activates multi-step for threshold-crossing actions (K=N wins).
- Picks academy over library when the full path of academies is cheaper than the full path of libraries (both reach 20000 cap, academies are fewer geometrically-priceRatio'd builds).

**Estimated implementation:** ~150 lines + tests. Not yet started — currently in design.

---

## 9. Other known limitations (in priority order, after K-step)

1. **Layer 3 only handles `build` (terrestrial).** Six other build-style action kinds (`build-space`, `build-chronoforge`, `build-voidspace`, `build-ziggurat`, `space-launch`, `pact`) have no planner support. ~50% of remaining unbuilt goal clauses are gated by these.
2. **Population stall at 10 kittens.** Planner doesn't model "more housing → more kittens → more workers" 3-step chain. Hut priceRatio = 2.5 makes them expensive fast; logHouse (cheaper) is unlocked but never picked.
3. **No engineer-assign subsystem.** `engineer-assign` action exists; nothing fires it. Workshop crafted-good production line is dormant.
4. **No time-skip / chronoforge auto-shatter.** Once chronosphere is built and chronophysics is researched, time-skip is the standard late-game accelerant. Currently not used.
5. **No strategic trade.** Auto-trade-overflow is a leak-stopper. Civ-choice (titanium from zebras, blueprints from spiders) is Layer 3 territory but not implemented.
6. **No auto-explore.** `send-explorers` exists; never auto-fired. Only the first-discovered civ (zebras) is ever in the discovered set.
7. **Workshop discounts not snapshotted.** `buildActionCost` uses static catalog; live engine discounts are not picked up. Mild conservative bias on cost.
8. **Crafted-good caps not modeled.** Beam / slab / etc. have caps; workshop upgrades raise them. Late-game costs need tens of thousands of crafts.
9. **Tampermonkey re-validation pending.** Phase 11 fixes were validated headlessly; live-game behavior with the priority reorder + cap-deficit-TTA hasn't been re-confirmed.

---

## 10. Project conventions worth flagging

- **Strict version control discipline.** Every phase = one commit with a body explaining the *why*. The full Phase 0 → 11.3 history is reviewable on master.
- **Catalogs are auto-generated** by `scripts/generate-catalogs.ts` from the vendored `kittensgame-master/`. Never hand-edited.
- **No DLA, no rollout simulator.** All planner work is symbolic projection over State, never engine cloning. K-step lookahead is symbolic-multi-step, consistent with this rule.
- **No hand rules per tech / building.** Curated lists exist for irreversible mutually-exclusive choices (`PREFERRED_POLICIES`); everything else is computed.
- **Headless first.** New work is verified via `pnpm headless` before live-game testing.

---

## 11. Quick reference

| Want to... | Look at |
|---|---|
| Understand the formal model | `Kittens Game model.MD` |
| Read the chronological log | `DIARY.md` |
| See how a layer dispatches | `src/policy/pipeline.ts` |
| See the strategic scorer | `src/policy/strategic/buildingPlanner.ts` |
| Understand goal predicate | `src/model/goal.ts` + `src/model/goalCompletion.ts` |
| Add a new reflex | drop a file in `src/policy/reflexes/`, register in `index.ts` |
| Run the autoplayer headlessly | `pnpm headless --seed 1 --max-ticks 100000 --out report.json` |
| Run on the live game | `pnpm build` → install `dist/kittens-autoplayer.user.js` in Tampermonkey |
| Run the full test suite | `pnpm test` (264 tests, ~10 sec) |
