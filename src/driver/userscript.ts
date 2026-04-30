import { run, type DriverIO } from "./loop";
import { extract, apply, ApplyError } from "@/simulator";
import { goal, goalReport, enumerateFeasibleActions } from "@/model";
import {
  makeRandomPolicy,
  runPipeline,
  recordTrace,
  recentTraces,
} from "@/policy";
import type { State } from "@/model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const unsafeWindow: any;

console.log("[autoplayer] userscript loaded");

// Tampermonkey isolates user scripts from page scripts; gamePage lives on the
// page's window, not ours. Prefer unsafeWindow when available.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pageWindow: any = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

interface Stats {
  steps: number;
  applied: number;
  failed: number;
  byKind: Record<string, number>;
  errors: Record<string, number>;
  startedAt: number;
}

const stats: Stats = {
  steps: 0,
  applied: 0,
  failed: 0,
  byKind: {},
  errors: {},
  startedAt: Date.now(),
};

// On-screen panel so you can watch the autoplayer without DevTools.
let panel: HTMLDivElement | null = null;
let running = false;
const STEP_INTERVAL_MS = 2000;
const STORAGE_KEY = "autoplayer_running";

function ensurePanel(): HTMLDivElement {
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "autoplayer-panel";
  panel.style.cssText = [
    "position:fixed",
    "top:8px",
    "right:8px",
    "z-index:99999",
    "background:rgba(20,20,20,0.92)",
    "color:#dcdcdc",
    "font:12px/1.4 monospace",
    "padding:10px 12px",
    "border:1px solid #555",
    "border-radius:4px",
    "max-width:340px",
    "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
  ].join(";");
  document.body.appendChild(panel);
  return panel;
}

function renderPanel(lastAction: string, lastResult: string): void {
  const p = ensurePanel();
  const elapsed = Math.floor((Date.now() - stats.startedAt) / 1000);
  const topKinds = Object.entries(stats.byKind)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, n]) => `${k}:${n}`)
    .join(" ");
  const topErrors = Object.entries(stats.errors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => `${k}(${n})`)
    .join(" ");
  const btn = (id: string, label: string, color = "#9ec0e0"): string =>
    `<span id="${id}" style="cursor:pointer;color:${color};border:1px solid #555;padding:1px 6px;border-radius:3px;margin-right:4px;display:inline-block;margin-top:2px;">${label}</span>`;
  p.innerHTML = [
    `<b style="color:#7ec699">Kittens Autoplayer</b> &nbsp; ` +
      `<span id="ap-toggle" style="cursor:pointer;color:${running ? "#e58a8a" : "#7ec699"};">[${running ? "stop" : "start"}]</span>`,
    `running: ${running ? "yes" : "no"} &nbsp; t=${elapsed}s`,
    `steps: ${stats.steps} &nbsp; applied: ${stats.applied} &nbsp; failed: ${stats.failed}`,
    `last: <span style="color:#9ec0e0">${lastAction}</span>`,
    `result: <span style="color:#dcb47c">${lastResult}</span>`,
    `top kinds: ${topKinds || "—"}`,
    `errors: ${topErrors || "—"}`,
    `<div style="margin-top:6px;">` +
      btn("ap-state", "state") +
      btn("ap-actions", "actions") +
      btn("ap-goal", "goal") +
      btn("ap-probe", "probe") +
      btn("ap-step", "step", "#dcb47c") +
      btn("ap-assign", "assign", "#c69ec0") +
      btn("ap-verify", "verify", "#dcb47c") +
      btn("ap-trace", "trace", "#9ec0e0") +
      `</div>`,
  ].join("<br>");
  const wire = (id: string, fn: () => void): void => {
    const el = p.querySelector(`#${id}`);
    if (el) (el as HTMLElement).onclick = fn;
  };
  wire("ap-toggle", () => (running ? stop() : start()));
  wire("ap-state", printState);
  wire("ap-actions", printActions);
  wire("ap-goal", printGoal);
  wire("ap-probe", printProbe);
  wire("ap-step", stepOnce);
  wire("ap-assign", assignAllUI);
  wire("ap-verify", verifyFeasibility);
  wire("ap-trace", printTrace);
}

function printTrace(): void {
  const t = recentTraces();
  console.log(`[autoplayer] last ${t.length} pipeline decisions:`);
  for (const e of t.slice(-20)) {
    console.log(`  L${e.layer} ${e.source}: ${fmtAction(e.action)}`);
  }
}

function fmtAction(a: unknown): string {
  if (typeof a !== "object" || a === null) return String(a);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const x = a as any;
   
  const kind = x.kind;
   
  const detail =
    x.building ?? x.tech ?? x.upgrade ?? x.policy ?? x.civ ?? x.structure ?? x.mission ?? "";
   
  return detail ? `${kind}:${detail}` : `${kind}`;
}

