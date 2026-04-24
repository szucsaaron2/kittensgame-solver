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
        var plan = planNextAction(gamePage);
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
