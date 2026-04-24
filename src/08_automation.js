    // =========================================================================
    //  [L] AUTOCLICKER + SPEED WORKERS
    // =========================================================================
    function startClickerWorker() {
        var code = 'var id=null,iv=0;function s(){if(id)clearInterval(id);if(iv>0)id=setInterval(function(){postMessage("g")},iv);}self.onmessage=function(e){if(e.data&&e.data.type==="setInterval"){iv=e.data.interval>0?e.data.interval:0;if(iv<=0&&id){clearInterval(id);id=null;}else s();}};';
        var blob = new Blob([code], { type: 'application/javascript' });
        clickerWorker = new Worker(URL.createObjectURL(blob));
        clickerWorker.onmessage = function () {
            if (typeof gamePage !== 'undefined' && gamePage.bld) try { gamePage.bld.gatherCatnip(); } catch (e) { }
        };
    }

    function setClickerRate(cps) {
        if (clickerWorker) clickerWorker.postMessage({ type: 'setInterval', interval: cps > 0 ? Math.round(1000 / cps) : 0 });
    }

    function startSpeedWorker() {
        var code = 'var id=null,iv=0;function s(){if(id)clearInterval(id);if(iv>0)id=setInterval(function(){postMessage("t")},iv);}self.onmessage=function(e){if(e.data&&e.data.type==="setInterval"){iv=e.data.interval>0?e.data.interval:0;if(iv<=0&&id){clearInterval(id);id=null;}else s();}};';
        var blob = new Blob([code], { type: 'application/javascript' });
        speedWorker = new Worker(URL.createObjectURL(blob));
        speedWorker.onmessage = function () {
            if (typeof gamePage === 'undefined' || !gamePage.tick) return;
            if (gamePage.isPaused) return;
            try { gamePage.tick(); } catch (e) { }
        };
    }

    function setSpeedMultiplier(mult) {
        if (!speedWorker) return;
        var m = Math.max(1, Math.floor(mult || 1));
        var tps = (typeof gamePage !== 'undefined' && gamePage.ticksPerSecond) ? gamePage.ticksPerSecond : 5;
        var extraPerSec = (m - 1) * tps;
        var interval = extraPerSec > 0 ? Math.max(5, Math.round(1000 / extraPerSec)) : 0;
        speedWorker.postMessage({ type: 'setInterval', interval: interval });
    }

    // =========================================================================
    //  [M] HUNT, CRAFT, OBSERVE
    // =========================================================================
    function doAutoHunt() {
        if (!gamePage.village) return;
        var mp = gamePage.resPool.get("manpower");
        if (!mp || mp.maxValue <= 0 || mp.value / mp.maxValue < 0.99) return;
        var hunter = (gamePage.village.jobs || []).find(function (j) { return j.name === "hunter"; });
        if (!hunter || hunter.value <= 0) return;
        if (typeof gamePage.village.huntAll === 'function') gamePage.village.huntAll();
    }

    function _workshopBuilt(game) {
        var w = game.bld.get("workshop");
        return !!(w && w.val > 0);
    }

    var AUTO_CRAFT_AT_CAP = [
        { resource: "catnip", craft: "wood" },
        { resource: "wood", craft: "beam" },
        { resource: "minerals", craft: "slab" },
        { resource: "coal", craft: "steel" },
        { resource: "iron", craft: "plate" },
    ];
    var AUTO_CRAFT_ALWAYS = ["parchment"];

    function doAutoCraft() {
        if (!_workshopBuilt(gamePage)) return;
        for (var i = 0; i < AUTO_CRAFT_AT_CAP.length; i++) {
            var e = AUTO_CRAFT_AT_CAP[i];
            var res = gamePage.resPool.get(e.resource);
            if (!res || res.maxValue <= 0 || res.value / res.maxValue < 0.99) continue;
            if (_resourceReservedForRanked(e.resource, 180)) continue;
            var craft = gamePage.workshop.getCraft(e.craft);
            if (!craft || !craft.unlocked) continue;
            var prices = gamePage.workshop.getCraftPrice(craft);
            if (!prices || !gamePage.resPool.hasRes(prices)) continue;
            gamePage.workshop.craftAll(e.craft);
        }
        for (var i = 0; i < AUTO_CRAFT_ALWAYS.length; i++) {
            var craft = gamePage.workshop.getCraft(AUTO_CRAFT_ALWAYS[i]);
            if (!craft || !craft.unlocked) continue;
            var prices = gamePage.workshop.getCraftPrice(craft);
            if (!prices || !gamePage.resPool.hasRes(prices)) continue;
            gamePage.workshop.craftAll(AUTO_CRAFT_ALWAYS[i]);
        }
    }

    function doAutoObserve() {
        if (!gamePage.calendar) return;
        var btn = gamePage.calendar.observeBtn; if (!btn) return;
        if (btn.nodeType) { if (btn.offsetParent !== null) btn.click(); return; }
        if (btn.model && btn.model.visible === false) return;
        if (typeof btn.click === 'function') btn.click();
        else if (btn.domNode) btn.domNode.click();
    }

    // True if any frontier entry on the current chain plan lists `resName` in
    // its cost.  Used to block sacrifices/auto-craft that would strip a
    // reserve a near-term goal depends on.  Returns false when no plan yet
    // (idle / unknown-goal) — no goal means no reservation.
    function _resourceReservedForRanked(resName, maxSecs) {
        if (typeof lastPlan === 'undefined' || !lastPlan || !lastPlan.chain) return false;
        var chain = lastPlan.chain;
        var horizon = (maxSecs === undefined) ? Infinity : maxSecs;
        for (var i = 0; i < chain.frontier.length; i++) {
            var e = chain.entries[chain.frontier[i]];
            if (!e || !e.cost) continue;
            if (e.etaSecs !== undefined && e.etaSecs > horizon) continue;
            for (var j = 0; j < e.cost.length; j++) {
                if (e.cost[j].name === resName) return true;
            }
        }
        return false;
    }

    // =========================================================================
    //  [M2] TRADE, PRAISE, SACRIFICE, EXPLORE, FESTIVAL
    // =========================================================================

    // One trade per unlocked race per cycle: fire if affordable and the output
    // resource isn't near cap.  Steady-state background trading.
    var _TRADE_PARTNERS = ["nagas", "zebras", "spiders", "dragons",
                           "griffins", "lizards", "sharks"];
    function doAutoTrade() {
        if (!gamePage.diplomacy) return;
        var traded = false;
        for (var i = 0; i < _TRADE_PARTNERS.length; i++) {
            var race = gamePage.diplomacy.get(_TRADE_PARTNERS[i]);
            if (!race || !race.unlocked) continue;
            if (!canAffordTrade(gamePage, race, 1)) continue;
            // Skip if any output resource is already near cap.
            var wasteful = false;
            if (race.sells) {
                for (var s = 0; s < race.sells.length; s++) {
                    var out = gamePage.resPool.get(race.sells[s].name);
                    if (out && out.maxValue > 0 && out.value >= out.maxValue * 0.95) { wasteful = true; break; }
                }
            }
            if (wasteful) continue;
            try { gamePage.diplomacy.tradeMultiple(race, 1); traded = true; } catch (e) { }
        }
        if (traded) { try { gamePage.updateCaches(); } catch (e) { } }
    }

    var _EXPLORE_COST = 1000;
    function _exploreShouldFire(game) {
        var dip = game.diplomacy;
        if (!dip || !dip.hasUnlockedRaces()) return false;
        var mp = game.resPool.get("manpower");
        if (!mp || mp.value < _EXPLORE_COST) return false;

        var firstTrio = ["lizards", "sharks", "griffins"];
        for (var i = 0; i < firstTrio.length; i++) {
            var r = dip.get(firstTrio[i]);
            if (r && !r.unlocked) return true;
        }
        var nagas = dip.get("nagas");
        var cu = game.resPool.get("culture");
        if (nagas && !nagas.unlocked && cu && cu.value >= 1500) return true;

        var ship = game.resPool.get("ship");
        var zebras = dip.get("zebras");
        if (zebras && !zebras.unlocked && ship && ship.value >= 1) return true;

        var spiders = dip.get("spiders");
        var sci = game.resPool.get("science");
        if (spiders && !spiders.unlocked && ship && ship.value >= 100 &&
            sci && sci.maxValue > 125000) return true;

        var dragons = dip.get("dragons");
        var fission = game.science && game.science.get && game.science.get("nuclearFission");
        if (dragons && !dragons.unlocked && fission && fission.researched) return true;

        return false;
    }

    function doAutoExplore() {
        if (!_exploreShouldFire(gamePage)) return;
        try {
            gamePage.resPool.addResEvent("manpower", -_EXPLORE_COST);
            var race = gamePage.diplomacy.unlockRandomRace();
            if (race) {
                gamePage.diplomacyTab.visible = true;
                try { gamePage.render(); } catch (e) { }
            } else {
                gamePage.resPool.addResEvent("manpower", _EXPLORE_COST);
            }
        } catch (e) { }
    }

    function doAutoSacrificeUnicorns() {
        var zig = gamePage.bld.get("ziggurat");
        if (!zig || zig.val === 0) return;
        var u = gamePage.resPool.get("unicorns");
        if (!u || u.value < 2500 || u.maxValue <= 0) return;
        if (u.value < u.maxValue * 0.95) return;
        if (_resourceReservedForRanked("unicorns")) return;
        try { executeSacrificeUnicorns(gamePage); gamePage.updateCaches(); } catch (e) { }
    }

    function doAutoSacrificeAlicorns() {
        var a = gamePage.resPool.get("alicorn");
        if (!a || a.value < 25) return;
        if (_resourceReservedForRanked("alicorn")) return;
        if (a.maxValue > 0 && a.value < a.maxValue * 0.95) return;
        try { executeSacrificeAlicorns(gamePage); gamePage.updateCaches(); } catch (e) { }
    }

    function doAutoFestival() {
        if (!gamePage.calendar) return;
        if ((gamePage.calendar.festivalDays || 0) >= 400) return;
        var mp = gamePage.resPool.get("manpower");
        var cu = gamePage.resPool.get("culture");
        var pa = gamePage.resPool.get("parchment");
        if (!mp || !cu || !pa) return;
        if (mp.value < 1500 || cu.value < 5000 || pa.value < 2500) return;
        if (mp.maxValue > 0 && mp.value < mp.maxValue * 0.80) return;
        if (cu.maxValue > 0 && cu.value < cu.maxValue * 0.80) return;
        if (pa.maxValue > 0 && pa.value < pa.maxValue * 0.80) return;
        try { executeFestival(gamePage); gamePage.updateCaches(); } catch (e) { }
    }

    function doAutoPraise() {
        if (!gamePage.religion) return;
        var faith = gamePage.resPool.get("faith");
        if (!faith || faith.maxValue <= 0) return;
        if (faith.value < faith.maxValue * 0.95) return;
        var reserve = cfg.faithPraiseReserve || 0;
        if (faith.value <= reserve) return;
        try { gamePage.religion.praise(); gamePage.updateCaches(); } catch (e) { }
    }

    // =========================================================================
    //  [M3] JOB ASSIGNMENT — EMA-smoothed farmers + stage-weighted split
    //
    //  Design goals (in order):
    //    1. Don't starve: keep catnip non-negative.
    //    2. Don't oscillate: smooth the catnip rate with an EMA and gate
    //       farmer add/shed by cooldowns.  Raw perTickCached flips sign
    //       every season and on every building tick; naive rules thrash.
    //    3. Surge the bottleneck: the resource blocking the highest-priority
    //       unaffordable building gets a weight bump proportional to how
    //       long it would take to accumulate at current rates.
    //    4. Don't waste: jobs whose output is at cap get zero weight, with
    //       hysteresis (re-enable at 75% so we don't ping-pong at 99%).
    //       Exception: scholar / priest / hunter outputs are CONSUMED, so
    //       capping them deadlocks the planner ("no faith production" →
    //       faith goal never committed).  Those always get weight.
    //    5. Rebalance only on actual changes: kitten count, stage, or
    //       bottleneck flip.  Every-tick clearJobs+assignJob is the primary
    //       source of visible flicker.
    // =========================================================================

    // Per-session state — resets on page reload.
    var _catnipProductionRate = 0;    // catnip/sec from perTickCached
    var _catnipRateEMA = null;         // smoothed
    var _lastFarmerShedTime = 0;
    var _lastFarmerAddTime = 0;
    var _lastStructuralHash = "";
    var _cappedJobs = {};              // job → true while its output is at cap
    var _lastTotalKittens = 0;
    var _lastSeasonForJobs = -1;
    var _seasonChangeTimeForJobs = 0;
    var _seasonRecalculated = true;

    var FARMER_EMA_ALPHA = 0.75;       // weight on new sample; higher = less smoothing
    var FARMER_SHED_COOLDOWN_BASE = 8000;  // slower to let go of farmers
    var FARMER_ADD_COOLDOWN_BASE  = 2000;  // faster to add on shortfall

    // Scale a wall-clock cooldown by speed multiplier so debounces feel the
    // same in game-time regardless of how fast the clock runs.
    function _effectiveCooldown(baseMs) {
        var mult = Math.max(1, cfg.speedMultiplier || 1);
        return Math.max(100, Math.round(baseMs / mult));
    }

    var RESOURCE_TO_JOB = {
        catnip: "farmer", wood: "woodcutter", minerals: "miner", iron: "miner",
        coal: "geologist", gold: "geologist", science: "scholar", faith: "priest",
        manpower: "hunter", beam: "woodcutter", scaffold: "woodcutter", slab: "miner",
        plate: "miner", steel: "geologist", gear: "geologist", alloy: "geologist",
        concrate: "miner",
    };

    var JOB_TO_RESOURCE = {
        woodcutter: "wood", miner: "minerals", scholar: "science",
        hunter: "manpower", priest: "faith", geologist: "coal",
    };

    // Jobs whose output is CONSUMED each tick (scholar → science burned by
    // research, priest → faith by religion upgrades, hunter → manpower by
    // crafting/trading).  Must NOT be capped-skipped: if we stop producing
    // science because it's at cap, the planner sees "no science production"
    // and refuses to commit to any tech goal, which deadlocks the agenda.
    var CONSUMABLE_JOBS = { scholar: 1, priest: 1, hunter: 1 };

    // Priority order for bottleneck detection.  Walks the list top-down and
    // picks the first unaffordable building whose price deficit maps to a
    // job — that's the job to surge.  Early-game foundational buildings come
    // first; late-game specialty structures later.
    var BUILDING_PRIORITY = [
        "field", "hut", "logHouse", "barn", "amphitheatre", "warehouse", "library",
        "academy", "mansion", "mine", "lumberMill", "workshop", "smelter", "temple",
        "chapel", "tradepost", "mint", "brewery", "harbor", "aqueduct", "observatory",
        "pasture", "oilWell", "steamworks", "magneto", "factory", "reactor", "biolab",
        "accelerator", "unicornPasture", "ziggurat", "calciner", "quarry", "chronosphere",
        "aiCore", "zebraOutpost", "zebraWorkshop", "zebraForge",
    ];

    // Update catnip rate from the game's own per-tick calculation.  Uses
    // perTickCached = net production (farmers + fields + pastures − kitten
    // food consumption).  Does NOT include crafting or construction spend,
    // so auto-crafting catnip→wood won't trigger a farmer panic.
    function updateCatnipProductionRate() {
        var r = gamePage.resPool.get("catnip");
        if (!r) return;
        var tps = gamePage.ticksPerSecond || 5;
        _catnipProductionRate = (r.perTickCached || 0) * tps;
    }

    function updateCatnipEMA() {
        if (_catnipRateEMA === null) _catnipRateEMA = _catnipProductionRate;
        else _catnipRateEMA = FARMER_EMA_ALPHA * _catnipRateEMA +
                              (1 - FARMER_EMA_ALPHA) * _catnipProductionRate;
    }

    // Return +1 / −1 / 0 for farmer count change.  Gated by cooldowns so
    // one bad season doesn't ping-pong.
    function calculateFarmerAdjustment() {
        if (!gamePage.resPool.get("catnip")) return 0;
        var now = Date.now();
        var farmerJob = (gamePage.village.jobs || []).find(function (j) { return j.name === "farmer"; });
        var currentFarmers = farmerJob ? (farmerJob.value || 0) : 0;
        if (_catnipRateEMA < -0.5 &&
            now - _lastFarmerAddTime > _effectiveCooldown(FARMER_ADD_COOLDOWN_BASE)) {
            _lastFarmerAddTime = now; return 1;
        }
        if (_catnipRateEMA > 1.0 && currentFarmers >= 2 &&
            now - _lastFarmerShedTime > _effectiveCooldown(FARMER_SHED_COOLDOWN_BASE)) {
            _lastFarmerShedTime = now; return -1;
        }
        return 0;
    }

    // Find the job blocking the highest-priority unaffordable building.
    // Severity scales by accumulation time (10s → 0.15, 300s+ → 1.0) so
    // short-wait bottlenecks get a gentle nudge and hard ones get a surge.
    function getBottleneckJob() {
        for (var pi = 0; pi < BUILDING_PRIORITY.length; pi++) {
            var bldName = BUILDING_PRIORITY[pi];
            var bld = gamePage.bld.get(bldName);
            if (!bld || !bld.unlocked) continue;
            var prices;
            try {
                var ext = gamePage.bld.getBuildingExt(bldName);
                prices = ext ? gamePage.bld.getPricesWithAccessor(ext) : bld.prices;
            } catch (e) { prices = bld.prices; }
            if (!prices || !prices.length) continue;
            if (gamePage.resPool.hasRes(prices)) continue;

            // Rank the prices by accumulation time (biggest deficit / rate).
            var ranked = [];
            for (var i = 0; i < prices.length; i++) {
                var r = gamePage.resPool.get(prices[i].name);
                if (!r) continue;
                var deficit = prices[i].val - r.value;
                if (deficit <= 0) continue;
                var rate = Math.max((r.perTickCached || 0) * (gamePage.ticksPerSecond || 5), 0.001);
                ranked.push({ name: prices[i].name, time: deficit / rate });
            }
            ranked.sort(function (a, b) { return b.time - a.time; });

            for (var ri = 0; ri < ranked.length; ri++) {
                if (RESOURCE_TO_JOB[ranked[ri].name]) {
                    var jobName = RESOURCE_TO_JOB[ranked[ri].name];
                    var severity = Math.min(Math.max((ranked[ri].time - 10) / 290, 0), 1) * 0.85 + 0.15;
                    return { job: jobName, severity: severity };
                }
            }
            break;  // first unaffordable building decides; don't scan deeper
        }
        return null;
    }

    // Stage-weighted base allocation.  As more jobs unlock we reduce the
    // share of the earlier ones (woodcutter went from 100% → 35% → 15% → 8%
    // across stages) so newly-unlocked specialties actually get staffed.
    function getStructuralWeights(availableJobs) {
        var has = function (n) { return availableJobs.some(function (j) { return j.name === n; }); };
        var w;
        if (!has("miner") && !has("scholar")) {
            w = { woodcutter: 100 };
        } else if (!has("priest") && !has("geologist")) {
            w = { woodcutter: 35, miner: has("miner") ? 35 : 0, hunter: has("hunter") ? 10 : 0, scholar: has("scholar") ? 20 : 0 };
        } else if (!has("engineer")) {
            w = { woodcutter: 15, miner: has("miner") ? 20 : 0, hunter: has("hunter") ? 10 : 0, scholar: has("scholar") ? 25 : 0, priest: has("priest") ? 15 : 0, geologist: has("geologist") ? 15 : 0 };
        } else {
            w = { woodcutter: 8, miner: has("miner") ? 10 : 0, hunter: has("hunter") ? 5 : 0, scholar: has("scholar") ? 20 : 0, priest: has("priest") ? 15 : 0, geologist: has("geologist") ? 12 : 0, engineer: has("engineer") ? 30 : 0 };
        }
        for (var k in w) if (!has(k)) delete w[k];
        return w;
    }

    // Hysteresis: zero a job's weight once its output hits 99.9%, re-enable
    // once it drops back below 75%.  Prevents 99% ↔ 100% ping-pong when a
    // single kitten's production is larger than 1% of cap.
    function applyCappedResourceAdjustments(weights) {
        for (var jobName in JOB_TO_RESOURCE) {
            if (weights[jobName] === undefined) continue;
            if (CONSUMABLE_JOBS[jobName]) continue;   // always produce these
            var r = gamePage.resPool.get(JOB_TO_RESOURCE[jobName]);
            if (!r || r.maxValue <= 0) continue;
            var ratio = r.value / r.maxValue;
            var wasCapped = _cappedJobs[jobName] || false;
            if (!wasCapped && ratio >= 0.999) { weights[jobName] = 0; _cappedJobs[jobName] = true; }
            else if (wasCapped && ratio <= 0.75) { _cappedJobs[jobName] = false; }
            else if (wasCapped) { weights[jobName] = 0; }
        }
    }

    // Compute per-job kitten targets.  Returns {targets, structuralHash};
    // structuralHash captures "which jobs are active + which is the current
    // bottleneck" so the caller can detect a state change and rebalance.
    function computeJobTargets(availableJobs, totalKittens, farmerOverride) {
        var has = function (n) { return availableJobs.some(function (j) { return j.name === n; }); };
        var farmerJob = availableJobs.find(function (j) { return j.name === "farmer"; });
        var currentFarmers = farmerOverride !== undefined
            ? farmerOverride : (farmerJob ? (farmerJob.value || 0) : 0);
        var adjustment = has("farmer") ? calculateFarmerAdjustment() : 0;
        var farmerCount = Math.max(0, currentFarmers + adjustment);
        var remaining = Math.max(0, totalKittens - farmerCount);
        if (remaining === 0) return { targets: { farmer: totalKittens }, structuralHash: "farmers_only" };

        var structuralWeights = getStructuralWeights(availableJobs);
        var bottleneck = getBottleneckJob();
        var structuralHash = JSON.stringify({
            jobs: Object.keys(structuralWeights).sort(),
            bottleneck: bottleneck ? bottleneck.job : "none"
        });

        var weights = {};
        for (var k in structuralWeights) weights[k] = structuralWeights[k];
        applyCappedResourceAdjustments(weights);

        var totalWeight = 0;
        for (var k in weights) totalWeight += weights[k];
        if (totalWeight === 0) return { targets: { farmer: totalKittens }, structuralHash: structuralHash };

        // Surge: give the bottleneck job a 15–60% kicker depending on how
        // long that resource would take to accumulate.
        if (bottleneck && weights[bottleneck.job] !== undefined && weights[bottleneck.job] > 0) {
            var surgePct = 0.15 + bottleneck.severity * 0.45;
            weights[bottleneck.job] += Math.round(remaining * surgePct);
        }

        // Hamilton apportionment — largest remainder on the fractional part
        // so every kitten gets assigned without integer rounding drift.
        var newTotalWeight = 0;
        for (var k in weights) newTotalWeight += weights[k];
        var targets = { farmer: farmerCount };
        var fractionals = [];
        var floorSum = 0;
        for (var jobName in weights) {
            if (weights[jobName] > 0) {
                var exact = (weights[jobName] / newTotalWeight) * remaining;
                var floored = Math.floor(exact);
                targets[jobName] = floored;
                floorSum += floored;
                fractionals.push({ job: jobName, frac: exact - floored });
            }
        }
        var remainder = remaining - floorSum;
        fractionals.sort(function (a, b) { return b.frac - a.frac; });
        for (var i = 0; i < fractionals.length && remainder > 0; i++) { targets[fractionals[i].job]++; remainder--; }

        // Safety clamp: if rounding overshoots total, trim from the largest
        // non-farmer buckets so catnip floor stays honoured.
        var sum = 0;
        for (var k in targets) sum += targets[k];
        if (sum > totalKittens) {
            var order = Object.keys(targets).filter(function (k) { return k !== "farmer"; })
                .sort(function (a, b) { return targets[b] - targets[a]; });
            for (var i = 0; i < order.length && sum > totalKittens; i++) {
                var cut = Math.min(targets[order[i]], sum - totalKittens);
                targets[order[i]] -= cut; sum -= cut;
            }
        }
        return { targets: targets, structuralHash: structuralHash };
    }

    function doAutoJobs() {
        if (!gamePage.village || !gamePage.village.sim) return;
        var kittens = gamePage.village.sim.kittens;
        if (!kittens || !kittens.length) return;
        var total = kittens.length;
        var jobs = gamePage.village.jobs || [];
        var available = jobs.filter(function (j) { return j.unlocked; });
        if (!available.length) return;

        // Season-change debounce: don't react to the first few ticks of a
        // new season (winter's -catnip swing is huge).  Wait 5s, then mark
        // for recalc on the next cycle.
        var currentSeason = gamePage.calendar ? gamePage.calendar.season : -1;
        // Spring (season 0) entry from winter (season 3): immediate reset.
        // Winter's scarcity skew makes the in-place nudge logic slow to
        // reconverge on the optimal spring distribution.
        var springWakeup = (_lastSeasonForJobs === 3 && currentSeason === 0);
        if (_lastSeasonForJobs !== -1 && _lastSeasonForJobs !== currentSeason) {
            _seasonChangeTimeForJobs = Date.now();
            _seasonRecalculated = false;
        }
        _lastSeasonForJobs = currentSeason;
        var delayedSeasonChange = false;
        if (!_seasonRecalculated &&
            (Date.now() - _seasonChangeTimeForJobs > _effectiveCooldown(5000))) {
            delayedSeasonChange = true;
            _seasonRecalculated = true;
        }
        if (springWakeup) {
            delayedSeasonChange = true;
            _seasonRecalculated = true;
            // Wipe winter's biases so the recompute starts fresh.
            _catnipRateEMA = null;
            _lastFarmerAddTime = 0;
            _cappedJobs = {};
        }

        updateCatnipEMA();
        var result = computeJobTargets(available, total);
        var targets = result.targets;
        var structuralHash = result.structuralHash;
        if (!Object.keys(targets).length) return;

        var populationChanged = (total !== _lastTotalKittens);
        var structureChanged = (structuralHash !== _lastStructuralHash);

        // Full rebalance: kitten count changed, jobs/bottleneck shifted, or
        // we're consuming the post-season-change grace period.
        if (populationChanged || structureChanged || delayedSeasonChange) {
            _lastTotalKittens = total;
            _lastStructuralHash = structuralHash;
            _cappedJobs = {};
            var farmerJob = available.find(function (j) { return j.name === "farmer"; });
            var preClearFarmers = farmerJob ? (farmerJob.value || 0) : 0;
            try { gamePage.village.clearJobs(true); } catch (e) { }
            _lastFarmerAddTime = 0;
            // Recompute with pre-clear farmer count so the EMA logic doesn't
            // see "0 farmers → crisis" right after the wipe.
            // Exception: spring wakeup — force a full recompute from zero so
            // winter's farmer pile doesn't re-seed the new distribution.
            result = computeJobTargets(available, total, springWakeup ? 0 : preClearFarmers);
            targets = result.targets;
        }

        // Emergency farmer floor — if EMA is deeply negative but we ended
        // up with 0 farmers (surge ate them), carve out 10% of pop for
        // farming by trimming the largest other bucket.
        if (_catnipRateEMA !== null && _catnipRateEMA < -0.5 && (targets["farmer"] || 0) === 0) {
            var emergencyFarmers = Math.max(1, Math.ceil(total * 0.10));
            targets["farmer"] = emergencyFarmers;
            var largest = Object.keys(targets).filter(function (k) { return k !== "farmer"; })
                .sort(function (a, b) { return targets[b] - targets[a]; })[0];
            if (largest) targets[largest] = Math.max(0, targets[largest] - emergencyFarmers);
        }

        var needsReassign = available.some(function (j) { return (j.value || 0) !== (targets[j.name] || 0); });
        if (!needsReassign) return;

        try { gamePage.village.clearJobs(true); } catch (e) { }
        // Farmer first so catnip floor is paid before surge assignments.
        var assignOrder = Object.keys(targets).sort(function (a, b) {
            if (a === "farmer") return -1; if (b === "farmer") return 1;
            return targets[b] - targets[a];
        });
        for (var i = 0; i < assignOrder.length; i++) {
            var count = targets[assignOrder[i]] || 0;
            if (count <= 0) continue;
            var job = available.find(function (j) { return j.name === assignOrder[i]; });
            if (!job) continue;
            try { gamePage.village.assignJob(job, count); }
            catch (e) { job.value = (job.value || 0) + count; }
        }

        // Reconcile: whatever leftover kittens the assign loop couldn't place
        // (target referenced an unavailable job, assignJob short-assigned, etc.)
        // get dumped into a real job so nobody sits idle.
        try {
            var free = gamePage.village.getFreeKittens ? gamePage.village.getFreeKittens() : 0;
            if (free > 0) {
                var fallback = available.find(function (j) { return j.name === "farmer"; })
                    || available.find(function (j) { return j.name === "woodcutter"; })
                    || available[0];
                if (fallback) {
                    try { gamePage.village.assignJob(fallback, free); }
                    catch (e) { fallback.value = (fallback.value || 0) + free; }
                }
            }
        } catch (e) { }
    }
