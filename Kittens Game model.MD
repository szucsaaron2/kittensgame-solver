# Kittens Game as a Sequential Decision Problem
### A Powell-style five-element model

---

## 0. Scope, conventions, and ground rules

**In scope.** All gameplay reachable without (a) any reset of the run, (b) any expenditure or accumulation of paragon, or (c) any expenditure or accumulation of karma. This means: the full tech tree, all non-paragon-gated workshop upgrades, all religion upgrades reachable from faith and apocrypha alone, the full diplomacy and trade system, the full space program through its terminal celestial body, the chronoforge and voidspace machinery (these run on time crystals and void, which are accumulable without paragon), and all kitten-management mechanics.

**Out of scope.** The reset / Iron Will mechanic. Paragon accumulation and any building/upgrade gated on paragon. Karma accumulation and the transcendence/cryptotheology upgrades gated on karma tiers. Challenges. Anything in the game whose cost row contains paragon or karma is excluded from the goal predicate but **its slot in the state vector is still kept** — partly for cleanliness, partly so that the model needn't change if the user later wants to relax these restrictions.

**Time discretization.** Decisions are indexed by *decision events*, not by simulator ticks. A decision event is the earliest of: (a) a new action becomes affordable, (b) a season boundary is crossed, (c) a craft / building / research operation completes, (d) a stochastic event fires (astronomical observation, hunt return, trade roll), (e) a kitten arrives. Between decision events the simulator runs forward deterministically under fixed flows; the duration $\Delta t_{t+1}$ to the next event is part of the exogenous information $W_{t+1}$.

**Notation.** Following Powell's principle 12 — single-letter variables, time as subscript, component classes as superscripts in calligraphic or Roman text. The transition is $S^M$ (not $f$). The policy is $X^\pi$. Sets are uppercase calligraphic. Bitsets are written as elements of $\{0,1\}^N$.

**Outline.**
1. Clock and decision-event semantics
2. State variable $S_t$ — physical, informational, belief
3. Decision variable $x_t$ and feasible set $\mathcal{X}_t(S_t)$
4. Exogenous information $W_{t+1}$
5. Transition function $S^M$
6. Objective and goal predicate
7. Implementation notes and progressive activation

---

## 1. Clock and decision-event semantics

Let $t \in \{0, 1, 2, \ldots\}$ index decision events. Wall-clock time is tracked by a state component $\tau_t \in \mathbb{R}_{\geq 0}$ (seconds since run start) and advances by $\Delta t_{t+1} = \tau_{t+1} - \tau_t$, which is a component of $W_{t+1}$.

The heartbeat is Powell's standard:

$$S_0 \to x_0 \to W_1 \to S_1 \to x_1 \to W_2 \to S_2 \to \cdots$$

Most of the time, $x_t$ will be the trivial *wait* action and $\Delta t_{t+1}$ will be set by whichever future event fires first. Strategic decisions (build / research / reassign) are interleaved with these waits; they take effect either instantaneously (research, workshop upgrade, kitten reassignment) or by initiating a build/craft order whose completion is itself a future event.

---

## 2. State variable $S_t$

The state decomposes as

$$S_t = (R_t, I_t, B_t)$$

where $R_t$ is the physical (resource-like) substate, $I_t$ is the informational substate (perfectly known, non-resource), and $B_t$ is the belief substate. Powell's discipline: *everything we know, and only what we need to know, to make a decision and model the problem.*

### 2.1 Physical state $R_t$

#### 2.1.1 Stockpiled resources $R^{\text{res}}_t$

A vector $R^{\text{res}}_t \in \mathbb{R}^{N_R}_{\geq 0}$ with associated capacity vector $\bar{R}^{\text{res}}_t \in (\mathbb{R}_{\geq 0} \cup \{\infty\})^{N_R}$. Both sides depend on $I_t$ (techs, upgrades) and $R^{\text{bld}}_t$ (storage buildings).

Components, grouped by tier of unlock:

| Group | Resources |
|---|---|
| Primary | catnip, wood, minerals |
| Secondary | coal, iron, gold, titanium |
| Industrial | oil, uranium |
| Frontier | unobtainium, antimatter, thorium, eludium |
| Soft | science, culture, faith |
| Effort | catpower (manpower) |
| Crafted (basic) | beam, slab, plate, steel, concrete, gear, alloy, scaffold |
| Crafted (advanced) | ship, tanker, megalith, kerosene |
| Crafted (knowledge) | parchment, manuscript, compendium, blueprint |
| Astronomy / space | starchart |
| Time / void | time crystal, relic, void |
| Religion-flow | tears, sorrow, BLS / bloodstones (verify name in source) |

