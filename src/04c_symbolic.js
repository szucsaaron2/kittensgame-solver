    // =========================================================================
    //  [G3] ALGEBRAIC STATE — closed-form state transitions for beam search
    //
    //  A plain-data snapshot of {resources, rates, caps, unlocks, tps} that
    //  supports arithmetic state transitions without running the game tick loop.
    //
    //  RATES are stored in per-SECOND units: perTickCached × ticksPerSecond.
    //  RATIO provides are applied multiplicatively to current rate (first-order
    //  approx: new_rate = old_rate × (1 + delta_ratio), accurate within ~5%
    //  for typical mid-game stacking).
    //
    //  perUnitProvides (added to building nodes in 06_edges.js) gives the
    //  MARGINAL effect of ONE additional building, not the total for val copies.
    // =========================================================================

    // ── Snapshot ─────────────────────────────────────────────────────────────
    // KG constants — keep in sync with 05_graph.js.
    var _KITTEN_BIRTH_PER_TICK = 0.01;  // base birth/tick when catnip rate > 0
    var _CATNIP_PER_KITTEN_PER_TICK = 0.85;  // kitten appetite/tick

    function snapshotAlgebraicState(game, eg) {
        var tps = game.ticksPerSecond || 5;
        var resources = {}, rates = {}, caps = {}, unlocks = {};

        var resList = game.resPool.resources;
        for (var i = 0; i < resList.length; i++) {
            var r = resList[i];
            resources[r.name] = r.value   || 0;
            rates[r.name]     = (r.perTickCached || 0) * tps;
            caps[r.name]      = r.maxValue || 0;
        }

        if (eg) {
            var ids = Object.keys(eg.nodes);
            for (var j = 0; j < ids.length; j++) {
                if (eg.nodes[ids[j]].state === 'done') unlocks[ids[j]] = true;
            }
        }

        // Population snapshot.  Kittens aren't a resPool resource — they live
        // in game.village.sim.  rates.catnip already includes CURRENT kittens'
        // appetite via perTickCached, so we only need to subtract NEW kittens'
        // appetite when symbolic time-advance spawns more.
        var village = game.village || {};
        var sim     = village.sim || {};
        var kittens = (sim.kittens && sim.kittens.length) || 0;
        var free    = (typeof village.getFreeKittens === 'function')
                      ? village.getFreeKittens()
                      : 0;
        var assignments = {};
        var jobsArr = village.jobs || [];
        for (var ji = 0; ji < jobsArr.length; ji++) {
            assignments[jobsArr[ji].name] = jobsArr[ji].value || 0;
        }
        var pop = {
            kittens:         kittens,
            maxKittens:      village.maxKittens || 0,
            free:            free,
            happiness:       village.happiness || 1,
            assignments:     assignments,
            birthRatePerSec: _KITTEN_BIRTH_PER_TICK * tps,
            catnipPerKittenPerSec: _CATNIP_PER_KITTEN_PER_TICK * tps,
            growthActive:    ((rates.catnip || 0) > 0) && (kittens < (village.maxKittens || 0))
        };

        // Collect per-kitten job modifiers from the edge graph so the beam can
        // compute delta rates when reassigning free kittens.
        var jobMods = {};
        if (eg && eg.nodes) {
            var nids = Object.keys(eg.nodes);
            for (var ni = 0; ni < nids.length; ni++) {
                var n = eg.nodes[nids[ni]];
                if (n.kind === 'job' && n.jobModifiers) jobMods[n.name] = n.jobModifiers;
            }
        }

        return { resources: resources, rates: rates, caps: caps,
                 unlocks: unlocks, elapsed: 0, tps: tps,
                 pop: pop, jobMods: jobMods };
    }

    function _cloneAlgState(s) {
        var popCopy = null;
        if (s.pop) {
            popCopy = Object.assign({}, s.pop);
            popCopy.assignments = Object.assign({}, s.pop.assignments);
        }
        return {
            resources: Object.assign({}, s.resources),
            rates:     Object.assign({}, s.rates),
            caps:      Object.assign({}, s.caps),
            unlocks:   Object.assign({}, s.unlocks),
            elapsed:   s.elapsed,
            tps:       s.tps || 5,
            pop:       popCopy,
            jobMods:   s.jobMods  // shared, immutable
        };
    }

    // ── Analytical ETA in symbolic state ─────────────────────────────────────
    // Mirrors timeToAfford() from 07_chain.js but operates entirely on the
    // algebraic state — no game object access.
    function timeToAffordInState(state, prices, craftsByOutput, seen) {
        if (!prices || prices.length === 0) return { secs: 0, capLimited: false };
        seen = seen || {};
        var total = 0;
        var capLimited = false;

        for (var i = 0; i < prices.length; i++) {
            var p       = prices[i];
            var have    = state.resources[p.name] || 0;
            var rate    = state.rates[p.name]     || 0;
            var cap     = state.caps[p.name]      || 0;
            var deficit = p.val - have;
            if (deficit <= 0) continue;

            var craft = craftsByOutput ? craftsByOutput[p.name] : null;
            var craftSecs = Infinity;
            if (craft && !seen[p.name]) {
                var perUnit  = craft.output.amt || 1;
                var batches  = Math.ceil(deficit / perUnit);
                var nextSeen = Object.assign({}, seen);
                nextSeen[p.name] = true;
                var perBatch = timeToAffordInState(state, craft.inputs, craftsByOutput, nextSeen);
                if (!perBatch.capLimited && perBatch.secs !== Infinity) {
                    craftSecs = batches * perBatch.secs;
                }
            }

            var prodSecs = Infinity;
            var capOk    = (cap <= 0) || (cap >= p.val);
            if (rate > 0 && capOk) {
                prodSecs = deficit / rate;
            } else if (!capOk && !craft) {
                capLimited = true;
            }

            var thisSecs = Math.min(craftSecs, prodSecs);
            if (thisSecs === Infinity) return { secs: Infinity, capLimited: capLimited };
            if (thisSecs > total) total = thisSecs;
        }
        return { secs: total, capLimited: capLimited };
    }

    // ── Symbolic state transition ────────────────────────────────────────────
    // Apply the effect of acquiring `node` to `state`.
    // Uses node.perUnitProvides (marginal: 1 building) for production/storage/ratio.
    // `priceOverride` (optional) lets beam pass a repeat-scaled price; when
    // omitted, the node's standard price/unlockPrice is used.
    // Returns the new state, or null if the node's cost is unreachable.
    function applyActionSymbolic(state, node, craftsByOutput, priceOverride) {
        var cost = priceOverride !== undefined && priceOverride !== null
                   ? priceOverride
                   : ((node.state === 'locked-ui') ? node.unlockPrice : node.price);
        var etaResult = cost ? timeToAffordInState(state, cost, craftsByOutput) : { secs: 0 };
        if (etaResult.secs === Infinity) return null;
        var eta = etaResult.secs;
        var tps = state.tps || 5;

        var next = _cloneAlgState(state);
        next.elapsed += eta;

        // 1. Advance resources by eta at current rates.
        for (var r in next.rates) {
            if (!next.rates[r]) continue;
            var cap  = next.caps[r] || 0;
            var proj = next.resources[r] + next.rates[r] * eta;
            next.resources[r] = (cap > 0) ? Math.min(proj, cap) : proj;
        }

        // 1b. Kitten growth during this interval (Euler, first-order).
        //     Each new kitten adds future catnip drain.  Three caps:
        //       (a) birthRate × eta        — how many could plausibly arrive
        //       (b) maxKittens - kittens   — population cap headroom
        //       (c) catnipRate / drain     — SUSTAINABLE headcount bump.
        //           Without this the beam will happily spawn kittens into a
        //           catnip-deficit state, falsely making huts look productive
        //           even when no fields support the extra mouths.
        if (next.pop && next.pop.growthActive) {
            var drainPerKitten = next.pop.catnipPerKittenPerSec;
            var bornByRate    = next.pop.birthRatePerSec * eta;
            var bornByCap     = next.pop.maxKittens - next.pop.kittens;
            var bornBySustain = drainPerKitten > 0
                                ? Math.max(0, (next.rates.catnip || 0) / drainPerKitten)
                                : Infinity;
            var born = Math.max(0, Math.min(bornByRate, bornByCap, bornBySustain));
            if (born > 0) {
                next.pop.kittens += born;
                next.rates.catnip = (next.rates.catnip || 0) - born * drainPerKitten;

                // Auto-assign newborn kittens proportionally to the current job
                // distribution — mirrors what doAutoJobs will do in reality, so
                // the beam can see population growth translate into rate growth.
                // When no jobs are assigned yet, kittens stay free (no signal).
                var totalAssigned = 0;
                for (var jn in next.pop.assignments) {
                    if (next.pop.assignments.hasOwnProperty(jn))
                        totalAssigned += next.pop.assignments[jn] || 0;
                }
                if (totalAssigned > 0 && next.jobMods) {
                    for (var jn2 in next.pop.assignments) {
                        if (!next.pop.assignments.hasOwnProperty(jn2)) continue;
                        var curCount = next.pop.assignments[jn2] || 0;
                        if (curCount <= 0) continue;
                        var share    = curCount / totalAssigned;
                        var assigned = born * share;
                        var mods2    = next.jobMods[jn2];
                        if (mods2) {
                            for (var res2 in mods2) {
                                if (!mods2.hasOwnProperty(res2)) continue;
                                next.rates[res2] = (next.rates[res2] || 0)
                                                 + mods2[res2] * assigned * tps;
                            }
                        }
                        next.pop.assignments[jn2] = curCount + assigned;
                    }
                } else {
                    next.pop.free += born;
                }

                next.pop.growthActive = (next.rates.catnip > 0)
                                      && (next.pop.kittens < next.pop.maxKittens);
            }
        }

        // 2. Pay cost.
        if (cost) {
            for (var i = 0; i < cost.length; i++) {
                next.resources[cost[i].name] = (next.resources[cost[i].name] || 0) - cost[i].val;
            }
        }

        // 3. Apply marginal provides.
        var prov = node.perUnitProvides || node.provides;

        // 3a. Flat rate additions. _provideEntries stores per-tick values; convert × tps.
        if (prov && prov.resources) {
            for (var i = 0; i < prov.resources.length; i++) {
                var e = prov.resources[i];
                next.rates[e.res] = (next.rates[e.res] || 0) + e.rate * tps;
            }
        }

        // 3b. Storage cap increases.  maxKittens mirrors into pop.maxKittens
        //     so kitten growth sees the new headroom immediately.
        if (prov && prov.storage) {
            for (var i = 0; i < prov.storage.length; i++) {
                var e = prov.storage[i];
                next.caps[e.res] = (next.caps[e.res] || 0) + e.amount;
                if (e.res === 'maxKittens' && next.pop) {
                    next.pop.maxKittens += e.amount;
                    next.pop.growthActive = ((next.rates.catnip || 0) > 0)
                                          && (next.pop.kittens < next.pop.maxKittens);
                }
            }
        }

        // 3c. Ratio multipliers: first-order new_rate = old_rate × (1 + delta).
        if (prov && prov.ratios) {
            for (var i = 0; i < prov.ratios.length; i++) {
                var e = prov.ratios[i];
                if (e.kind === 'ratio') {
                    next.rates[e.res] = (next.rates[e.res] || 0) * (1 + e.amount);
                }
            }
        }

        // 3d. Job reassignment: move ALL currently-free kittens to this job,
        //     delta-add their per-kitten rates.  Matches doAutoJobs semantics
        //     closely enough for ranking.  Existing rates[] reflects current
        //     assignments via perTickCached, so we only add the delta.
        if (node.kind === 'job' && next.pop && next.jobMods) {
            var mods = next.jobMods[node.name];
            var freeK = next.pop.free || 0;
            if (mods && freeK > 0) {
                for (var jr in mods) {
                    if (!mods.hasOwnProperty(jr)) continue;
                    next.rates[jr] = (next.rates[jr] || 0) + mods[jr] * freeK * tps;
                }
                next.pop.assignments[node.name] = (next.pop.assignments[node.name] || 0) + freeK;
                next.pop.free = 0;
            }
        }

        // 4. Mark node and its unlock targets as done in symbolic unlocks.
        next.unlocks[node.id] = true;
        if (node.provides && node.provides.unlocks) {
            for (var i = 0; i < node.provides.unlocks.length; i++) {
                next.unlocks[node.provides.unlocks[i]] = true;
            }
        }

        return next;
    }

    // ── Console test helpers ─────────────────────────────────────────────────
    if (typeof window !== "undefined") {
        window.__snapshotAlgebraicState = function () {
            var eg = (typeof getCachedEdgeGraph === 'function') ? getCachedEdgeGraph(gamePage) : null;
            return snapshotAlgebraicState(gamePage, eg);
        };

        // window.__testTTAS(prices, optState)
        window.__testTTAS = function (prices, state) {
            var s   = state || window.__snapshotAlgebraicState();
            var idx = {};
            try {
                var eg = getCachedEdgeGraph(gamePage);
                var scrape = eg.__scrape || scrapeGraph(gamePage);
                idx = _indexCraftsByOutput(scrape, gamePage);
            } catch (e) {}
            return timeToAffordInState(s, prices, idx);
        };

        // window.__kittensIn(state?) — show pop block of a symbolic state.
        window.__kittensIn = function (state) {
            var s = state || window.__snapshotAlgebraicState();
            if (!s || !s.pop) return '(no pop)';
            var p = s.pop;
            return {
                kittens: p.kittens.toFixed(2) + '/' + p.maxKittens,
                free: p.free.toFixed(2),
                assignments: p.assignments,
                birthPerSec: p.birthRatePerSec,
                growthActive: p.growthActive,
                catnipRate: (s.rates.catnip || 0).toFixed(3) + '/s'
            };
        };

        // window.__applySymbolic('bld:field')
        window.__applySymbolic = function (nodeId) {
            var eg = (typeof getCachedEdgeGraph === 'function') ? getCachedEdgeGraph(gamePage) : null;
            if (!eg) return null;
            var node = eg.nodes[nodeId];
            if (!node) { console.warn('[__applySymbolic] unknown nodeId:', nodeId); return null; }
            var state  = snapshotAlgebraicState(gamePage, eg);
            var scrape = eg.__scrape || scrapeGraph(gamePage);
            var idx    = _indexCraftsByOutput(scrape, gamePage);
            var next   = applyActionSymbolic(state, node, idx);
            if (!next) console.warn('[__applySymbolic] unreachable (Infinity ETA) for', nodeId);
            return next;
        };
    }
