# Kittens Game Autoplayer

An autonomous agent for [Kittens Game](https://kittensgame.com/web/) that
plays the game end-to-end with a single, readable heuristic: **pick the most
valuable unresearched tech or upgrade, then do whatever shrinks its
bottleneck fastest.**

No features, no learned weights, no training loop. The whole decision
model is ~300 lines of straight-line code driven entirely by live game
data.

---

## Overview

This is a Tampermonkey userscript that plays Kittens Game. The game has
several properties that make planning hard — sparse rewards, long
horizons, ~100+ candidate actions, 8-level craft chains, seasonal
swings — but a human player cuts through all of it with a simple
compass: the Science and Workshop tabs. Pick the next thing to unlock,
and everything else becomes instrumental to that target.

The agent implements exactly that.

---

## How the approach evolved

The project went through four architectures, getting noticeably simpler
each time.

### v1–v3: Heuristic priority bot

The first versions were pure rule systems: priorities like
`has_workshop=80`, `has_smelter=70`, hand-written logic for crafting /
jobs / trading / festivals. Cheap and predictable in the early game but
unmaintainable once religion / space / transcendence opened up.

### v4–v5: MCTS with iframe rollouts

To escape the hand-tuning ceiling, v4 introduced search: a hidden
`<iframe>` loaded a second copy of Kittens Game, the parent serialised
state via `postMessage`, and the iframe ran greedy rollouts with an
analytical fast-forward. UCB1 over affordable arms. Worked, but: 30–60s
iframe init, multi-second rollouts, high-variance greedy estimates, and
round-trip fragility every time the game version changed.

### v6: Linear value model + ranked queue

Replaced the rollouts with a linear value function `V(s) = θ · φ(s)`
over 22 hand-designed features. Every goal was scored by `θ · Δφ / √T`
and ranked in one big queue; buildings competed head-to-head with
techs. Fast (milliseconds per decision) and decent. But: dozens of
heuristics on top to make the flat ranker approximate sequential
reasoning — pair-scoring, horizon pair-scoring, scarcity scaling,
hand-coded `_B_PROD` / `_B_MAX` tables, θ-training pipeline, data
collection, offline ridge fit, sanity checks, per-feature α.
Fundamentally the ranker treated "pick what to do next" as one big
unconstrained optimisation.

### v7 (current): Hierarchical planner

**Realisation:** humans don't rank all actions together. We pick an
**agenda** (next tech or upgrade) and treat everything else as
instrumental to it. That's a two-level problem, not a ranking problem.

The current agent, in its entirety:

1. Pick the unresearched tech / workshop upgrade / religion upgrade /
   space mission with the best `(1 + fanout) / timeSecs`, where
   fanout = `|unlocks|` as listed in the game's own data.
2. If that target is directly affordable, execute it.
3. Otherwise, classify its obstacle — production, storage, or
   unlock-prod — from the registry's existing `bottleneck` and
   `blockReason` fields.
4. Scan the registry for BUILDs / SPACE_BUILDINGs / WORKSHOP_UPGRADEs /
   RELIGION_UPGRADEs whose effects attack that obstacle. Pick the one
   closest to ready. Execute it.
5. If nothing instrumental helps (or all helpers would take longer
   than the target itself), just save for the target.

That's it. Every lookup is live game data: `game.bld.buildingsData`,
`game.workshop.upgrades`, `game.religion.{getRU,getZU,getTU}`,
`game.space.planets`. No parameters to fit, no features to extract, no
theta to train.

v7 removed ~2700 lines and added ~370.

---

## Architecture

```
                        ┌─────────────────────┐
                        │    Orchestrator     │  1-second Web Worker tick
                        │  (09_orchestrator)  │
                        └──────────┬──────────┘
                                   │
               ┌───────────────────┼───────────────────┐
               │                   │                   │
               ▼                   ▼                   ▼
      ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
      │  Rule helpers  │  │  Instant buy   │  │ Goal registry  │
      │ (jobs, craft,  │  │ (tech/upg/rel/ │  │ (04b_planner)  │
      │  hunt, trade,  │  │  space — free  │  │  ready/saving/ │
      │  praise, fest.)│  │  wins)         │  │  blocked       │
      └────────────────┘  └────────────────┘  └───────┬────────┘
                                                      │
                                                      ▼
                                              ┌────────────────┐
                                              │  pickDecision  │
                                              │ (04d_planner)  │
                                              │                │
                                              │ 1. pickTarget  │
                                              │ 2. classify    │
                                              │    bottleneck  │
                                              │ 3. findInstru- │
                                              │    mental      │
                                              └───────┬────────┘
                                                      │
                                        ┌─────────────┴─────────────┐
                                        ▼                           ▼
                             ┌─────────────────┐         ┌─────────────────┐
                             │ execute action  │         │ save for target │
                             │ (target or      │         │ progress craft  │
                             │  instrumental)  │         │ chain           │
                             └─────────────────┘         └─────────────────┘
```

### Component summary

**Orchestrator** (`09_orchestrator.js`) — main loop, driven by a Web
Worker posting a message every second. Each tick runs rule-based
helpers unconditionally, then (if enabled and the decision interval
has elapsed) runs one queue cycle: instant-buy, converter helpers,
compute goal registry, call `pickDecision`, execute the chosen action
or display a saving status.

**Action enumerator** (`02_actions.js`) — scans all game subsystems
and returns the currently affordable actions. `canAffordWithCrafting`
looks through craft chains so a goal is "affordable now" even if
intermediate crafts are required first.

**Craft chain resolver + goal registry** (`04b_planner.js`) — the
heart of the system, unchanged from v6. `resolveRawCost` converts a
price list into `{rawCost, craftPlan, minBatch, directNeed}`.
`computeGoalRegistry` runs this for every possible goal and produces
a snapshot with status (ready / ready-craft / saving / blocked),
bottleneck resource, time-to-affordable, craft plan, and helpful
trade suggestions. The new planner consumes this snapshot directly.

**Hierarchical planner** (`04d_planner.js`) — the only new piece.
Scrapes `{res}PerTick*` / `{res}Max` effect keys from the game's
building and space-building data at first call; the scrape is cached
for the session. `pickTarget` ranks by `(1 + fanout) / timeSecs`.
`classifyBottleneck` maps registry status/blockReason to
`{kind, res}`. `findInstrumental` picks the shortest-time-to-ready
action whose effects help the bottleneck, matched via direct
res-prefix keys (`{R}Ratio`, `{R}JobRatio`, `{R}PerTickBase`) or
indirect producer-building keys (`lumberMillRatio` helps wood
because lumberMill is a wood producer). `isGoalSafe` hard-vetoes any
BUILD whose consumer effects would crash a foundation resource.

**Rule-based helpers** (`08_automation.js`) — jobs, auto-craft at
cap, auto-hunt, auto-praise, goal-directed trading (fires trades for
registry goals whose bottleneck is a tradable resource),
auto-sacrifice unicorns + alicorns, auto-festival. The
`_resourceReservedForRanked` gate still exists but now reads from
the registry directly rather than from a stale ranked list.

**UI** (`10_ui.js`) — three tabs. **Main** shows the current
target → instrumental decision, the decision log, and the craft log.
**Goals** is the full registry grouped by category with resource
lanes; the current target/instrumental are marked with ◆ / ◇.
**Settings** for decision interval, gold/faith reserves, game-speed
multiplier.

---

## Why this works

1. **Fanout is in the data.** Every tech and upgrade in kittensgame
   has an `unlocks: {buildings, tech, upgrades, policies}` field. So
   "how much does this open up?" is one subtraction, not a feature
   to design.

2. **Bottlenecks are in the data.** The goal registry already
   computes each saving goal's bottleneck resource (the deficit with
   the longest accumulation time) and each blocked goal's reason
   ("need more storage for X" / "no X production"). The planner just
   reads those.