A few items often confused with stockpiled resources but are *not* stockpiled in this model:
- **Energy** is a flow, never accumulated; tracked in $I_t$ as net energy from buildings.
- **Apocrypha / epiphany / atonement** are accumulated under religion but their dynamics differ from normal resources; they live in $I^{\text{rel}}_t$.
- **Paragon, karma**: excluded by scope, but slots retained as identically zero in the implementation.

For each resource $r$, the capacity $\bar{R}^{\text{res}}_{t,r}$ is computed from storage buildings (barns, warehouses, harbors, accelerators, …) plus capacity-multiplying upgrades. Resources without natural caps (science once libraries+ are built; culture; some others) take $\bar{R}_{t,r} = \infty$ or a very large effective value.

#### 2.1.2 Building counts $R^{\text{bld}}_t$

A vector $R^{\text{bld}}_t \in \mathbb{Z}^{N_B}_{\geq 0}$, one component per building type. The full set $\mathcal{B}$ partitions across tabs:

- **Bonfire (terrestrial).** catnip field, pasture, aqueduct, hut, log house, mansion, library, academy, observatory, bio lab, mine, quarry, lumber mill, smelter, calciner, steamworks, magneto, reactor, factory, oil well, hydro plant, broadcast tower, data center, harbor, warehouse, barn, tradepost, mint, amphitheatre, chapel, temple, workshop, ziggurat, chronosphere, accelerator, brewery, solar farm.
- **Religion structures (unicorn / sun).** unicorn pasture, unicorn tower, unicorn temple, unicorn graveyard, unicorn necropolis, sun spire, marker, black pyramid, solar chant (verify exact list against source — the religion structures evolve).
- **Space (per celestial body).** Each of {moon, Dune, Piscine, Helios, T-Minus, Yarn, Umbra, Charon, Centaurus} carries its own building subvector. Bodies that have no buildings yet (locked) carry zero subvectors. Bodies typically have: a habitat, a science/observation building, a mining/extraction building, a storage extension, and one or two specialty structures.
- **Chronoforge.** temporal accelerator, temporal impedex, blastfurnace, time impedance device, ressourceful retreat (verify names).
- **Voidspace.** void hoover, void rift, chronocontrol, antimatter-related buildings (verify).

Buildings are integer counts; some have a maximum count (e.g., one chronosphere in early techs, with cap raised by upgrades). Caps are derived from $I_t$ and not separately stored.

#### 2.1.3 Kitten substate $R^{\text{kit}}_t$

- **Total population** $K_t \in \mathbb{Z}_{\geq 0}$, growing toward housing capacity at a rate determined by housing surplus and pasture/aqueduct buffs.
- **Job assignment vector** $J_t \in \mathbb{Z}^{N_J}_{\geq 0}$ with $\sum_j J_{t,j} \leq K_t$ (unassigned kittens permitted; they consume catnip but produce nothing).
  - Jobs $\mathcal{J}$: woodcutter, scholar, farmer, hunter, miner, priest, geologist, engineer.
  - The engineer job has subcomponents — a vector $E_t$ assigning engineers to specific craft outputs. This is itself a small sub-policy that lives inside $J_t$.
- **Skill levels** $\Sigma_t \in \mathbb{R}^{N_J}_{\geq 0}$, average skill per job, accumulating over time-in-job. Skill multiplies job output. Per-kitten skill detail is unnecessary — Powell's "only what we need" — the average is sufficient because production aggregates linearly.
- **Leader** $L_t = (\text{job}, \text{trait}, \text{rank}, \text{skill})$, granting a global bonus tied to the leader's job. Optional null if no leader appointed.
- **Senators** (with monarchy policy): a small list of council members, mostly relevant only when a specific late-game policy is active.
- **Happiness / unhappiness**, derived from population, luxury resources, and culture; it modulates production. Track explicitly because the policy will respond to it. Place in $I_t$ since it is a *derived* informational quantity, not a stock.

#### 2.1.4 Embassies and diplomacy stocks

Embassy counts per civilization $E^{\text{emb}}_{t,v}$ for $v$ ranging over $\{\text{zebras}, \text{lizards}, \text{sharks}, \text{griffins}, \text{nagas}, \text{spiders}, \text{dragons}, \text{leviathans}\}$. Embassies are integer counts and sit logically alongside buildings, but they are tied to a discovered-civilization gating in $I_t$.

### 2.2 Informational state $I_t$

#### 2.2.1 Calendar $I^{\text{cal}}_t$

$$I^{\text{cal}}_t = (y_t, s_t, d_t, c_t)$$

