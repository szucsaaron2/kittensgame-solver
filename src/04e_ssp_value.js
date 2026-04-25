    // =========================================================================
    //  [SSP-D] VALUE ITERATION OVER TERMINAL-GOAL CANDIDATES
    //
    //  Phase 1 of the SSP-Dynamic plan.  Pure, dependency-injected — does not
    //  touch `gamePage`, `window`, or any sibling-file global.  Tests in
    //  tests/ssp_value.test.js drive it with a synthetic edge graph.
    //
    //  Inputs:
    //    eg       — edge graph from 06_edges.js  (nodes, unlockedBy)
    //    algState — symbolic state from 04c_symbolic.js (snapshotAlgebraicState)
    //    deps     — { applyActionSymbolic, timeToAffordInState, craftsByOutput,
    //                 getBias?:(goalId)->number, rewardWeight?:number }
    //    opts     — { candidates?:string[], horizon?:number, terminalKinds?:string[] }
    //
    //  Output:
    //    {
    //      V:        { [goalId]: secondsToReach },
    //      fanout:   { [goalId]: descendantCount },
    //      ranking:  [{ id, V, fanout, score, reachable }]   (ascending score)
    //    }
    //
    //  Score = bias(g) · V(g) − rewardWeight · (1 + fanout(g)).  Lower is
    //  better.  rewardWeight is in seconds-per-unlock and defaults to 1 — a
    //  conservative trade that prefers gateway nodes only when their time
    //  cost is comparable to the leaves they outweigh.
    // =========================================================================

    var SSP_TERMINAL_KINDS_DEFAULT = {
        tech: true, ws_upg: true,
        rel_upg_ru: true, rel_upg_zu: true, rel_upg_tu: true,
        mission: true, space_bld: true
    };
    var SSP_DEFAULT_HORIZON     = 8;
    var SSP_DEFAULT_REWARD_W    = 1.0;
    var SSP_DEFAULT_BIAS        = function () { return 1.0; };
    var SSP_INFINITY            = Infinity;

    // ── Fanout: |transitive descendants via provides.unlocks| ────────────────
    // Cycle-safe DFS with memoization.  Returns the *count* of distinct
    // descendant ids (not including g itself).
    function _sspComputeFanout(eg) {
        var memo = {};
        var stack = {};
        function dfs(id) {
            if (memo[id]) return memo[id];
            if (stack[id]) return { set: {}, count: 0 };  // cycle stub
            stack[id] = true;
            var node = eg.nodes[id];
            var set = {};
            if (node && node.provides && node.provides.unlocks) {
                var ul = node.provides.unlocks;
                for (var i = 0; i < ul.length; i++) {
                    var child = ul[i];
                    if (set[child]) continue;
                    set[child] = true;
                    var sub = dfs(child);
                    for (var k in sub.set) set[k] = true;
                }
            }
            stack[id] = false;
            var count = 0;
            for (var k2 in set) count++;
            memo[id] = { set: set, count: count };
            return memo[id];
        }
        var out = {};
        for (var id in eg.nodes) out[id] = dfs(id).count;
        return out;
    }

    // ── Edge time: cost to acquire a single node from a given symbolic state ─
    // Returns { secs, nextState } or { secs: Infinity, nextState: null }.
    function _sspEdgeTime(node, state, deps) {
        if (!node) return { secs: SSP_INFINITY, nextState: null };
        if (state.unlocks && state.unlocks[node.id]) return { secs: 0, nextState: state };
        if (node.state === 'done') return { secs: 0, nextState: state };
        // locked-prereq cannot be paid for directly — caller must walk
        // unlockedBy first.  Returning Infinity here forces _sspCost into the
        // recursive branch instead of treating the price as immediately
        // payable.
        if (node.state === 'locked-prereq') return { secs: SSP_INFINITY, nextState: null };

        var price = (node.state === 'locked-ui') ? node.unlockPrice : node.price;
        var eta = price
            ? deps.timeToAffordInState(state, price, deps.craftsByOutput)
            : { secs: 0 };
        if (eta.secs === SSP_INFINITY) return { secs: SSP_INFINITY, nextState: null };

        var next = deps.applyActionSymbolic
            ? deps.applyActionSymbolic(state, node, deps.craftsByOutput)
            : null;
        if (!next) return { secs: eta.secs, nextState: state };
        return { secs: eta.secs, nextState: next };
    }

    // ── Bellman cost: V(g | s) = min over OR-branches of {time(prereq)+time(g)} ─
    // For ready / locked-cost / locked-ui nodes, edge time is the closed-form
    // ETA from `state`.  For locked-prereq nodes, recurse into eg.unlockedBy
    // and accumulate.  `seen` guards cycles.
    function _sspCost(goalId, state, eg, deps, depth, seen) {
        if (depth <= 0) return SSP_INFINITY;
        if (seen[goalId]) return SSP_INFINITY;

        var node = eg.nodes[goalId];
        if (!node) return SSP_INFINITY;
        if (node.state === 'done' || (state.unlocks && state.unlocks[goalId])) return 0;

        if (node.state === 'ready' || node.state === 'locked-cost' || node.state === 'locked-ui') {
            return _sspEdgeTime(node, state, deps).secs;
        }

        // locked-prereq: take min over OR-options of {cost(opt) + price(goal | after opt)}.
        // After the prereq is satisfied, the goal becomes "virtually ready" — bill
        // its raw price against the post-prereq state directly (do NOT route
        // through _sspEdgeTime, which still sees node.state==='locked-prereq').
        var sources = eg.unlockedBy ? (eg.unlockedBy[goalId] || []) : [];
        if (sources.length === 0) return SSP_INFINITY;

        var nextSeen = Object.assign({}, seen); nextSeen[goalId] = true;
        var goalPrice = (node.state === 'locked-ui') ? node.unlockPrice : node.price;

        var best = SSP_INFINITY;
        for (var i = 0; i < sources.length; i++) {
            var srcId = sources[i].id;
            var srcNode = eg.nodes[srcId];
            if (!srcNode) continue;

            var preCost, afterPre;
            var preEdge = _sspEdgeTime(srcNode, state, deps);
            if (preEdge.secs === SSP_INFINITY) {
                // Source also gated — recurse.  We don't have a post-state from
                // a chain of recursive calls; fall back to the current state as
                // a lower bound for goal pricing.
                preCost = _sspCost(srcId, state, eg, deps, depth - 1, nextSeen);
                if (preCost === SSP_INFINITY) continue;
                afterPre = state;
            } else {
                preCost = preEdge.secs;
                afterPre = preEdge.nextState || state;
            }

            var goalSecs = 0;
            if (goalPrice && goalPrice.length > 0) {
                var eta = deps.timeToAffordInState(afterPre, goalPrice, deps.craftsByOutput);
                if (!eta || eta.secs === SSP_INFINITY) continue;
                goalSecs = eta.secs;
            }
            var total = preCost + goalSecs;
            if (total < best) best = total;
        }
        return best;
    }

    // ── Public entry ─────────────────────────────────────────────────────────
    function computeSspValueTable(eg, algState, deps, opts) {
        deps = deps || {};
        opts = opts || {};
        var horizon       = opts.horizon       || SSP_DEFAULT_HORIZON;
        var terminalKinds = opts.terminalKinds || SSP_TERMINAL_KINDS_DEFAULT;
        var rewardWeight  = (deps.rewardWeight != null) ? deps.rewardWeight : SSP_DEFAULT_REWARD_W;
        var getBias       = deps.getBias || SSP_DEFAULT_BIAS;

        var fanout = _sspComputeFanout(eg);

        var candidates = opts.candidates;
        if (!candidates) {
            candidates = [];
            for (var id in eg.nodes) {
                var n = eg.nodes[id];
                if (!terminalKinds[n.kind]) continue;
                if (n.state === 'done') continue;
                candidates.push(id);
            }
        }

        var V = {};
        var ranking = [];
        for (var i = 0; i < candidates.length; i++) {
            var gid  = candidates[i];
            var raw  = _sspCost(gid, algState, eg, deps, horizon, {});
            // Bias contract matches 04f: only finite, strictly-positive values
            // are honoured; everything else (0, NaN, null, undefined, negatives)
            // is rejected and we fall back to 1.0.  Treating 0 as "free" would
            // hide bugs in the belief table.
            var biasRaw = getBias(gid);
            var bias = (typeof biasRaw === 'number' && isFinite(biasRaw) && biasRaw > 0)
                ? biasRaw : 1.0;
            var biased = (raw === SSP_INFINITY) ? SSP_INFINITY : raw * bias;
            V[gid] = biased;
            var fan = fanout[gid] || 0;
            var score = (biased === SSP_INFINITY)
                ? SSP_INFINITY
                : biased - rewardWeight * (1 + fan);
            ranking.push({
                id: gid, V: biased, fanout: fan,
                score: score, reachable: biased !== SSP_INFINITY
            });
        }
        ranking.sort(function (a, b) { return a.score - b.score; });

        return { V: V, fanout: fanout, ranking: ranking };
    }

    // ── Dual-mode export (Node tests / browser userscript) ───────────────────
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            computeSspValueTable: computeSspValueTable,
            _sspComputeFanout: _sspComputeFanout,
            _sspEdgeTime: _sspEdgeTime,
            _sspCost: _sspCost,
            SSP_TERMINAL_KINDS_DEFAULT: SSP_TERMINAL_KINDS_DEFAULT
        };
    }