let stopRequested = false;

// -- Diagnostic helpers ---------------------------------------------------

function safeExtract(): ReturnType<typeof extract> | null {
  try {
    return extract(pageWindow.gamePage);
  } catch (e) {
    console.error("[autoplayer] extract failed:", e);
    return null;
  }
}

function printState(): void {
  const s = safeExtract();
  if (!s) return;
  const summary = {
    calendar: s.info.calendar,
    weather: s.info.weather,
    resources: Object.fromEntries(
      Object.entries(s.physical.resources).filter(([, v]) => v > 0),
    ),
    resourceCaps: Object.fromEntries(
      Object.entries(s.physical.resourceCaps).filter(([, v]) => v !== Infinity && v > 0),
    ),
    buildings: Object.fromEntries(
      Object.entries(s.physical.buildings).filter(([, v]) => v > 0),
    ),
    techsResearched: Object.entries(s.info.techs)
      .filter(([, v]) => v)
      .map(([k]) => k),
    workshopResearched: Object.entries(s.info.workshop)
      .filter(([, v]) => v)
      .map(([k]) => k),
    policiesAdopted: Object.entries(s.info.policies)
      .filter(([, v]) => v)
      .map(([k]) => k),
    policiesBlocked: Object.entries(s.info.policyBlocked)
      .filter(([, v]) => v)
      .map(([k]) => k),
    kittens: s.physical.kittens,
    diplomacyDiscovered: Object.entries(s.info.diplomacyDiscovered)
      .filter(([, v]) => v)
      .map(([k]) => k),
    embassies: Object.fromEntries(
      Object.entries(s.physical.embassies).filter(([, v]) => v > 0),
    ),
    faith: s.info.faith,
    apocrypha: s.info.apocrypha,
    paragon: s.info.paragon,
    karma: s.info.karma,
    happiness: s.info.happiness,
  };
  console.log("[autoplayer] state:", summary);
  console.log("[autoplayer] full state object:", s);
}

function printActions(): void {
  const s = safeExtract();
  if (!s) return;
  const actions = enumerateFeasibleActions(s);
  const byKind: Record<string, unknown[]> = {};
  for (const a of actions) {
    if (!byKind[a.kind]) byKind[a.kind] = [];
    byKind[a.kind]!.push(a);
  }
  console.log(`[autoplayer] ${actions.length} feasible actions:`);
  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`  ${kind} (${list.length}):`, list);
  }
}

function printGoal(): void {
  const s = safeExtract();
  if (!s) return;
  const r = goalReport(s);
  console.log(`[autoplayer] goal satisfied: ${r.satisfied}`);
  for (const [k, list] of Object.entries(r) as Array<[string, unknown]>) {
    if (k === "satisfied") continue;
    if (Array.isArray(list) && list.length > 0) {
      console.log(`  ${k} (${list.length}):`, list);
    }
  }
}

function printProbe(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cls: any = pageWindow.classes;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const com: any = pageWindow.com;
  const probe = {
    "classes.ui.btn.BuildingBtnModernController":
      typeof cls?.ui?.btn?.BuildingBtnModernController,
    "com.nuclearunicorn.game.ui.BuildingStackableBtnController":
      typeof com?.nuclearunicorn?.game?.ui?.BuildingStackableBtnController,
    "com.nuclearunicorn.game.ui.TechButtonController":
      typeof com?.nuclearunicorn?.game?.ui?.TechButtonController,
    "com.nuclearunicorn.game.ui.UpgradeButtonController":
      typeof com?.nuclearunicorn?.game?.ui?.UpgradeButtonController,
    "com.nuclearunicorn.game.ui.ZigguratBtnController":
      typeof com?.nuclearunicorn?.game?.ui?.ZigguratBtnController,
    "com.nuclearunicorn.game.ui.ReligionBtnController":
      typeof com?.nuclearunicorn?.game?.ui?.ReligionBtnController,
    "classes.ui.PolicyBtnController": typeof cls?.ui?.PolicyBtnController,
    "classes.ui.space.PlanetBuildingBtnController":
      typeof cls?.ui?.space?.PlanetBuildingBtnController,
    "classes.ui.time.ChronoforgeBtnController":
      typeof cls?.ui?.time?.ChronoforgeBtnController,
    "classes.ui.time.VoidSpaceBtnController":
      typeof cls?.ui?.time?.VoidSpaceBtnController,
    "classes.game.ui.GatherCatnipButtonController":
      typeof cls?.game?.ui?.GatherCatnipButtonController,
    "classes.game.ui.RefineCatnipButtonController":
      typeof cls?.game?.ui?.RefineCatnipButtonController,
  };
  console.log("[autoplayer] controller probe (live page):", probe);
}