- $y_t \in \mathbb{Z}_{\geq 0}$: year.
- $s_t \in \{\text{spring}, \text{summer}, \text{autumn}, \text{winter}\}$: season.
- $d_t \in [0, 100)$: day within season (real-valued, fractional).
- $c_t \in \{\text{Charon}, \text{Umbra}, \text{Yarn}, \text{Helios}, \text{Cath}, \text{Redmoon}, \text{Dune}, \text{Piscine}, \text{Terminus}, \text{Kairo}\}$: cosmic cycle, unlocked once chronospheres reveal it. Each cycle gives multiplicative bonuses/penalties to certain space buildings. Before chronospheres, $c_t$ is a placeholder of "Charon" (the default cycle name) and has no effect.

#### 2.2.2 Weather $I^{\text{wx}}_t \in \{\text{cold}, \text{neutral}, \text{warm}\}$

Modulates catnip production multiplicatively. Refreshed seasonally with a known distribution (which goes in $W_{t+1}$).

#### 2.2.3 Tech bitset $I^{\text{tech}}_t \in \{0,1\}^{N_T}$

Indexed over the full tech tree $\mathcal{T}$. The tree is a DAG; prerequisites are constraints on the decision $x^{\text{tech}}_t$. Approximate enumeration (verify completeness against source):

calendar, agriculture, archery, mining, animal husbandry, metal working, mathematics, construction, engineering, currency, writing, philosophy, steel, civil service, machinery, theology, astronomy, navigation, architecture, physics, metaphysics, chemistry, acoustics, geology, drama and poetry, electricity, biology, biochemistry, genetics, industrialization, mechanization, combustion, ecology, electronics, robotics, artificial intelligence, quantum cryptography, nuclear fission, rocketry, oil processing, satellite, orbital engineering, thorium, exogeology, advanced exogeology, nuclear smelters, energy rifts, stasis chambers, voidspace, paradox theory, chronophysics, tachyon theory, cryptotheology, hydroponics, antimatter, terraformation, particle physics, dimensional physics, superconductors, antimatter drives, blackchain.

Cryptotheology-tier techs that require karma to research are flagged but excluded from the goal predicate.

#### 2.2.4 Workshop upgrades $I^{\text{ws}}_t \in \{0,1\}^{N_{WS}}$

A large bitset over the workshop catalog. Each upgrade has a one-time cost (resources, possibly tech prereqs) and a permanent multiplicative or unlock effect. Examples: mineral hoes, iron hoes, reinforced saw, alloy axe, expanded barns, bolas, hunting armor, nuclear smelters, factory automation, pneumatic press, …

#### 2.2.5 Religion upgrades $I^{\text{rel}}_t$

Decomposes:
- **Solar revolution / faith bonus level**: a real number derived from accumulated apocrypha. $A_t \in \mathbb{R}_{\geq 0}$ is total apocrypha accumulated; the resulting bonus is a known function $\rho(A_t)$.
- **Faith reset count** $n^{\text{praise}}_t$: how many times the player has praised the sun. Each praise converts the current faith stock to apocrypha via a known ratio; faith stock then resets to zero.
- **Religion upgrade bitset**: the purchased subset of {revival, transcendence (excluded if karma-gated), apocryphal lore, sun altar, basilica, templars, scholasticism, golden spire, …}. Karma-gated transcendence-tier entries are flagged and excluded from the goal predicate but kept as state slots.

#### 2.2.6 Diplomacy / trade $I^{\text{trade}}_t$

- Discovered civilizations bitset $\in \{0,1\}^8$.
- Standing per civ (dragons / leviathans have nontrivial standing; others mostly fixed).
- Pact statuses: pact with leviathans, pact with dragons (verify), each with a tier.
- Trade ratio multipliers from explored embassies.
- Last trade timestamps if relevant for cooldowns (probably not needed; trades are instant).

#### 2.2.7 Policies $I^{\text{pol}}_t$

A vector of categorical choices in mutually-exclusive policy slots: government type {anarchy, autocracy, monarchy, republic, theocracy, …}, fascism vs. liberty, etc. Each slot $p$ holds a value in $\mathcal{P}_p \cup \{\text{none}\}$. Most policies are *irreversible once selected* — this matters for the policy class search: a wrong choice cannot be undone within the run.

#### 2.2.8 Astronomical event flag $I^{\text{astro}}_t$

A binary flag: is there currently an unobserved astronomical event? If true, an `observe` action becomes available with science/starchart reward. The flag rises stochastically (Poisson-like) and falls when observed or when it expires.

#### 2.2.9 Festival timer $I^{\text{fest}}_t \in \mathbb{R}_{\geq 0}$

Time remaining on the current festival's production bonus. Decremented with $\Delta t$.

#### 2.2.10 Energy and other derived informational quantities

