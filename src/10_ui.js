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
            var blkBadge = (p.__goalSource === 'ssp')
                ? ' <span style="color:#0af;font-size:9px;border:1px solid #057;border-radius:2px;padding:0 3px;">SSP</span>'
                : '';
            candidatesEl.innerHTML = '<div style="font-size:11px;">'
                + '<span style="color:#888;font-size:10px;">GOAL</span> '
                + '<span style="color:#0f0;">' + p.goalId + '</span>' + blkBadge + '</div>'
                + '<div style="font-size:10px;color:#a55;margin-left:8px;">&#8627; ' + (p.reason || 'blocked') + '</div>';
            return;
        }
        // recommend
        var entry = p.entry;
        var ready = entry && entry.state === 'ready';
        var goalBadge = (p.__goalSource === 'ssp')
            ? ' <span style="color:#0af;font-size:9px;border:1px solid #057;border-radius:2px;padding:0 3px;">SSP</span>'
            : '';
        var h = '<div style="font-size:11px;margin:1px 0;">'
            + '<span style="color:#888;font-size:10px;">GOAL</span> '
            + '<span style="color:#0f0;">' + p.goalId + '</span>' + goalBadge + '</div>';
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

    function updateSspDisplay() {
        var section = document.getElementById('mcts_ssp_section');
        var pendingEl = document.getElementById('mcts_ssp_pending');
        var tableEl = document.getElementById('mcts_ssp_table');
        if (!section || !pendingEl || !tableEl) return;

        if (!cfg.sspEnabled) { section.style.display = 'none'; return; }
        section.style.display = '';

        // Pending observation panel.
        try {
            var pending = (typeof _sspPendingObservation === 'function')
                ? _sspPendingObservation() : null;
            if (pending) {
                var elapsed = (Date.now() - pending.startedAtMs) / 1000;
                var ratio = elapsed / pending.predictedSecs;
                var col = ratio > 1.5 ? '#a55' : (ratio > 1.05 ? '#aa0' : '#0a7');
                pendingEl.innerHTML = '<span style="color:#555;">tracking</span> '
                    + '<span style="color:#0f0;">' + pending.goalId + '</span> '
                    + '<span style="color:' + col + ';">'
                    + formatTime(Math.round(elapsed)) + '/' + formatTime(Math.round(pending.predictedSecs))
                    + '</span>';
            } else {
                pendingEl.innerHTML = '<span style="color:#555;">no goal in flight</span>';
            }
        } catch (e) { pendingEl.textContent = 'err: ' + e.message; }

        // Top-5 ranking with bias / count.
        try {
            if (!lastSspResult || !lastSspResult.ranking || !lastSspResult.ranking.length) {
                tableEl.innerHTML = '<span style="color:#555;">computing...</span>';
                return;
            }
            var rows = lastSspResult.ranking.slice(0, 5);
            var html = '';
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i];
                var rec = (typeof getSspBeliefRecord === 'function')
                    ? getSspBeliefRecord(r.id) : { bias: 1, count: 0, effective: 1 };
                var biasCol = rec.count === 0 ? '#555'
                    : (Math.abs(rec.bias - 1) < 0.1 ? '#888'
                       : (rec.bias > 1 ? '#a70' : '#077'));
                var vStr = isFinite(r.V) ? formatTime(Math.round(r.V)) : '∞';
                html += '<div style="margin:1px 0;display:flex;gap:4px;align-items:baseline;">'
                    + '<span style="color:#888;width:14px;text-align:right;">' + (i + 1) + '.</span>'
                    + '<span style="color:#0f0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + r.id + '</span>'
                    + '<span style="color:#aa0;min-width:36px;text-align:right;">' + vStr + '</span>'
                    + '<span style="color:' + biasCol + ';min-width:32px;text-align:right;" title="raw bias × count">'
                    + rec.bias.toFixed(2) + '×' + rec.count + '</span>'
                    + '</div>';
            }
            tableEl.innerHTML = html;
        } catch (e) { tableEl.textContent = 'err: ' + e.message; }
    }

    function updatePhaseDisplay() {
        var nowEl = document.getElementById('mcts_phase_now');
        var logElP = document.getElementById('mcts_phase_log');
        if (!nowEl || !logElP) return;
        try {
            var current = (typeof getCurrentPhase === 'function') ? getCurrentPhase() : null;
            if (current && current.tier >= 0) {
                nowEl.innerHTML = '<span style="color:#888;font-size:9px;">T' + current.tier + '</span> '
                    + '<span style="color:#fa0;">' + current.name + '</span>';
            } else {
                nowEl.innerHTML = '<span style="color:#555;">—</span>';
            }
            var log = (typeof getPhaseLog === 'function') ? getPhaseLog() : [];
            var rows = log.slice(-5).reverse();   // newest first, last 5
            var h = '';
            for (var i = 0; i < rows.length; i++) {
                var e = rows[i];
                var when = (e.year != null) ? ('Y' + e.year) : new Date(e.atMs).toLocaleTimeString();
                h += '<div>→ T' + e.tier + ' '
                    + '<span style="color:#fa0;">' + e.name + '</span> '
                    + '<span style="color:#666;">(' + when + ')</span></div>';
            }
            logElP.innerHTML = h || '<span style="color:#555;">no transitions yet</span>';
        } catch (e) { nowEl.textContent = 'err: ' + e.message; }
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
                    + '<label style="cursor:pointer;"><input type="checkbox" id="mcts_cb_observe"> Observe</label>'
                    + '<label style="cursor:pointer;" title="Use SSP-Dynamic to auto-pick the terminal goal each cycle."><input type="checkbox" id="mcts_cb_ssp"> SSP</label></div>'
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
                + '<div style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;" title="Trades per cycle with zebras when ships ≥ floor. 0 = off.">'
                    + '<span style="color:#888;font-size:11px;">Ti trade burst</span>'
                    + '<input type="number" id="mcts_input_ti_burst" min="0" max="500" step="1" value="25" style="width:70px;background:#111;border:1px solid #333;color:#0f0;font-family:inherit;font-size:11px;padding:2px 4px;text-align:right;"></div>'
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
                + '<div id="mcts_ssp_section" style="border-top:1px solid #222;padding-top:4px;display:none;">'
                    + '<div style="color:#057;font-size:10px;margin-bottom:2px;">SSP <span style="color:#555;">(top 5)</span></div>'
                    + '<div id="mcts_ssp_pending" style="font-size:10px;color:#888;margin-bottom:2px;"></div>'
                    + '<div id="mcts_ssp_table" style="font-size:10px;"></div></div>'
                + '<div id="mcts_phase_section" style="border-top:1px solid #222;padding-top:4px;">'
                    + '<div style="color:#a70;font-size:10px;margin-bottom:2px;">PHASE</div>'
                    + '<div id="mcts_phase_now" style="font-size:11px;color:#fa0;margin-bottom:2px;">—</div>'
                    + '<div id="mcts_phase_log" style="font-size:10px;color:#aa6;max-height:60px;overflow-y:auto;"></div></div>'
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
        wireToggle('mcts_cb_ssp', 'sspEnabled');
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
        document.getElementById('mcts_cb_ssp').checked = !!cfg.sspEnabled;
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

        var tiBurstInput = document.getElementById('mcts_input_ti_burst');
        tiBurstInput.value = (cfg.titaniumTradeBatch != null) ? cfg.titaniumTradeBatch : 25;
        tiBurstInput.addEventListener('change', function () {
            var v = parseInt(tiBurstInput.value); if (isNaN(v) || v < 0) v = 0;
            tiBurstInput.value = v; cfg.titaniumTradeBatch = v; saveCfg();
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