// Assign one specific job. Convenience for testing from the console.
function assign(jobName: string, count: number): void {
  try {
    apply(pageWindow.gamePage, {
      kind: "assign",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jobs: { [jobName]: count } as any,
    });
    const s = safeExtract();
    console.log("[autoplayer] assign result:", s?.physical.kittens);
  } catch (e) {
    console.error("[autoplayer] assign failed:", e);
  }
}

// Distribute every free kitten evenly across currently-unlocked jobs.
function assignAllUI(): void {
  const s = safeExtract();
  if (!s) return;
  const unlockedJobs = (Object.entries(s.info.unlocked.jobs) as [string, boolean][])
    .filter(([, ok]) => ok)
    .map(([j]) => j);
  const total = s.physical.kittens.total;
  if (total === 0) {
    console.log("[autoplayer] assign: no kittens yet");
    return;
  }
  if (unlockedJobs.length === 0) {
    console.log("[autoplayer] assign: no unlocked jobs (need a hut first)");
    return;
  }

  // Spread evenly. Remainder goes to the first job(s).
  const baseShare = Math.floor(total / unlockedJobs.length);
  const remainder = total - baseShare * unlockedJobs.length;
  const jobs: Record<string, number> = {};
  unlockedJobs.forEach((j, i) => {
    jobs[j] = baseShare + (i < remainder ? 1 : 0);
  });
  console.log(`[autoplayer] assign: distributing ${total} kittens across`, jobs);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apply(pageWindow.gamePage, { kind: "assign", jobs: jobs as any });
    const after = safeExtract();
    console.log("[autoplayer] post-assign kittens:", after?.physical.kittens);
  } catch (e) {
    console.error("[autoplayer] assignAll failed:", e);
  }
}

/**
 * Live cross-check: for every action our enumeration calls feasible, ask the
 * live game whether IT considers the action available + affordable. Log
 * disagreements. Catches predicate bugs the random run would hit only by
 * chance.
 */
