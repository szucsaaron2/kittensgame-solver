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
