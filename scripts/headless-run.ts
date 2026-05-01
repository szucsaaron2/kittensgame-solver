/**
 * Headless autoplayer harness.
 *
 * Runs the full Layer-0/1/2/3 pipeline against a fresh game in Node. Used
 * to diagnose autoplayer behavior end-to-end without Tampermonkey: see
 * which reflexes fire, whether the planner makes sensible builds, where
 * the run gets stuck.
 *
 * Usage:
 *   pnpm headless --seed 1 --max-ticks 200000 --log-interval 5000 --out report.json
 *
 * Engine: 5 ticks/sec (game.js:1892). 1 day in calendar = ~5 ticks at
 * default speed. So 200k ticks ≈ 11 game-years.
 */
import { setupGame } from "@/testdriver/setupGame";
import { extract, apply, ApplyError } from "@/simulator";
import {
  runPipeline,
  recordTrace,
  recentTraces,
  makeStrategicPolicy,
  chooseBuildingAction,
  type PlannerDebug,
} from "@/policy";
import {
  goal,
  goalReport,
  plannerScore,
  unbuiltGoalTTAs,
  infiniteTTAClauseCount,
} from "@/model";
import type { State, Action } from "@/model";
import { writeFile } from "node:fs/promises";

interface CliArgs {
  seed: number;
  maxTicks: number;
  maxWallSeconds: number;
  tickStep: number;
  logInterval: number;
  out?: string;
  quiet: boolean;
  plannerDebug?: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    seed: 1,
    maxTicks: 200_000,
    maxWallSeconds: 600,
    tickStep: 5,
    logInterval: 5_000,
    quiet: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = argv[i + 1];
    switch (a) {
      case "--seed":
        args.seed = Number(next);
        i++;
        break;
      case "--max-ticks":
        args.maxTicks = Number(next);
        i++;
        break;
      case "--max-wall-seconds":
        args.maxWallSeconds = Number(next);
        i++;
        break;
      case "--tick-step":
        args.tickStep = Number(next);
        i++;
        break;
      case "--log-interval":
        args.logInterval = Number(next);
        i++;
        break;
      case "--out":
        args.out = next;
        i++;
        break;
      case "--quiet":
        args.quiet = true;
        break;
      case "--planner-debug":
        args.plannerDebug = true;
        break;
      default:
        // ignore unknown
        break;
    }
  }
  return args;
}

interface ActionLike {
  kind: string;
  building?: string;
  tech?: string;
  upgrade?: string;
  policy?: string;
  civ?: string;
  structure?: string;
  mission?: string;
  item?: string;
}

function fmtAction(a: Action): string {
  const al = a as unknown as ActionLike;
  const detail =
    al.building ??
    al.tech ??
    al.upgrade ??
    al.policy ??
    al.civ ??
    al.structure ??
    al.mission ??
    al.item ??
    "";
  return detail ? `${al.kind}:${detail}` : al.kind;
}

interface Snapshot {
  tick: number;
  year: number;
  kittens: number;
  catnip: number;
  wood: number;
  minerals: number;
  iron: number;
  science: number;
  energy: number;
  techs: number;
  buildings: number;
  workshop: number;
  religion: number;
  policies: number;
  unbuiltGoalClauses: number;
  plannerScore: number;
  happiness: number;
  unlockedJobs: string[];
  assignments: Record<string, number>;
  buildingsByName: Record<string, number>;
  flowSciencePerTick: number;
  flowCatnipPerTick: number;
  flowWoodPerTick: number;
  unlockedCrafts: string[];
  crafted: { furs: number; parchment: number; manuscript: number; compedium: number; blueprint: number };
  techsResearched: string[];
  techsUnlockedNotResearched: string[];
  scienceCap: number;
  cultureCap: number;
  faithCap: number;
}

