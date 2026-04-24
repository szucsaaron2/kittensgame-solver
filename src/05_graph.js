    // =========================================================================
    //  [GRAPH] DIAGNOSTIC SCRAPE DUMP
    //  Pure read-only scrape of the live game state into a node/edge graph
    //  we can validate by eye before building a planner on top of it.
    //
    //  Expose:
    //    window.__scrapeGraph()  -> graph object
    //    window.__dumpGraph()    -> prints formatted dump to console
    //    window.__dumpGraphText()-> returns the dump as a string
    // =========================================================================

    // ── resource constants (from village.js) ─────────────────────────────
    var CATNIP_PER_KITTEN_TICK = -0.85;
    var KITTENS_PER_TICK_BASE  = 0.01;

    function _r(n, d) { return Math.round(n * Math.pow(10, d || 3)) / Math.pow(10, d || 3); }

    // ── node id helpers ──────────────────────────────────────────────────
    function _id(kind, name) { return kind + ":" + name; }

    // ── scrape: resources ────────────────────────────────────────────────
    function _scrapeResources(game) {
        var out = {};
        var arr = (game.resPool && game.resPool.resources) || [];
        for (var i = 0; i < arr.length; i++) {
            var r = arr[i];
            out[r.name] = {
                id: _id("res", r.name),
                kind: "res",
                name: r.name,
                value: r.value || 0,
                perTick: r.perTickCached || 0,
                maxValue: r.maxValue || 0,
                craftable: r.craftable || false,
                unlocked: r.unlocked || false
            };
        }
        return out;
    }

    // ── scrape: building (one node per building, covering stages) ────────
    function _bldEffects(meta) {
        // Return the effects dict actually active at the current stage,
        // same logic as the planner's _effectiveEffects.
        if (!meta) return null;
        if (meta.stages && meta.stages.length > 0) {
            var s = meta.stages[meta.stage || 0];
            if (s && s.effects) return s.effects;
        }
        return meta.effects || null;
    }
    function _bldPrices(game, meta) {
        // Live scaled prices via the UI controller, matching getBuildingPrices.
        try {
            var c = new classes.ui.btn.BuildingBtnModernController(game);
            var m = c.fetchModel({ key: meta.name, building: meta.name });
            var p = c.getPrices(m);
            if (p && p.length > 0) return p;
        } catch (e) { }
        if (!meta.prices) return null;
        return meta.prices.map(function (p) {
            return { name: p.name, val: p.val * Math.pow(meta.priceRatio || 1.15, meta.val || 0) };
        });
    }
    function _scrapeBuildings(game) {
        var out = [];
        var arr = (game.bld && game.bld.buildingsData) || [];
        for (var i = 0; i < arr.length; i++) {
            var meta = arr[i];
            var stageEffects = _bldEffects(meta);
            var stagePrices  = _bldPrices(game, meta);
            var stageUnlocks = meta.unlocks || {};
            var numStages = (meta.stages && meta.stages.length) || 1;
            out.push({
                id: _id("bld", meta.name),
                kind: "bld",
                name: meta.name,
                val: meta.val || 0,
                on: meta.on || 0,
                unlocked: !!meta.unlocked,
                unlockable: !!meta.unlockable,
                defaultUnlockable: !!meta.defaultUnlockable,
                unlockScheme: meta.unlockScheme || null,
                stage: meta.stage || 0,
                numStages: numStages,
                priceRatio: meta.priceRatio || 1,
                prices: stagePrices || [],
                effects: stageEffects || {},
                unlocks: stageUnlocks,
                consumer: _isConsumer(stageEffects)
            });
        }
        return out;
    }
    function _isConsumer(effects) {
        if (!effects) return false;
        for (var k in effects) {
            if (!effects.hasOwnProperty(k)) continue;
            if (k.indexOf("PerTickCon") >= 0 && effects[k] < 0) return true;
        }
        return false;
    }

    // ── scrape: space buildings ──────────────────────────────────────────
    function _scrapeSpaceBuildings(game) {
        var out = [];
        if (!game.space || !game.space.planets) return out;
        for (var p = 0; p < game.space.planets.length; p++) {
            var planet = game.space.planets[p];
            var bs = planet.buildings || [];
            for (var i = 0; i < bs.length; i++) {
                var meta = bs[i];
                out.push({
                    id: _id("space_bld", meta.name),
                    kind: "space_bld",
                    name: meta.name,
                    planet: planet.name,
                    val: meta.val || 0,
                    on: meta.on || 0,
                    unlocked: !!meta.unlocked,
                    priceRatio: meta.priceRatio || 1.05,
                    prices: meta.prices || [],
                    effects: meta.effects || {},
                    unlocks: meta.unlocks || {}
                });
            }
        }
        return out;
    }

    // ── scrape: jobs ─────────────────────────────────────────────────────
    function _scrapeJobs(game) {
        var out = [];
        var arr = (game.village && game.village.jobs) || [];
        for (var i = 0; i < arr.length; i++) {
            var j = arr[i];
            // Job mods may be set lazily by calculateEffects.
            if (typeof j.calculateEffects === "function") {
                try { j.calculateEffects(j, game); } catch (e) { }
            }
            out.push({
                id: _id("job", j.name),
                kind: "job",
                name: j.name,
                unlocked: !!j.unlocked,
                value: j.value || 0,
                modifiers: j.modifiers || {}
            });
        }
        return out;
    }

    // ── scrape: crafts ───────────────────────────────────────────────────
    function _scrapeCrafts(game) {
        var out = [];
        var arr = (game.workshop && game.workshop.crafts) || [];
        for (var i = 0; i < arr.length; i++) {
            var c = arr[i];
            var inputs = null;
            try { inputs = game.workshop.getCraftPrice(c); } catch (e) { }
            var ratio = 0;
            try { ratio = game.getResCraftRatio({ name: c.name }) || 0; } catch (e) { }
            out.push({
                id: _id("craft", c.name),
                kind: "craft",
                name: c.name,
                unlocked: !!c.unlocked,
                tier: c.tier || 0,
                ignoreBonuses: !!c.ignoreBonuses,
                inputs: inputs || [],
                output: { name: c.name, amt: 1 + (c.ignoreBonuses ? 0 : ratio) }
            });
        }
        return out;
    }

    // ── scrape: techs ────────────────────────────────────────────────────
    function _scrapeTechs(game) {
        var out = [];
        var arr = (game.science && game.science.techs) || [];
        for (var i = 0; i < arr.length; i++) {
            var t = arr[i];
            out.push({
                id: _id("tech", t.name),
                kind: "tech",
                name: t.name,
                unlocked: !!t.unlocked,
                researched: !!t.researched,
                prices: t.prices || [],
                unlocks: t.unlocks || {}
            });
        }
        return out;
    }

    // ── scrape: upgrades (workshop + religion) ───────────────────────────
    function _scrapeUpgrades(game) {
        var out = [];
        function push(kind, u) {
            out.push({
                id: _id(kind, u.name),
                kind: kind,
                name: u.name,
                unlocked: !!u.unlocked,
                researched: !!u.researched,
                val: u.val || 0,
                noStackable: !!u.noStackable,
                prices: u.prices || [],
                effects: u.effects || {},
                unlocks: u.unlocks || {}
            });
        }
        var ws = (game.workshop && game.workshop.upgrades) || [];
        for (var i = 0; i < ws.length; i++) push("ws_upg", ws[i]);
        if (game.religion) {
            var pools = [
                ["ru", game.religion.religionUpgrades || []],
                ["zu", game.religion.zigguratUpgrades || []],
                ["tu", game.religion.transcendenceUpgrades || []]
            ];
            for (var p = 0; p < pools.length; p++) {
                var arr = pools[p][1];
                for (var j = 0; j < arr.length; j++) push("rel_upg_" + pools[p][0], arr[j]);
            }
        }
        return out;
    }

    // ── scrape: space missions ───────────────────────────────────────────
    function _scrapeSpaceMissions(game) {
        var out = [];
        var arr = (game.space && game.space.programs) || [];
        for (var i = 0; i < arr.length; i++) {
            var p = arr[i];
            out.push({
                id: _id("mission", p.name),
                kind: "mission",
                name: p.name,
                unlocked: !!p.unlocked,
                researched: !!p.researched,
                prices: p.prices || [],
                unlocks: p.unlocks || {}
            });
        }
        return out;
    }

    // ── scrape: policies ─────────────────────────────────────────────────
    function _scrapePolicies(game) {
        var out = [];
        var arr = (game.science && game.science.policies) || [];
        for (var i = 0; i < arr.length; i++) {
            var p = arr[i];
            out.push({
                id: _id("policy", p.name),
                kind: "policy",
                name: p.name,
                unlocked: !!p.unlocked,
                researched: !!p.researched,
                blocked: !!p.blocked,
                prices: p.prices || [],
                unlocks: p.unlocks || {}
            });
        }
        return out;
    }

    // ── scrape: races (synthetic — used to gate embassies) ───────────────
    function _scrapeRaces(game) {
        var out = [];
        var arr = (game.diplomacy && game.diplomacy.races) || [];
        for (var i = 0; i < arr.length; i++) {
            var r = arr[i];
            out.push({
                id: _id("race", r.name),
                kind: "race",
                name: r.name,
                unlocked: !!r.unlocked,
                hidden: !!r.hidden
            });
        }
        return out;
    }

    // ── scrape: embassies ────────────────────────────────────────────────
    function _scrapeEmbassies(game) {
        var out = [];
        if (!game.diplomacy || !game.diplomacy.races) return out;
        for (var i = 0; i < game.diplomacy.races.length; i++) {
            var r = game.diplomacy.races[i];
            if (!r.embassyPrices) continue;
            out.push({
                id: _id("embassy", r.name),
                kind: "embassy",
                name: r.name,
                unlocked: !!r.unlocked,
                level: r.embassyLevel || 0,
                prices: typeof getEmbassyPrices === "function" ? (getEmbassyPrices(game, r) || []) : r.embassyPrices,
                buys: r.buys || [],
                sells: r.sells || []
            });
        }
        return out;
    }

    // ── scrape: population model ─────────────────────────────────────────
    function _scrapePopulation(game) {
        var v = game.village || {};
        var sim = v.sim || {};
        var kittens = (sim.kittens && sim.kittens.length) || 0;
        var capacity = v.maxKittens || 0;
        var catnip = game.resPool && game.resPool.get("catnip");
        var catnipPerTick = catnip ? catnip.perTickCached : 0;
        var catnipValue = catnip ? catnip.value : 0;
        var consumption = kittens * CATNIP_PER_KITTEN_TICK; // negative
        var netCatnip = catnipPerTick;  // perTickCached already includes kitten consumption
        var growthActive = catnipValue > 0 || netCatnip > 0;

        // Leader — bonus applies to all same-job kittens via boostFromLeader.
        var leader = null;
        if (v.leader) {
            leader = {
                name: (v.leader.name || "") + " " + (v.leader.surname || ""),
                job: v.leader.job || null,
                rank: v.leader.rank || 0,
                trait: v.leader.trait && v.leader.trait.name,
                bonus: (typeof v.getLeaderBonus === "function") ? v.getLeaderBonus(v.leader.rank || 0) : 1
            };
        }
        // Average skill level per job (affects per-kitten production).
        var skillSum = {}, skillCount = {};
        var sims = sim.kittens || [];
        for (var i = 0; i < sims.length; i++) {
            var k = sims[i];
            if (!k.job) continue;
            var s = (k.skills && k.skills[k.job]) || 0;
            skillSum[k.job]   = (skillSum[k.job]   || 0) + s;
            skillCount[k.job] = (skillCount[k.job] || 0) + 1;
        }
        var avgSkill = {};
        for (var j in skillSum) avgSkill[j] = skillSum[j] / skillCount[j];

        return {
            kittens: kittens,
            capacity: capacity,
            free: Math.max(0, kittens - _assignedKittens(v)),
            assigned: _assignedKittens(v),
            growthPerTickBase: KITTENS_PER_TICK_BASE,
            catnipPerKittenPerTick: CATNIP_PER_KITTEN_TICK,
            totalKittenConsumption: consumption,
            netCatnipPerTick: netCatnip,
            growthActive: growthActive,
            happiness: v.happiness || 1,
            leader: leader,
            avgSkillByJob: avgSkill
        };
    }
    function _assignedKittens(village) {
        var sum = 0;
        var jobs = village.jobs || [];
        for (var i = 0; i < jobs.length; i++) sum += (jobs[i].value || 0);
        return sum;
    }

    // ── derive: producer index (res -> [sources]) ────────────────────────
    // Each "source" is {kind, id, rate, note}. Rate is per-tick (or per-kitten
    // for jobs). Ratio-kind producers list with rate = null, note = "ratio:X".
    var _PROD_SUFFIXES_G = ["PerTickBase", "PerTickAutoprod", "PerTickProd"];
    function _indexProducers(graph) {
        var idx = {}; // res -> []
        function add(res, entry) { (idx[res] = idx[res] || []).push(entry); }

        // Buildings (current stage only, honouring val for realised rate).
        for (var i = 0; i < graph.buildings.length; i++) {
            var b = graph.buildings[i];
            for (var k in b.effects) {
                if (!b.effects.hasOwnProperty(k)) continue;
                var v = b.effects[k];
                if (!(v > 0 || v < 0)) continue;
                var hit = _parseEffectKey(k);
                if (!hit) continue;
                add(hit.res, {
                    kind: "bld", id: b.id, name: b.name,
                    rate: (hit.kind === "prod") ? v : null,
                    mode: hit.kind,         // prod | storage | ratio | demand_ratio | con
                    perLevel: v
                });
            }
        }
        // Space buildings
        for (var i = 0; i < graph.spaceBuildings.length; i++) {
            var b = graph.spaceBuildings[i];
            for (var k in b.effects) {
                if (!b.effects.hasOwnProperty(k)) continue;
                var v = b.effects[k]; if (!(v > 0 || v < 0)) continue;
                var hit = _parseEffectKey(k); if (!hit) continue;
                add(hit.res, {
                    kind: "space_bld", id: b.id, name: b.name,
                    rate: (hit.kind === "prod") ? v : null, mode: hit.kind, perLevel: v
                });
            }
        }
        // Jobs (rate is per-kitten-per-tick)
        for (var i = 0; i < graph.jobs.length; i++) {
            var j = graph.jobs[i];
            for (var rn in j.modifiers) {
                if (!j.modifiers.hasOwnProperty(rn)) continue;
                add(rn, {
                    kind: "job", id: j.id, name: j.name,
                    rate: j.modifiers[rn], mode: "prod_per_kitten"
                });
            }
        }
        // Crafts (output side)
        for (var i = 0; i < graph.crafts.length; i++) {
            var c = graph.crafts[i];
            add(c.name, {
                kind: "craft", id: c.id, name: c.name,
                rate: null, mode: "craft",
                inputs: c.inputs
            });
        }
        return idx;
    }

    // Parse effect key into {res, kind}. kind ∈ prod|storage|ratio|demand_ratio|con|other.
    function _parseEffectKey(k) {
        for (var s = 0; s < _PROD_SUFFIXES_G.length; s++) {
            var suf = _PROD_SUFFIXES_G[s];
            if (k.length > suf.length && k.slice(-suf.length) === suf) {
                return { res: k.slice(0, -suf.length), kind: "prod" };
            }
        }
        if (k.length > 3 && k.slice(-3) === "Max") {
            return { res: k.slice(0, -3), kind: "storage" };
        }
        if (k.length > 5 && k.slice(-5) === "Ratio") {
            var stem = k.slice(0, -5);
            if (stem.length > 6 && stem.slice(-6) === "Demand") {
                return { res: stem.slice(0, -6), kind: "demand_ratio" };
            }
            return { res: stem, kind: "ratio" };
        }
        if (k.indexOf("PerTickCon") >= 0) {
            return { res: k.slice(0, k.indexOf("PerTickCon")), kind: "con" };
        }
        return null;
    }

    // ── computed production view — replicates game.calcResourcePerTick
    // (game.js:3174) using getEffect aggregation.  Each res returns a stack
    // of {name, type:fixed|ratio, value} entries so the planner can perturb
    // any single layer and recompute.  Job-ratio maps mirror AutoJob's
    // RESOURCE_TO_JOB / JOB_TO_RESOURCE so we share one source of truth.
    function _computeProduction(game, graph) {
        var out = {};
        var jobMap = {};
        try {
            if (game.village && typeof game.village.getResProduction === "function") {
                jobMap = game.village.getResProduction() || {};
            }
        } catch (e) { }
        var conMap = {};
        try {
            if (game.village && typeof game.village.getResConsumption === "function") {
                conMap = game.village.getResConsumption() || {};
            }
        } catch (e) { }

        // Candidate resources: anything with a PerTickBase, job contribution,
        // or that appears in graph.producers.
        var candidates = {};
        for (var rn in graph.resources) candidates[rn] = 1;
        for (var rn in jobMap)           candidates[rn] = 1;

        var resNames = Object.keys(candidates);
        for (var ri = 0; ri < resNames.length; ri++) {
            var R = resNames[ri];
            out[R] = _computeOneResource(game, graph, R, jobMap, conMap);
        }
        return out;
    }

    function _effect(game, key) {
        try { return game.getEffect(key) || 0; } catch (e) { return 0; }
    }
    function _weatherMod(game, resName) {
        try {
            var resObj = game.resPool.get(resName);
            return game.calendar.getWeatherMod(resObj);
        } catch (e) { return 1; }
    }
    function _paragonRatio(game) {
        try { return game.prestige.getParagonProductionRatio() || 0; } catch (e) { return 0; }
    }
    function _hgScaling(game) {
        try { return game.religion.getHGScalingBonus() || 1; } catch (e) { return 1; }
    }

    function _computeOneResource(game, graph, R, jobMap, conMap) {
        var stack = [];
        var push = function (name, type, value) { stack.push({ name: name, type: type, value: value }); };
        var perTick = 0;

        // 1. Building PerTickBase (aggregated).
        var base = _effect(game, R + "PerTickBase");
        push("bldBase", "fixed", base);
        perTick = base;

        // 2. Space PerTickBase.
        var spaceRatio = 1 + _effect(game, "spaceRatio");
        var spaceBase  = _effect(game, R + "PerTickBaseSpace") * spaceRatio;
        if (spaceBase) { push("spaceBase", "fixed", spaceBase); perTick += spaceBase; }

        // 3. Weather × season modifier (catnip mostly).
        var weather = _weatherMod(game, R);
        if (weather !== 1) { push("weather", "ratio", weather - 1); perTick *= weather; }

        // 4. Village jobs (raw production, happiness×skill×leader already applied).
        var jobRaw  = jobMap[R] || 0;
        var hgScale = _hgScaling(game);
        var jobAdj  = jobRaw * hgScale;
        if (jobAdj) { push("jobs", "fixed", jobAdj); perTick += jobAdj; }

        // 5. Workshop job-ratio upgrade (e.g. catnipJobRatio from hoes).
        var jobRatio = _effect(game, R + "JobRatio");
        var jobBoost = jobAdj * jobRatio;
        if (jobBoost) { push("jobUpgrades(" + R + "JobRatio)", "fixed", jobBoost); perTick += jobBoost; }

        // 6. Ratios (applied multiplicatively on accumulated perTick).
        var globalR = _effect(game, R + "GlobalRatio");
        if (globalR) { push("globalRatio", "ratio", globalR); perTick *= 1 + globalR; }
        var bldR = _effect(game, R + "Ratio");
        if (bldR) { push("bldRatio", "ratio", bldR); perTick *= 1 + bldR; }
        var relR = _effect(game, R + "RatioReligion");
        if (relR) { push("religionRatio", "ratio", relR); perTick *= 1 + relR; }
        var supR = _effect(game, R + "SuperRatio");
        if (supR) { push("superRatio", "ratio", supR); perTick *= 1 + supR; }

        // 7. Steamworks hack (coal): {R}RatioGlobal on steamworks when on.
        try {
            var sw = game.bld.get("steamworks");
            if (sw && sw.on > 0 && sw.effects && sw.effects[R + "RatioGlobal"]) {
                var swG = sw.effects[R + "RatioGlobal"];
                push("steamworksRatioGlobal", "ratio", swG); perTick *= 1 + swG;
            }
        } catch (e) { }

        // 8. Paragon.
        var paragon = _paragonRatio(game);
        if (R === "catnip") {
            try { if (game.challenges.isActive("winterIsComing")) paragon = 0; } catch (e) { }
        }
        if (paragon) { push("paragon", "ratio", paragon); perTick *= 1 + paragon; }

        // 9. Catnip pollution.
        if (R === "catnip") {
            try {
                var pol = (game.bld.pollutionEffects && game.bld.pollutionEffects["catnipPollutionRatio"]) || 0;
                if (pol) { push("pollution", "ratio", pol); perTick *= 1 + pol; }
            } catch (e) { }
        }

        // 10. Autoprod (smelters, calciners).
        var autoprod = _effect(game, R + "PerTickAutoprod");
        if (autoprod) {
            var pSpace = 1 + paragon * 0.05;
            var rankBonus = 1 + _effect(game, "rankLeaderBonusConversion") *
                ((game.village && game.village.leader) ? game.village.leader.rank : 0);
            var apAdj = autoprod * pSpace * rankBonus;
            push("autoprod", "fixed", apAdj); perTick += apAdj;
        }

        // 11. Magneto + reactor bonuses (not catnip).
        try {
            var res = game.resPool.get(R);
            if (res && !res.transient && game.bld.get("magneto").on > 0 && R !== "catnip") {
                var sw = game.bld.get("steamworks");
                var swRatio = (sw && sw.on > 0) ? (1 + sw.effects["magnetoBoostRatio"] * sw.on) : 1;
                if (R !== "oil") {
                    var mag = _effect(game, "magnetoRatio") * swRatio;
                    if (mag) { push("magneto", "ratio", mag); perTick *= 1 + mag; }
                }
            }
            if (res && !res.transient && R !== "uranium" && R !== "catnip") {
                var prR = _effect(game, "productionRatio");
                if (prR) { push("reactor", "ratio", prR); perTick *= 1 + prR; }
            }
        } catch (e) { }

        // 12. Solar revolution faith bonus.
        try {
            var sr = game.religion.getSolarRevolutionRatio() || 0;
            if (sr) {
                var srPollutionBoost = 0;
                if (R === "wood" || R === "catnip") {
                    srPollutionBoost = (game.bld.pollutionEffects &&
                        game.bld.pollutionEffects["solarRevolutionPollution"]) || 0;
                }
                var srEff = sr * (1 + srPollutionBoost);
                push("solarRev", "ratio", srEff); perTick *= 1 + srEff;
            }
        } catch (e) { }

        // 13. CMBR.
        try {
            if (!game.opts.disableCMBR && R !== "coal") {
                var cmbr = game.getCMBRBonus ? game.getCMBRBonus() : 0;
                if (cmbr) { push("cmbr", "ratio", cmbr); perTick *= 1 + cmbr; }
            }
        } catch (e) { }

        // 14. PerTickProd (automated building prod, flat).
        var tickProd = _effect(game, R + "PerTickProd");
        if (tickProd) { push("perTickProd", "fixed", tickProd); perTick += tickProd; }

        // 15. PerTick + PerTickRatio.
        var pt = _effect(game, R + "PerTick") * (1 + _effect(game, R + "PerTickRatio"));
        if (pt) { push("perTick", "fixed", pt); perTick += pt; }

        // 16. Consumption (kitten catnip + DemandRatio modifier + happiness).
        var con = conMap[R] || 0;
        if (con) {
            var demandR = _effect(game, R + "DemandRatio");
            con = con * (1 + demandR);
            if (R === "catnip" && game.village.sim.kittens.length > 0 && game.village.happiness > 1) {
                var hapCon = Math.max(game.village.happiness *
                    (1 + _effect(game, "hapinnessConsumptionRatio")) - 1, 0);
                var freeMod = 1 - (game.village.getFreeKittens() / game.village.sim.kittens.length);
                con += con * hapCon * (1 + _effect(game, R + "DemandWorkerRatioGlobal")) * freeMod;
            }
            push("consumption", "fixed", con); perTick += con;
        }

        // 17. Policy ratio (necrocracy + policyRatio).
        var polR = _effect(game, R + "PolicyRatio");
        if (polR) { push("policy", "ratio", polR); perTick *= 1 + polR; }

        // Ground truth.
        var r = graph.resources[R];
        var cached = r ? r.perTick : 0;
        return { stack: stack, estimate: perTick, cached: cached, diff: perTick - cached };
    }

    // Pollution isn't a resPool resource; it lives on bld.cathPollution with
    // derived ratios stored in bld.pollutionEffects. Expose it as a pseudo
    // for completeness (planner needs to know when pollution is suppressing
    // catnip / wood / boosting solar-rev malus).
    function _scrapePollution(game) {
        try {
            return {
                value: (game.bld && game.bld.cathPollution) || 0,
                effects: (game.bld && game.bld.pollutionEffects) || {}
            };
        } catch (e) { return { value: 0, effects: {} }; }
    }

    // ── top-level scrape ─────────────────────────────────────────────────
    function scrapeGraph(game) {
        if (!game || !game.bld) return null;
        var g = {
            resources:       _scrapeResources(game),
            buildings:       _scrapeBuildings(game),
            spaceBuildings:  _scrapeSpaceBuildings(game),
            jobs:            _scrapeJobs(game),
            crafts:          _scrapeCrafts(game),
            techs:           _scrapeTechs(game),
            upgrades:        _scrapeUpgrades(game),
            missions:        _scrapeSpaceMissions(game),
            embassies:       _scrapeEmbassies(game),
            policies:        _scrapePolicies(game),
            races:           _scrapeRaces(game),
            population:      _scrapePopulation(game),
            pollution:       _scrapePollution(game)
        };
        g.producers = _indexProducers(g);
        g.computed   = _computeProduction(game, g);
        return g;
    }

    // ── dump formatter ───────────────────────────────────────────────────
    function _fmtPrices(p) {
        if (!p || p.length === 0) return "—";
        return p.map(function (x) { return _r(x.val, 2) + " " + x.name; }).join(", ");
    }
    function _fmtUnlocks(u) {
        if (!u) return "";
        var parts = [];
        if (u.tabs      && u.tabs.length)      parts.push("tabs=" + u.tabs.join(","));
        if (u.jobs      && u.jobs.length)      parts.push("jobs=" + u.jobs.join(","));
        if (u.buildings && u.buildings.length) parts.push("bld=" + u.buildings.join(","));
        if (u.crafts    && u.crafts.length)    parts.push("crafts=" + u.crafts.join(","));
        if (u.upgrades  && u.upgrades.length)  parts.push("upg=" + u.upgrades.join(","));
        if (u.tech      && u.tech.length)      parts.push("tech=" + u.tech.join(","));
        if (u.policies  && u.policies.length)  parts.push("pol=" + u.policies.join(","));
        if (u.stages    && u.stages.length)    parts.push("stages=" + u.stages.length);
        return parts.join("; ");
    }
    function _fmtEffects(e) {
        if (!e) return "";
        var parts = [];
        for (var k in e) {
            if (!e.hasOwnProperty(k)) continue;
            if (e[k] === 0) continue;
            parts.push(k + "=" + _r(e[k], 4));
        }
        return parts.join(", ");
    }

    function dumpGraphText(graph) {
        if (!graph) return "(no graph)";
        var lines = [];
        function W(s) { lines.push(s); }

        W("=== GRAPH DUMP ===");
        W("");

        // POPULATION
        var p = graph.population;
        W("POPULATION");
        W("  kittens: " + p.kittens + " / capacity " + p.capacity +
          "  (assigned " + p.assigned + ", free " + p.free + ")");
        W("  growth base: " + p.growthPerTickBase + "/tick, happiness x" + _r(p.happiness, 2));
        W("  consumption: " + _r(p.catnipPerKittenPerTick, 3) + " catnip/tick/kitten (= " +
          _r(p.totalKittenConsumption, 3) + " total)");
        W("  net catnip/tick: " + _r(p.netCatnipPerTick, 3) +
          (p.growthActive ? "  (growth active)" : "  (starving)"));
        if (p.leader) {
            W("  leader: " + p.leader.name + " (" + (p.leader.job || "—") +
              ", rank " + p.leader.rank + ", trait " + (p.leader.trait || "—") +
              ", bonus x" + _r(p.leader.bonus, 3) + ")");
        } else {
            W("  leader: (none)");
        }
        var asKeys = Object.keys(p.avgSkillByJob || {});
        if (asKeys.length) {
            var parts = [];
            for (var i = 0; i < asKeys.length; i++) {
                parts.push(asKeys[i] + "=" + _r(p.avgSkillByJob[asKeys[i]], 1));
            }
            W("  avg skill xp by job: " + parts.join(", "));
        }
        W("");

        // RESOURCES
        W("RESOURCES");
        var resNames = Object.keys(graph.resources).sort();
        for (var i = 0; i < resNames.length; i++) {
            var r = graph.resources[resNames[i]];
            if (!r.unlocked && r.value === 0 && r.perTick === 0) continue;
            W("  " + _pad(r.name, 14) +
              " val=" + _pad(_r(r.value, 2), 10) +
              " rate=" + _pad(_r(r.perTick, 4), 10) +
              " max=" + _pad(_r(r.maxValue, 2), 10));
        }
        W("");

        // BUILDINGS — split into unlocked-and-relevant vs locked
        W("BUILDINGS (unlocked or built)");
        var lockedBlds = [];
        for (var i = 0; i < graph.buildings.length; i++) {
            var b = graph.buildings[i];
            if (!b.unlocked && b.val === 0) { lockedBlds.push(b); continue; }
            var gate = b.unlocked ? "ok" : "LOCKED";
            var stageStr = (b.numStages > 1) ? ("stage " + b.stage + "/" + (b.numStages - 1) + ", ") : "";
            var flags = [];
            if (b.defaultUnlockable) flags.push("defaultUnlockable");
            if (b.unlockable)        flags.push("unlockable");
            W("  " + b.name + "  [" + stageStr + "val=" + b.val + ", " + gate +
              (b.on && b.on !== b.val ? (", on=" + b.on) : "") +
              (b.consumer ? ", CONSUMER" : "") +
              (flags.length ? ", " + flags.join(",") : "") + "]");
            W("    cost: " + _fmtPrices(b.prices) + "  (x" + _r(b.priceRatio, 3) + ")");
            var ef = _fmtEffects(b.effects);
            if (ef) W("    effects: " + ef);
            var un = _fmtUnlocks(b.unlocks);
            if (un) W("    unlocks: " + un);
        }
        if (lockedBlds.length > 0) {
            W("");
            W("BUILDINGS (locked — name / base-cost / unlocks)");
            for (var i = 0; i < lockedBlds.length; i++) {
                var b = lockedBlds[i];
                var flags = [];
                if (b.defaultUnlockable) flags.push("defaultUnlockable");
                if (b.unlockable)        flags.push("unlockable");
                var line = "  " + _pad(b.name, 18) +
                    " cost: " + _fmtPrices(b.prices);
                var un = _fmtUnlocks(b.unlocks);
                if (un) line += "  | unlocks: " + un;
                if (flags.length)   line += "  [" + flags.join(",") + "]";
                W(line);
            }
        }
        W("");

        // SPACE BUILDINGS
        if (graph.spaceBuildings.length > 0) {
            W("SPACE BUILDINGS (only unlocked shown)");
            for (var i = 0; i < graph.spaceBuildings.length; i++) {
                var b = graph.spaceBuildings[i];
                if (!b.unlocked && b.val === 0) continue;
                W("  [" + b.planet + "] " + b.name + "  val=" + b.val + (b.unlocked ? "" : " LOCKED"));
                W("    cost: " + _fmtPrices(b.prices));
                var ef = _fmtEffects(b.effects); if (ef) W("    effects: " + ef);
                var un = _fmtUnlocks(b.unlocks); if (un) W("    unlocks: " + un);
            }
            W("");
        }

        // JOBS
        W("JOBS");
        for (var i = 0; i < graph.jobs.length; i++) {
            var j = graph.jobs[i];
            var parts = [];
            for (var rn in j.modifiers) {
                if (!j.modifiers.hasOwnProperty(rn)) continue;
                parts.push(_r(j.modifiers[rn], 4) + " " + rn + "/kitten/tick");
            }
            W("  " + _pad(j.name, 14) + " [" + (j.unlocked ? "ok" : "LOCKED") +
              ", assigned=" + j.value + "]  " + (parts.join(", ") || "(no modifiers)"));
        }
        W("");

        // CRAFTS
        W("CRAFTS (unlocked only)");
        for (var i = 0; i < graph.crafts.length; i++) {
            var c = graph.crafts[i];
            if (!c.unlocked) continue;
            W("  " + _pad(c.name, 14) + "  " + _fmtPrices(c.inputs) +
              "  ->  " + _r(c.output.amt, 3) + " " + c.output.name +
              "  (tier " + c.tier + (c.ignoreBonuses ? ", ignoreBonuses" : "") + ")");
        }
        W("");

        // TECH (unlocked, unresearched first; then locked)
        W("TECH");
        var techsUR = graph.techs.filter(function (t) { return t.unlocked && !t.researched; });
        var techsL  = graph.techs.filter(function (t) { return !t.unlocked; });
        for (var i = 0; i < techsUR.length; i++) {
            var t = techsUR[i];
            W("  " + _pad(t.name, 22) + " cost: " + _fmtPrices(t.prices));
            var un = _fmtUnlocks(t.unlocks); if (un) W("    unlocks: " + un);
        }
        if (techsL.length > 0) {
            W("  [locked tech, not shown: " + techsL.length + "]");
        }
        W("");

        // UPGRADES (only unlocked & not researched, grouped by kind)
        W("UPGRADES (unlocked, not researched)");
        var upgBuckets = {};
        for (var i = 0; i < graph.upgrades.length; i++) {
            var u = graph.upgrades[i];
            if (!u.unlocked) continue;
            if (u.researched && !u.noStackable) continue;
            if (u.researched && u.noStackable && u.val > 0) continue;
            (upgBuckets[u.kind] = upgBuckets[u.kind] || []).push(u);
        }
        var kinds = Object.keys(upgBuckets);
        for (var ki = 0; ki < kinds.length; ki++) {
            var k = kinds[ki];
            W("  [" + k + "]");
            var list = upgBuckets[k];
            for (var i = 0; i < list.length; i++) {
                var u = list[i];
                W("    " + _pad(u.name, 22) + " cost: " + _fmtPrices(u.prices));
                var ef = _fmtEffects(u.effects); if (ef) W("      effects: " + ef);
                var un = _fmtUnlocks(u.unlocks); if (un) W("      unlocks: " + un);
            }
        }
        W("");

        // MISSIONS
        var ml = graph.missions.filter(function (m) { return m.unlocked && !m.researched; });
        if (ml.length > 0) {
            W("SPACE MISSIONS (available)");
            for (var i = 0; i < ml.length; i++) {
                var m = ml[i];
                W("  " + _pad(m.name, 22) + " cost: " + _fmtPrices(m.prices));
                var un = _fmtUnlocks(m.unlocks); if (un) W("    unlocks: " + un);
            }
            W("");
        }

        // EMBASSIES
        var el = graph.embassies.filter(function (e) { return e.unlocked; });
        if (el.length > 0) {
            W("EMBASSIES");
            for (var i = 0; i < el.length; i++) {
                var e = el[i];
                W("  " + _pad(e.name, 14) + " level=" + e.level + "  cost: " + _fmtPrices(e.prices));
            }
            W("");
        }

        // PRODUCER INDEX
        W("PRODUCERS (resource -> sources)");
        var pr = graph.producers;
        var rnames = Object.keys(pr).sort();
        for (var i = 0; i < rnames.length; i++) {
            var rn = rnames[i];
            var srcs = pr[rn];
            var byMode = {};
            for (var j = 0; j < srcs.length; j++) {
                var m = srcs[j].mode; (byMode[m] = byMode[m] || []).push(srcs[j]);
            }
            var line = "  " + _pad(rn, 14);
            var modes = Object.keys(byMode);
            var segs = [];
            for (var mi = 0; mi < modes.length; mi++) {
                var mode = modes[mi];
                var arr = byMode[mode];
                var names = arr.map(function (s) { return s.name; }).join(",");
                segs.push(mode + "(" + arr.length + "): " + names);
            }
            W(line + segs.join("   "));
        }
        W("");

        // POLLUTION (pseudo-resource, not in resPool)
        if (graph.pollution && (graph.pollution.value || 0) !== 0) {
            W("POLLUTION");
            W("  cathPollution: " + _r(graph.pollution.value, 3));
            var pe = graph.pollution.effects || {};
            var peParts = [];
            for (var k in pe) {
                if (!pe.hasOwnProperty(k)) continue;
                if (pe[k] === 0) continue;
                peParts.push(k + "=" + _r(pe[k], 4));
            }
            if (peParts.length) W("  effects: " + peParts.join(", "));
            W("");
        }

        // COMPUTED PRODUCTION — full stack per resource, matching game's
        // calcResourcePerTick. Diff column shows gap to resPool.perTickCached.
        W("COMPUTED PRODUCTION (stack replays game.calcResourcePerTick)");
        W("  " + _pad("res", 14) + _pad("estimate", 12) + _pad("cached", 12) + "diff");
        var cnames = Object.keys(graph.computed || {}).sort();
        for (var i = 0; i < cnames.length; i++) {
            var res = cnames[i];
            var c = graph.computed[res];
            if (!c) continue;
            if (c.estimate === 0 && c.cached === 0) continue;
            var flag = (Math.abs(c.diff) > 0.0005 && Math.abs(c.diff) > Math.abs(c.cached) * 0.02) ? "  *" : "";
            W("  " + _pad(res, 14) +
              _pad(_r(c.estimate, 4), 12) +
              _pad(_r(c.cached, 4),   12) +
              _r(c.diff, 4) + flag);
            // Stack breakdown — only show non-zero terms.
            for (var j = 0; j < c.stack.length; j++) {
                var s = c.stack[j];
                if (!s.value) continue;
                var marker = (s.type === "ratio") ? "×" : "+";
                W("      " + marker + " " + _pad(s.name, 26) +
                  (s.type === "ratio"
                      ? " (1+" + _r(s.value, 4) + ")"
                      : " " + _r(s.value, 4)));
            }
        }
        W("");
        W("(diff flagged with '*' if > 2% — any remaining gap is a formula");
        W(" pathway we don't yet replicate from game.calcResourcePerTick)");
        W("");

        return lines.join("\n");
    }

    function _pad(s, n) {
        s = "" + s;
        while (s.length < n) s += " ";
        return s;
    }

    function dumpGraph() {
        if (typeof gamePage === "undefined" || !gamePage.bld) {
            console.warn("[graph] gamePage not ready");
            return;
        }
        var g = scrapeGraph(gamePage);
        var txt = dumpGraphText(g);
        console.log(txt);
        return txt;
    }

    // Expose on window for console use.
    if (typeof window !== "undefined") {
        window.__scrapeGraph   = function () { return scrapeGraph(gamePage); };
        window.__dumpGraph     = dumpGraph;
        window.__dumpGraphText = function () { return dumpGraphText(scrapeGraph(gamePage)); };
    }
