// ==UserScript==
// @name         Kittens Game MCTS Autoplayer
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Goal-oriented MCTS autoplayer with craft chain resolver, parallel execution, and milestone scoring.
// @author       Claude + Human
// @match        *://bloodrizer.ru/games/kittens/*
// @match        *://kittensgame.com/web/*
// @match        *://kittensgame.com/alpha/*
// @match        *://kittensgame.com/beta/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    //  [B] CONFIGURATION & STATE
    // =========================================================================
    var cfg = {
        mctsEnabled: false,
        autoObserve: true,
        clicksPerSec: 0,
        decisionIntervalMs: 3000,
        goldTradeReserve: 0,
        faithPraiseReserve: 0,
        speedMultiplier: 1,
        terminalGoal: null,
        // ── Beam search ──────────────────────────────────────────────────────
        beamEnabled:        true,
        beamDepth:          3,
        beamWidth:          4,
        beamBudgetMs:       400,
        beamCandidateMode:  'goalAware',   // 'goalAware' | 'frontier'
        beamMaxCandidates:  10,
    };

    function saveCfg() {
        try { localStorage.setItem('mctsAuto_cfg', JSON.stringify(cfg)); } catch (e) { }
    }
    function loadCfg() {
        try {
            var saved = JSON.parse(localStorage.getItem('mctsAuto_cfg'));
            if (saved) {
                for (var key in cfg) {
                    if (key === 'clicksPerSec') continue;
                    if (key in saved) cfg[key] = saved[key];
                }
            }
        } catch (e) { }
    }
    loadCfg();

    var mctsRunning = false;
    var lastDecisionTime = 0;
    var decisionLog = [];
    var clickerWorker = null;
    var speedWorker = null;

    // Instant-buy dedupe key set, reset each orchestrator cycle.
    var instantBoughtKeys = {};
    // Snapshot of the last planNextAction() result — consumed by UI.
    var lastPlan = null;

    // Shared resolve-context hint for one orchestrator cycle (ratio/craft-price caches).
    var _cycleCtx = null;

    // =========================================================================
    //  [D] ACTION TYPES
    // =========================================================================
    var ActionType = {
        BUILD: "BUILD", RESEARCH: "RESEARCH", CRAFT: "CRAFT",
        WORKSHOP_UPGRADE: "WORKSHOP_UPGRADE", ASSIGN_JOB: "ASSIGN_JOB",
        TRADE: "TRADE", PRAISE: "PRAISE",
        SACRIFICE_UNICORNS: "SACRIFICE_UNICORNS",
        SACRIFICE_ALICORNS: "SACRIFICE_ALICORNS",
        RELIGION_UPGRADE: "RELIGION_UPGRADE",
        SPACE_MISSION: "SPACE_MISSION", SPACE_BUILDING: "SPACE_BUILDING",
        FESTIVAL: "FESTIVAL",
        EMBASSY: "EMBASSY",
        IDLE: "IDLE",
    };

    // Embassy cost, scaled by level and any embassyCostReduction effects —
    // mirrors diplomacy.js:1237-1244 EmbassyButtonController.getPrices.
    function getEmbassyPrices(game, race) {
        if (!race || !race.embassyPrices) return null;
        var coef = 1 - ((game.getEffect && game.getEffect("embassyCostReduction")) || 0);
        var fake = (game.getEffect && game.getEffect("embassyFakeBought")) || 0;
        var mult = coef * Math.pow(1.15, (race.embassyLevel || 0) + fake);
        return race.embassyPrices.map(function (p) {
            return { name: p.name, val: p.val * mult };
        });
    }

    function createAction(type, target, params) {
        return {
            type: type, target: target, params: params || {},
            key: type + ":" + target + (params && params.amount ? ":" + params.amount : "")
                + (params && params.subtype ? ":" + params.subtype : "")
        };
    }

    // =========================================================================
    //  [E] ACTION ENUMERATOR
    // =========================================================================
    function enumerateAffordableActions(game) {
        var actions = [];
        // Reuse a per-cycle ctx set by the orchestrator when available,
        // so ratio / craft-price caches persist across registry + enumerate.
        var ctx = (typeof _cycleCtx !== 'undefined' && _cycleCtx) ? _cycleCtx : createResolveContext(game);
        try { enumerateBuildings(game, actions, ctx); } catch (e) { }
        try { enumerateResearch(game, actions, ctx); } catch (e) { }
        try { enumerateWorkshopUpgrades(game, actions, ctx); } catch (e) { }
        try { enumerateReligion(game, actions, ctx); } catch (e) { }
        try { enumerateSpace(game, actions, ctx); } catch (e) { }
        try { enumerateFestival(game, actions); } catch (e) { }
        try { enumerateShipCrafts(game, actions, ctx); } catch (e) { }
        try { enumerateEmbassies(game, actions, ctx); } catch (e) { }
        return actions;
    }

    function enumerateBuildings(game, actions, ctx) {
        for (var i = 0; i < game.bld.buildingsData.length; i++) {
            var bld = game.bld.buildingsData[i];
            if (!bld.unlockable && !bld.unlocked && bld.val === 0) continue;
            var prices = getBuildingPrices(game, bld.name);
            if (!prices) continue;
            var check = canAffordWithCrafting(game, prices, ctx);
            if (!check.affordable) continue;
            var a = createAction(ActionType.BUILD, bld.name);
            a.craftPlan = check.craftPlan;
            actions.push(a);
        }
    }

    function enumerateResearch(game, actions, ctx) {
        for (var i = 0; i < game.science.techs.length; i++) {
            var tech = game.science.techs[i];
            if (tech.researched || !tech.unlocked) continue;
            var prices = game.science.getPrices(tech);
            var check = canAffordWithCrafting(game, prices, ctx);
            if (!check.affordable) continue;
            var a = createAction(ActionType.RESEARCH, tech.name);
            a.craftPlan = check.craftPlan;
            actions.push(a);
        }
    }

    // Craft steps progressCraftChain skips (these are handled by doAutoCraft).
    var AUTO_CRAFT_EXCLUDED = { wood: 1, parchment: 1 };

    function enumerateWorkshopUpgrades(game, actions, ctx) {
        // Workshop tab is invisible to the player until the workshop building
        // exists (game.js:2620 `workshopTab.visible = bld.get("workshop").on > 0`).
        // Without this gate the planner would enumerate upgrades that a human
        // player literally can't access, and workshop itself never gets built
        // because the "unlock crafting" upside is already free.
        var ws = game.bld.get("workshop");
        if (!ws || ws.val === 0) return;
        for (var i = 0; i < game.workshop.upgrades.length; i++) {
            var upg = game.workshop.upgrades[i];
            if (upg.researched || !upg.unlocked) continue;
            var check = canAffordWithCrafting(game, upg.prices, ctx);
            if (!check.affordable) continue;
            var a = createAction(ActionType.WORKSHOP_UPGRADE, upg.name);
            a.craftPlan = check.craftPlan;
            actions.push(a);
        }
    }

    // Trade ships: each one raises titanium trade chance from zebras (0.35%)
    // and amount (+0.03/trade), plus +1% harbor storage via cargoShips.
    // Only emitted while marginal value is non-negligible (ship < 500) and
    // the craft is available.
    function enumerateShipCrafts(game, actions, ctx) {
        var craft = game.workshop.getCraft && game.workshop.getCraft("ship");
        if (!craft || !craft.unlocked) return;
        var ships = game.resPool.get("ship");
        if (ships && ships.value >= 500) return;
        var prices = game.workshop.getCraftPrice(craft);
        if (!prices || !game.resPool.hasRes(prices)) return;
        actions.push(createAction(ActionType.CRAFT, "ship", { amount: 1 }));
    }

    function enumerateEmbassies(game, actions, ctx) {
        if (!game.diplomacy || !game.diplomacy.races) return;
        for (var i = 0; i < game.diplomacy.races.length; i++) {
            var race = game.diplomacy.races[i];
            if (!race.unlocked || !race.embassyPrices) continue;
            var prices = getEmbassyPrices(game, race);
            if (!prices) continue;
            var check = canAffordWithCrafting(game, prices, ctx);
            if (!check.affordable) continue;
            var a = createAction(ActionType.EMBASSY, race.name);
            a.craftPlan = check.craftPlan;
            actions.push(a);
        }
    }

    function enumerateReligion(game, actions, ctx) {
        var faith = game.resPool.get("faith");
        var faithReserve = cfg.faithPraiseReserve || 0;
        if (faith && faith.value > faithReserve) actions.push(createAction(ActionType.PRAISE, "praise"));
        var unicorns = game.resPool.get("unicorns");
        if (unicorns && unicorns.value >= 2500) {
            var zig = game.bld.get("ziggurat");
            if (zig && zig.val > 0) actions.push(createAction(ActionType.SACRIFICE_UNICORNS, "unicorns"));
        }
        var alicorns = game.resPool.get("alicorn");
        if (alicorns && alicorns.value >= 25) actions.push(createAction(ActionType.SACRIFICE_ALICORNS, "alicorns"));
        var lists = [
            [game.religion.religionUpgrades, "ru"],
            [game.religion.zigguratUpgrades, "zu"],
            [game.religion.transcendenceUpgrades, "tu"]
        ];
        for (var l = 0; l < lists.length; l++) {
            var arr = lists[l][0], sub = lists[l][1];
            for (var i = 0; i < arr.length; i++) {
                if (!arr[i].unlocked || (arr[i].noStackable && arr[i].val > 0)) continue;
                if (!arr[i].prices) continue;
                // Split prices: faith is checked directly, others via craft resolver
                var faithOk = true, otherPrices = [];
                for (var p = 0; p < arr[i].prices.length; p++) {
                    if (arr[i].prices[p].name === "faith") {
                        if (game.religion.faith < arr[i].prices[p].val) faithOk = false;
                    } else {
                        otherPrices.push(arr[i].prices[p]);
                    }
                }
                if (!faithOk) continue;
                var check = otherPrices.length > 0 ? canAffordWithCrafting(game, otherPrices, ctx) : { affordable: true, craftPlan: null };
                if (!check.affordable) continue;
                var a = createAction(ActionType.RELIGION_UPGRADE, arr[i].name, { subtype: sub });
                a.craftPlan = check.craftPlan;
                actions.push(a);
            }
        }
    }

    function enumerateSpace(game, actions, ctx) {
        for (var i = 0; i < game.space.programs.length; i++) {
            var prog = game.space.programs[i];
            if (!prog.unlocked || prog.on > 0 || prog.researched) continue;
            var mCheck = canAffordWithCrafting(game, prog.prices, ctx);
            if (!mCheck.affordable) continue;
            var ma = createAction(ActionType.SPACE_MISSION, prog.name);
            ma.craftPlan = mCheck.craftPlan;
            actions.push(ma);
        }
        if (game.space.planets) {
            for (var p = 0; p < game.space.planets.length; p++) {
                if (!game.space.planets[p].buildings) continue;
                for (var b = 0; b < game.space.planets[p].buildings.length; b++) {
                    var bld = game.space.planets[p].buildings[b];
                    if (!bld.unlocked) continue;
                    var prices = getSpaceBuildingPrices(game, bld);
                    if (!prices) continue;
                    var sCheck = canAffordWithCrafting(game, prices, ctx);
                    if (!sCheck.affordable) continue;
                    var sa = createAction(ActionType.SPACE_BUILDING, bld.name);
                    sa.craftPlan = sCheck.craftPlan;
                    actions.push(sa);
                }
            }
        }
    }

    function enumerateFestival(game, actions) {
        var mp = game.resPool.get("manpower"), cu = game.resPool.get("culture"), pa = game.resPool.get("parchment");
        if (mp && mp.value >= 1500 && cu && cu.value >= 5000 && pa && pa.value >= 2500)
            actions.push(createAction(ActionType.FESTIVAL, "festival"));
    }

    function scalePrices(prices, ratio, level) {
        return prices.map(function (p) { return { name: p.name, val: p.val * Math.pow(ratio, level) }; });
    }

    function getBuildingPrices(game, bldName) {
        try {
            var c = new classes.ui.btn.BuildingBtnModernController(game);
            var m = c.fetchModel({ key: bldName, building: bldName });
            var p = c.getPrices(m);
            if (p && p.length > 0) return p;
        } catch (e) { }
        var bld = game.bld.get(bldName);
        if (!bld || !bld.prices) return null;
        return scalePrices(bld.prices, bld.priceRatio || 1.15, bld.val || 0);
    }

    function getSpaceBuildingPrices(game, bld) {
        if (!bld.prices) return null;
        return scalePrices(bld.prices, bld.priceRatio || 1.05, bld.val || 0);
    }

    function canAffordTrade(game, race, amount) {
        var g = game.resPool.get("gold"), mp = game.resPool.get("manpower");
        var reserve = cfg.goldTradeReserve || 0;
        if (!g || g.value < game.diplomacy.getGoldCost() * amount + reserve) return false;
        if (!mp || mp.value < game.diplomacy.getManpowerCost() * amount) return false;
        if (race.buys) for (var i = 0; i < race.buys.length; i++) {
            var r = game.resPool.get(race.buys[i].name);
            if (!r || r.value < race.buys[i].val * amount) return false;
        }
        return true;
    }

    // =========================================================================
    //  [F] ACTION EXECUTOR
    // =========================================================================
    function executeAction(game, action) {
        var success = false;
        try {
            // Execute prerequisite crafts if attached by the planner
            if (action.craftPlan && action.craftPlan.length > 0) {
                executeCraftPlan(game, action.craftPlan);
            }
            switch (action.type) {
                case ActionType.BUILD: success = executeBuild(game, action.target); break;
                case ActionType.RESEARCH: success = executeResearch(game, action.target); break;
                case ActionType.CRAFT: success = executeCraft(game, action.target, action.params.amount); break;
                case ActionType.WORKSHOP_UPGRADE: success = executeWorkshopUpgrade(game, action.target); break;
                // ASSIGN_JOB handled by rule-based system, not here
                case ActionType.TRADE: success = executeTrade(game, action.target, action.params.amount || 1); break;
                case ActionType.PRAISE: success = executePraise(game); break;
                case ActionType.SACRIFICE_UNICORNS: success = executeSacrificeUnicorns(game); break;
                case ActionType.SACRIFICE_ALICORNS: success = executeSacrificeAlicorns(game); break;
                case ActionType.RELIGION_UPGRADE: success = executeReligionUpgrade(game, action.target, action.params.subtype); break;
                case ActionType.SPACE_MISSION: success = executeSpaceMission(game, action.target); break;
                case ActionType.SPACE_BUILDING: success = executeSpaceBuilding(game, action.target); break;
                case ActionType.FESTIVAL: success = executeFestival(game); break;
                case ActionType.EMBASSY: success = executeEmbassy(game, action.target); break;
            }
            if (success) {
                try { game.updateCaches(); } catch (ue) {
                    console.warn('[EXEC] updateCaches threw for ' + action.key + ':', ue.message);
                }
                if (typeof markEdgeGraphDirty === 'function') markEdgeGraphDirty();
            }
        } catch (e) {
            console.error('[EXEC] executeAction failed for ' + action.key + ':', e.message, e.stack);
            success = false;
        }
        return success;
    }

    function executeBuild(game, bldName) {
        // Try UI controller first (works in main game context)
        try {
            var c = new classes.ui.btn.BuildingBtnModernController(game);
            var m = c.fetchModel({ key: bldName, building: bldName });
            if (c.hasResources(m)) { c.build(m, 1); return true; }
            console.log('[BUILD] UI controller hasResources=false for ' + bldName);
        } catch (e) {
            console.log('[BUILD] UI controller failed for ' + bldName + ': ' + e.message);
        }

        // Direct fallback: pay prices and increment building manually
        var bld = game.bld.get(bldName);
        if (!bld) { console.log('[BUILD] bld.get returned null for ' + bldName); return false; }

        // Compute prices directly from building data (avoid UI controller)
        var prices = (bld.prices && bld.prices.length > 0)
            ? scalePrices(bld.prices, bld.priceRatio || 1.15, bld.val || 0) : null;
        if (!prices || prices.length === 0) {
            // Try getBuildingPrices as last resort
            prices = getBuildingPrices(game, bldName);
        }
        if (!prices || prices.length === 0) { console.log('[BUILD] No prices for ' + bldName); return false; }

        if (!game.resPool.hasRes(prices)) {
            // Safety net: try crafting any missing intermediate resources
            for (var pi = 0; pi < prices.length; pi++) {
                var pr = game.resPool.get(prices[pi].name);
                if (pr && pr.value < prices[pi].val) {
                    try { game.workshop.craftAll(prices[pi].name); } catch (ce) { }
                }
            }
            if (!game.resPool.hasRes(prices)) {
                console.log('[BUILD] Cannot afford ' + bldName + ':', prices.map(function(p) {
                    var r = game.resPool.get(p.name);
                    return p.name + ' need=' + p.val.toFixed(1) + ' have=' + (r ? r.value.toFixed(1) : 'N/A');
                }).join(', '));
                return false;
            }
        }
        game.resPool.payPrices(prices);
        bld.val = (bld.val || 0) + 1;
        if (bld.on !== undefined) bld.on = (bld.on || 0) + 1;
        if (bld.unlocks) game.unlock(bld.unlocks);
        if (bld.calculateEffects) bld.calculateEffects(bld, game);
        console.log('[BUILD] Direct build succeeded for ' + bldName + ' (now val=' + bld.val + ')');
        return true;
    }

    function executeResearch(game, techName) {
        var t = game.science.get(techName);
        if (!t || t.researched || !t.unlocked) return false;
        var p = game.science.getPrices(t);
        if (!game.resPool.hasRes(p)) return false;
        game.resPool.payPrices(p); t.researched = true;
        if (t.unlocks) game.unlock(t.unlocks);
        if (t.upgrades) game.upgrade(t.upgrades);
        if (t.handler) t.handler(game, t);
        return true;
    }

    function executeCraft(game, craftName, amount) {
        var ws = game.bld.get("workshop");
        if (!ws || ws.val === 0) return false;
        var craft = game.workshop.getCraft(craftName);
        if (!craft) return false;
        var prices = game.workshop.getCraftPrice(craft);
        if (!prices || !game.resPool.hasRes(prices)) return false;
        var outRes = game.resPool.get(craftName);
        var before = outRes ? outRes.value : 0;
        if (amount === "all") game.workshop.craftAll(craftName);
        else game.workshop.craft(craftName, amount || 1);
        return outRes ? outRes.value > before : true;
    }

    function executeWorkshopUpgrade(game, upgName) {
        var ws = game.bld.get("workshop");
        if (!ws || ws.val === 0) return false;
        var u = game.workshop.get(upgName);
        if (!u || u.researched || !u.unlocked) return false;
        if (!game.resPool.hasRes(u.prices)) return false;
        game.resPool.payPrices(u.prices); u.researched = true;
        if (u.unlocks) game.unlock(u.unlocks);
        if (u.upgrades) game.upgrade(u.upgrades);
        if (u.handler) u.handler(game, u);
        return true;
    }

    function executeEmbassy(game, raceName) {
        var race = game.diplomacy.get(raceName);
        if (!race || !race.unlocked || !race.embassyPrices) return false;
        var prices = getEmbassyPrices(game, race);
        if (!prices || !game.resPool.hasRes(prices)) return false;
        game.resPool.payPrices(prices);
        race.embassyLevel = (race.embassyLevel || 0) + 1;
        try { game.diplomacy.triggerOnEmbassyCountChanged(); } catch (e) { }
        return true;
    }

    function executeTrade(game, raceName, amount) {
        var r = game.diplomacy.get(raceName);
        if (!r || !r.unlocked) return false;
        game.diplomacy.tradeMultiple(r, amount); return true;
    }

    function executePraise(game) {
        var f = game.resPool.get("faith");
        var reserve = cfg.faithPraiseReserve || 0;
        if (!f || f.value <= reserve) return false;
        game.religion.praise(); return true;
    }

    function executeSacrificeUnicorns(game) {
        var u = game.resPool.get("unicorns");
        if (!u || u.value < 2500) return false;
        var z = game.bld.get("ziggurat");
        if (!z || z.val === 0) return false;
        var n = Math.floor(u.value / 2500);
        game.resPool.addResEvent("unicorns", -2500 * n);
        game.resPool.addResEvent("tears", n); return true;
    }

    function executeSacrificeAlicorns(game) {
        var a = game.resPool.get("alicorn");
        if (!a || a.value < 25) return false;
        var n = Math.floor(a.value / 25);
        game.resPool.addResEvent("alicorn", -25 * n);
        game.resPool.addResEvent("timeCrystal", n); return true;
    }

    function executeReligionUpgrade(game, upgName, subtype) {
        var u;
        if (subtype === "ru") u = game.religion.getRU(upgName);
        else if (subtype === "zu") u = game.religion.getZU(upgName);
        else if (subtype === "tu") u = game.religion.getTU(upgName);
        if (!u || !u.unlocked || (u.noStackable && u.val > 0) || !u.prices) return false;
        for (var i = 0; i < u.prices.length; i++) {
            if (u.prices[i].name === "faith") { if (game.religion.faith < u.prices[i].val) return false; }
            else { var r = game.resPool.get(u.prices[i].name); if (!r || r.value < u.prices[i].val) return false; }
        }
        for (var i = 0; i < u.prices.length; i++) {
            if (u.prices[i].name === "faith") game.religion.faith -= u.prices[i].val;
            else game.resPool.addResEvent(u.prices[i].name, -u.prices[i].val);
        }
        u.val = (u.val || 0) + 1;
        if (u.on !== undefined) u.on = (u.on || 0) + 1;
        if (u.unlocks) game.unlock(u.unlocks);
        if (u.upgrades) game.upgrade(u.upgrades);
        if (u.handler) u.handler(game, u);
        if (u.calculateEffects) u.calculateEffects(u, game);
        return true;
    }

    function executeSpaceMission(game, name) {
        var m = game.space.getProgram(name);
        if (!m || !m.unlocked || m.on > 0 || m.researched) return false;
        if (!game.resPool.hasRes(m.prices)) return false;
        game.resPool.payPrices(m.prices); m.on = 1; m.researched = true;
        if (m.unlocks) game.unlock(m.unlocks);
        if (m.handler) m.handler(game, m);
        return true;
    }

    function executeSpaceBuilding(game, bldName) {
        var b = game.space.getBuilding(bldName);
        if (!b || !b.unlocked) return false;
        var prices = scalePrices(b.prices, b.priceRatio || 1.05, b.val || 0);
        if (!game.resPool.hasRes(prices)) return false;
        game.resPool.payPrices(prices);
        b.val = (b.val || 0) + 1;
        if (b.on !== undefined) b.on = (b.on || 0) + 1;
        if (b.unlocks) game.unlock(b.unlocks);
        if (b.calculateEffects) b.calculateEffects(b, game);
        return true;
    }

    function executeFestival(game) {
        var mp = game.resPool.get("manpower"), cu = game.resPool.get("culture"), pa = game.resPool.get("parchment");
        if (!mp || mp.value < 1500 || !cu || cu.value < 5000 || !pa || pa.value < 2500) return false;
        game.resPool.addResEvent("manpower", -1500);
        game.resPool.addResEvent("culture", -5000);
        game.resPool.addResEvent("parchment", -2500);
        game.calendar.festivalDays += game.calendar.daysPerSeason * game.calendar.seasonsPerYear;
        return true;
    }

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

        return { resources: resources, rates: rates, caps: caps,
                 unlocks: unlocks, elapsed: 0, tps: tps };
    }

    function _cloneAlgState(s) {
        return {
            resources: Object.assign({}, s.resources),
            rates:     Object.assign({}, s.rates),
            caps:      Object.assign({}, s.caps),
            unlocks:   Object.assign({}, s.unlocks),
            elapsed:   s.elapsed,
            tps:       s.tps || 5
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
    // Returns the new state, or null if the node's cost is unreachable.
    function applyActionSymbolic(state, node, craftsByOutput) {
        var cost = (node.state === 'locked-ui') ? node.unlockPrice : node.price;
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

        // 3b. Storage cap increases.
        if (prov && prov.storage) {
            for (var i = 0; i < prov.storage.length; i++) {
                var e = prov.storage[i];
                next.caps[e.res] = (next.caps[e.res] || 0) + e.amount;
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

    // =========================================================================
    //  [EDGES] AND-OR GRAPH BUILDER
    //  Transforms the raw scrape (05_graph.js) into a searchable graph:
    //    - nodes indexed by id ("bld:field", "tech:calendar", "ws_upg:...")
    //    - explicit requires (resources + prereq nodes) and provides
    //      (resources, storage, ratios, unlocks)
    //    - `state` captures whether the action is done / ready / needs cost /
    //      needs UI-unlock / needs a prereq node
    //  This is data transformation only — no search.  Rebuilt each cycle.
    // =========================================================================

    // id helpers already defined in 05_graph.js (_id).  We namespace upgrade
    // kinds with the same prefixes the scrape uses: ws_upg / rel_upg_ru /
    // rel_upg_zu / rel_upg_tu.

    // ── state derivation ─────────────────────────────────────────────────
    //   done          : already built/researched (and not stackable further)
    //   ready         : unlocked + prereqs met + full price affordable
    //   locked-cost   : unlocked but can't yet afford full price
    //   locked-ui     : unlockable but UI-gate not crossed (30% of first-level)
    //   locked-prereq : not unlockable — needs an upstream action first
    function _stateOf(done, unlocked, unlockable, canAfford) {
        if (done) return "done";
        if (unlocked) return canAfford ? "ready" : "locked-cost";
        if (unlockable) return "locked-ui";
        return "locked-prereq";
    }

    // Kittens-game "UI reveal" threshold — 30% of first-level price on the
    // first listed resource.  game/buildings.js:2605 `isUnlocked`.
    var UI_UNLOCK_THRESHOLD = 0.3;

    function _unlockPrice(prices) {
        if (!prices || prices.length === 0) return null;
        return prices.map(function (p) {
            return { name: p.name, val: p.val * UI_UNLOCK_THRESHOLD };
        });
    }

    // First-level base prices for a scaled-price node.  For buildings we
    // already have the scaled current-level cost in scrape.prices; for the
    // 30% UI gate we need the base (val=0) prices — read from the meta.
    function _basePricesFromMeta(meta) {
        if (!meta || !meta.prices) return null;
        return meta.prices.map(function (p) { return { name: p.name, val: p.val }; });
    }

    function _canAfford(game, prices) {
        if (!prices || prices.length === 0) return true;
        for (var i = 0; i < prices.length; i++) {
            var r = game.resPool.get(prices[i].name);
            if (!r || r.value < prices[i].val) return false;
        }
        return true;
    }

    // Resources effects → provides entries. Reuses _parseEffectKey from 05.
    function _provideEntries(effects, multiplier) {
        var m = multiplier || 1;
        var prov = { resources: [], storage: [], ratios: [], con: [] };
        if (!effects) return prov;
        for (var k in effects) {
            if (!effects.hasOwnProperty(k)) continue;
            var v = effects[k]; if (!v) continue;
            var hit = _parseEffectKey(k); if (!hit) continue;
            var total = v * m;
            if (hit.kind === "prod") prov.resources.push({ res: hit.res, rate: total, key: k });
            else if (hit.kind === "storage") prov.storage.push({ res: hit.res, amount: total, key: k });
            else if (hit.kind === "ratio" || hit.kind === "demand_ratio")
                prov.ratios.push({ res: hit.res, amount: total, kind: hit.kind, key: k });
            else if (hit.kind === "con") prov.con.push({ res: hit.res, rate: total, key: k });
        }
        return prov;
    }

    // meta.unlocks → list of target node ids.  Scope-ambiguous keys
    // (upgrades, buildings) are resolved via lookup in the scrape.
    function _unlockTargets(unlocks, scrape) {
        if (!unlocks) return [];
        var out = [];
        function mapList(list, kind) {
            if (!list) return;
            for (var i = 0; i < list.length; i++) out.push(kind + ":" + list[i]);
        }
        mapList(unlocks.tabs,      "tab");
        mapList(unlocks.jobs,      "job");
        mapList(unlocks.buildings, "bld");
        mapList(unlocks.crafts,    "craft");
        mapList(unlocks.tech,      "tech");
        mapList(unlocks.policies,  "policy");
        // Upgrades are ambiguous — scan scrape to figure out the pool.
        if (unlocks.upgrades) {
            for (var i = 0; i < unlocks.upgrades.length; i++) {
                var name = unlocks.upgrades[i];
                var kind = _findUpgradeKind(name, scrape);
                if (kind) out.push(kind + ":" + name);
            }
        }
        return out;
    }
    function _findUpgradeKind(name, scrape) {
        for (var i = 0; i < scrape.upgrades.length; i++) {
            if (scrape.upgrades[i].name === name) return scrape.upgrades[i].kind;
        }
        return null;
    }

    // ── hardcoded UI parent-gates ────────────────────────────────────────
    // Some "becomes unlockable" rules are implicit in game logic and don't
    // appear in meta.unlocks.  Without these, planner can't see that
    // workshop upgrades need a workshop building first.
    var PARENT_BUILDING_GATES = {
        ws_upg:     "workshop",
        rel_upg_zu: "ziggurat",
    };

    // Kinds whose gating node lives outside the scraped per-item meta.unlocks.
    // Each entry is an AND-link from the listed source node ids to every node
    // of that kind.  Not kind-specific overrides — purely additive.
    var IMPLICIT_AND_GATES = {
        rel_upg_ru: ["tech:theology"],  // Religion tab appears with theology
        embassy:    ["tech:writing"],   // first culture-heavy tech; ships need it
        policy:     ["tech:philosophy"],// Civil Service tab
    };

    // Synthetic race → approximate unlock source.  Real logic is runtime
    // (year thresholds, ship count, etc.) — we pick the most common prereq
    // for planning.  AND-linked into race:<name>.
    var RACE_UNLOCKERS = {
        lizards:    ["tech:archery"],
        sharks:     ["tech:archery"],
        griffins:   ["tech:archery"],
        nagas:      ["tech:writing"],
        zebras:     ["craft:ship"],
        spiders:    ["craft:ship"],
        dragons:    ["tech:nuclearFission"],
        leviathans: ["tech:ecology"],
    };

    // ── node constructors ────────────────────────────────────────────────
    function _bldNode(game, b) {
        var done = false;
        var prov     = _provideEntries(b.effects, b.val || 0);
        var provUnit = _provideEntries(b.effects, 1);
        // For buildings, "done" is ambiguous (can always build more).  Mark
        // done only if the building is single-purpose (no price-ratio scaling
        // and already present).  Otherwise leave as incremental — planner
        // treats each purchase as an action, never "done".
        var canAfford = _canAfford(game, b.prices);
        return {
            id: _id("bld", b.name),
            kind: "bld",
            name: b.name,
            state: _stateOf(false, b.unlocked, b.unlockable || b.defaultUnlockable, canAfford),
            val: b.val, on: b.on,
            prereqs: [],           // filled in after inverse-unlock pass
            price: b.prices,
            unlockPrice: _unlockPriceFromScraped(b),
            provides: {
                resources: prov.resources, storage: prov.storage,
                ratios: prov.ratios, con: prov.con,
                unlocks: [] // filled after
            },
            perUnitProvides: {
                resources: provUnit.resources, storage: provUnit.storage,
                ratios: provUnit.ratios, con: provUnit.con
            },
            rawUnlocks: b.unlocks
        };
    }
    // Helper: recover 30%-of-first-level-price from the scraped building.
    // scrape.prices is scaled by (1.15)^val; dividing by priceRatio^val gives
    // us the base, then take 30%.
    function _unlockPriceFromScraped(b) {
        if (!b.prices || b.prices.length === 0) return null;
        var ratio = b.priceRatio || 1.15;
        var pow = Math.pow(ratio, b.val || 0);
        return b.prices.map(function (p) {
            return { name: p.name, val: (p.val / pow) * UI_UNLOCK_THRESHOLD };
        });
    }

    function _techNode(game, t) {
        var canAfford = _canAfford(game, t.prices);
        return {
            id: _id("tech", t.name),
            kind: "tech",
            name: t.name,
            state: _stateOf(t.researched, t.unlocked, t.unlocked, canAfford),
            prereqs: [],
            price: t.prices,
            unlockPrice: t.prices,  // tech unlock gate is reaching 30% of cost
            provides: { resources: [], storage: [], ratios: [], con: [], unlocks: [] },
            rawUnlocks: t.unlocks
        };
    }

    function _upgNode(game, u) {
        var prov = _provideEntries(u.effects, 1);
        var done = u.researched && (!u.noStackable || u.val > 0);
        var canAfford = _canAfford(game, u.prices);
        return {
            id: _id(u.kind, u.name),
            kind: u.kind,  // ws_upg / rel_upg_ru / rel_upg_zu / rel_upg_tu
            name: u.name,
            state: _stateOf(done, u.unlocked, u.unlocked, canAfford),
            prereqs: [],
            price: u.prices,
            unlockPrice: u.prices,
            provides: {
                resources: prov.resources, storage: prov.storage,
                ratios: prov.ratios, con: prov.con, unlocks: []
            },
            rawUnlocks: u.unlocks
        };
    }

    function _jobNode(j) {
        return {
            id: _id("job", j.name),
            kind: "job",
            name: j.name,
            state: j.unlocked ? "ready" : "locked-prereq",
            prereqs: [],
            price: null, unlockPrice: null,
            provides: {
                resources: _modsToProvides(j.modifiers),
                storage: [], ratios: [], con: [], unlocks: []
            },
            rawUnlocks: null
        };
    }
    function _modsToProvides(mods) {
        var out = [];
        for (var k in mods) {
            if (!mods.hasOwnProperty(k)) continue;
            if (!mods[k]) continue;
            out.push({ res: k, rate: mods[k], key: "jobMod" });
        }
        return out;
    }

    function _craftNode(c) {
        return {
            id: _id("craft", c.name),
            kind: "craft",
            name: c.name,
            state: c.unlocked ? "ready" : "locked-prereq",
            prereqs: [],
            price: c.inputs,
            unlockPrice: c.inputs,
            provides: {
                resources: [{ res: c.name, rate: c.output.amt, key: "craftOutput" }],
                storage: [], ratios: [], con: [], unlocks: []
            },
            rawUnlocks: null
        };
    }

    function _missionNode(game, m) {
        var canAfford = _canAfford(game, m.prices);
        return {
            id: _id("mission", m.name),
            kind: "mission",
            name: m.name,
            state: _stateOf(m.researched, m.unlocked, m.unlocked, canAfford),
            prereqs: [],
            price: m.prices, unlockPrice: m.prices,
            provides: { resources: [], storage: [], ratios: [], con: [], unlocks: [] },
            rawUnlocks: m.unlocks
        };
    }

    function _spaceBldNode(game, b) {
        var prov     = _provideEntries(b.effects, b.val || 0);
        var provUnit = _provideEntries(b.effects, 1);
        var canAfford = _canAfford(game, b.prices);
        return {
            id: _id("space_bld", b.name),
            kind: "space_bld",
            name: b.name,
            state: _stateOf(false, b.unlocked, b.unlocked, canAfford),
            val: b.val, on: b.on,
            prereqs: [],
            price: b.prices,
            unlockPrice: b.prices && b.prices.map(function (p) {
                return { name: p.name, val: p.val * UI_UNLOCK_THRESHOLD };
            }),
            provides: {
                resources: prov.resources, storage: prov.storage,
                ratios: prov.ratios, con: prov.con, unlocks: []
            },
            perUnitProvides: {
                resources: provUnit.resources, storage: provUnit.storage,
                ratios: provUnit.ratios, con: provUnit.con
            },
            rawUnlocks: b.unlocks
        };
    }

    function _embassyNode(game, e) {
        var canAfford = _canAfford(game, e.prices);
        return {
            id: _id("embassy", e.name),
            kind: "embassy",
            name: e.name,
            state: _stateOf(false, e.unlocked, e.unlocked, canAfford),
            prereqs: [],
            price: e.prices, unlockPrice: e.prices,
            provides: { resources: [], storage: [], ratios: [], con: [], unlocks: [] },
            rawUnlocks: null
        };
    }

    function _policyNode(game, p) {
        var canAfford = _canAfford(game, p.prices);
        // Policies: unlocked=visible, researched=adopted. blocked means opposed.
        var done = p.researched;
        var state = done ? "done"
                  : p.blocked ? "locked-prereq"
                  : p.unlocked ? (canAfford ? "ready" : "locked-cost")
                  : "locked-prereq";
        return {
            id: _id("policy", p.name),
            kind: "policy",
            name: p.name,
            state: state,
            prereqs: [],
            price: p.prices, unlockPrice: p.prices,
            provides: { resources: [], storage: [], ratios: [], con: [], unlocks: [] },
            rawUnlocks: p.unlocks
        };
    }

    function _raceNode(r) {
        // Synthetic: state = ready if discovered, else locked-prereq.
        // No price — unlocked by runtime events (approximated via RACE_UNLOCKERS).
        return {
            id: _id("race", r.name),
            kind: "race",
            name: r.name,
            state: r.unlocked ? "done" : "locked-prereq",
            prereqs: [],
            price: null, unlockPrice: null,
            provides: { resources: [], storage: [], ratios: [], con: [], unlocks: [] },
            rawUnlocks: null
        };
    }

    // ── top-level builder ────────────────────────────────────────────────
    function buildEdgeGraph(game, scrape) {
        if (!scrape) return null;
        var nodes = {};
        var unlockedBy = {};   // targetId -> [{id, mode}]
        var producersOf = {};  // res -> [nodeId]
        var capRaisersOf = {}; // res -> [nodeId] (nodes whose provides.storage raises this cap)

        function add(n) {
            if (!n) return;
            // Ensure every node has a perUnitProvides field so applyActionSymbolic
            // can read it without null-checks per kind. For non-scaling kinds the
            // marginal effect of "acquiring one" equals provides directly.
            if (!n.perUnitProvides) {
                n.perUnitProvides = {
                    resources: n.provides.resources,
                    storage:   n.provides.storage,
                    ratios:    n.provides.ratios,
                    con:       n.provides.con
                };
            }
            nodes[n.id] = n;
            for (var i = 0; i < n.provides.resources.length; i++) {
                var r = n.provides.resources[i].res;
                (producersOf[r] = producersOf[r] || []).push(n.id);
            }
            for (var i = 0; i < n.provides.storage.length; i++) {
                var r = n.provides.storage[i].res;
                (capRaisersOf[r] = capRaisersOf[r] || []).push(n.id);
            }
        }
        function linkUnlock(sourceId, targets, mode) {
            var m = mode || "or";
            for (var i = 0; i < targets.length; i++) {
                (unlockedBy[targets[i]] = unlockedBy[targets[i]] || []).push({ id: sourceId, mode: m });
            }
        }

        // Build all nodes.
        for (var i = 0; i < scrape.buildings.length; i++) add(_bldNode(game, scrape.buildings[i]));
        for (var i = 0; i < scrape.spaceBuildings.length; i++) add(_spaceBldNode(game, scrape.spaceBuildings[i]));
        for (var i = 0; i < scrape.techs.length; i++) add(_techNode(game, scrape.techs[i]));
        for (var i = 0; i < scrape.upgrades.length; i++) add(_upgNode(game, scrape.upgrades[i]));
        for (var i = 0; i < scrape.jobs.length; i++) add(_jobNode(scrape.jobs[i]));
        for (var i = 0; i < scrape.crafts.length; i++) add(_craftNode(scrape.crafts[i]));
        for (var i = 0; i < scrape.missions.length; i++) add(_missionNode(game, scrape.missions[i]));
        for (var i = 0; i < scrape.embassies.length; i++) add(_embassyNode(game, scrape.embassies[i]));
        if (scrape.policies) for (var i = 0; i < scrape.policies.length; i++) add(_policyNode(game, scrape.policies[i]));
        if (scrape.races)    for (var i = 0; i < scrape.races.length; i++) add(_raceNode(scrape.races[i]));

        // Inverse-unlock pass: read rawUnlocks on each node, register source → target.
        var ids = Object.keys(nodes);
        for (var i = 0; i < ids.length; i++) {
            var n = nodes[ids[i]];
            var targets = _unlockTargets(n.rawUnlocks, scrape);
            n.provides.unlocks = targets;
            linkUnlock(n.id, targets);
        }

        // Apply hardcoded parent-building gates (ws_upg → workshop, etc.).
        for (var i = 0; i < ids.length; i++) {
            var n = nodes[ids[i]];
            var parentName = PARENT_BUILDING_GATES[n.kind];
            if (parentName) {
                var parentId = _id("bld", parentName);
                if (nodes[parentId]) linkUnlock(parentId, [n.id], "and");
            }
        }

        // Apply implicit AND gates by kind (religion tab, policy tab, etc.).
        for (var i = 0; i < ids.length; i++) {
            var n = nodes[ids[i]];
            var srcs = IMPLICIT_AND_GATES[n.kind];
            if (srcs) {
                for (var j = 0; j < srcs.length; j++) {
                    if (nodes[srcs[j]]) linkUnlock(srcs[j], [n.id], "and");
                }
            }
        }

        // Embassy needs its matching race (AND).
        for (var i = 0; i < ids.length; i++) {
            var n = nodes[ids[i]];
            if (n.kind === "embassy") {
                var raceId = _id("race", n.name);
                if (nodes[raceId]) linkUnlock(raceId, [n.id], "and");
            }
        }

        // Race unlockers (approximate — runtime events).
        for (var i = 0; i < ids.length; i++) {
            var n = nodes[ids[i]];
            if (n.kind !== "race") continue;
            var srcs = RACE_UNLOCKERS[n.name];
            if (srcs) {
                for (var j = 0; j < srcs.length; j++) {
                    if (nodes[srcs[j]]) linkUnlock(srcs[j], [n.id], "and");
                }
            }
        }

        // Second pass: for locked-prereq nodes, fill prereqs from unlockedBy.
        for (var i = 0; i < ids.length; i++) {
            var n = nodes[ids[i]];
            if (n.state === "locked-prereq") {
                var sources = unlockedBy[n.id] || [];
                for (var j = 0; j < sources.length; j++) {
                    n.prereqs.push({ kind: "node", id: sources[j].id, mode: sources[j].mode });
                }
            }
        }

        return { nodes: nodes, unlockedBy: unlockedBy, producersOf: producersOf, capRaisersOf: capRaisersOf };
    }

    // ── dump formatter ───────────────────────────────────────────────────
    function dumpEdgeGraphText(eg) {
        if (!eg) return "(no edge graph)";
        var lines = [];
        function W(s) { lines.push(s); }

        W("=== EDGE GRAPH ===");
        W("");

        // Bucket nodes by state, then by kind.
        var byState = { ready: [], "locked-cost": [], "locked-ui": [], "locked-prereq": [], done: [] };
        var ids = Object.keys(eg.nodes).sort();
        for (var i = 0; i < ids.length; i++) {
            var n = eg.nodes[ids[i]];
            (byState[n.state] || (byState[n.state] = [])).push(n);
        }

        function fmtPrices(p) {
            if (!p || p.length === 0) return "—";
            return p.map(function (x) { return _r(x.val, 2) + " " + x.name; }).join(", ");
        }
        function fmtProvides(n) {
            var parts = [];
            if (n.provides.resources.length)
                parts.push("prod: " + n.provides.resources.map(function (e) { return _r(e.rate, 4) + " " + e.res; }).join(", "));
            if (n.provides.storage.length)
                parts.push("store: " + n.provides.storage.map(function (e) { return "+" + _r(e.amount, 1) + " " + e.res; }).join(", "));
            if (n.provides.ratios.length)
                parts.push("ratio: " + n.provides.ratios.map(function (e) { return e.res + "×(1+" + _r(e.amount, 3) + ")"; }).join(", "));
            if (n.provides.con.length)
                parts.push("con: " + n.provides.con.map(function (e) { return _r(e.rate, 4) + " " + e.res; }).join(", "));
            if (n.provides.unlocks.length)
                parts.push("unlocks: " + n.provides.unlocks.join(","));
            return parts.join("  |  ");
        }

        function section(label, arr) {
            if (!arr || arr.length === 0) return;
            W(label + "  (" + arr.length + ")");
            for (var i = 0; i < arr.length; i++) {
                var n = arr[i];
                var head = "  " + n.id;
                if (n.kind === "bld" || n.kind === "space_bld") head += " [val=" + n.val + "]";
                W(head);
                if (n.price && n.price.length) W("    price: " + fmtPrices(n.price));
                if (n.unlockPrice && n.state === "locked-ui") W("    ui-gate (30%): " + fmtPrices(n.unlockPrice));
                if (n.prereqs.length) W("    needs: " + n.prereqs.map(function (p) { return p.id; }).join(", "));
                var pv = fmtProvides(n);
                if (pv) W("    " + pv);
            }
            W("");
        }
        section("READY",          byState["ready"]);
        section("LOCKED-COST",    byState["locked-cost"]);
        section("LOCKED-UI",      byState["locked-ui"]);
        section("LOCKED-PREREQ",  byState["locked-prereq"]);
        section("DONE",           byState["done"]);

        // Inverse-unlock summary: who unlocks each locked-prereq node?
        W("UNLOCKED-BY (inverse index — which node unlocks which)");
        var ubKeys = Object.keys(eg.unlockedBy).sort();
        for (var i = 0; i < ubKeys.length; i++) {
            var srcs = eg.unlockedBy[ubKeys[i]].map(function (s) {
                return s.mode === "and" ? ("&" + s.id) : s.id;
            });
            W("  " + _pad(ubKeys[i], 28) + " ← " + srcs.join(", "));
        }
        W("");

        return lines.join("\n");
    }

    function dumpEdgeGraph() {
        if (typeof gamePage === "undefined" || !gamePage.bld) {
            console.warn("[edges] gamePage not ready"); return;
        }
        var scrape = scrapeGraph(gamePage);
        var eg = buildEdgeGraph(gamePage, scrape);
        var txt = dumpEdgeGraphText(eg);
        console.log(txt);
        return txt;
    }

    function listAllNodeIds(eg) {
        var ids = [];
        for (var k in eg.nodes) ids.push(k);
        ids.sort();
        return ids;
    }

    function getTerminalGoal() { return cfg.terminalGoal || null; }

    function getTerminalGoalNode() {
        var id = getTerminalGoal();
        if (!id) return null;
        var scrape = scrapeGraph(gamePage);
        var eg = buildEdgeGraph(gamePage, scrape);
        return eg.nodes[id] || null;
    }

    // ── Edge graph cache ─────────────────────────────────────────────────────
    // Rebuilds are expensive (scrape + link-build over 300+ nodes each cycle).
    // We cache and only rebuild when game state mutates (action executed) or
    // EG_FORCE_INTERVAL cycles elapse as a safety net against stale nodes.
    var _egCache              = null;
    var _egDirty              = true;
    var _egCyclesSinceRebuild = 0;
    var EG_FORCE_INTERVAL     = 10;

    function markEdgeGraphDirty() {
        _egDirty = true;
    }

    function getCachedEdgeGraph(game) {
        _egCyclesSinceRebuild++;
        var forceRebuild = (_egCyclesSinceRebuild >= EG_FORCE_INTERVAL);
        if (_egDirty || !_egCache || forceRebuild) {
            var scrape = scrapeGraph(game);
            _egCache = buildEdgeGraph(game, scrape);
            _egCache.__scrape = scrape;
            _egDirty = false;
            _egCyclesSinceRebuild = 0;
        }
        return _egCache;
    }

    if (typeof window !== "undefined") {
        window.__buildEdgeGraph = function () { return buildEdgeGraph(gamePage, scrapeGraph(gamePage)); };
        window.__dumpEdgeGraph  = dumpEdgeGraph;
        window.__listNodeIds    = function () { return listAllNodeIds(window.__buildEdgeGraph()); };
        window.__egCacheInfo    = function () {
            return {
                dirty:     _egDirty,
                cycles:    _egCyclesSinceRebuild,
                cached:    !!_egCache,
                nodeCount: _egCache ? Object.keys(_egCache.nodes).length : 0
            };
        };
    }

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

    // Returns { relevant: bool, reason: 'producer'|'capRaiser'|'ratioBooster'|null }.
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
            var pri = rel.reason === 'producer'   ? 1 :
                      rel.reason === 'capRaiser'  ? 2 : 3;
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

    // ── Beam search over frontier ordering ───────────────────────────────────
    // Evaluates sequences of frontier actions using closed-form algebraic
    // simulation (see 04c_symbolic.js). Picks the ordering with minimum total
    // elapsed time.  Falls back to chain.recommended if budget exhausted.
    function beamSearchFrontier(game, eg, frontier, craftsByOutput, opts) {
        if (!frontier || frontier.length === 0) return null;
        if (frontier.length === 1) return frontier[0];

        var startMs   = Date.now();
        var maxDepth  = (opts && opts.maxDepth)  || 3;
        var beamWidth = (opts && opts.beamWidth) || 4;
        var budgetMs  = (opts && opts.budgetMs)  || 400;

        var baseState = snapshotAlgebraicState(game, eg);

        // Seed: each frontier item is a 1-step candidate.
        var beam = [];
        for (var i = 0; i < frontier.length; i++) {
            var nodeId = frontier[i];
            var node   = eg.nodes[nodeId];
            if (!node) continue;
            var price  = (node.state === 'locked-ui') ? node.unlockPrice : node.price;
            var eta    = timeToAffordInState(baseState, price || [], craftsByOutput);
            if (eta.secs === Infinity) continue;
            beam.push({ firstAction: nodeId, path: [nodeId], state: baseState, totalEta: eta.secs });
        }
        _beamSort(beam);
        beam = beam.slice(0, beamWidth);

        for (var depth = 1; depth < maxDepth; depth++) {
            if (Date.now() - startMs > budgetMs || beam.length === 0) break;
            var nextBeam = [];
            for (var bi = 0; bi < beam.length; bi++) {
                if (Date.now() - startMs > budgetMs) break;
                var cand     = beam[bi];
                var lastId   = cand.path[cand.path.length - 1];
                var lastNode = eg.nodes[lastId];
                if (!lastNode) { nextBeam.push(cand); continue; }

                var nextState = applyActionSymbolic(cand.state, lastNode, craftsByOutput);
                if (!nextState) { nextBeam.push(cand); continue; }

                var remaining = _beamRemaining(cand.path, frontier, lastNode, eg);
                if (remaining.length === 0) { nextBeam.push(cand); continue; }

                for (var ri = 0; ri < remaining.length; ri++) {
                    var nextId   = remaining[ri];
                    var nextNode = eg.nodes[nextId];
                    if (!nextNode) continue;
                    var nextPrice = (nextNode.state === 'locked-ui') ? nextNode.unlockPrice : nextNode.price;
                    var nextEta   = timeToAffordInState(nextState, nextPrice || [], craftsByOutput);
                    if (nextEta.secs === Infinity) continue;
                    nextBeam.push({
                        firstAction: cand.firstAction,
                        path:        cand.path.concat([nextId]),
                        state:       nextState,
                        totalEta:    cand.totalEta + nextEta.secs
                    });
                }
            }
            _beamSort(nextBeam);
            beam = nextBeam.slice(0, beamWidth);
        }

        var elapsedMs = Date.now() - startMs;
        var best = beam.length > 0 ? beam[0] : null;
        if (typeof console !== "undefined" && console.log) {
            console.log('[Beam] depth=' + maxDepth + ' width=' + beamWidth +
                ' took=' + elapsedMs + 'ms best=' +
                (best ? best.firstAction + ' totalEta=' + best.totalEta.toFixed(0) + 's' : 'none'));
        }
        return best ? best.firstAction : null;
    }

    function _beamSort(beam) {
        beam.sort(function (a, b) { return a.totalEta - b.totalEta; });
    }

    // Remaining candidates: original set minus those already in path.
    // NOTE: we deliberately do NOT fold in appliedNode.provides.unlocks —
    // doing so asymmetrically deepens branches whose last action unlocks
    // new nodes, inflating their totalEta vs. branches that exhaust earlier.
    // Apples-to-apples requires a fixed candidate pool across all paths.
    function _beamRemaining(path, frontier, appliedNode, eg) {
        var out = [];
        for (var i = 0; i < frontier.length; i++) {
            if (path.indexOf(frontier[i]) < 0) out.push(frontier[i]);
        }
        return out;
    }

    function planNextAction(game, eg) {
        var goalId = (typeof getTerminalGoal === "function") ? getTerminalGoal() : null;
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
                var beamId = beamSearchFrontier(game, eg, candidateIds, chain.__craftsByOutput || {}, beamOpts);
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

    // =========================================================================
    //  [N] ORCHESTRATOR
    // =========================================================================

    function formatTime(secs) {
        if (secs === Infinity || secs !== secs) return '--';
        if (secs < 60) return secs + 's';
        if (secs < 3600) return Math.round(secs / 60) + 'm';
        return (secs / 3600).toFixed(1) + 'h';
    }

    // Free wins: researches and workshop upgrades whose prices are already met.
    // Order doesn't matter — all of these are one-shot no-downside unlocks.
    function doInstantBuys() {
        var actions = [];
        for (var i = 0; i < gamePage.science.techs.length; i++) {
            var t = gamePage.science.techs[i];
            if (!t.researched && t.unlocked && gamePage.resPool.hasRes(gamePage.science.getPrices(t)))
                actions.push(createAction(ActionType.RESEARCH, t.name));
        }
        for (var i = 0; i < gamePage.workshop.upgrades.length; i++) {
            var u = gamePage.workshop.upgrades[i];
            if (!u.researched && u.unlocked && gamePage.resPool.hasRes(u.prices))
                actions.push(createAction(ActionType.WORKSHOP_UPGRADE, u.name));
        }
        var bought = false;
        for (var i = 0; i < actions.length; i++) {
            if (executeAction(gamePage, actions[i])) {
                instantBoughtKeys[actions[i].key] = true;
                logDecision(actions[i].key, 'instant');
                setStatus('Instant buy: ' + actions[i].key);
                bought = true;
            }
        }
        return bought;
    }

    var cycleCount = 0;

    async function runQueueCycle() {
        cycleCount++;
        instantBoughtKeys = {};
        if (doInstantBuys()) updateLogDisplay();

        // Resource-converter helpers run BEFORE registry so post-mutation state
        // (trades flipped to ready, faith freed by praise) is visible this cycle.
        try { doAutoPraise(); }            catch (e) { console.warn("[AutoPraise]", e); }
        try { doAutoTrade(); }             catch (e) { console.warn("[AutoTrade]", e); }
        try { doAutoExplore(); }           catch (e) { console.warn("[AutoExplore]", e); }
        try { doAutoSacrificeUnicorns(); } catch (e) { console.warn("[AutoSacUni]", e); }
        try { doAutoSacrificeAlicorns(); } catch (e) { console.warn("[AutoSacAli]", e); }
        try { doAutoFestival(); }          catch (e) { console.warn("[AutoFestival]", e); }

        _cycleCtx = createResolveContext(gamePage);
        var ctx = _cycleCtx;

        var cycleStartMs = Date.now();
        var eg = (typeof getCachedEdgeGraph === 'function')
            ? getCachedEdgeGraph(gamePage) : null;
        var plan = planNextAction(gamePage, eg);
        var cycleMs = Date.now() - cycleStartMs;
        plan.__cycleMs = cycleMs;
        if (cycleMs > 500) console.log('[Cycle] planNextAction took ' + cycleMs + 'ms');
        lastPlan = plan;

        if (plan.kind === "no-goal") {
            setStatus('<span style="color:#888;">Pick a terminal goal to start planning.</span>', true);
        } else if (plan.kind === "unknown-goal") {
            setStatus('<span style="color:#a55;">Unknown goal id: ' + plan.goalId + '</span>', true);
        } else if (plan.kind === "done") {
            setStatus('<span style="color:#0f0;">Goal achieved: ' + plan.goalId + ' — idle.</span>', true);
        } else if (plan.kind === "blocked") {
            setStatus('<span style="color:#aa0;">Blocked: ' + plan.reason + '</span>', true);
        } else if (plan.kind === "recommend") {
            var action = plan.action;
            var entry = plan.entry;

            // Attempt to execute: affordable-with-crafting trumps the `state`
            // label — a locked-cost entry whose deficit can be covered by an
            // on-the-fly craft plan is really "ready now".
            var executed = false;
            try {
                var check = canAffordWithCrafting(gamePage, entry.cost || [], ctx);
                if (check.affordable) {
                    if (check.craftPlan) action.craftPlan = check.craftPlan;
                    if (executeAction(gamePage, action)) {
                        logDecision(action.key, 'queue');
                        setStatus('Queue: ' + action.key
                            + ' <span style="color:#555;">(goal: ' + plan.goalId + ')</span>', true);
                        executed = true;
                    }
                }
            } catch (e) { console.warn('[Queue] exec failed', e); }

            // Not affordable yet — pre-craft storage-bounded intermediates.
            var crafted = 0;
            if (!executed && entry && entry.cost && entry.cost.length > 0) {
                try { crafted = progressCraftChain(gamePage, entry.cost); } catch (e) { }
                if (crafted > 0) { try { gamePage.updateCaches(); } catch (e) { } }
            }

            if (!executed) {
                var etaStr = formatTime(Math.round(plan.etaSecs || 0));
                var craftNote = crafted > 0 ? ' <span style="color:#0a0;">(+' + crafted + ' crafts)</span>' : '';
                setStatus('<div style="color:#0a0;font-size:11px;">'
                    + 'Saving for: <span style="color:#aa0;">' + plan.node.name + '</span>'
                    + ' <span style="color:#555;">(' + etaStr + ', goal: ' + plan.goalId + ')</span>'
                    + craftNote + '</div>', true);
            }
        }

        _cycleCtx = null;
        updateQueueDisplay();
        updateLogDisplay();
    }

    async function orchestratorTick() {
        if (typeof gamePage === 'undefined' || !gamePage.bld) return;
        if (cfg.autoObserve) try { doAutoObserve(); } catch (e) { }
        try { updateCatnipProductionRate(); } catch (e) { }
        try { doAutoJobs(); }  catch (e) { }
        try { doAutoHunt(); }  catch (e) { }
        try { doAutoCraft(); } catch (e) { }

        if (!cfg.mctsEnabled) return;
        if (mctsRunning) return;
        if (Date.now() - lastDecisionTime < cfg.decisionIntervalMs) return;
        mctsRunning = true;
        try { await runQueueCycle(); }
        catch (e) { setStatus('Queue error: ' + e.message); console.error('[Queue]', e); }
        finally { mctsRunning = false; lastDecisionTime = Date.now(); }
    }

    function logDecision(actionKey, source) {
        var sn = ['Spring', 'Summer', 'Autumn', 'Winter'];
        decisionLog.unshift({
            action: actionKey,
            year: gamePage.calendar.year, season: sn[gamePage.calendar.season] || '?',
            time: new Date().toLocaleTimeString(),
            source: source || 'queue',
        });
        if (decisionLog.length > 30) decisionLog.pop();
    }

    function startOrchestrator() {
        var code = 'setInterval(function(){postMessage("t")},1000);';
        var blob = new Blob([code], { type: 'application/javascript' });
        var w = new Worker(URL.createObjectURL(blob));
        w.onmessage = function () { orchestratorTick(); };
    }

    // =========================================================================
    //  [O] UI PANEL — single tab
    // =========================================================================
    var panel, statusEl, candidatesEl, logEl;

    function setStatus(text, isHtml) {
        if (!statusEl) return;
        if (isHtml) statusEl.innerHTML = text;
        else statusEl.textContent = text;
    }

    // Render the current chain-planner decision.
    function updateQueueDisplay() {
        if (!candidatesEl) return;
        if (!lastPlan) {
            candidatesEl.innerHTML = '<span style="color:#444;">idle</span>';
            return;
        }
        var p = lastPlan;
        if (p.kind === 'no-goal') {
            candidatesEl.innerHTML = '<span style="color:#888;font-size:11px;">Pick a terminal goal to begin.</span>';
            return;
        }
        if (p.kind === 'unknown-goal') {
            candidatesEl.innerHTML = '<span style="color:#a55;font-size:11px;">Unknown goal: ' + p.goalId + '</span>';
            return;
        }
        if (p.kind === 'done') {
            candidatesEl.innerHTML = '<div style="font-size:11px;">'
                + '<span style="color:#0f0;">✓ goal achieved</span> '
                + '<span style="color:#555;">(' + p.goalId + ')</span></div>'
                + '<div style="font-size:10px;color:#665;margin-left:8px;">idle — pick a new goal</div>';
            return;
        }
        if (p.kind === 'blocked') {
            candidatesEl.innerHTML = '<div style="font-size:11px;">'
                + '<span style="color:#888;font-size:10px;">GOAL</span> '
                + '<span style="color:#0f0;">' + p.goalId + '</span></div>'
                + '<div style="font-size:10px;color:#a55;margin-left:8px;">&#8627; ' + (p.reason || 'blocked') + '</div>';
            return;
        }
        // recommend
        var entry = p.entry;
        var ready = entry && entry.state === 'ready';
        var h = '<div style="font-size:11px;margin:1px 0;">'
            + '<span style="color:#888;font-size:10px;">GOAL</span> '
            + '<span style="color:#0f0;">' + p.goalId + '</span></div>';
        var actTime = ready
            ? '<span style="color:#0f0;">READY</span>'
            : '<span style="color:#aa0;">' + formatTime(Math.round(p.etaSecs || 0)) + '</span>';
        h += '<div style="font-size:11px;margin:1px 0;">'
            + '<span style="color:#888;font-size:10px;">NEXT</span> '
            + '<span style="color:#0a7;">' + p.node.name + '</span>'
            + ' <span style="color:#555;">[' + p.node.kind + ']</span> '
            + actTime + '</div>';
        if (entry && entry.capLimited) {
            h += '<div style="font-size:10px;color:#a70;margin-left:8px;">&#8627; cap-limited</div>';
        }
        if (entry && entry.prodLimited) {
            h += '<div style="font-size:10px;color:#a70;margin-left:8px;">&#8627; prod-limited</div>';
        }
        if (p.safetyNote) {
            h += '<div style="font-size:10px;color:#a55;margin-left:8px;">&#8627; ' + p.safetyNote + '</div>';
        }
        candidatesEl.innerHTML = h;
    }

    function updateLogDisplay() {
        if (!logEl) return;
        var h = '';
        for (var i = 0; i < Math.min(decisionLog.length, 15); i++) {
            var e = decisionLog[i];
            var col = e.source === 'instant' ? '#06a' : '#0aa';
            var label = e.source === 'instant' ? 'auto' : 'q';
            h += '<div style="font-size:10px;color:#666;margin:1px 0;">'
                + '<span style="color:#555;">Y' + e.year + ' ' + e.season.charAt(0) + ':</span> '
                + '<span style="color:' + col + ';font-size:8px;">[' + label + ']</span> '
                + '<span style="color:' + col + ';">' + e.action + '</span>'
                + '</div>';
        }
        logEl.innerHTML = h;
    }

    function setupUI() {
        panel = document.createElement('div');
        panel.id = 'mctsPanel';
        panel.innerHTML =
            '<div id="mcts_header" style="padding:6px 10px;background:rgba(0,255,0,0.08);border-bottom:1px solid #0a0;cursor:move;display:flex;justify-content:space-between;align-items:center;">'
                + '<span style="font-weight:bold;letter-spacing:1px;">AUTO</span>'
                + '<span id="mcts_collapse" style="cursor:pointer;padding:0 6px;font-size:14px;color:#0a0;">-</span></div>'
            + '<div id="mcts_body" style="padding:8px 10px;">'
                + '<div style="margin-bottom:6px;display:flex;align-items:center;gap:10px;">'
                    + '<label style="cursor:pointer;"><input type="checkbox" id="mcts_cb_engine"> Enable</label>'
                    + '<label style="cursor:pointer;"><input type="checkbox" id="mcts_cb_observe"> Observe</label></div>'
                + '<div style="margin-bottom:4px;display:flex;align-items:center;gap:6px;">'
                    + '<span style="color:#888;font-size:11px;">Clicker:</span>'
                    + '<input type="range" id="mcts_slider_clicker" min="0" max="250" value="0" style="flex:1;accent-color:#0a0;">'
                    + '<span id="mcts_lbl_clicker" style="color:#0f0;font-size:11px;min-width:40px;">Off</span></div>'
                + '<div style="margin-bottom:4px;display:flex;align-items:center;gap:6px;">'
                    + '<span style="color:#888;font-size:11px;">Speed:</span>'
                    + '<input type="range" id="mcts_slider_speed" min="1" max="20" value="1" style="flex:1;accent-color:#0a0;">'
                    + '<span id="mcts_lbl_speed" style="color:#0f0;font-size:11px;min-width:30px;">1x</span></div>'
                + '<div style="margin-bottom:4px;display:flex;align-items:center;gap:6px;">'
                    + '<span style="color:#888;font-size:11px;">Interval:</span>'
                    + '<input type="range" id="mcts_slider_interval" min="1" max="10" value="3" style="flex:1;accent-color:#0a0;">'
                    + '<span id="mcts_lbl_interval" style="color:#0f0;font-size:11px;min-width:30px;">3s</span></div>'
                + '<div style="margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;">'
                    + '<span style="color:#888;font-size:11px;">Gold reserve</span>'
                    + '<input type="number" id="mcts_input_gold_reserve" min="0" step="1" value="0" style="width:70px;background:#111;border:1px solid #333;color:#0f0;font-family:inherit;font-size:11px;padding:2px 4px;text-align:right;"></div>'
                + '<div style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">'
                    + '<span style="color:#888;font-size:11px;">Faith reserve</span>'
                    + '<input type="number" id="mcts_input_faith_reserve" min="0" step="1" value="0" style="width:70px;background:#111;border:1px solid #333;color:#0f0;font-family:inherit;font-size:11px;padding:2px 4px;text-align:right;"></div>'
                + '<div style="margin-bottom:4px;">'
                    + '<div style="color:#888;font-size:11px;margin-bottom:2px;">Terminal goal</div>'
                    + '<input id="mcts_input_goal" list="mcts_goal_options" placeholder="type to search (e.g. tech:calendar)" style="width:100%;box-sizing:border-box;background:#111;border:1px solid #333;color:#0f0;font-family:inherit;font-size:11px;padding:2px 4px;">'
                    + '<datalist id="mcts_goal_options"></datalist>'
                    + '<div id="mcts_goal_state" style="color:#555;font-size:10px;margin-top:2px;min-height:12px;"></div></div>'
                + '<div style="margin-bottom:4px;display:flex;gap:4px;">'
                    + '<button id="mcts_btn_dump"  style="flex:1;background:#111;border:1px solid #333;color:#0f0;font-family:inherit;font-size:11px;padding:3px 4px;cursor:pointer;">Dump graph</button>'
                    + '<button id="mcts_btn_edges" style="flex:1;background:#111;border:1px solid #333;color:#0f0;font-family:inherit;font-size:11px;padding:3px 4px;cursor:pointer;">Dump edges</button>'
                    + '<button id="mcts_btn_chain" style="flex:1;background:#111;border:1px solid #333;color:#0f0;font-family:inherit;font-size:11px;padding:3px 4px;cursor:pointer;">Dump chain</button></div>'
                + '<div style="border-top:1px solid #222;padding-top:4px;margin-bottom:4px;">'
                    + '<div id="mcts_status" style="color:#0a0;font-size:11px;">Initializing...</div></div>'
                + '<div style="border-top:1px solid #222;padding-top:4px;margin-bottom:4px;">'
                    + '<div style="color:#555;font-size:10px;margin-bottom:2px;">DECISION</div>'
                    + '<div id="mcts_candidates" style="min-height:20px;"></div></div>'
                + '<div style="border-top:1px solid #222;padding-top:4px;">'
                    + '<div style="color:#555;font-size:10px;margin-bottom:2px;">LOG</div>'
                    + '<div id="mcts_log" style="max-height:180px;overflow-y:auto;"></div></div>'
            + '</div>';

        document.body.appendChild(panel);
        Object.assign(panel.style, {
            position: 'fixed', bottom: '20px', right: '20px', zIndex: '99999',
            background: 'rgba(0,0,0,0.92)', border: '1px solid #0a0', borderRadius: '6px',
            fontFamily: '"Consolas","Courier New",monospace', fontSize: '12px', color: '#0f0',
            padding: '0', minWidth: '320px', maxWidth: '400px',
            boxShadow: '0 0 20px rgba(0,255,0,0.15)', pointerEvents: 'auto', userSelect: 'none'
        });
        panel.addEventListener('click', function (e) { e.stopPropagation(); });
        panel.addEventListener('mousedown', function (e) { e.stopPropagation(); });

        statusEl = document.getElementById('mcts_status');
        candidatesEl = document.getElementById('mcts_candidates');
        logEl = document.getElementById('mcts_log');

        wireToggle('mcts_cb_engine', 'mctsEnabled');
        wireToggle('mcts_cb_observe', 'autoObserve');
        wireSlider('mcts_slider_clicker', 'clicksPerSec', function (v) {
            setClickerRate(v); document.getElementById('mcts_lbl_clicker').textContent = v === 0 ? 'Off' : v + '/sec';
        });
        wireSlider('mcts_slider_interval', 'decisionIntervalMs', function (v) {
            document.getElementById('mcts_lbl_interval').textContent = v + 's';
        }, true);

        var collapseBtn = document.getElementById('mcts_collapse');
        var body = document.getElementById('mcts_body');
        var collapsed = false;
        collapseBtn.addEventListener('click', function () {
            collapsed = !collapsed;
            body.style.display = collapsed ? 'none' : 'block';
            collapseBtn.textContent = collapsed ? '+' : '-';
        });

        var dumpBtn = document.getElementById('mcts_btn_dump');
        if (dumpBtn) dumpBtn.addEventListener('click', function () {
            try { if (typeof dumpGraph === 'function') dumpGraph(); }
            catch (e) { console.error('[graph dump]', e); }
        });
        var edgesBtn = document.getElementById('mcts_btn_edges');
        if (edgesBtn) edgesBtn.addEventListener('click', function () {
            try { if (typeof dumpEdgeGraph === 'function') dumpEdgeGraph(); }
            catch (e) { console.error('[edge dump]', e); }
        });
        var chainBtn = document.getElementById('mcts_btn_chain');
        if (chainBtn) chainBtn.addEventListener('click', function () {
            try { if (typeof dumpChain === 'function') dumpChain(); }
            catch (e) { console.error('[chain dump]', e); }
        });

        var goalInput = document.getElementById('mcts_input_goal');
        var goalList  = document.getElementById('mcts_goal_options');
        var goalState = document.getElementById('mcts_goal_state');

        function refreshGoalState() {
            if (!goalState) return;
            var id = cfg.terminalGoal;
            if (!id) { goalState.textContent = ''; return; }
            try {
                var node = (typeof getTerminalGoalNode === 'function') ? getTerminalGoalNode() : null;
                if (!node) { goalState.innerHTML = '<span style="color:#a55;">unknown id</span>'; return; }
                var colorByState = {
                    'ready':         '#0f0',
                    'locked-cost':   '#aa0',
                    'locked-ui':     '#a70',
                    'locked-prereq': '#955',
                    'done':          '#08a',
                };
                var col = colorByState[node.state] || '#888';
                goalState.innerHTML = '<span style="color:' + col + ';">' + node.state + '</span>'
                    + ' <span style="color:#555;">' + (node.name || id) + '</span>';
            } catch (e) { goalState.textContent = 'err: ' + e.message; }
        }

        function refreshGoalOptions() {
            if (!goalList) return;
            try {
                var ids = (typeof window.__listNodeIds === 'function') ? window.__listNodeIds() : [];
                var html = '';
                for (var i = 0; i < ids.length; i++) html += '<option value="' + ids[i] + '">';
                goalList.innerHTML = html;
            } catch (e) { }
        }

        if (goalInput) {
            goalInput.value = cfg.terminalGoal || '';
            goalInput.addEventListener('focus', refreshGoalOptions);
            goalInput.addEventListener('change', function () {
                var v = goalInput.value.trim();
                cfg.terminalGoal = v || null;
                saveCfg();
                refreshGoalState();
            });
            refreshGoalState();
        }

        makeDraggable(panel, document.getElementById('mcts_header'));

        document.getElementById('mcts_cb_engine').checked = cfg.mctsEnabled;
        document.getElementById('mcts_cb_observe').checked = cfg.autoObserve;
        document.getElementById('mcts_slider_clicker').value = cfg.clicksPerSec;
        document.getElementById('mcts_lbl_clicker').textContent = cfg.clicksPerSec === 0 ? 'Off' : cfg.clicksPerSec + '/sec';
        document.getElementById('mcts_slider_interval').value = cfg.decisionIntervalMs / 1000;
        document.getElementById('mcts_lbl_interval').textContent = (cfg.decisionIntervalMs / 1000) + 's';

        var goldInput = document.getElementById('mcts_input_gold_reserve');
        goldInput.value = cfg.goldTradeReserve || 0;
        goldInput.addEventListener('change', function () {
            var v = parseFloat(goldInput.value); if (isNaN(v) || v < 0) v = 0;
            goldInput.value = v; cfg.goldTradeReserve = v; saveCfg();
        });

        var faithInput = document.getElementById('mcts_input_faith_reserve');
        faithInput.value = cfg.faithPraiseReserve || 0;
        faithInput.addEventListener('change', function () {
            var v = parseFloat(faithInput.value); if (isNaN(v) || v < 0) v = 0;
            faithInput.value = v; cfg.faithPraiseReserve = v; saveCfg();
        });

        var speedSlider = document.getElementById('mcts_slider_speed');
        var speedLabel = document.getElementById('mcts_lbl_speed');
        var speedInit = cfg.speedMultiplier || 1;
        speedSlider.value = speedInit;
        speedLabel.textContent = speedInit + 'x';
        setSpeedMultiplier(speedInit);
        speedSlider.addEventListener('input', function () {
            var v = parseInt(speedSlider.value); if (isNaN(v) || v < 1) v = 1;
            cfg.speedMultiplier = v; speedLabel.textContent = v + 'x';
            setSpeedMultiplier(v); saveCfg();
        });
    }

    function wireToggle(id, key) {
        var cb = document.getElementById(id);
        if (cb) cb.addEventListener('change', function () { cfg[key] = cb.checked; saveCfg(); });
    }
    function wireSlider(id, key, fn, isSec) {
        var sl = document.getElementById(id); if (!sl) return;
        sl.addEventListener('input', function () {
            var v = parseInt(sl.value);
            if (key) cfg[key] = isSec ? v * 1000 : v;
            if (fn) fn(v);
            if (key) saveCfg();
        });
    }

    function makeDraggable(el, handle) {
        var ox = 0, oy = 0, d = false;
        handle.addEventListener('mousedown', function (e) {
            d = true; ox = e.clientX - el.getBoundingClientRect().left; oy = e.clientY - el.getBoundingClientRect().top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) {
            if (!d) return;
            el.style.left = (e.clientX - ox) + 'px'; el.style.top = (e.clientY - oy) + 'px';
            el.style.right = 'auto'; el.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', function () { d = false; });
    }

    // =========================================================================
    //  [P] INIT
    // =========================================================================
    var checkReady = setInterval(function () {
        if (typeof gamePage !== 'undefined' && gamePage.bld && gamePage.resPool) {
            clearInterval(checkReady);
            init();
        }
    }, 1000);

    function init() {
        console.log('[Auto] v5.0 (queue planner + linear value model) initializing...');
        if (gamePage.ui && typeof gamePage.ui.confirm === 'function') {
            gamePage.ui.confirm = function (t, m, cb) { if (cb) cb(); return true; };
        }
        startClickerWorker();
        startSpeedWorker();
        setupUI();
        startOrchestrator();
        setStatus('Ready. Enable the planner to start.');
    }

})();