- Net energy $\eta_t$, computed from buildings as a sum. If $\eta_t < 0$, certain buildings are penalized. Strictly redundant given $R^{\text{bld}}_t$ and $I^{\text{ws}}_t$, but a useful cached field.
- Happiness $h_t$, similarly derivable but cached.
- Visible-tab flags: which UI panels are visible. Derivable; not part of the state proper, but needed to mirror the game's progressive disclosure if you're driving the actual web client.

#### 2.2.11 Wall-clock timestamp $\tau_t$

Tracked separately from the calendar so that real-time events (cooldowns, wall-clock-paced things) are anchored. In Kittens Game most things are calendar-paced, so $\tau_t$ is mostly cosmetic.

### 2.3 Belief state $B_t$

For Kittens Game, the belief state is essentially trivial. All distributions are known: hunt yields, trade rolls, weather, astronomical event rates. There is no parameter to learn.

The only nontrivial candidate would be if you wanted the autoplayer to *infer* the game's hidden modifiers from observations (e.g., if you're driving the live UI rather than a forked engine). For the model-first formulation, take

$$B_t = \emptyset.$$

If you later need it (say, to robustify against game updates that change constants), you would put posterior beliefs over key multipliers here. The framework accommodates it cleanly; you just don't need it now.

---

## 3. Decision variable $x_t$

The decision at each event is a tagged union across categories. Multiple categories can in principle fire in the same in-game tick (the player can click many buttons rapidly), but for clean modeling we treat each as a separate decision event with $\Delta t = 0$ between them when chained. This is faithful to player behavior and avoids combinatorial explosion in the action space.

### 3.1 Action categories

Let $a_t \in \mathcal{A}$ be the action class, with payload depending on class.

| Class | Payload | Effect |
|---|---|---|
| `wait` | — | Advance to next decision event. |
| `build` | building $b \in \mathcal{B}$ | Pay $\text{cost}_b(R^{\text{bld}}_{t,b})$, increment $R^{\text{bld}}_{t,b}$. |
| `research` | tech $\tau \in \mathcal{T}$ | Pay $\text{cost}_\tau$, set $I^{\text{tech}}_{t,\tau} \gets 1$. Instantaneous. |
| `workshop` | upgrade $w \in \mathcal{W}$ | Pay $\text{cost}_w$, set $I^{\text{ws}}_{t,w} \gets 1$. |
| `religion` | upgrade $u \in \mathcal{U}$ | Pay $\text{cost}_u$ in faith/apocrypha, set bit. |
| `policy` | slot $p$, value $v$ | Set $I^{\text{pol}}_{t,p} \gets v$. Usually irreversible. |
| `embassy` | civilization $v$ | Pay culture+gold, increment $E^{\text{emb}}_{t,v}$. |
| `pact` | civilization $v$, tier | Pay uranium/relics, increment pact tier. |
| `assign` | new $J_t$ | Reassignment of kittens across jobs. Free; instantaneous. |
| `engineer-assign` | new $E_t$ | Reassign engineers across crafts. Free. |
| `promote` | leader rank up | Pay manuscripts, advance leader rank. |
| `appoint-leader` | kitten id | Choose new leader. |
| `craft` | item $c$, quantity $n$ | Pay raw materials, gain $n$ crafted. |
| `hunt` | catpower $m$ | Spend manpower, returns stochastic furs/ivory/gold/unicorns/spice. |
| `trade` | civilization $v$, caravans $n$ | Pay manpower + tribute resources, returns stochastic commodity bundle. |
| `praise` | — | Convert faith stock $\to$ apocrypha, faith $\gets 0$. |
| `observe` | — | Available iff $I^{\text{astro}}_t = 1$. Returns starcharts/science. |
| `share-knowledge` | — | Spend culture, return manuscripts (if upgrade owned). |
| `festival` | — | Spend manuscripts+culture+parchment, set $I^{\text{fest}}_t$. |
| `refine` | — | Various refine actions (refine tears, refine catnip, refine TC, …). |
| `space-launch` | mission $m$ | Pay oil/kerosene/ships, advance space-mission state. |
| `time-skip` | n_years | Spend time crystals, advance calendar by $n$ years (chronosphere mechanic). Voidspace and chronoforge variants exist. |

Note: the `wait` action is the *only* action that advances time. Every other action is instantaneous in the in-game clock — costs/rewards apply immediately, then the engine resumes flow accumulation. This is a critical modeling fact and matches how the actual engine works.

### 3.2 Feasible set $\mathcal{X}_t(S_t)$

A single predicate per action class. Each predicate factors as

$$\text{prereq}_{a}(I_t) \;\land\; \text{cost}_a(S_t) \leq \text{available}_a(R_t)$$

with details per class:

- **build $b$.** Tech prereqs in $I^{\text{tech}}_t$ satisfied. Workshop prereqs in $I^{\text{ws}}_t$ satisfied. All resource costs (which scale by $R^{\text{bld}}_{t,b}$ via the standard $\text{cost} \cdot \rho^k$ geometric formula) within $R^{\text{res}}_t$. Building-specific caps respected (e.g., chronosphere cap from upgrades).
- **research $\tau$.** Parent tech bits satisfied; science cost satisfied.
- **workshop $w$.** Tech prereqs; resource cost (often crafted goods).
- **religion $u$.** Faith / apocrypha cost. For karma-gated entries: out of scope (predicate returns false).
- **policy $(p, v)$.** Tech prereq; slot $p$ currently in `none` or in a state where $v$ is reachable.
- **embassy $v$.** Civilization $v$ discovered; culture+gold cost; embassy cap (some civs cap at 99 or so, but practically uncapped).
- **pact $v$.** Pact prereq tech; uranium / relics cost.
- **assign / engineer-assign.** $\sum_j J_{t,j} \leq K_t$, integer constraints.
- **craft $c$.** Workshop prereq; raw material cost; current craft ratio multiplier from upgrades.
- **hunt.** Catpower $\geq 100$ (per-hunt cost).
- **trade.** Catpower $\geq c^{\text{cp}}_v$, gold $\geq c^{\text{g}}_v$, season constraint (some civs only trade in certain seasons).
- **praise.** $I^{\text{rel}}$ implies religion is unlocked; faith stock $> 0$.
- **observe.** $I^{\text{astro}}_t = 1$.
- **time-skip.** Time crystals $> 0$; chronosphere $\geq 1$ built.
- **wait.** Always feasible.

### 3.3 Policy

A policy is a function $X^\pi: \mathcal{S} \to \mathcal{A}$ mapping state to action class + payload. The four Powell classes (PFA, CFA, VFA, DLA) parameterize this function differently. The choice among them is the *solver* problem, not the *modeling* problem, and is deferred to a separate document. As established last turn, a hybrid DLA+CFA backbone with PFA fast-path is the recommended approach.

---

## 4. Exogenous information $W_{t+1}$

$W_{t+1}$ is the random information that arrives between $x_t$ and the next decision. Components:

1. **Time advance** $\Delta t_{t+1}$. Deterministic given $x_t = \text{wait}$ and the schedule of upcoming events; zero given any instantaneous action.
2. **Hunt outcome** $H_{t+1}$, fired only when $x_t = \text{hunt}$. Vector-valued: gold, furs, ivory, unicorns (rare), spice (rare). Distributions are known and depend on workshop upgrades (bolas, hunting armor) and culture.
3. **Trade outcome** $T_{t+1}$, fired only when $x_t = \text{trade}$. Bernoulli for each rare commodity (titanium with zebras pre-iron-tech, blueprint with spiders, unicorns with nagas, etc.) plus deterministic base bundle. Distributions known.
4. **Weather transition** at season boundaries: sampled from a known categorical distribution conditioned on season.
5. **Astronomical event arrival**: if $I^{\text{astro}}_t = 0$, draw next-event-time from known exponential-like distribution.
6. **Astronomical event expiration**: if $I^{\text{astro}}_t = 1$ and `observe` is not played in time, the flag clears.
7. **Leader trait** on `appoint-leader`: categorical sample over traits.
8. **Refine yield variance**: small variance on certain refine actions.
9. **Stochastic time-skip side effects** in voidspace/chronoforge: low-probability events when time-skipping.

For implementation, $W_{t+1}$ is a sparse record — most components are null on most transitions. Only the components corresponding to $x_t$'s class (plus the always-present $\Delta t_{t+1}$ and any free-running stochastic clocks that happened to fire during the interval) are realized.

---

## 5. Transition function $S^M$

The transition $S_{t+1} = S^M(S_t, x_t, W_{t+1})$ is the game engine. Conceptually it factors as

$$S^M = \text{TimeFlow}_{\Delta t} \circ \text{ApplyAction}_{x_t} \circ \text{ApplyExogenous}_{W_{t+1}}$$

with the operations commuting where the order doesn't matter and explicit when it does. The cleanest order:

### 5.1 Apply action

The action's effect is applied first, since costs are paid *before* time advances. For each class:

- **build:** subtract resource cost; increment building count; recompute caps and multipliers (cached in $I_t$).
- **research / workshop / religion:** subtract cost; flip bit.
- **policy:** set slot value.
- **embassy / pact:** subtract cost; increment counter.
- **assign / engineer-assign:** replace $J_t / E_t$.
- **promote / appoint-leader:** mutate $L_t$; subtract cost.
- **craft:** subtract raw materials × ratio; add crafted output × current craft multiplier.
- **hunt:** subtract 100 catpower; later in step, $W_{t+1}$ adds outcome to resources.
- **trade:** subtract caravan cost; later in step, $W_{t+1}$ adds outcome; some trades require season match (already in feasibility).
- **praise:** apocrypha $\mathrel{+}= \alpha \cdot \text{faith}_t$ for known $\alpha$; faith $\gets 0$.
- **observe:** subtract nothing; $W_{t+1}$ delivers starcharts/science.
- **share-knowledge:** subtract culture; add manuscripts.
- **festival:** subtract crafted goods; set $I^{\text{fest}}_t$ to known duration.
- **time-skip:** subtract time crystals; advance calendar; trigger off-line accumulation across the skipped interval (this is the trickiest transition — it must run a closed-form integration of resource flows over the skipped duration).

### 5.2 Apply exogenous information

Hunt/trade outcomes are added; weather may flip if season boundary in $\Delta t$; astronomical event flag may transition.

### 5.3 Time flow over $\Delta t_{t+1}$

This is the bulk of the work and should be implemented as a single integrator:

$$R^{\text{res}}_{t+1, r} = \min\{\bar{R}^{\text{res}}_{t+1, r},\; R^{\text{res}}_{t,r} + (\text{prod}_r - \text{cons}_r) \cdot \Delta t_{t+1}\}$$

with

$$\text{prod}_r = \sum_{b \in \mathcal{B}} R^{\text{bld}}_{t,b} \cdot \mu_{b,r}(I_t, J_t, c_t, s_t, w_t, \eta_t, h_t) + \sum_{j} J_{t,j} \cdot \nu_{j,r}(I_t, \Sigma_{t,j}) + \text{trickle}_r$$

and consumption similarly. The multipliers $\mu, \nu$ are products of: workshop upgrades, religion bonuses (apocrypha-driven), policy effects, leader bonuses, weather, season, cycle, festival, paragon (excluded), happiness.

Population dynamics:
$$K_{t+1} = K_t + \kappa(K_t, \bar K_t, \text{pasture}, \text{aqueduct}, \ldots) \cdot \Delta t_{t+1}$$

where $\bar K_t$ is housing capacity.

Skill dynamics:
$$\Sigma_{t+1, j} = \Sigma_{t,j} + \sigma(J_{t,j}) \cdot \Delta t_{t+1}$$

(possibly capped, possibly with per-job rate; verify exact formula).

Calendar dynamics:
$$d_{t+1} = (d_t + \Delta t_{t+1} \cdot \text{day-rate}) \mod 100$$
with carry into $s, y, c$.

Festival timer:
$$I^{\text{fest}}_{t+1} = \max\{0, I^{\text{fest}}_t - \Delta t_{t+1}\}.$$

The transition is large but mechanical; its implementation is the bulk of the simulator backbone. Crucially, **everything in it is deterministic given $S_t$ and the multiplier formulas**, so the simulator is a pure function (modulo $W_{t+1}$ for stochastic action outcomes). This is a gift: zero model uncertainty in Powell's sense (principle 7).

---

## 6. Objective and goal predicate

### 6.1 Goal predicate

Define the in-scope target sets (those reachable without paragon or karma):

- $\mathcal{B}^* \subseteq \mathcal{B}$: buildings reachable without paragon/karma. (All buildings except those whose cost row contains paragon. In Kittens Game this is essentially every building — paragon-gated buildings are rare; verify against `buildings.js`, `religion.js`, `space.js`, `time.js`.)
- $\mathcal{T}^* \subseteq \mathcal{T}$: techs reachable without paragon/karma. (Excludes karma-gated cryptotheology entries.)
- $\mathcal{W}^* \subseteq \mathcal{W}$: workshop upgrades reachable without paragon/karma.
- $\mathcal{U}^* \subseteq \mathcal{U}$: religion upgrades reachable without paragon/karma. (Excludes karma-gated transcendence-tier and paragon-gated cryptotheology entries.)
- $\mathcal{P}$: the set of policy slots (government type, knowledge/justice slot, etc.). Each slot is mutually-exclusive over its values.
- $\mathcal{V}^{\text{pact}}$: the set of civilizations with a tiered pact mechanic (leviathans at minimum; verify the rest). Let $\bar{m}_v$ be the maximum non-paragon/karma pact tier for civ $v$.

The completionist goal:

