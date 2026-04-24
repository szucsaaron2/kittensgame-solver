    // =========================================================================
    //  [CHAIN] BACKWARD-CHAIN FROM TERMINAL GOAL → CURRENT STATE
    //  Walks the AND-OR edge graph built in 06_edges.js:
    //    - AND: every node's own cost + its prereqs must be satisfied
    //    - OR : `unlockedBy` gives multiple candidate sources for a
    //           locked-prereq node; we pick the one with the smallest
    //           expanded subtree (cheapest chain by count) for the "picked"
    //           path, but retain all options for display.
    //  Output = tree rooted at the goal + flat frontier of actionable leaves.
    //  Actionable = state in {ready, locked-cost, locked-ui}.  Everything
    //  deeper is either `done` (already satisfied) or a cycle stub.
    // =========================================================================

    // entry shape:
    //   { id, state, done?, cycle?, options?: [id], picked?: id,
    //     children: [id]  // AND-children actually walked for frontier }

    // True if the game's workshop has an unlocked craft recipe producing resName.
    function _isCraftableResource(game, resName) {
        if (!game || !game.workshop || !game.workshop.crafts) return false;
        var crafts = game.workshop.crafts;
        for (var i = 0; i < crafts.length; i++) {
            if (crafts[i].name === resName && crafts[i].unlocked) return true;
        }
        return false;
    }

    // Return {inputs, outputAmt} for an unlocked craft producing resName, or null.
    function _craftRecipeFor(game, resName) {
        if (!game || !game.workshop || !game.workshop.crafts) return null;
        var crafts = game.workshop.crafts;
        for (var i = 0; i < crafts.length; i++) {
            var c = crafts[i];
            if (c.name !== resName || !c.unlocked) continue;
            var inputs = null;
            try { inputs = game.workshop.getCraftPrice(c); } catch (e) { }
            if (!inputs) inputs = c.prices || [];
            var ratio = 0;
            try { ratio = game.getResCraftRatio({ name: c.name }) || 0; } catch (e) { }
            var amt = 1 + (c.ignoreBonuses ? 0 : ratio);
            return { inputs: inputs, outputAmt: amt };
        }
        return null;
    }

    // Walk a cost array and accumulate *prod-limited* helper node ids —
    // producers we should consider building/unlocking.  A cost entry blocks
    // if: (stockpile insufficient) AND (no production rate) AND (not
    // craftable).  If craftable, recurse into the scaled input cost so
    // transitive blocks surface too (e.g. warehouse→slab→minerals).
    function _gatherProdHelpers(game, eg, cost, helpers, seen) {
        if (!cost) return;
        for (var ci = 0; ci < cost.length; ci++) {
            var p = cost[ci];
            if (seen[p.name]) continue;
            seen[p.name] = true;
            var r = game.resPool.get(p.name);
            if (!r) continue;
            if ((r.value || 0) >= p.val) continue;
            var recipe = _craftRecipeFor(game, p.name);
            if (recipe) {
                var perUnit = recipe.outputAmt || 1;
                var deficit = p.val - (r.value || 0);
                var batches = Math.max(1, Math.ceil(deficit / perUnit));
                var scaled = [];
                for (var k = 0; k < recipe.inputs.length; k++) {
                    scaled.push({ name: recipe.inputs[k].name, val: recipe.inputs[k].val * batches });
                }
                _gatherProdHelpers(game, eg, scaled, helpers, seen);
            } else if ((r.perTickCached || 0) <= 0) {
                var producers = (eg.producersOf && eg.producersOf[p.name]) || [];
                for (var pi2 = 0; pi2 < producers.length; pi2++) {
                    var pid = producers[pi2];
                    var pNode = eg.nodes[pid];
                    if (pNode && pNode.state !== "done"
                        && helpers.indexOf(pid) < 0) {
                        helpers.push(pid);
                    }
                }
            }
        }
    }

    function _chainEntry(id, st, extra) {
        var e = { id: id, state: st, children: [] };
        if (extra) for (var k in extra) e[k] = extra[k];
        return e;
    }

    // Count actionable leaves reachable from an entry.  Walks raw
    // options/andReqs (set in first pass) rather than e.children (which is
    // still being populated during the picker loop).  Uses an in-progress
    // Infinity sentinel so cycles back to self return Inf instead of masking
    // as cheap — critical for goals whose cap-raisers transitively depend on
    // the goal itself (e.g. theology cap-limited by science, observatory
    // raises science cap, observatory needs astronomy, astronomy needs
    // theology).  Also returns Inf for dead-end locked-prereq nodes whose
    // unlocker edges aren't modeled in the graph (race/mission gates).
    function _leafCount(entries, id, memo) {
        if (memo[id] !== undefined) return memo[id];
        memo[id] = Infinity; // in-progress sentinel → cycle ⇒ Infinity
        var e = entries[id];
        if (!e)               { memo[id] = 1;        return 1; }
        if (e.done)           { memo[id] = 0;        return 0; }
        if (e.cycle)          { memo[id] = Infinity; return Infinity; }

        var n;
        var hasCapOrProd = (e.capLimited || e.prodLimited) && e.options && e.options.length;
        if (hasCapOrProd) {
            // Cap/prod-limited actionable leaf: MIN over synthesized helpers.
            n = Infinity;
            for (var i = 0; i < e.options.length; i++) {
                var c = _leafCount(entries, e.options[i], memo);
                if (c < n) n = c;
            }
        } else if (e.state === "ready" || e.state === "locked-cost" || e.state === "locked-ui") {
            // Plain actionable leaf = 1 leaf.
            n = 1;
        } else if (e.state === "locked-prereq") {
            var hasAnd = e.andReqs && e.andReqs.length > 0;
            var hasOr  = e.options && e.options.length > 0;
            if (!hasAnd && !hasOr) {
                n = Infinity; // dead-end: no unlocker modeled
            } else {
                n = 0;
                if (hasAnd) {
                    for (var i = 0; i < e.andReqs.length; i++) {
                        var c = _leafCount(entries, e.andReqs[i], memo);
                        if (c === Infinity) { n = Infinity; break; }
                        n += c;
                    }
                }
                if (n !== Infinity && hasOr) {
                    var best = Infinity;
                    for (var j = 0; j < e.options.length; j++) {
                        var c = _leafCount(entries, e.options[j], memo);
                        if (c < best) best = c;
                    }
                    if (best === Infinity) n = Infinity;
                    else n += best;
                }
            }
        } else {
            n = 1;
        }
        memo[id] = n;
        return n;
    }

    function chainBackward(eg, goalId) {
        if (!eg || !eg.nodes[goalId]) return null;

        var entries = {};
        var visiting = {};    // on current DFS path — for cycle detection

        function expand(id) {
            if (entries[id]) return entries[id];
            if (visiting[id]) return _chainEntry(id, "cycle", { cycle: true });
            var node = eg.nodes[id];
            if (!node) return _chainEntry(id, "missing", { missing: true });

            visiting[id] = true;
            var e;
            if (node.state === "done") {
                e = _chainEntry(id, "done", { done: true });
            } else if (node.state === "ready" || node.state === "locked-cost" || node.state === "locked-ui") {
                // Actionable leaf — cost is this node's own price (or ui-gate).
                var cost = (node.state === "locked-ui") ? node.unlockPrice : node.price;
                // Two limit conditions get decomposed here:
                //   cap-limited: price > maxValue → synthesize capRaisers
                //   prod-limited: not craftable AND rate ≤ 0 → synthesize producers
                // Both are OR-options (any one helps).  We merge into a single
                // `options` list and flag which conditions apply.
                var capRaisers = [];
                var prodHelpers = [];
                if (cost) {
                    // Cap-limited: direct cost only (caps don't compose
                    // through crafts — a craft consumes its inputs, so the
                    // craft output's cap doesn't constrain anything).
                    for (var ci = 0; ci < cost.length; ci++) {
                        var p = cost[ci];
                        var r = game.resPool.get(p.name);
                        if (!r) continue;
                        if (r.maxValue && p.val > r.maxValue) {
                            var raisers = (eg.capRaisersOf && eg.capRaisersOf[p.name]) || [];
                            for (var ri = 0; ri < raisers.length; ri++) {
                                var rNode = eg.nodes[raisers[ri]];
                                if (rNode && rNode.state !== "done"
                                    && raisers[ri] !== id
                                    && capRaisers.indexOf(raisers[ri]) < 0) {
                                    capRaisers.push(raisers[ri]);
                                }
                            }
                        }
                    }
                    // Prod-limited: recurse through craft inputs so a
                    // transitive block surfaces (e.g. warehouse→slab→minerals
                    // — minerals have no rate, so slab can't be crafted, so
                    // warehouse is really blocked on a mineral producer).
                    _gatherProdHelpers(game, eg, cost, prodHelpers, {});
                    // Filter self-reference (a building can't be its own
                    // producer — would collapse to a cycle stub).
                    var filtered = [];
                    for (var fi = 0; fi < prodHelpers.length; fi++) {
                        if (prodHelpers[fi] !== id) filtered.push(prodHelpers[fi]);
                    }
                    prodHelpers = filtered;
                }
                var allOpts = capRaisers.concat(prodHelpers);
                if (allOpts.length > 0) {
                    for (var oi = 0; oi < allOpts.length; oi++) expand(allOpts[oi]);
                    e = _chainEntry(id, node.state, {
                        cost: cost,
                        capLimited:  capRaisers.length > 0,
                        prodLimited: prodHelpers.length > 0,
                        options: allOpts
                    });
                } else {
                    e = _chainEntry(id, node.state, { cost: cost });
                }
            } else if (node.state === "locked-prereq") {
                // Split unlockers: AND = all required, OR = pick one.
                var unlockers = (eg.unlockedBy[id] || []);
                var andIds = [], orIds = [];
                for (var i = 0; i < unlockers.length; i++) {
                    var u = unlockers[i];
                    if (u.mode === "and") andIds.push(u.id); else orIds.push(u.id);
                }
                for (var i = 0; i < andIds.length; i++) expand(andIds[i]);
                for (var i = 0; i < orIds.length; i++) expand(orIds[i]);
                e = _chainEntry(id, "locked-prereq", { andReqs: andIds, options: orIds });
                // `picked` selected in second pass.
            } else {
                e = _chainEntry(id, node.state || "unknown");
            }
            entries[id] = e;
            visiting[id] = false;
            return e;
        }

        expand(goalId);

        // Second pass: for each locked-prereq node:
        //   children = AND-required ids (all) + picked OR option (one).
        //   Pick OR option with smallest subtree (leaf count), tiebreak on depth.
        var leafMemo = {};
        var ids = Object.keys(entries);
        for (var i = 0; i < ids.length; i++) {
            var e = entries[ids[i]];
            if (e.state !== "locked-prereq" && !e.capLimited && !e.prodLimited) continue;
            var kids = (e.andReqs || []).slice();
            if (e.options && e.options.length) {
                var best = null, bestN = Infinity;
                for (var j = 0; j < e.options.length; j++) {
                    var oid = e.options[j];
                    var n = _leafCount(entries, oid, leafMemo);
                    if (n < bestN) { bestN = n; best = oid; }
                }
                e.picked = best;
                if (best) kids.push(best);
            }
            e.children = kids;
        }

        // Collect the frontier: walk via `children`, stopping at actionable or done.
        var frontier = [];
        var seen = {};
        function walk(id) {
            if (seen[id]) return;
            seen[id] = true;
            var e = entries[id]; if (!e) return;
            if (e.done || e.cycle || e.missing) return;
            if (e.state === "ready" || e.state === "locked-cost" || e.state === "locked-ui") {
                // Policies are user-only — surface as nodes but not as auto-actions.
                var node = eg.nodes[id];
                if (node && node.kind === "policy") return;
                // Cap- or prod-limited: descend into raisers/producers
                // instead of surfacing self (self is not yet actionable).
                if (e.capLimited || e.prodLimited) {
                    for (var k = 0; k < e.children.length; k++) walk(e.children[k]);
                    return;
                }
                if (!frontier.some(function (x) { return x === id; })) frontier.push(id);
                return;
            }
            for (var i = 0; i < e.children.length; i++) walk(e.children[i]);
        }
        walk(goalId);

        return { goalId: goalId, entries: entries, frontier: frontier };
    }

    // ── ETA computation ──────────────────────────────────────────────────
    // Recursive time-to-afford a price array.  Handles:
    //   - already-have → 0 on that resource
    //   - craft outputs → recurse on inputs × ceil(needed / outputPerBatch)
    //   - pure production → deficit / rate
    //   - cap-gated (cost > maxValue and not craftable) → Infinity, capLimited
    //   - negative / zero rate and no craft path → Infinity

    function _reserveFor(resName) {
        if (resName === "gold")  return cfg.goldTradeReserve  || 0;
        if (resName === "faith") return cfg.faithPraiseReserve || 0;
        return 0;
    }

    function _findCraftByOutput(outputRes, craftsByOutput) {
        return craftsByOutput[outputRes] || null;
    }

    function _indexCraftsByOutput(scrape, game) {
        var out = {};
        if (!scrape || !scrape.crafts) return out;
        for (var i = 0; i < scrape.crafts.length; i++) {
            var c = scrape.crafts[i];
            if (c.unlocked) out[c.output.name] = c;
        }
        // Synthetic pseudo-crafts for non-workshop conversions.
        if (game) {
            var manpower = game.resPool.get("manpower");
            if (manpower && manpower.unlocked) {
                // Hunt: 100 manpower → ~39 fur (base; bonuses not modeled).
                out["fur"] = out["fur"] || {
                    name: "_hunt_fur",
                    inputs: [{ name: "manpower", val: 100 }],
                    output: { name: "fur", amt: 39 },
                    unlocked: true,
                    synthetic: true
                };
            }
        }
        return out;
    }

    function timeToAfford(game, cost, craftsByOutput, seen) {
        if (!cost || cost.length === 0) return { secs: 0, capLimited: false };
        seen = seen || {};
        var tps = game.ticksPerSecond || 5;
        var total = 0;
        var capLimited = false;

        for (var i = 0; i < cost.length; i++) {
            var p = cost[i];
            var res = game.resPool.get(p.name);
            if (!res) return { secs: Infinity, capLimited: false };
            var reserve = _reserveFor(p.name);
            var have = Math.max(0, res.value - reserve);
            var deficit = p.val - have;
            if (deficit <= 0) continue;

            var craft = _findCraftByOutput(p.name, craftsByOutput);
            var craftSecs = Infinity;
            if (craft && !seen[p.name]) {
                var perUnit = craft.output.amt || 1;
                var batches = Math.ceil(deficit / perUnit);
                var nextSeen = {}; for (var k in seen) nextSeen[k] = seen[k];
                nextSeen[p.name] = true;
                var perBatch = timeToAfford(game, craft.inputs, craftsByOutput, nextSeen);
                if (!perBatch.capLimited && perBatch.secs !== Infinity) {
                    craftSecs = batches * perBatch.secs;
                }
            }

            // Direct-save path: need cap ≥ deficit (or already enough — handled above)
            var prodSecs = Infinity;
            var rate = (res.perTickCached || 0) * tps;
            var capOk = !res.maxValue || res.maxValue >= p.val || res.maxValue === 0;
            if (rate > 0 && capOk) {
                prodSecs = deficit / rate;
            } else if (!capOk && craft === null) {
                // Cap-limited with no craft fallback.
                capLimited = true;
            }

            var thisSecs = Math.min(craftSecs, prodSecs);
            if (thisSecs === Infinity) return { secs: Infinity, capLimited: capLimited };
            if (thisSecs > total) total = thisSecs;
        }
        return { secs: total, capLimited: capLimited };
    }

    // Annotate frontier entries with ETA.  Mutates chain.
    function annotateChainETA(game, scrape, chain) {
        if (!chain) return chain;
        var idx = _indexCraftsByOutput(scrape, game);
        for (var i = 0; i < chain.frontier.length; i++) {
            var e = chain.entries[chain.frontier[i]];
            var eta = timeToAfford(game, e.cost || [], idx);
            e.etaSecs     = eta.secs;
            e.capLimited  = eta.capLimited;
        }
        // Pick "next action": among AND-siblings pick longest ETA (bottleneck);
        // among pure OR survivors pick shortest.  For now single-pass flat:
        //   if frontier has ≥2, prefer longest finite ETA as bottleneck;
        //   ties broken by shortest; `∞ capLimited` pushed to end.
        var best = null;
        var bestSecs = -1;
        for (var i = 0; i < chain.frontier.length; i++) {
            var e = chain.entries[chain.frontier[i]];
            if (e.etaSecs === Infinity) continue;
            if (e.etaSecs > bestSecs) { bestSecs = e.etaSecs; best = e.id; }
        }
        // If everything is Infinity, pick a policy-excluded first finite; else first.
        if (!best && chain.frontier.length > 0) best = chain.frontier[0];
        chain.recommended = best;
        return chain;
    }

    // ── renderer ─────────────────────────────────────────────────────────
    function _fmtChainPrices(p) {
        if (!p || p.length === 0) return "—";
        return p.map(function (x) { return _r(x.val, 2) + " " + x.name; }).join(", ");
    }

    function dumpChainText(eg, chain) {
        if (!chain) return "(no chain — set a terminal goal first)";
        var lines = [];
        function W(s) { lines.push(s); }

        W("=== BACKWARD CHAIN ===");
        W("goal: " + chain.goalId);
        W("");

        var rendered = {};
        function tagFor(e) {
            if (e.done)       return "[done]";
            if (e.cycle)      return "[cycle]";
            if (e.state === "ready")         return "[READY]";
            if (e.state === "locked-cost")   return "[cost: " + _fmtChainPrices(e.cost) + (e.capLimited ? " | cap-limited" : "") + (e.prodLimited ? " | prod-limited" : "") + "]";
            if (e.state === "locked-ui")     return "[ui-gate: " + _fmtChainPrices(e.cost) + (e.capLimited ? " | cap-limited" : "") + (e.prodLimited ? " | prod-limited" : "") + "]";
            if (e.state === "locked-prereq") {
                var a = (e.andReqs && e.andReqs.length) || 0;
                var o = (e.options && e.options.length) || 0;
                return "[and " + a + " / or " + o + "]";
            }
            return "[" + e.state + "]";
        }
        // prefix = ancestor-column text (pure indent/bars, no current-level marker).
        // connector = this-line's branch marker ("", "├── ", "└── ").
        // kindMark = "&" (and-required), "✓" (picked-or), "·" (alt-or), or "".
        function render(id, prefix, connector, kindMark) {
            var e = chain.entries[id];
            if (!e) { W(prefix + connector + id + " [missing]"); return; }
            var km = kindMark ? kindMark + " " : "";
            var dup = rendered[id] ? " …" : "";
            W(prefix + connector + km + id + " " + tagFor(e) + dup);
            if (rendered[id]) return;
            rendered[id] = true;
            if (e.done || e.cycle) return;

            var extend;
            if (connector === "")          extend = "";
            else if (connector === "└── ") extend = "    ";
            else                           extend = "│   ";
            var childPrefix = prefix + extend;

            var kids = [];
            if (e.andReqs) for (var i = 0; i < e.andReqs.length; i++) kids.push({ id: e.andReqs[i], mark: "&" });
            if (e.options) for (var i = 0; i < e.options.length; i++) {
                kids.push({ id: e.options[i], mark: (e.options[i] === e.picked) ? "✓" : "·" });
            }
            if (kids.length === 0 && e.children) {
                for (var i = 0; i < e.children.length; i++) kids.push({ id: e.children[i], mark: "" });
            }
            for (var i = 0; i < kids.length; i++) {
                var last = (i === kids.length - 1);
                render(kids[i].id, childPrefix, last ? "└── " : "├── ", kids[i].mark);
            }
        }
        render(chain.goalId, "  ", "", "");

        W("");
        W("FRONTIER (" + chain.frontier.length + ")");
        function _fmtEta(secs, capLimited) {
            if (capLimited) return "∞ cap-limited";
            if (secs === Infinity || secs !== secs) return "∞";
            if (secs < 60)   return secs.toFixed(0) + "s";
            if (secs < 3600) return (secs / 60).toFixed(1) + "m";
            return (secs / 3600).toFixed(1) + "h";
        }
        for (var i = 0; i < chain.frontier.length; i++) {
            var e = chain.entries[chain.frontier[i]];
            var t = (e.state === "ready") ? "READY" :
                    (e.state === "locked-cost") ? "cost: " + _fmtChainPrices(e.cost) :
                    (e.state === "locked-ui") ? "ui-gate: " + _fmtChainPrices(e.cost) : e.state;
            var etaStr = (e.etaSecs !== undefined) ? "  ETA: " + _fmtEta(e.etaSecs, e.capLimited) : "";
            var mark = (chain.recommended === e.id) ? " ← next" : "";
            W("  " + _pad(e.id, 32) + "  " + t + etaStr + mark);
        }
        W("");
        return lines.join("\n");
    }

    function dumpChain() {
        if (typeof gamePage === "undefined" || !gamePage.bld) {
            console.warn("[chain] gamePage not ready"); return;
        }
        var goalId = getTerminalGoal();
        if (!goalId) { console.warn("[chain] no terminal goal set"); return; }
        var scrape = scrapeGraph(gamePage);
        var eg = buildEdgeGraph(gamePage, scrape);
        if (!eg.nodes[goalId]) { console.warn("[chain] goal id not found: " + goalId); return; }
        var chain = chainBackward(eg, goalId);
        annotateChainETA(gamePage, scrape, chain);
        var txt = dumpChainText(eg, chain);
        console.log(txt);
        return txt;
    }

    // ── runway safety ────────────────────────────────────────────────────
    // Checks whether executing `node` (a BUILD or SPACE_BUILDING) would push a
    // foundation resource into negative production.  Two cases:
    //   1. Direct consumer drain: effect `{R}PerTickCon` < 0 that makes the
    //      post-build rate negative (old planner's check).
    //   2. Kitten-slot housing: buildings with `maxKittens` effect (hut,
    //      mansion, logHouse) spawn new kittens who consume catnip.  Require
    //      ~0.85/sec of catnip headroom per additional slot.
    // Returns null if safe, or { res, reason } if unsafe.
    function _runwayCheck(game, node) {
        if (!node || (node.kind !== "bld" && node.kind !== "space_bld")) return null;
        var meta = null;
        if (node.kind === "bld" && game.bld && game.bld.get) {
            meta = game.bld.get(node.name);
        } else if (node.kind === "space_bld" && game.space && game.space.planets) {
            for (var pi = 0; pi < game.space.planets.length; pi++) {
                var bs = game.space.planets[pi].buildings || [];
                for (var bi = 0; bi < bs.length; bi++) {
                    if (bs[bi].name === node.name) { meta = bs[bi]; break; }
                }
                if (meta) break;
            }
        }
        if (!meta) return null;
        var eff = meta.effects;
        if (meta.stages && meta.stages.length > 0) {
            var st = meta.stages[meta.stage || 0];
            if (st && st.effects) eff = st.effects;
        }
        if (!eff) return null;
        var tps = game.ticksPerSecond || 5;

        // (1) Direct consumer drain.
        var runwayRes = ["catnip", "wood", "minerals"];
        for (var i = 0; i < runwayRes.length; i++) {
            var rn = runwayRes[i];
            var drain = eff[rn + "PerTickCon"] || 0;
            if (drain >= 0) continue;
            var rr = game.resPool.get(rn);
            if (!rr) continue;
            if ((rr.perTickCached || 0) + drain < 0) {
                return { res: rn, reason: rn + " drain would go negative" };
            }
        }

        // (2) Kitten-slot housing check.  maxKittens effect → new kitten worth
        // of catnip consumption must already be covered by current margin.
        var raisesKittens = (eff.maxKittens || 0) > 0;
        if (raisesKittens) {
            var catnip = game.resPool.get("catnip");
            var marginPerKittenPerTick = 0.85 / tps;  // ~0.85/sec per kitten
            if (catnip && (catnip.perTickCached || 0) < marginPerKittenPerTick) {
                return { res: "catnip", reason: "catnip margin insufficient for new kitten" };
            }
        }
        return null;
    }

    // When the recommended producer is a `job` node but no free kittens exist,
    // we need more population first.  Scan bld for unlocked housing (buildings
    // with `maxKittens` effect); return the earliest-listed not-done one
    // (typically hut → logHouse → mansion).  Returns chain-node id or null.
    function _findHousingProducer(game, eg) {
        // Try all bld nodes in eg; pick first unlocked one whose game meta
        // has maxKittens > 0.  Order: hut, logHouse, mansion.
        var preferred = ["hut", "logHouse", "mansion"];
        for (var i = 0; i < preferred.length; i++) {
            var nm = preferred[i];
            var nid = "bld:" + nm;
            var nn = eg.nodes[nid];
            if (!nn || nn.state === "done" || nn.state === "missing") continue;
            var b = game.bld && game.bld.get && game.bld.get(nm);
            if (!b || !b.unlocked) continue;
            var eff = b.effects;
            if (b.stages && b.stages.length > 0) {
                var st = b.stages[b.stage || 0];
                if (st && st.effects) eff = st.effects;
            }
            if (!eff || !(eff.maxKittens > 0)) continue;
            return nid;
        }
        return null;
    }

    // Pick the best producer of `res` from a list of producer node ids.
    // Preference: smallest chain leaf-count (cheapest), tie-break by ETA, then
    // by whether it's already ready.  Returns node id or null.
    function _pickBestProducer(game, scrape, eg, producerIds) {
        var bestId = null, bestScore = Infinity;
        for (var i = 0; i < producerIds.length; i++) {
            var pid = producerIds[i];
            var pnode = eg.nodes[pid];
            if (!pnode) continue;
            if (pnode.state === "done") continue;
            var sub = chainBackward(eg, pid);
            if (!sub) continue;
            annotateChainETA(game, scrape, sub);
            var subEntry = sub.entries[sub.recommended];
            if (!subEntry) continue;
            var eta = (subEntry.etaSecs === undefined) ? Infinity : subEntry.etaSecs;
            if (eta < bestScore) { bestScore = eta; bestId = pid; }
        }
        return bestId;
    }

    // ── planner entry ────────────────────────────────────────────────────
    // Map a chain-graph node to an executable action.  Returns null for
    // node kinds that aren't auto-executable (policy / race / job / tab).
    function nodeToAction(node) {
        if (!node) return null;
        switch (node.kind) {
            case "bld":        return createAction(ActionType.BUILD, node.name);
            case "tech":       return createAction(ActionType.RESEARCH, node.name);
            case "ws_upg":     return createAction(ActionType.WORKSHOP_UPGRADE, node.name);
            case "rel_upg_ru": return createAction(ActionType.RELIGION_UPGRADE, node.name, { subtype: "ru" });
            case "rel_upg_zu": return createAction(ActionType.RELIGION_UPGRADE, node.name, { subtype: "zu" });
            case "rel_upg_tu": return createAction(ActionType.RELIGION_UPGRADE, node.name, { subtype: "tu" });
            case "mission":    return createAction(ActionType.SPACE_MISSION, node.name);
            case "space_bld":  return createAction(ActionType.SPACE_BUILDING, node.name);
            case "embassy":    return createAction(ActionType.EMBASSY, node.name);
            case "craft":      return createAction(ActionType.CRAFT, node.name, { amount: 1 });
            default:           return null;  // policy / race / job / tab — user-only
        }
    }

    // Orchestrator entry.  Returns one of:
    //   { kind: "no-goal" }                          — no cfg.terminalGoal set
    //   { kind: "unknown-goal", goalId }             — goal id not in graph
    //   { kind: "done",     goalId, node, chain }    — goal is already "done"
    //   { kind: "blocked",  goalId, chain, reason }  — frontier empty or all ∞
    //   { kind: "recommend", goalId, node, entry, chain, action, etaSecs }
    function planNextAction(game) {
        var goalId = (typeof getTerminalGoal === "function") ? getTerminalGoal() : null;
        if (!goalId) return { kind: "no-goal" };

        var scrape = scrapeGraph(game);
        var eg = buildEdgeGraph(game, scrape);
        var node = eg.nodes[goalId];
        if (!node) return { kind: "unknown-goal", goalId: goalId };

        if (node.state === "done") return { kind: "done", goalId: goalId, node: node };

        var chain = chainBackward(eg, goalId);
        annotateChainETA(game, scrape, chain);

        if (!chain || !chain.recommended) {
            return { kind: "blocked", goalId: goalId, chain: chain, reason: "no frontier" };
        }
        var entry = chain.entries[chain.recommended];
        var recNode = eg.nodes[chain.recommended];
        var safetyNote = null;

        // Job-producer redirect: `job:X` is user-only (nothing to build), but
        // producing anything via a job requires a free kitten.  If none exist,
        // route to a housing building so population grows first.
        if (recNode && recNode.kind === "job") {
            var free = (game.village && game.village.getFreeKittens)
                ? game.village.getFreeKittens() : 0;
            if (free <= 0) {
                var houseId = _findHousingProducer(game, eg);
                if (houseId) {
                    chain = chainBackward(eg, houseId);
                    annotateChainETA(game, scrape, chain);
                    if (chain.recommended) {
                        entry = chain.entries[chain.recommended];
                        recNode = eg.nodes[chain.recommended];
                        safetyNote = "population: routing via " + houseId;
                    }
                }
            }
        }

        // Runway safety: if the recommended build is unsafe, swap to a
        // producer of the threatened resource.  One redirect step only.
        var unsafe = _runwayCheck(game, recNode);
        if (unsafe) {
            var producerIds = (eg.producersOf && eg.producersOf[unsafe.res]) || [];
            var swapId = _pickBestProducer(game, scrape, eg, producerIds);
            if (!swapId) {
                return {
                    kind: "blocked", goalId: goalId, chain: chain,
                    reason: "unsafe (" + unsafe.reason + ") and no producer of " + unsafe.res
                };
            }
            chain = chainBackward(eg, swapId);
            annotateChainETA(game, scrape, chain);
            if (!chain.recommended) {
                return {
                    kind: "blocked", goalId: goalId, chain: chain,
                    reason: "producer " + swapId + " has no frontier"
                };
            }
            entry = chain.entries[chain.recommended];
            recNode = eg.nodes[chain.recommended];
            safetyNote = unsafe.res + " safety: routing via " + swapId;
        }

        var action = nodeToAction(recNode);
        if (!action) {
            return {
                kind: "blocked", goalId: goalId, chain: chain,
                reason: "frontier is user-only (" + (recNode ? recNode.kind : "?") + " " + chain.recommended + ")"
            };
        }
        return {
            kind: "recommend", goalId: goalId,
            node: recNode, entry: entry, chain: chain,
            action: action, etaSecs: entry ? entry.etaSecs : Infinity,
            safetyNote: safetyNote
        };
    }

    if (typeof window !== "undefined") {
        window.__chainBackward = function () {
            var goalId = getTerminalGoal(); if (!goalId) return null;
            var scrape = scrapeGraph(gamePage);
            var eg = buildEdgeGraph(gamePage, scrape);
            var chain = chainBackward(eg, goalId);
            annotateChainETA(gamePage, scrape, chain);
            return chain;
        };
        window.__dumpChain = dumpChain;
    }
