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
            priceRatio: b.priceRatio || 1.15,  // used by beam repeat-cost scaling
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
        // jobModifiers is per-kitten-per-tick.  Symbolic state multiplies by
        // (assigned count × tps) when a job action is applied.  We deliberately
        // leave provides.resources EMPTY so the flat-add path in
        // applyActionSymbolic doesn't count a job reassignment as one-kitten
        // worth of rate.
        var mods = {};
        if (j.modifiers) {
            for (var k in j.modifiers) {
                if (j.modifiers.hasOwnProperty(k) && j.modifiers[k]) mods[k] = j.modifiers[k];
            }
        }
        return {
            id: _id("job", j.name),
            kind: "job",
            name: j.name,
            state: j.unlocked ? "ready" : "locked-prereq",
            prereqs: [],
            price: null, unlockPrice: null,
            jobModifiers: mods,
            provides: {
                resources: [],
                storage: [], ratios: [], con: [], unlocks: []
            },
            rawUnlocks: null
        };
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
            priceRatio: b.priceRatio || 1.15,  // used by beam repeat-cost scaling
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

        // Register jobs as producers/consumers from their jobModifiers.  Jobs
        // intentionally keep provides.resources empty (symbolic state would
        // miscount), but the chain-backward search needs to know which jobs
        // produce a given resource so prod-helpers can surface housing /
        // unlocker chains (e.g. wood is produced by job:woodcutter, which
        // requires kittens from bld:hut).  jobModifiers keys are bare resource
        // names ("wood": 0.018), not effect keys, so we don't go through
        // _parseEffectKey here.
        for (var i = 0; i < ids.length; i++) {
            var n = nodes[ids[i]];
            if (n.kind !== "job" || !n.jobModifiers) continue;
            for (var resName in n.jobModifiers) {
                if (!n.jobModifiers.hasOwnProperty(resName)) continue;
                var rate = n.jobModifiers[resName];
                if (!rate || rate <= 0) continue;
                var bucket = (producersOf[resName] = producersOf[resName] || []);
                if (bucket.indexOf(n.id) < 0) bucket.push(n.id);
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
