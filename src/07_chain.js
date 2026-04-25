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
            } else {
                // No craft path. Surface producers when rate is non-positive
                // OR when the rate is too low to satisfy this cost in a
                // reasonable horizon — otherwise the chain declares a
                // marginal +0.1/s "solved" and never plans more producers,
                // which is what stalls early-game catnip when one farmer
                // barely covers one kitten's consumption.
                var rate = r.perTickCached || 0;
                var tps = (game && game.ticksPerSecond) || 5;
                var deficit = p.val - (r.value || 0);
                var secsToAfford = (rate > 0) ? (deficit / (rate * tps)) : Infinity;
                var horizonSecs = (cfg && typeof cfg.prodHelperHorizonSecs === 'number')
                    ? cfg.prodHelperHorizonSecs : 600;   // 10 min default
                if (rate <= 0 || secsToAfford > horizonSecs) {
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
    }

    function _chainEntry(id, st, extra) {
        var e = { id: id, state: st, children: [] };
        if (extra) for (var k in extra) e[k] = extra[k];
        return e;
    }

    // Effective fanout = count of this node's unlock targets that aren't
    // already satisfied.  Done targets add no planning value.
    function _effectiveFanout(eg, id) {
        if (!eg || !eg.nodes) return 0;
        var n = eg.nodes[id];
        if (!n || !n.provides || !n.provides.unlocks) return 0;
        var unlocks = n.provides.unlocks;
        var c = 0;
        for (var i = 0; i < unlocks.length; i++) {
            var t = eg.nodes[unlocks[i]];
            if (t && t.state !== "done") c++;
        }
        return c;
    }

    // Discount a leaf-count by the option's fanout so gateways outrank leaves.
    // Floor prevents a single gateway from becoming indistinguishably free,
    // but must be small enough that deep chains don't saturate — at depth N
    // with fanout f each, compounded discount is (1+f)^-N, which for f=5 N=7
    // is ~1e-5.  Floor at 1e-8 lets ~12 fanout-5 levels stay distinguishable.
    // Infinity (cycle / dead-end) passes through untouched.
    function _fanoutScore(n, eg, id) {
        if (n === Infinity) return Infinity;
        var w = (typeof cfg !== "undefined" && typeof cfg.fanoutWeight === "number")
                ? cfg.fanoutWeight : 1.0;
        if (!w) return n;
        var f = _effectiveFanout(eg, id);
        if (!f) return n;
        var discounted = n / (1 + w * f);
        return discounted < 1e-8 ? 1e-8 : discounted;
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
    //
    // `eg` is the edge graph; used only for fanout-weighted OR selection
    // (see _fanoutScore).  Passing null recovers the legacy behavior.
    function _leafCount(entries, id, memo, eg) {
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
            // Fanout discount applies only when there's genuine choice
            // (≥2 helpers).  A forced single helper is effectively AND —
            // discounting it would distort propagated leaf counts for no
            // selection benefit.
            n = Infinity;
            var multi = e.options.length >= 2;
            for (var i = 0; i < e.options.length; i++) {
                var oid = e.options[i];
                var raw = _leafCount(entries, oid, memo, eg);
                var c = multi ? _fanoutScore(raw, eg, oid) : raw;
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
                        var c = _leafCount(entries, e.andReqs[i], memo, eg);
                        if (c === Infinity) { n = Infinity; break; }
                        n += c;
                    }
                }
                if (n !== Infinity && hasOr) {
                    var best = Infinity;
                    var multiOr = e.options.length >= 2;
                    for (var j = 0; j < e.options.length; j++) {
                        var oid = e.options[j];
                        var raw = _leafCount(entries, oid, memo, eg);
                        var c = multiOr ? _fanoutScore(raw, eg, oid) : raw;
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
                        // Cap-limited iff price exceeds storage. maxValue=0
                        // means "no storage exists" — that IS cap-limited
                        // (e.g. science cap at cold start with no library).
                        if (p.val > r.maxValue) {
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
                var multiPick = e.options.length >= 2;
                for (var j = 0; j < e.options.length; j++) {
                    var oid = e.options[j];
                    var raw = _leafCount(entries, oid, leafMemo, eg);
                    var n = multiPick ? _fanoutScore(raw, eg, oid) : raw;
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
        chain.__craftsByOutput = idx;  // reused by beam search without re-indexing
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
    function _runwayCheck(game, node, entry) {
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

        // (2) Kitten-slot housing check.  maxKittens effect → new kittens
        // will spawn and each consumes ~0.85 catnip/sec.  Project current
        // rate AT FULL OCCUPANCY of the new slots: rate must remain non-
        // negative once every new slot is filled.  This catches the
        // "build a hut, two kittens spawn, catnip locks at 0" stall.
        var newSlots = eff.maxKittens || 0;
        if (newSlots > 0) {
            var catnip = game.resPool.get("catnip");
            // Bare per-kitten consumption is ~0.85/sec.  Knife-edge balance
            // (margin == 0.85 × slots) means catnip stays at 0 forever —
            // there's no surplus to pay for further catnip-priced builds, and
            // any seasonal/scholar dip flips the rate negative.  Demand a
            // headroom buffer so post-occupancy production exceeds bare
            // consumption by a multiplier.
            var perKittenPerSec = 0.85;
            var headroom = (cfg && typeof cfg.housingHeadroom === 'number')
                ? cfg.housingHeadroom : 1.25;   // 25% buffer over bare burn
            var requiredPerSec = newSlots * perKittenPerSec * headroom;
            var requiredPerTick = requiredPerSec / tps;
            if (catnip && (catnip.perTickCached || 0) < requiredPerTick) {
                return { res: "catnip", reason:
                    "catnip rate " + ((catnip.perTickCached || 0) * tps).toFixed(2)
                    + "/s insufficient for " + newSlots + " new kitten slot(s) "
                    + "(need ≥" + requiredPerSec.toFixed(2) + "/s with "
                    + headroom + "× headroom)" };
            }
        }

        // (3) Catnip-spend safety.  Any build whose price includes catnip
        // commits us to draining stock at construction time.  If the post-
        // spend stock + rate*horizon would still be ≤ 0, we'll just stall at
        // 0 catnip after building (every kitten at the floor).  Redirect to a
        // catnip producer so production climbs first.
        var spendHorizon = (cfg && typeof cfg.catnipSpendSafetyHorizonSecs === 'number')
            ? cfg.catnipSpendSafetyHorizonSecs : 30;
        if (spendHorizon > 0 && entry && entry.cost) {
            for (var ci = 0; ci < entry.cost.length; ci++) {
                var pe = entry.cost[ci];
                if (pe.name !== "catnip") continue;
                var cres = game.resPool.get("catnip");
                if (!cres) break;
                var stock = cres.value || 0;
                var rateSec = (cres.perTickCached || 0) * tps;
                var afterSpend = stock - pe.val;
                var projected = afterSpend + rateSec * spendHorizon;
                if (projected <= 0) {
                    return { res: "catnip", reason:
                        "post-spend catnip projection ≤ 0 "
                        + "(stock " + stock.toFixed(1)
                        + " − cost " + pe.val.toFixed(1)
                        + " + rate " + rateSec.toFixed(2) + "/s × "
                        + spendHorizon + "s = " + projected.toFixed(1) + ")" };
                }
                break;
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
            // Skip jobs — doAutoJobs handles assignment.  Runway redirects
            // need a NEW production source (a building), not a kitten
            // reshuffle that produces nothing extra.
            if (pnode.kind === "job") continue;
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

    // Cap-horizon guard: when an entry is cap-limited (price exceeds storage
    // and no craft escape exists), find the cheapest cap-raiser by chain-back
    // ETA and return its id. Returns null if no helpful raiser exists.
    function _findCapHorizonRaiser(game, scrape, eg, entry) {
        if (!entry || !entry.cost || !entry.cost.length) return null;
        if (!eg.capRaisersOf) return null;

        var bestId = null, bestEta = Infinity;
        for (var i = 0; i < entry.cost.length; i++) {
            var p = entry.cost[i];
            var res = game.resPool && game.resPool.get(p.name);
            if (!res) continue;
            // Only resources whose cap is the actual blocker.
            if (!res.maxValue || res.maxValue === 0) continue;
            if (res.maxValue >= p.val) continue;

            var raisers = eg.capRaisersOf[p.name] || [];
            for (var j = 0; j < raisers.length; j++) {
                var rid = (typeof raisers[j] === 'string') ? raisers[j] : raisers[j].id;
                var rnode = eg.nodes[rid];
                if (!rnode || rnode.state === 'done') continue;
                if (!_isExecutableKind(rnode.kind)) continue;
                var sub = chainBackward(eg, rid);
                if (!sub) continue;
                annotateChainETA(game, scrape, sub);
                if (!sub.recommended) continue;
                var subEntry = sub.entries[sub.recommended];
                if (!subEntry) continue;
                // Skip raisers that are themselves cap-limited (loop) or out of reach.
                if (subEntry.capLimited) continue;
                var eta = (subEntry.etaSecs === undefined) ? Infinity : subEntry.etaSecs;
                if (eta < bestEta) { bestEta = eta; bestId = rid; }
            }
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
    // ── Goal-aware candidate expansion ────────────────────────────────────────
    // chain.frontier collapses to ~1 item in most Kittens states because OR
    // alternatives pick a single rail. To give beam real work, we expand the
    // candidate set to actionable nodes that *affect* a resource the goal
    // actually needs — producers, cap-raisers, ratio-boosters.

    function _collectGoalResources(chain) {
        var needed = {};
        if (!chain || !chain.entries) return needed;
        for (var id in chain.entries) {
            var e = chain.entries[id];
            if (!e.cost) continue;
            for (var i = 0; i < e.cost.length; i++) needed[e.cost[i].name] = true;
        }
        return needed;
    }

    function _isActionableState(s) {
        return s === 'ready' || s === 'locked-cost' || s === 'locked-ui';
    }
    function _isExecutableKind(k) {
        return k === 'bld' || k === 'tech' || k === 'ws_upg' ||
               k === 'rel_upg_ru' || k === 'rel_upg_zu' || k === 'rel_upg_tu' ||
               k === 'mission' || k === 'space_bld' || k === 'embassy';
    }

    // Returns { relevant: bool, reason: 'producer'|'capRaiser'|'ratioBooster'
    //          |'populationCap'|'populationFuel'|null }.
    // Minimum-magnitude filter drops tiny ratio boosts (<3%) that waste beam slots.
    var MIN_RATIO_MAGNITUDE = 0.03;
    function _nodeGoalRelevance(node, needed, state) {
        var p = node.perUnitProvides;
        if (!p) return { relevant: false };
        var r;
        for (var i = 0; i < p.resources.length; i++) {
            r = p.resources[i];
            if (needed[r.res] && r.rate > 0) return { relevant: true, reason: 'producer' };
        }
        for (var i = 0; i < p.storage.length; i++) {
            r = p.storage[i];
            if (needed[r.res] && r.amount > 0) return { relevant: true, reason: 'capRaiser' };
        }
        for (var i = 0; i < p.ratios.length; i++) {
            r = p.ratios[i];
            // Ratio boosters only help if there's a non-zero rate to multiply.
            // Without this check, a 10% bonus on 0 science still registers
            // as "goal-relevant" and the beam spams libraries in winter when
            // scholars are all reassigned to farming.
            var liveRate = state ? (state.rates[r.res] || 0) : 1;
            if (r.kind === 'ratio' && needed[r.res] &&
                r.amount > MIN_RATIO_MAGNITUDE &&
                liveRate > 0) {
                return { relevant: true, reason: 'ratioBooster' };
            }
        }

        // Transitive relevance through the kitten model: if any needed resource
        // has a per-kitten job modifier, then huts (maxKittens) and catnip
        // producers (fields/pastures) matter — they unblock population growth,
        // which the beam's time advance turns into more workers, which turns
        // into more of the needed resource.
        if (state && state.jobMods) {
            var kittenEnables = false;
            for (var res in needed) {
                if (!needed.hasOwnProperty(res)) continue;
                for (var jobName in state.jobMods) {
                    var mod = state.jobMods[jobName][res];
                    if (mod && mod > 0) { kittenEnables = true; break; }
                }
                if (kittenEnables) break;
            }
            if (kittenEnables) {
                for (var i = 0; i < p.storage.length; i++) {
                    if (p.storage[i].res === 'maxKittens' && p.storage[i].amount > 0) {
                        return { relevant: true, reason: 'populationCap' };
                    }
                }
                for (var i = 0; i < p.resources.length; i++) {
                    if (p.resources[i].res === 'catnip' && p.resources[i].rate > 0) {
                        return { relevant: true, reason: 'populationFuel' };
                    }
                }
            }
        }

        return { relevant: false };
    }

    function collectGoalAwareCandidates(eg, chain, state) {
        var needed = _collectGoalResources(chain);
        var candidates = {};

        // R1 — chain frontier gets priority 0.
        if (chain && chain.frontier) {
            for (var i = 0; i < chain.frontier.length; i++) {
                candidates[chain.frontier[i]] = { priority: 0, reason: 'chain' };
            }
        }

        // R2-R4 — scan edge graph.
        for (var id in eg.nodes) {
            if (candidates[id]) continue;
            var n = eg.nodes[id];
            if (!_isActionableState(n.state) || !_isExecutableKind(n.kind)) continue;
            var rel = _nodeGoalRelevance(n, needed, state);
            if (!rel.relevant) continue;
            var pri = rel.reason === 'producer'      ? 1 :
                      rel.reason === 'capRaiser'     ? 2 :
                      rel.reason === 'populationCap' ? 2 :
                      rel.reason === 'populationFuel'? 3 : 3;
            candidates[id] = { priority: pri, reason: rel.reason };
        }
        return candidates;
    }

    // Prune to top-K actionable now. Chain-priority survives regardless of ETA
    // so the user's goal always gets a seat at the table.
    function pruneCandidates(eg, state, craftsByOutput, candidates, maxK) {
        var scored = [];
        for (var id in candidates) {
            var n = eg.nodes[id];
            if (!n) continue;
            var price = (n.state === 'locked-ui') ? n.unlockPrice : n.price;
            var eta = timeToAffordInState(state, price || [], craftsByOutput);
            if (eta.secs === Infinity) continue;
            scored.push({ id: id, eta: eta.secs, priority: candidates[id].priority,
                          reason: candidates[id].reason });
        }
        scored.sort(function (a, b) {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return a.eta - b.eta;
        });
        return scored.slice(0, maxK);
    }

    // ── Beam search with goal-terminal scoring ───────────────────────────────
    // Objective: minimize wall-clock time to reach the terminal goal.
    //   score(path) = Σ buildTime(step_i)  +  T_goal(stateAfterPath)
    // where T_goal(s) = timeToAffordInState(s, goalPrice).  Baseline is
    // T_goal(baseState) — time to save for the goal with zero instrumentals.
    // Beam only overrides chain.recommended when some path beats the baseline.
    //
    // Repeat builds: buildings ('bld' / 'space_bld') can appear multiple times
    // in a single path.  Cost scales by priceRatio^count per copy; rates
    // accumulate linearly via perUnitProvides.  This is what lets the beam
    // answer "3rd mill vs. 2nd library".
    function beamSearchFrontier(game, eg, frontier, craftsByOutput, goalId, opts) {
        if (!frontier || frontier.length === 0) return null;

        var startMs   = Date.now();
        var maxDepth  = (opts && opts.maxDepth)  || 3;
        var beamWidth = (opts && opts.beamWidth) || 4;
        var budgetMs  = (opts && opts.budgetMs)  || 400;

        var baseState = snapshotAlgebraicState(game, eg);

        // Goal price — what we're ultimately saving for.  If missing, degrade
        // to pure cumulative-build-time minimization (legacy behavior).
        var goalNode  = goalId ? eg.nodes[goalId] : null;
        var goalPrice = null;
        if (goalNode) {
            goalPrice = (goalNode.state === 'locked-ui') ? goalNode.unlockPrice : goalNode.price;
        }
        function tGoal(state) {
            if (!goalPrice) return 0;
            var t = timeToAffordInState(state, goalPrice, craftsByOutput);
            return t.secs;
        }
        // When the goal is reachable, score = cumBuild + remaining wait (seconds).
        // When not reachable (cap too small, no producer), fall back to a
        // graded penalty so the beam can still rank "library (+250 science
        // cap) vs hut (+0 science cap)".  Penalty components:
        //   • cap shortfall: (goalAmt - cap) per unit unreachable via cap
        //   • no production: (goalAmt - have) per unit of a zero-rate resource
        // BIG_PENALTY ensures cap-limited paths always rank above reachable
        // ones (beam prefers "finite wait" when it's an option) but different
        // cap-limited paths can be meaningfully compared.
        var BIG_PENALTY = 1e7;
        function scoreOf(state, cumBuild) {
            if (!goalPrice) return cumBuild;
            var remaining = tGoal(state);
            if (remaining !== Infinity) return cumBuild + remaining;
            var gap = 0;
            for (var i = 0; i < goalPrice.length; i++) {
                var p    = goalPrice[i];
                var have = state.resources[p.name] || 0;
                if (have >= p.val) continue;
                var cap  = state.caps[p.name]  || 0;
                var rate = state.rates[p.name] || 0;
                if (cap > 0 && cap < p.val)       gap += (p.val - cap);
                if (rate <= 0 && have < p.val)    gap += (p.val - have);
            }
            return cumBuild + BIG_PENALTY + gap;
        }

        // Baseline: save for the goal with zero instrumentals.
        var baselineScore = scoreOf(baseState, 0);

        // Seed: one 1-step candidate per frontier node, state already advanced
        // past that step so depth-1 scoring sees post-action rates.
        var beam = [];
        for (var i = 0; i < frontier.length; i++) {
            var nodeId = frontier[i];
            var node   = eg.nodes[nodeId];
            if (!node) continue;
            var price0 = _scaledPriceFor(node, 0);
            var eta0   = timeToAffordInState(baseState, price0 || [], craftsByOutput);
            if (eta0.secs === Infinity) continue;
            var next0  = applyActionSymbolic(baseState, node, craftsByOutput, price0);
            if (!next0) continue;
            beam.push({
                firstAction: nodeId,
                path:        [nodeId],
                state:       next0,
                cumBuild:    eta0.secs,
                counts:      _seedCounts(nodeId, node),
                score:       scoreOf(next0, eta0.secs)
            });
        }
        _beamSort(beam);
        beam = beam.slice(0, beamWidth);

        for (var depth = 1; depth < maxDepth; depth++) {
            if (Date.now() - startMs > budgetMs || beam.length === 0) break;
            var nextBeam = [];
            for (var bi = 0; bi < beam.length; bi++) {
                if (Date.now() - startMs > budgetMs) break;
                var cand = beam[bi];
                // Carry the shorter path forward — with goal-terminal scoring,
                // a longer extension isn't automatically better.
                nextBeam.push(cand);

                var remaining = _beamRemaining(cand.path, frontier, cand.counts, eg);
                for (var ri = 0; ri < remaining.length; ri++) {
                    var nextId   = remaining[ri];
                    var nextNode = eg.nodes[nextId];
                    if (!nextNode) continue;
                    var repeatCount = cand.counts[nextId] || 0;
                    var scaledPrice = _scaledPriceFor(nextNode, repeatCount);
                    var nextEta = timeToAffordInState(cand.state, scaledPrice || [], craftsByOutput);
                    if (nextEta.secs === Infinity) continue;
                    var nextState = applyActionSymbolic(cand.state, nextNode, craftsByOutput, scaledPrice);
                    if (!nextState) continue;
                    var newCumBuild = cand.cumBuild + nextEta.secs;
                    nextBeam.push({
                        firstAction: cand.firstAction,
                        path:        cand.path.concat([nextId]),
                        state:       nextState,
                        cumBuild:    newCumBuild,
                        counts:      _bumpCount(cand.counts, nextId),
                        score:       scoreOf(nextState, newCumBuild)
                    });
                }
            }
            _beamSort(nextBeam);
            beam = nextBeam.slice(0, beamWidth);
        }

        var elapsedMs = Date.now() - startMs;
        var best = beam.length > 0 ? beam[0] : null;
        if (typeof console !== "undefined" && console.log) {
            var baseStr = (baselineScore === Infinity) ? '∞' : baselineScore.toFixed(0);
            var bestStr = best
                ? best.firstAction + ' score=' + best.score.toFixed(0) + 's cum=' + best.cumBuild.toFixed(0) + 's path=' + best.path.join('→')
                : 'none';
            console.log('[Beam] d=' + maxDepth + ' w=' + beamWidth +
                ' ' + elapsedMs + 'ms baseline=' + baseStr + 's best=' + bestStr);
        }
        // Only override chain.recommended if some path genuinely beats
        // save-for-goal.  Otherwise the caller uses its own fallback.
        if (!best || best.score >= baselineScore) return null;
        return best.firstAction;
    }

    function _beamSort(beam) {
        beam.sort(function (a, b) { return a.score - b.score; });
    }

    // Scale a node's price for repeat builds: 2nd copy = base × ratio^1, etc.
    // Only buildings scale; everything else returns its nominal price.
    function _scaledPriceFor(node, repeatCount) {
        var price = (node.state === 'locked-ui') ? node.unlockPrice : node.price;
        if (!price || !repeatCount) return price;
        if (node.kind !== 'bld' && node.kind !== 'space_bld') return price;
        var ratio = node.priceRatio || 1.15;
        var mult  = Math.pow(ratio, repeatCount);
        var out = new Array(price.length);
        for (var i = 0; i < price.length; i++) {
            out[i] = { name: price[i].name, val: price[i].val * mult };
        }
        return out;
    }

    function _seedCounts(nodeId, node) {
        var out = {};
        if (node && (node.kind === 'bld' || node.kind === 'space_bld')) out[nodeId] = 1;
        return out;
    }

    function _bumpCount(counts, nodeId) {
        var out = {};
        for (var k in counts) if (counts.hasOwnProperty(k)) out[k] = counts[k];
        out[nodeId] = (out[nodeId] || 0) + 1;
        return out;
    }

    // Remaining candidates.  Non-building nodes are consumed once per path
    // (can't "research calendar twice").  Incremental buildings stay in the
    // pool so the beam can represent "3rd mill vs. 2nd library".
    function _beamRemaining(path, frontier, counts, eg) {
        var out = [];
        for (var i = 0; i < frontier.length; i++) {
            var id = frontier[i];
            var node = eg.nodes[id];
            if (node && (node.kind === 'bld' || node.kind === 'space_bld')) {
                out.push(id);
            } else if (path.indexOf(id) < 0) {
                out.push(id);
            }
        }
        return out;
    }

    function planNextAction(game, eg, opts) {
        var goalId = (opts && opts.goalIdOverride)
            || ((typeof getTerminalGoal === "function") ? getTerminalGoal() : null);
        if (!goalId) return { kind: "no-goal" };

        var scrape;
        if (!eg) {
            scrape = scrapeGraph(game);
            eg = buildEdgeGraph(game, scrape);
            eg.__scrape = scrape;
        } else {
            scrape = eg.__scrape || scrapeGraph(game);
        }

        var node = eg.nodes[goalId];
        if (!node) return { kind: "unknown-goal", goalId: goalId };

        if (node.state === "done") return { kind: "done", goalId: goalId, node: node };

        var chain = chainBackward(eg, goalId);
        annotateChainETA(game, scrape, chain);

        if (!chain || !chain.recommended) {
            return { kind: "blocked", goalId: goalId, chain: chain, reason: "no frontier" };
        }

        // Beam candidate set: 'frontier' (chain-only) or 'goalAware' (B2 — wider).
        var recommendedId = chain.recommended;
        var beamUsed = false;
        var beamEnabled = (typeof cfg !== 'undefined') ? (cfg.beamEnabled !== false) : true;
        var candidateMode = (cfg && cfg.beamCandidateMode) || 'goalAware';

        if (beamEnabled) {
            var candidateIds;
            if (candidateMode === 'goalAware') {
                var baseState = snapshotAlgebraicState(game, eg);
                var cand = collectGoalAwareCandidates(eg, chain, baseState);
                var maxK = (cfg && cfg.beamMaxCandidates) || 10;
                var pruned = pruneCandidates(eg, baseState, chain.__craftsByOutput || {}, cand, maxK);
                candidateIds = pruned.map(function (s) { return s.id; });
            } else {
                candidateIds = chain.frontier;
            }

            if (candidateIds.length > 1) {
                var beamOpts = {
                    maxDepth:  (cfg && cfg.beamDepth)    || 3,
                    beamWidth: (cfg && cfg.beamWidth)    || 4,
                    budgetMs:  (cfg && cfg.beamBudgetMs) || 400
                };
                var beamId = beamSearchFrontier(game, eg, candidateIds, chain.__craftsByOutput || {}, goalId, beamOpts);
                if (beamId) { recommendedId = beamId; beamUsed = true; }
            }
        }

        var entry   = chain.entries[recommendedId];
        var recNode = eg.nodes[recommendedId];
        // Beam may pick a candidate outside chain.entries (e.g. a capRaiser
        // surfaced by goalAware expansion). Synthesize an entry so downstream
        // consumers (orchestrator, UI) have the standard { cost, etaSecs } shape.
        if (!entry && recNode) {
            var synthCost = (recNode.state === 'locked-ui') ? recNode.unlockPrice : recNode.price;
            var etaR = timeToAfford(game, synthCost || [], chain.__craftsByOutput || {});
            entry = {
                id: recommendedId, state: recNode.state, children: [],
                cost: synthCost || [], etaSecs: etaR.secs, capLimited: etaR.capLimited
            };
            chain.entries[recommendedId] = entry;
        }
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
        var unsafe = _runwayCheck(game, recNode, entry);
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

        // Cap-horizon guard: if the chosen entry is structurally unreachable
        // because cost > storage cap and no craft escape, redirect to the
        // cheapest cap-raiser. Skip when another safety redirect already fired,
        // or when cfg.capHorizon === false (kill-switch).
        var capHorizonOn = !cfg || cfg.capHorizon !== false;
        if (capHorizonOn && !safetyNote && entry && entry.capLimited) {
            var raiserId = _findCapHorizonRaiser(game, scrape, eg, entry);
            if (raiserId && raiserId !== chain.recommended) {
                var capChain = chainBackward(eg, raiserId);
                annotateChainETA(game, scrape, capChain);
                if (capChain.recommended) {
                    chain = capChain;
                    entry = chain.entries[chain.recommended];
                    recNode = eg.nodes[chain.recommended];
                    safetyNote = "cap-horizon: routing via " + raiserId;
                }
            }
        }

        var action = nodeToAction(recNode);
        if (!action) {
            return {
                kind: "blocked", goalId: goalId, chain: chain,
                reason: "frontier is user-only (" + (recNode ? recNode.kind : "?") + " " + recommendedId + ")"
            };
        }
        return {
            kind: "recommend", goalId: goalId,
            node: recNode, entry: entry, chain: chain,
            action: action, etaSecs: entry ? entry.etaSecs : Infinity,
            safetyNote: safetyNote, beamUsed: beamUsed
        };
    }

    if (typeof window !== "undefined") {
        window.__chainBackward = function () {
            var goalId = getTerminalGoal(); if (!goalId) return null;
            var eg = (typeof getCachedEdgeGraph === 'function')
                ? getCachedEdgeGraph(gamePage)
                : buildEdgeGraph(gamePage, scrapeGraph(gamePage));
            var chain = chainBackward(eg, goalId);
            annotateChainETA(gamePage, eg.__scrape || scrapeGraph(gamePage), chain);
            return chain;
        };
        window.__beamSearch = function () {
            var eg = (typeof getCachedEdgeGraph === 'function')
                ? getCachedEdgeGraph(gamePage)
                : null;
            return planNextAction(gamePage, eg);
        };
        window.__beamDebug = function () {
            var savedD = cfg.beamDepth, savedW = cfg.beamWidth, savedB = cfg.beamBudgetMs;
            cfg.beamDepth = 4; cfg.beamWidth = 8; cfg.beamBudgetMs = 3000;
            var result = window.__beamSearch();
            cfg.beamDepth = savedD; cfg.beamWidth = savedW; cfg.beamBudgetMs = savedB;
            console.log('[beamDebug]', result);
            return result;
        };
        window.__dumpChain = dumpChain;
        // Trace every OR-decision in the current chain with (rawLeaves,
        // fanout, weighted score).  The option with the smallest score is
        // the one chainBackward picks.  Rows marked ✓ are the picks.
        window.__testFanout = function (goalId) {
            goalId = goalId || getTerminalGoal();
            if (!goalId) { console.warn('[testFanout] no goal'); return; }
            var eg = (typeof getCachedEdgeGraph === 'function')
                ? getCachedEdgeGraph(gamePage)
                : buildEdgeGraph(gamePage, scrapeGraph(gamePage));
            var chain = chainBackward(eg, goalId);
            if (!chain) { console.warn('[testFanout] no chain'); return; }
            var memo = {};
            var rows = [];
            var multiWay = 0, forced = 0;
            var ids = Object.keys(chain.entries);
            for (var i = 0; i < ids.length; i++) {
                var e = chain.entries[ids[i]];
                if (!e.options || e.options.length < 1) continue;
                var kind = (e.options.length >= 2) ? 'OR' : 'forced';
                if (e.capLimited) kind = 'cap(' + e.options.length + ')';
                else if (e.prodLimited) kind = 'prod(' + e.options.length + ')';
                if (e.options.length >= 2) multiWay++; else forced++;
                for (var j = 0; j < e.options.length; j++) {
                    var oid = e.options[j];
                    var raw = _leafCount(chain.entries, oid, memo, eg);
                    var fan = _effectiveFanout(eg, oid);
                    var scored = _fanoutScore(raw, eg, oid);
                    rows.push({
                        parent: ids[i],
                        kind:   kind,
                        option: oid,
                        rawLeaves: (raw === Infinity ? '∞' : Number(raw.toFixed(2))),
                        fanout: fan,
                        score:  (scored === Infinity ? '∞' : Number(scored.toFixed(2))),
                        picked: (e.picked === oid) ? '✓' : ''
                    });
                }
            }
            console.log('[testFanout] fanoutWeight=' + cfg.fanoutWeight +
                        ' goal=' + goalId + ' entries=' + ids.length +
                        ' multiWayOR=' + multiWay + ' forced=' + forced +
                        ' rows=' + rows.length);
            console.table(rows);
            return rows;
        };
        window.__dumpCandidates = function () {
            var goalId = getTerminalGoal();
            if (!goalId) { console.warn('[candidates] no terminal goal set'); return; }
            var eg = (typeof getCachedEdgeGraph === 'function')
                ? getCachedEdgeGraph(gamePage)
                : buildEdgeGraph(gamePage, scrapeGraph(gamePage));
            var scrape = eg.__scrape || scrapeGraph(gamePage);
            var chain = chainBackward(eg, goalId);
            annotateChainETA(gamePage, scrape, chain);
            var baseState = snapshotAlgebraicState(gamePage, eg);
            var cand = collectGoalAwareCandidates(eg, chain, baseState);
            var maxK = (cfg && cfg.beamMaxCandidates) || 10;
            var pruned = pruneCandidates(eg, baseState, chain.__craftsByOutput || {}, cand, maxK);
            var rows = pruned.map(function (s) {
                var n = eg.nodes[s.id];
                return {
                    id:       s.id,
                    kind:     n.kind,
                    state:    n.state,
                    reason:   s.reason,
                    priority: s.priority,
                    etaSecs:  Number(s.eta.toFixed(1))
                };
            });
            console.log('[candidates] goal=' + goalId + '  total=' + Object.keys(cand).length + '  pruned=' + rows.length);
            console.table(rows);
            return rows;
        };
    }