3. **Effect keys are in the data.** Kittens-Game effects use
   consistent naming: `{res}PerTickBase` for flat production,
   `{res}Ratio` for multipliers, `{res}Max` for storage,
   `{building}Ratio` for building-specific boosts. Scraping these
   once at init replaces ~800 lines of hand-maintained tables
   (`_B_PROD`, `_B_MAX`, `_UPG_PROD_MULT`, etc.).

4. **One target at a time.** Because the agenda is a single goal,
   shared-resource contention is settled by construction: we're
   saving for X, so spend on whatever shortens X's bottleneck and
   nothing else. The pair-scoring / horizon-pair-scoring machinery
   that approximated this in v6 is no longer needed.

---

## Installation and usage

### Prerequisites

[Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, or Edge).

### Install

```bash
python build.py
```

This concatenates `src/*.js` in filename order into
`mcts_autoplayer.user.js` and copies it to the clipboard. Paste into
a new Tampermonkey userscript (or install the generated `.user.js`
directly).

Then open [Kittens Game](https://kittensgame.com/web/) — the panel
appears in the bottom-right corner.

### Panel

- **Main** — current target / instrumental, enable toggle, decision
  log, catnip-clicker slider.
- **Goals** — every goal in the game with status, time,
  bottleneck, craft plan; target / instrumental marked with ◆ / ◇.
- **Settings** — decision interval, gold/faith reserves, game-speed
  multiplier.

---

## Limitations

- **Cheapest-first biases toward leaves.** Fanout tie-breaks
  (`1 + fanout` in the numerator) help but a mountain of 0-fanout
  leaf techs can still delay committing to a genuinely transformative
  unlock. In practice not a problem — once leaves are exhausted the
  gateway becomes the cheapest remaining candidate — but noticeable
  early.

- **Instrumental matching is heuristic.** `{res}Ratio` on a
  building helps "res"; `{producer}Ratio` where producer is in
  `_producerOf[res]` also helps. This covers most cases cleanly but
  misses second-order effects (e.g. an upgrade boosting a building
  that boosts a resource via a non-producer path). Failure mode is
  that the helper gets skipped, not wrong — the target still gets
  served by the next-best candidate.

- **No multi-step lookahead.** If a target is blocked on resource X,
  and the best producer of X is itself blocked on Y, the planner
  only reasons one level deep. Adding recursion would be simple
  (the bottleneck of an instrumental can be classified the same
  way) but hasn't proved necessary.

- **Personal project, not a research contribution.** No benchmarks
  against the previous versions.

---

## Project structure

```
src/
  00_header.js        Tampermonkey metadata (@name, @match, @grant)
  01_config.js        cfg state, perf instrumentation
  02_actions.js       ActionType, affordable-action enumerators
  03_executor.js      Action execution (build/research/craft/trade/religion/space)
  04_priority.js      Priority heuristics (used for tie-breaking auto-buys)
  04b_planner.js      Craft chain resolver, goal registry, progressCraftChain
  04d_planner.js      pickDecision: target + instrumental + isGoalSafe
  05_scoring.js       Progress metric used by UI / debug dump
  08_automation.js    Jobs, auto-craft, auto-hunt, auto-trade, auto-praise, auto-sacrifice, auto-festival
  09_orchestrator.js  runQueueCycle + orchestratorTick
  10_ui.js            Main / Goals / Settings tabs
  11_init.js          Game-ready detection + init
  99_footer.js        IIFE closing
build.py              Concatenate src/*.js → mcts_autoplayer.user.js (+ clipboard)
```

---

## License

Provided as-is for educational and personal use. Kittens Game is
created by [bloodrizer](https://kittensgame.com/).