function verifyFeasibility(): void {
  const s = safeExtract();
  if (!s) return;
  const g = pageWindow.gamePage;
  const actions = enumerateFeasibleActions(s);

  interface Mismatch {
    action: string;
    weSay: string;
    gameSays: string;
    note?: string;
  }
  const mismatches: Mismatch[] = [];
  const summary: Record<string, number> = {};

  // Helpers to ask the game directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tryHasResources = (entry: any): boolean | null => {
    try {
      const prices = (entry?.prices ?? entry?.cost ?? []) as Array<{
        name: string;
        val: number;
      }>;
      if (!Array.isArray(prices)) return null;
       
      return Boolean(g.resPool.hasRes(prices));
    } catch {
      return null;
    }
  };

  for (const a of actions) {
    summary[a.kind] = (summary[a.kind] ?? 0) + 1;
    let gameSays = "?";
    let entry: unknown = null;
    try {
      switch (a.kind) {
        case "build":
           
          entry = g.bld.get(a.building);
          break;
        case "research":
           
          entry = g.science.get(a.tech);
          break;
        case "workshop":
           
          entry = g.workshop.get(a.upgrade);
          break;
        case "religion-upgrade":
           
          entry = g.religion.getRU(a.upgrade);
          break;
        case "build-ziggurat":
           
          entry = g.religion.getZU(a.structure);
          break;
        case "build-chronoforge":
           
          entry = g.time.getCFU(a.building);
          break;
        case "build-voidspace":
           
          entry = g.time.getVSU(a.building);
          break;
        case "policy":
           
          entry = g.science.getPolicy(a.policy);
          break;
        case "craft": {
           
          const recipe = g.workshop.getCraft(a.item);
           
          const prices = g.workshop.getCraftPrice(recipe);
           
          entry = { prices, unlocked: recipe?.unlocked };
          break;
        }
        default:
          // No live affordability check for this kind — trust feasibility.
          continue;
      }
       
      const unlocked = (entry as { unlocked?: boolean })?.unlocked;
      const hasRes = tryHasResources(entry);
       
      const researched = (entry as { researched?: boolean })?.researched;
      gameSays = `unlocked=${String(unlocked)} hasRes=${String(hasRes)} researched=${String(researched)}`;
      // We expect: feasible iff (unlocked && hasRes && !researched).
      const expected = unlocked === true && hasRes === true && researched !== true;
      if (!expected) {
        mismatches.push({
          action: fmtAction(a),
          weSay: "feasible",
          gameSays,
          note: "we say feasible but game disagrees",
        });
      }
    } catch (e) {
      mismatches.push({
        action: fmtAction(a),
        weSay: "feasible",
        gameSays: `threw: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  console.log(`[autoplayer] verify: ${actions.length} feasible actions, ${mismatches.length} mismatches`);
  console.log("  by kind:", summary);
  if (mismatches.length > 0) {
    console.warn("  mismatches:", mismatches);
  }
}

function stepOnce(): void {
  const s = safeExtract();
  if (!s) return;
  const policy = makeRandomPolicy();
  const a = policy(s);
  console.log("[autoplayer] step: policy chose", a);
  try {
    if (a.kind !== "wait") {
      apply(pageWindow.gamePage, a);
      console.log("[autoplayer] step: applied OK");
    }
  } catch (e) {
    console.error("[autoplayer] step failed:", e);
  }
}

function start(): void {
  if (running) return;
  running = true;
  stopRequested = false;
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // ignore
  }
  console.log("[autoplayer] starting random-policy driver");
  void runLoop();
}

function stop(): void {
  if (!running) return;
  stopRequested = true;
  running = false;
  try {
    localStorage.setItem(STORAGE_KEY, "0");
  } catch {
    // ignore
  }
  console.log("[autoplayer] stop requested");
  renderPanel("(stopped)", "—");
}

async function runLoop(): Promise<void> {
  const fallback = makeRandomPolicy();
  let lastAction = "(none yet)";
  let lastResult = "—";
  let prevState: State | null = null;

  const policy = (s: State) => {
    const r = runPipeline(s, { prev: prevState, fallback });
    recordTrace(r.trace);
    prevState = s;
    return r.action;
  };

  const io: DriverIO = {
    read: () => extract(pageWindow.gamePage),
    apply: (a) => {
      lastAction = fmtAction(a);
      stats.steps++;
      stats.byKind[a.kind] = (stats.byKind[a.kind] ?? 0) + 1;
      try {
        if (a.kind !== "wait") {
          apply(pageWindow.gamePage, a);
          stats.applied++;
          lastResult = "applied";
        } else {
          lastResult = "waited";
        }
      } catch (e) {
        stats.failed++;
        const msg =
          e instanceof ApplyError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e);
        stats.errors[a.kind] = (stats.errors[a.kind] ?? 0) + 1;
        lastResult = `err: ${msg.slice(0, 60)}`;
      }
      renderPanel(lastAction, lastResult);
    },
    waitUntilNextEvent: () => new Promise<void>((r) => setTimeout(r, STEP_INTERVAL_MS)),
    shouldStop: (s) => {
      if (stopRequested) return true;
      if (goal(s)) {
        const r = goalReport(s);
        console.log("[autoplayer] goal reached!", r);
        lastResult = "GOAL REACHED 🎉";
        renderPanel(lastAction, lastResult);
        return true;
      }
      return false;
    },
  };

  // Initial render before any step.
  renderPanel(lastAction, "ready");

  await run(policy, io);
  running = false;
  try {
    localStorage.setItem(STORAGE_KEY, "0");
  } catch {
    // ignore
  }
}

const waitForGame = (): void => {
  if (typeof pageWindow.gamePage === "undefined" || pageWindow.gamePage === null) {
    setTimeout(waitForGame, 500);
    return;
  }
  console.log("[autoplayer] gamePage detected — panel ready");

  // Diagnostic: confirm the controller namespaces are reachable through
  // unsafeWindow. If any of these are missing on first load we want to know.
  const probe = {
    "unsafeWindow.classes": typeof pageWindow.classes,
    "unsafeWindow.com": typeof pageWindow.com,
    "BuildingBtnModernController": typeof pageWindow.classes?.ui?.btn?.BuildingBtnModernController,
    "BuildingStackableBtnController":
      typeof pageWindow.com?.nuclearunicorn?.game?.ui?.BuildingStackableBtnController,
    "TechButtonController": typeof pageWindow.com?.nuclearunicorn?.game?.ui?.TechButtonController,
    "GatherCatnipButtonController":
      typeof pageWindow.classes?.game?.ui?.GatherCatnipButtonController,
  };
  console.log("[autoplayer] controller probe:", probe);

  renderPanel("(idle)", "click [start] to begin");

  // Quick visibility into what the random policy *would* do right now,
  // even before pressing start.
  try {
    const s = extract(pageWindow.gamePage);
    const actions = enumerateFeasibleActions(s);
    console.log(`[autoplayer] ${actions.length} feasible actions in current state`);
  } catch (e) {
    console.warn("[autoplayer] initial extract failed:", e);
  }

  // Auto-resume if user previously had it running.
  try {
    if (localStorage.getItem(STORAGE_KEY) === "1") {
      console.log("[autoplayer] auto-resuming (was running before reload)");
      start();
    }
  } catch {
    // ignore
  }
};

waitForGame();

// Expose handles for the dev console — handy if you want to start/stop or
// inspect stats without touching the panel.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pageWindow as any).autoplayer = {
  start,
  stop,
  stats,
  assign, // window.autoplayer.assign("woodcutter", 3)
  assignAll: assignAllUI,
  state: () => safeExtract(),
  actions: () => {
    const s = safeExtract();
    return s ? enumerateFeasibleActions(s) : [];
  },
};