function snapshot(s: State, tick: number): Snapshot {
  const r = goalReport(s);
  const unbuilt =
    r.unsatisfiedBuildings.length +
    r.unsatisfiedTechs.length +
    r.unsatisfiedWorkshop.length +
    r.unsatisfiedReligion.length +
    r.unsatisfiedZiggurats.length +
    r.unsatisfiedSpaceBuildings.length +
    r.unsatisfiedSpacePrograms.length +
    r.unsatisfiedChronoforge.length +
    r.unsatisfiedVoidspace.length +
    r.unsatisfiedPolicies.length +
    r.unsatisfiedPacts.length;
  return {
    tick,
    year: s.info.calendar.year,
    kittens: s.physical.kittens.total,
    catnip: Math.round(s.physical.resources.catnip),
    wood: Math.round(s.physical.resources.wood),
    minerals: Math.round(s.physical.resources.minerals),
    iron: Math.round(s.physical.resources.iron),
    science: Math.round(s.physical.resources.science),
    energy: s.info.energy,
    techs: Object.values(s.info.techs).filter(Boolean).length,
    buildings: Object.values(s.physical.buildings).filter((v) => v > 0).length,
    workshop: Object.values(s.info.workshop).filter(Boolean).length,
    religion: Object.values(s.info.religionUpgrades).filter(Boolean).length,
    policies: Object.values(s.info.policies).filter(Boolean).length,
    unbuiltGoalClauses: unbuilt,
    plannerScore: Math.round(plannerScore(s)),
    happiness: Number(s.info.happiness.toFixed(3)),
    unlockedJobs: Object.entries(s.info.unlocked.jobs)
      .filter(([, v]) => v)
      .map(([k]) => k),
    assignments: Object.fromEntries(
      Object.entries(s.physical.kittens.jobs).filter(([, v]) => v > 0),
    ),
    buildingsByName: Object.fromEntries(
      Object.entries(s.physical.buildings).filter(([, v]) => v > 0),
    ),
    flowSciencePerTick: Number((s.info.flow.perTick.science ?? 0).toFixed(4)),
    flowCatnipPerTick: Number((s.info.flow.perTick.catnip ?? 0).toFixed(4)),
    flowWoodPerTick: Number((s.info.flow.perTick.wood ?? 0).toFixed(4)),
    unlockedCrafts: Object.entries(s.info.unlocked.crafts)
      .filter(([, v]) => v)
      .map(([k]) => k),
    techsResearched: Object.entries(s.info.techs)
      .filter(([, v]) => v)
      .map(([k]) => k),
    techsUnlockedNotResearched: Object.entries(s.info.unlocked.techs)
      .filter(([k, v]) => v && !s.info.techs[k as keyof typeof s.info.techs])
      .map(([k]) => k),
    scienceCap: s.physical.resourceCaps.science,
    cultureCap: s.physical.resourceCaps.culture,
    faithCap: s.physical.resourceCaps.faith,
    crafted: {
      furs: Math.round(s.physical.resources.furs),
      parchment: Math.round(s.physical.resources.parchment),
      manuscript: Math.round(s.physical.resources.manuscript),
      compedium: Math.round(s.physical.resources.compedium),
      blueprint: Math.round(s.physical.resources.blueprint),
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const handle = setupGame({ seed: args.seed });
  const fallback = makeStrategicPolicy();

  let prevState: State | null = null;
  let ticks = 0;
  let actions = 0;
  let errors = 0;
  const bySource = new Map<string, number>();
  const byActionDetail = new Map<string, number>();
  const errorsByKind = new Map<string, number>();
  const errorMessages: Array<{ tick: number; kind: string; message: string }> = [];
  const snapshots: Snapshot[] = [];

  const startWall = Date.now();
  console.log(
    `[headless] seed=${args.seed} maxTicks=${args.maxTicks} step=${args.tickStep} ` +
      `wallCap=${args.maxWallSeconds}s`,
  );

  let goalReached = false;
  let stallStreak = 0;
  let lastUnbuilt = -1;

  while (ticks < args.maxTicks) {
    const wallSec = (Date.now() - startWall) / 1000;
    if (wallSec > args.maxWallSeconds) {
      console.log(`[headless] wall-clock cap reached at ${wallSec.toFixed(1)}s`);
      break;
    }

    const s = extract(handle.gamePage);
    if (goal(s)) {
      goalReached = true;
      console.log(`[headless] GOAL REACHED at tick ${ticks} year ${s.info.calendar.year}`);
      break;
    }

    const r = runPipeline(s, { prev: prevState, fallback });
    recordTrace(r.trace);
    prevState = s;

    actions++;
    bySource.set(r.trace.source, (bySource.get(r.trace.source) ?? 0) + 1);
    const detailKey = fmtAction(r.trace.action);
    byActionDetail.set(detailKey, (byActionDetail.get(detailKey) ?? 0) + 1);

    try {
      if (r.trace.action.kind !== "wait") {
        apply(handle.gamePage, r.trace.action);
      }
    } catch (e) {
      errors++;
      const kind = r.trace.action.kind;
      errorsByKind.set(kind, (errorsByKind.get(kind) ?? 0) + 1);
      const message =
        e instanceof ApplyError ? e.message : e instanceof Error ? e.message : String(e);
      if (errorMessages.length < 100) {
        errorMessages.push({ tick: ticks, kind, message: message.slice(0, 200) });
      }
    }

    handle.tick(args.tickStep);
    ticks += args.tickStep;

    if (
      ticks % args.logInterval === 0 ||
      (ticks <= 1000 && ticks % 100 === 0)
    ) {
      const snapState = extract(handle.gamePage);
      const snap = snapshot(snapState, ticks);
      snapshots.push(snap);
      if (args.plannerDebug) {
        const debug: PlannerDebug = {
          candidatesEvaluated: 0,
          T_now: 0,
          zeroCostBest: null,
          positiveRatioBest: null,
          unblockerBest: null,
        };
        const choice = chooseBuildingAction(snapState, debug);
        const finiteGoals = unbuiltGoalTTAs(snapState).filter((g) => Number.isFinite(g.tta));
        finiteGoals.sort((a, b) => a.tta - b.tta);
        const cheapest = finiteGoals.slice(0, 5).map((g) => `${g.kind}:${g.name}=${Math.round(g.tta)}s`);
        console.log(
          `  [planner] cands=${debug.candidatesEvaluated} ` +
            `chose=${choice ? fmtAction(choice) : "null"} ` +
            `Tnow=${Math.round(debug.T_now)} ` +
            `inf=${infiniteTTAClauseCount(snapState)} ` +
            `zero=${debug.zeroCostBest ? fmtAction(debug.zeroCostBest.action) + "/" + Math.round(debug.zeroCostBest.savingsSeconds) + "s" : "-"} ` +
            `ratio=${debug.positiveRatioBest ? fmtAction(debug.positiveRatioBest.action) + "/" + debug.positiveRatioBest.ratio.toFixed(2) : "-"} ` +
            `unblock=${debug.unblockerBest ? fmtAction(debug.unblockerBest.action) + "(+" + debug.unblockerBest.deltaInfinite + ")" : "-"}`,
        );
        console.log(`  [planner] cheapest finite goals: ${cheapest.join(", ")}`);
      }
      // Stall detection: same unbuiltGoalClauses for many intervals.
      if (snap.unbuiltGoalClauses === lastUnbuilt) stallStreak++;
      else {
        stallStreak = 0;
        lastUnbuilt = snap.unbuiltGoalClauses;
      }
      if (!args.quiet) {
        console.log(
          `[t=${String(ticks).padStart(7)} y=${String(snap.year).padStart(3)}] ` +
            `K=${String(snap.kittens).padStart(3)} ` +
            `bld=${String(snap.buildings).padStart(2)} tech=${String(snap.techs).padStart(2)} ` +
            `ws=${String(snap.workshop).padStart(2)} rel=${String(snap.religion).padStart(2)} ` +
            `unbuilt=${String(snap.unbuiltGoalClauses).padStart(3)} ` +
            `score=${String(snap.plannerScore).padStart(8)} ` +
            `act=${actions} err=${errors}`,
        );
      }
      if (stallStreak >= 10 && !args.quiet) {
        console.log(`  ⚠ stalled: same unbuilt count ${stallStreak} intervals in a row`);
      }
    }
  }

  const wall = (Date.now() - startWall) / 1000;
  const finalState = extract(handle.gamePage);
  const finalReport = goalReport(finalState);

  const traceTail = recentTraces()
    .slice(-30)
    .map((t) => ({
      layer: t.layer,
      source: t.source,
      action: fmtAction(t.action),
    }));

  const summary = {
    args,
    goalReached,
    wallSeconds: Number(wall.toFixed(2)),
    ticksElapsed: ticks,
    actions,
    errors,
    finalState: snapshot(finalState, ticks),
    bySource: Object.fromEntries(
      [...bySource.entries()].sort((a, b) => b[1] - a[1]),
    ),
    topActions: Object.fromEntries(
      [...byActionDetail.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
    ),
    errorsByKind: Object.fromEntries(
      [...errorsByKind.entries()].sort((a, b) => b[1] - a[1]),
    ),
    sampleErrors: errorMessages.slice(-20),
    snapshots,
    traceTail,
    finalUnsatisfied: {
      buildings: finalReport.unsatisfiedBuildings,
      techs: finalReport.unsatisfiedTechs,
      workshop: finalReport.unsatisfiedWorkshop.slice(0, 30),
      religion: finalReport.unsatisfiedReligion.slice(0, 30),
      policies: finalReport.unsatisfiedPolicies,
      pacts: finalReport.unsatisfiedPacts,
      ziggurats: finalReport.unsatisfiedZiggurats,
      chronoforge: finalReport.unsatisfiedChronoforge,
      voidspace: finalReport.unsatisfiedVoidspace,
      spacePrograms: finalReport.unsatisfiedSpacePrograms,
    },
  };

  if (args.out) {
    await writeFile(args.out, JSON.stringify(summary, null, 2));
    console.log(`[headless] wrote ${args.out}`);
  }

  console.log("=== final ===");
  console.log(`goal=${goalReached} wall=${wall.toFixed(1)}s ticks=${ticks}`);
  console.log(`actions=${actions} errors=${errors}`);
  console.log(`final:`, summary.finalState);
  console.log(`top sources:`, summary.bySource);
  console.log(
    `top actions:`,
    Object.fromEntries(Object.entries(summary.topActions).slice(0, 10)),
  );
  if (Object.keys(summary.errorsByKind).length > 0) {
    console.log(`errors by kind:`, summary.errorsByKind);
    console.log(`sample errors:`, errorMessages.slice(-5));
  }

  await handle.teardown();
}

await main();
