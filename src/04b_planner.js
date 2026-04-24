    // =========================================================================
    //  [G2] RESOURCE PLANNER — Craft Chain Resolver
    //  Converts goal prices into raw resource costs, resolving craft dependencies.
    //  Used by enumerators to check "can I afford this with crafting?" and by
    //  executors to auto-craft prerequisites before building.
    // =========================================================================

    // Per-pass scratch + memo context for resolveRawCost. Building it once
    // per enumeration / registry / ticks-scan pass amortizes:
    //   - resource-value baseline snapshot
    //   - craft-recipe lookup table
    //   - getResCraftRatio cache (walks upgrade tree internally)
    //   - getCraftPrice cache
    // Lifetime: one pass over the current game state. Do NOT reuse across
    // executeAction calls or state mutations — resource values will drift.
    function createResolveContext(game) {
        var baseline = {};
        var resources = game.resPool.resources;
        for (var i = 0; i < resources.length; i++) {
            baseline[resources[i].name] = resources[i].value;
        }
        var craftLookup = {};
        var crafts = game.workshop.crafts;
        for (var i = 0; i < crafts.length; i++) {
            if (crafts[i].unlocked) craftLookup[crafts[i].name] = crafts[i];
        }
        return {
            baseline: baseline,
            craftLookup: craftLookup,
            ratioCache: {},       // name -> 1 + getResCraftRatio
            craftPriceCache: {}   // craftName -> getCraftPrice(recipe) result
        };
    }

    // Resolve a price list into production deficits + craft plan.
    // Deficit-first: deducts existing stockpiles before resolving.
    // Production-aware: resources with perTickCached > 0 are treated as
    // "will accumulate" and never resolved to craft inputs.
    //
    // Read-only: does NOT modify game state (uses internal available pool).
    //
    // Returns: { feasible: bool, rawCost: [{name,val}], craftPlan: [{name,amount}] }
    //   rawCost   = remaining deficits that must ACCUMULATE through production
    //   craftPlan = ordered list of crafts to execute (leaf-first, ready to run)
    //
    // Example: smelter needs [{minerals:200}, {beam:5}], player has 200 minerals + 100 wood
    //   minerals: have 200 >= 200 → deducted, zero cost
    //   beam: have 0, not produced → craft 5 beams from wood
    //   wood for beams: have 100, produced (perTick>0), need 875 → rawCost [{wood:775}]
    //   craftPlan = [{name:"beam", amount:5}]
    function resolveRawCost(game, prices, ctx) {
        var craftPlan = [];
        var rawCost = {};
        var minBatch = {};   // per-resource: max single-craft draw (for incremental-craft storage check)
        var directNeed = {}; // per-resource: max single direct-price amount (must fit in storage at purchase time)

        // Use a provided context or create a single-shot one.
        var ownCtx = !ctx;
        if (ownCtx) ctx = createResolveContext(game);

        // Per-call scratch: prototype-chain to baseline so reads fall through
        // and writes shadow locally. Resets to baseline by simply discarding.
        var available = Object.create(ctx.baseline);
        var craftLookup = ctx.craftLookup;
        var ratioCache = ctx.ratioCache;
        var craftPriceCache = ctx.craftPriceCache;

        // Pre-pass: deduct stockpiles for all direct prices first.
        // This reserves resources for direct-use prices before crafting
        // consumes them (e.g., reserve wood for "wood" price before
        // beam crafting eats wood).
        var pending = [];
        for (var i = 0; i < prices.length; i++) {
            // Track the biggest single-price demand per resource.  When the goal
            // fires, this full amount must be stored at once (it's the price the
            // game debits on purchase).  Craft chains can be incremental, but
            // direct prices cannot.
            directNeed[prices[i].name] = Math.max(directNeed[prices[i].name] || 0, prices[i].val);
            var have = available[prices[i].name] || 0;
            if (have >= prices[i].val) {
                available[prices[i].name] = have - prices[i].val;
                // Fully covered by stockpile — zero cost
            } else {
                var deficit = prices[i].val - have;
                available[prices[i].name] = 0;
                pending.push({ name: prices[i].name, val: deficit });
            }
        }

        // Iteratively resolve deficits (max 8 depth for craft chains)
        for (var depth = 0; depth < 8 && pending.length > 0; depth++) {
            var nextPending = [];
            for (var i = 0; i < pending.length; i++) {
                var p = pending[i];

                // Step 1: Deduct from available pool (for craft-chain intermediates)
                var have = available[p.name] || 0;
                if (have >= p.val) {
                    available[p.name] = have - p.val;
                    continue; // fully covered
                }
                var deficit = p.val - have;
                available[p.name] = 0;

                // Step 2: Is this resource being PRODUCED? (perTickCached > 0)
                var res = game.resPool.get(p.name);
                if (res && res.perTickCached > 0) {
                    // Will accumulate through production — treat as raw cost
                    rawCost[p.name] = (rawCost[p.name] || 0) + deficit;
                    // Track per-batch draw: if this resource feeds a craft chain, you only
                    // need singleBatch at a time (not the full deficit).  Direct-price items
                    // have no singleBatch and fall back to the conservative check.
                    if (p.singleBatch !== undefined)
                        minBatch[p.name] = Math.max(minBatch[p.name] || 0, p.singleBatch);
                    continue; // do NOT resolve to craft inputs
                }

                // Step 3: Not produced. Is it craftable?
                var recipe = craftLookup[p.name];
                if (!recipe) {
                    // Raw resource with no production and no craft recipe
                    rawCost[p.name] = (rawCost[p.name] || 0) + deficit;
                    continue;
                }

                // Step 4: Craft the DEFICIT (not the full amount)
                var ratio = ratioCache[p.name];
                if (ratio === undefined) {
                    ratio = 1;
                    try { ratio = 1 + (game.getResCraftRatio({ name: p.name }) || 0); }
                    catch (e) { ratio = 1; }
                    ratioCache[p.name] = ratio;
                }
                var times = Math.ceil(deficit / ratio);

                craftPlan.push({ name: p.name, amount: times });

                // Add craft input costs to next iteration
                var inputPrices = craftPriceCache[p.name];
                if (inputPrices === undefined) {
                    inputPrices = game.workshop.getCraftPrice(recipe);
                    craftPriceCache[p.name] = inputPrices;
                }
                for (var j = 0; j < inputPrices.length; j++) {
                    nextPending.push({
                        name: inputPrices[j].name,
                        val: inputPrices[j].val * times,
                        singleBatch: inputPrices[j].val  // cost per single craft op
                    });
                }
            }
            pending = nextPending;
        }

        if (pending.length > 0) {
            return { feasible: false, rawCost: [], craftPlan: [] };
        }

        // Reverse craftPlan so leaf operations (raw→L1) come first
        craftPlan.reverse();

        var rawCostArr = [];
        for (var name in rawCost) {
            if (rawCost[name] > 0) rawCostArr.push({
                name: name,
                val: rawCost[name],
                minBatch: minBatch[name] || 0,
                directNeed: directNeed[name] || 0
            });
        }

        return { feasible: true, rawCost: rawCostArr, craftPlan: craftPlan };
    }

    // Check if a goal is affordable right now, including after crafting intermediates.
    // Read-only: does NOT modify game state.
    //
    // With the deficit-aware resolveRawCost, rawCost entries represent remaining
    // deficits AFTER stockpiles are deducted. If rawCost is empty (or all <= 0),
    // everything is covered by existing resources + crafting.
    //
    // Returns: { affordable: bool, craftPlan: [{name,amount}] | null }
    function canAffordWithCrafting(game, prices, ctx) {
        // Quick path: already affordable directly
        if (game.resPool.hasRes(prices)) {
            return { affordable: true, craftPlan: null };
        }

        var resolved = resolveRawCost(game, prices, ctx);
        if (!resolved.feasible) return { affordable: false, craftPlan: null };

        // rawCost contains remaining deficits after stockpile deduction.
        // If any deficit > 0, we can't afford it right now.
        if (resolved.rawCost.length > 0) {
            return { affordable: false, craftPlan: null };
        }

        // rawCost is empty = all resources covered by stockpiles + crafting
        return { affordable: true, craftPlan: resolved.craftPlan };
    }

    // Incrementally progress a craft chain for the current target when
    // saving.  Only crafts steps whose full batch won't fit in the input's
    // storage (otherwise accumulating raws and crafting on-demand at build
    // time is strictly better).  Bounded by CRAFT_CYCLE_CAP per step.
    var CRAFT_CYCLE_CAP = 5;

    function _stepNeedsIncremental(game, step) {
        if (!step || !step.amount || step.amount <= 0) return false;
        var recipe; try { recipe = game.workshop.getCraft(step.name); } catch (e) { return false; }
        if (!recipe) return false;
        var prices; try { prices = game.workshop.getCraftPrice(recipe); } catch (e) { return false; }
        if (!prices) return false;
        for (var i = 0; i < prices.length; i++) {
            var r = game.resPool.get(prices[i].name);
            if (!r || r.maxValue <= 0) continue;
            if (prices[i].val * step.amount > r.maxValue) return true;
        }
        return false;
    }

    function progressCraftChain(game, prices) {
        var ws = game.bld.get("workshop");
        if (!ws || ws.val === 0) return 0;
        var resolved = resolveRawCost(game, prices);
        if (!resolved.feasible || !resolved.craftPlan) return 0;
        var plan = resolved.craftPlan;
        var crafted = 0;
        for (var i = 0; i < plan.length; i++) {
            var step = plan[i];
            if (AUTO_CRAFT_EXCLUDED[step.name]) continue;
            if (!_stepNeedsIncremental(game, step)) continue;
            var recipe = game.workshop.getCraft(step.name);
            if (!recipe || !recipe.unlocked) continue;
            var stepPrices = game.workshop.getCraftPrice(recipe);
            if (!stepPrices) continue;
            var affordable = Infinity;
            for (var j = 0; j < stepPrices.length; j++) {
                var r = game.resPool.get(stepPrices[j].name);
                if (!r || stepPrices[j].val <= 0) { affordable = 0; break; }
                var n = Math.floor(r.value / stepPrices[j].val);
                if (n < affordable) affordable = n;
            }
            var toCraft = Math.min(affordable, step.amount, CRAFT_CYCLE_CAP);
            if (toCraft <= 0) continue;
            try { game.workshop.craft(step.name, toCraft); crafted += toCraft; } catch (e) { }
        }
        return crafted;
    }

    // Execute a craft plan in order. Mutates game state.
    // NOTE: caller (executeAction) calls game.updateCaches() after the action
    // completes. Don't do it here — back-to-back updateCaches is wasteful.
    function executeCraftPlan(game, craftPlan) {
        if (!craftPlan || craftPlan.length === 0) return true;
        for (var i = 0; i < craftPlan.length; i++) {
            var step = craftPlan[i];
            try {
                game.workshop.craft(step.name, step.amount);
            } catch (e) {
                // Fallback: try craftAll if exact amount fails
                try { game.workshop.craftAll(step.name); } catch (e2) { }
            }
        }
        return true;
    }