$$
\begin{aligned}
G(S_t) := \;& [\forall b \in \mathcal{B}^*\!:\, R^{\text{bld}}_{t,b} \geq 1] \\
\land\;& [\forall \tau \in \mathcal{T}^*\!:\, I^{\text{tech}}_{t,\tau} = 1] \\
\land\;& [\forall w \in \mathcal{W}^*\!:\, I^{\text{ws}}_{t,w} = 1] \\
\land\;& [\forall u \in \mathcal{U}^*\!:\, I^{\text{rel}}_{t,u} = 1] \\
\land\;& [\forall p \in \mathcal{P}\!:\, I^{\text{pol}}_{t,p} \neq \text{none}] \\
\land\;& [\forall v \in \mathcal{V}^{\text{pact}}\!:\, \text{pact-tier}_{t,v} \geq \bar{m}_v].
\end{aligned}
$$

A few interpretive points worth being explicit about:

**The building condition is $\geq 1$, not $= 1$.** The autoplayer will build many catnip fields, mines, libraries, calciners, etc., during the run — that's how late-tech costs get paid. The goal predicate only says: *each kind of building has been constructed at least once*. There is no demolition phase at the end. This is the natural interpretation of "build only 1 of each, but stay sensible."

**Policies are mutually exclusive within a slot.** You picked the right framing — "all upgrades and techs unlocked" can't apply to policies, because picking monarchy excludes republic. The condition becomes: every policy slot has *some* value selected. The autoplayer chooses *which* value per slot as part of its strategy; that choice affects production multipliers and is therefore a real optimization variable, not just a goal-checkbox.

**Apocrypha / faith / leader rank are not in the goal.** These are unbounded scalar accumulators; requiring them to hit some level would be arbitrary. The autoplayer will accumulate as much as is *useful* for paying for $\mathcal{U}^*$ and for boosting production, and no more. Same logic for embassy counts and starchart stockpile.

**Discovery of all civilizations is implied.** Reaching max pact with leviathans requires having discovered them, which requires sufficient nautical/navigation tech. Discovery is therefore a sub-goal forced by the pact condition — no separate clause needed.

### 6.2 Stopping time and objective

$$T_{\text{goal}}(\pi, \omega) := \min\{t \;:\; G(S_t) = \text{true}\}$$

where $\omega$ is the realized exogenous trajectory $(W_1, W_2, \ldots)$.

Since the user wants a final-reward formulation, the contribution per step is

$$C(S_t, x_t, W_{t+1}) = \Delta t_{t+1}$$

and the objective is

$$\pi^* \in \arg\min_\pi \mathbb{E}\!\left[\sum_{t=0}^{T_{\text{goal}}-1} C(S_t, x_t, W_{t+1}) \;\Big|\; S_0\right] = \arg\min_\pi \mathbb{E}[\tau_{T_{\text{goal}}}].$$

Equivalently: minimize expected wall-clock time to goal. The expectation is over $W_{1:\infty}$.

### 6.3 Why expected (and not worst-case) time

For an autoplayer running once, expected time and median time are reasonable proxies for each other — variance is moderate because most stochasticity is small-magnitude. If you want robustness (a guarantee with high probability), you can swap to a quantile objective $\arg\min_\pi \text{VaR}_{0.9}(T_{\text{goal}})$ without changing any of the modeling above; only the solver criterion changes. Powell's framework accommodates risk measures cleanly.

---

## 7. Implementation notes and progressive activation

A few observations that make the model implementable:

**State as a typed record.** Every substate above maps to a struct/dataclass field. The full state record will have on the order of a few hundred fields (most of which are bits or small integers). This is large but flat and serializable. A run history is a sequence of such records plus actions.

