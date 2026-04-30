import { run, type DriverIO } from "./loop";
import { extract, apply, ApplyError } from "@/simulator";
import { goal, goalReport, enumerateFeasibleActions } from "@/model";
import { makeRandomPolicy } from "@/policy";

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
  p.innerHTML = [
    `<b style="color:#7ec699">Kittens Autoplayer</b> &nbsp; ` +
      `<span id="ap-toggle" style="cursor:pointer;color:${running ? "#e58a8a" : "#7ec699"};">[${running ? "stop" : "start"}]</span>`,
    `running: ${running ? "yes" : "no"} &nbsp; t=${elapsed}s`,
    `steps: ${stats.steps} &nbsp; applied: ${stats.applied} &nbsp; failed: ${stats.failed}`,
    `last: <span style="color:#9ec0e0">${lastAction}</span>`,
    `result: <span style="color:#dcb47c">${lastResult}</span>`,
    `top kinds: ${topKinds || "—"}`,
    `errors: ${topErrors || "—"}`,
  ].join("<br>");
  const toggle = p.querySelector("#ap-toggle");
  if (toggle) {
    (toggle as HTMLElement).onclick = (): void => {
      if (running) stop();
      else start();
    };
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
  const policy = makeRandomPolicy();
  let lastAction = "(none yet)";
  let lastResult = "—";

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
(pageWindow as any).autoplayer = { start, stop, stats };
