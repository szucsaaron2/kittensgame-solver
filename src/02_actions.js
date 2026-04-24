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
