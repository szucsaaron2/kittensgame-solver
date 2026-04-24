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