**Constraints as predicates.** Each action class gets a feasibility function `feasible_<class>(S, payload) -> bool` and a cost-deduction function. The full feasibility check is a dispatch on action class. This keeps the unlock structure (Powell's "constraint on $\mathcal{X}_t$" framing) localized.

**Transition as a pure function.** `S_next, W_next = transition(S, x, rng)` where `rng` is the source of randomness. Determinism modulo `rng` makes testing and lookahead-rollouts trivial — clone the state, advance, evaluate, throw away.

**Progressive activation comes for free.** Because the state is typed top-down, early game has most fields at zero. The feasibility predicates automatically rule out actions on locked items. There is no `if phase == "industrial"` anywhere; phase is implicit in which bits are set. This means the same code path runs from year 1 to year 5000.

**Two things to verify against the source code:**
1. The exact list of religion structures, chronoforge buildings, and voidspace buildings — I've left placeholder names in §2.1.2 where I'm not 100% sure. The github repo's `js/buildings.js`, `js/religion.js`, `js/space.js`, `js/time.js` contain the definitive lists.
2. The exact formula for skill accumulation $\sigma(J_{t,j})$ and the per-job multipliers $\nu_{j,r}$ — I've left these as known functions to be looked up in `js/village.js`.

**Goal-induced solver consequence.** The completionist goal forces the autoplayer to pick up *every* in-scope item, including ones that are useless for further progression (e.g., a late-game workshop upgrade that buffs catnip when you no longer have a catnip bottleneck). A pure shortest-path-to-the-deepest-tech solver would skip these. Two clean ways to handle it in the solver layer:

1. **Two-phase planning.** Phase A: rush the critical path that unlocks every $b/\tau/w/u$ as a *possibility*. Phase B: a mop-up phase that buys the now-unlocked-but-unbought leftovers in cheapest-first order. The transition between phases is automatic — Phase B begins when the only remaining goal-clauses are buyable from the current state.
2. **Single-phase scoring with a completion bonus.** The CFA scoring function awards a fixed bonus to any action that flips a goal-clause from false to true. Tune the bonus high enough that the autoplayer never voluntarily skips a goal item, but not so high that it derails efficient critical-path traversal.

The two-phase decomposition is conceptually cleaner and easier to debug; the single-phase scoring may produce slightly faster runs if the leftovers can be bought opportunistically along the critical path. Worth implementing the two-phase first and only revisiting if the mop-up phase turns out to be a meaningful fraction of total time.

---

## 8. Summary

$S_t = (R_t, I_t, B_t)$ with $R_t$ holding resources, buildings, kittens, and embassies; $I_t$ holding the calendar, weather, tech/upgrade/policy bitsets, religion accumulators, diplomacy state, and various cached derived quantities; $B_t$ empty. $x_t$ is a tagged union over $\sim$20 action classes with state-dependent feasibility. $W_{t+1}$ is a sparse record of time advance and a few stochastic outcomes from known distributions. $S^M$ is the engine — apply action, apply exogenous, integrate flows over $\Delta t$. The objective is expected wall-clock time to a completionist goal predicate $G$ that requires $\geq 1$ of every non-paragon/karma building, every reachable tech / workshop / religion bit, a value selected in every policy slot, and max tier in every pact.

Once this is implemented faithfully, the policy class question (PFA vs. CFA vs. VFA vs. DLA, or hybrid) becomes a separate, *solver*-side concern that does not require touching this model.

---

## Appendix A — Catnip per-tick flow (source-of-truth notes)

Authoritative formula in `kittensgame-master/js/game.js:3174-3344` (`calcResourcePerTick`). Tick rate = 5/sec (`game.js:1892`).

**Production sources**
- `catnipField`: 0.125/tick base (`buildings.js:328`).
- Farmer job: 1.0/tick base (`village.js:32`), modulated by skill (`village.js:1089-1117`), happiness (`village.js:538`), and leader bonus when leader.job=farmer (`village.js:532, 637-642`).

**Consumption**
- Per-kitten base: 0.85/tick (`village.js:9, 653`).
- Pasture/aqueduct/unicorn-pasture/hydroponics apply `catnipDemandRatio` (negative) **multiplicatively** to consumption: `consumption *= (1 + sum_demandRatio)` (`game.js:3314`). Per-unit values: pasture −0.005 (`buildings.js:349`), unicorn pasture −0.0015 (`buildings.js:1956`).
- When happiness > 1, an extra consumption term fires: `consumption += consumption × max(happiness × (1+hapinnessConsumptionRatio) − 1, 0) × (1 + catnipDemandWorkerRatioGlobal) × (1 − freeKittens/totalKittens)` (`game.js:3315-3322`). Anarchy challenge omits the freeKittens carve-out.

**Multiplier stack (multiplicative across categories, additive within)**
- Season × weather (`calendar.js:1095-1118`): spring 1.5, summer 1.0, autumn 1.0, winter 0.25; cold −0.15, warm +0.15 added to season.
- Catnip-specific ratios stacked multiplicatively in order: `catnipGlobalRatio`, `catnipRatio`, `catnipRatioReligion`, `catnipSuperRatio`, `steamworksCatnipRatioGlobal`, paragon production ratio, `catnipPollutionRatio`, solar revolution, CMBR, festival (numeromancy perk only), pyramid global, `catnipPolicyRatio`. See `game.js:3193-3326`.

**Practical implication for our `netFlow(s)`**
- We do NOT re-derive the multiplier stack. We snapshot `gamePage.getResourcePerTick(name, true)` directly into `state.info.flow.perTick`, then back out catnip consumption with the formula above so we can rescale production by `seasonalFactor` to project to a different season. Consumption is season-independent so it is preserved across projections. Source: `src/simulator/extract.ts`, `src/model/flow.ts`.

**Worst-case season for the guard**: `winter × cold = 0.25 × (1 − 0.15) = 0.2125`.