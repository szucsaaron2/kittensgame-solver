/**
 * AutoHL runner. Drop-in variant of `headless-run.ts` that loads an
 * external policy module (--policy <abs-path>) and slots its
 * `chooseBuildingAction(state, helpers)` into Layer 3.
 *
 * The agent's policy.ts file may be anywhere on disk (typically inside an
 * AutoHL HSRepo run dir). It only needs to default-export, or named-export,
 * a `chooseBuildingAction(state: State, helpers: PolicyHelpers): ActionBuild | null`
 * function. Type-only imports are stripped at runtime, so the file does not
 * need module-resolution to succeed for `@/...` paths — runtime helpers
 * are injected via the `helpers` argument.
 *
 * Output: writes a JSON report identical in shape to headless-run's, with
 * an additional `score` field (higher = better; AutoHL gate uses this).
 */
import { setupGame } from "@/testdriver/setupGame";
import { extract, apply, ApplyError } from "@/simulator";
import {
  runPipeline,
  recordTrace,
  recentTraces,
  chooseBuildingAction as bundledChooseBuildingAction,
  buildActionCost,
} from "@/policy";
import { isSafe, guardActions } from "@/policy/guard";
import { makeRandomPolicy } from "@/policy/random";
import {
  goal,
  goalReport,
  plannerScore,
  unbuiltGoalTTAs,
  infiniteTTAClauseCount,
  cheapestUnbuiltGoalTTA,
  costTTA,
  enumerateFeasibleActions,
  projectBuild,
  netFlow,
  netFlowAt,
  applyActionToFlow,
} from "@/model";
import type { State, Action, ActionBuild } from "@/model";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

interface CliArgs {
  seed: number;
  maxTicks: number;
  maxWallSeconds: number;
  tickStep: number;
  logInterval: number;
  out?: string;
  quiet: boolean;
  policy?: string;
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
      case "--seed": args.seed = Number(next); i++; break;
      case "--max-ticks": args.maxTicks = Number(next); i++; break;
      case "--max-wall-seconds": args.maxWallSeconds = Number(next); i++; break;
      case "--tick-step": args.tickStep = Number(next); i++; break;
      case "--log-interval": args.logInterval = Number(next); i++; break;
      case "--out": args.out = next; i++; break;
      case "--policy": args.policy = next; i++; break;
      case "--quiet": args.quiet = true; break;
      default: break;
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
    al.building ?? al.tech ?? al.upgrade ?? al.policy ?? al.civ ??
    al.structure ?? al.mission ?? al.item ?? "";
  return detail ? `${al.kind}:${detail}` : al.kind;
}

/** Helpers passed to the agent's policy. Pure functions; no engine access. */
export interface PolicyHelpers {
  goal: typeof goal;
  goalReport: typeof goalReport;
  plannerScore: typeof plannerScore;
  unbuiltGoalTTAs: typeof unbuiltGoalTTAs;
  cheapestUnbuiltGoalTTA: typeof cheapestUnbuiltGoalTTA;
  infiniteTTAClauseCount: typeof infiniteTTAClauseCount;
  costTTA: typeof costTTA;
  enumerateFeasibleActions: typeof enumerateFeasibleActions;
  projectBuild: typeof projectBuild;
  buildActionCost: typeof buildActionCost;
  netFlow: typeof netFlow;
  netFlowAt: typeof netFlowAt;
  applyActionToFlow: typeof applyActionToFlow;
  isSafe: typeof isSafe;
  guardActions: typeof guardActions;
  bundledChooseBuildingAction: typeof bundledChooseBuildingAction;
}

function makeHelpers(): PolicyHelpers {
  return {
    goal, goalReport, plannerScore, unbuiltGoalTTAs, cheapestUnbuiltGoalTTA,
    infiniteTTAClauseCount, costTTA, enumerateFeasibleActions, projectBuild,
    buildActionCost, netFlow, netFlowAt, applyActionToFlow, isSafe, guardActions,
    bundledChooseBuildingAction,
  };
}

type AgentChoose = (s: State, helpers: PolicyHelpers) => ActionBuild | null;

async function loadAgentPolicy(absPath: string): Promise<AgentChoose> {
  const url = pathToFileURL(absPath).href;
  const mod: Record<string, unknown> = await import(url);
  const fn = (mod.chooseBuildingAction ?? mod.default) as AgentChoose | undefined;
  if (typeof fn !== "function") {
    throw new Error(
      `policy at ${absPath} must export 'chooseBuildingAction(state, helpers)' (named or default). got keys: ${Object.keys(mod).join(",")}`,
    );
  }
  return fn;
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
    scienceCap: s.physical.resourceCaps.science,
    cultureCap: s.physical.resourceCaps.culture,
    faithCap: s.physical.resourceCaps.faith,
  };
}

const TOTAL_GOAL_CLAUSES = 373;

function computeScore(finalSnap: Snapshot, goalReached: boolean): number {
  const clausesSolved = TOTAL_GOAL_CLAUSES - finalSnap.unbuiltGoalClauses;
  const tieBreak = Math.max(0, 1 - finalSnap.plannerScore / 1e9);
  const goalBonus = goalReached ? 1_000 : 0;
  return clausesSolved + goalBonus + tieBreak;
}

interface RunState { agentError: string | null }

async function main(): Promise<void> {
  const args = parseArgs();
  const runState: RunState = { agentError: null };

  const agentChoose: AgentChoose = args.policy
    ? await loadAgentPolicy(args.policy)
    : (s) => bundledChooseBuildingAction(s);
  const helpers = makeHelpers();

  const handle = setupGame({ seed: args.seed });
  const randomFallback = makeRandomPolicy();

  const fallback = (s: State): Action => {
    try {
      const a = agentChoose(s, helpers);
      if (a) return a;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!runState.agentError) runState.agentError = msg.slice(0, 400);
    }
    return randomFallback(s);
  };

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
  if (!args.quiet) {
    console.log(
      `[autohl-runner] seed=${args.seed} maxTicks=${args.maxTicks} step=${args.tickStep} ` +
        `wallCap=${args.maxWallSeconds}s policy=${args.policy ?? "(bundled)"}`,
    );
  }

  let goalReached = false;

  while (ticks < args.maxTicks) {
    const wallSec = (Date.now() - startWall) / 1000;
    if (wallSec > args.maxWallSeconds) {
      if (!args.quiet) console.log(`[autohl-runner] wall-clock cap reached at ${wallSec.toFixed(1)}s`);
      break;
    }

    const s = extract(handle.gamePage);
    if (goal(s)) {
      goalReached = true;
      if (!args.quiet) console.log(`[autohl-runner] GOAL REACHED at tick ${ticks} year ${s.info.calendar.year}`);
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

    if (ticks % args.logInterval === 0 || (ticks <= 1000 && ticks % 100 === 0)) {
      const snapState = extract(handle.gamePage);
      const snap = snapshot(snapState, ticks);
      snapshots.push(snap);
      if (!args.quiet) {
        console.log(
          `[t=${String(ticks).padStart(7)} y=${String(snap.year).padStart(3)}] ` +
            `K=${String(snap.kittens).padStart(3)} ` +
            `bld=${String(snap.buildings).padStart(2)} tech=${String(snap.techs).padStart(2)} ` +
            `unbuilt=${String(snap.unbuiltGoalClauses).padStart(3)} ` +
            `score=${String(snap.plannerScore).padStart(8)} ` +
            `act=${actions} err=${errors}`,
        );
      }
    }
  }

  const wall = (Date.now() - startWall) / 1000;
  const finalState = extract(handle.gamePage);
  const finalSnap = snapshot(finalState, ticks);
  const finalReport = goalReport(finalState);
  const score = computeScore(finalSnap, goalReached);

  const traceTail = recentTraces()
    .slice(-30)
    .map((t) => ({ layer: t.layer, source: t.source, action: fmtAction(t.action) }));

  const summary = {
    args,
    goalReached,
    score,
    wallSeconds: Number(wall.toFixed(2)),
    ticksElapsed: ticks,
    actions,
    errors,
    agentError: runState.agentError,
    finalState: finalSnap,
    bySource: Object.fromEntries([...bySource.entries()].sort((a, b) => b[1] - a[1])),
    topActions: Object.fromEntries(
      [...byActionDetail.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
    ),
    errorsByKind: Object.fromEntries([...errorsByKind.entries()].sort((a, b) => b[1] - a[1])),
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
    if (!args.quiet) console.log(`[autohl-runner] wrote ${args.out}`);
  }

  if (!args.quiet) {
    console.log("=== final ===");
    console.log(`goal=${goalReached} score=${score.toFixed(2)} wall=${wall.toFixed(1)}s ticks=${ticks}`);
    console.log(`final:`, summary.finalState);
    if (runState.agentError) console.log(`agentError: ${runState.agentError}`);
  }

  // Forward summary on stdout's last line for parsers that don't read --out
  console.log(`AUTOHL_RESULT ${JSON.stringify({ score, goalReached, ticksElapsed: ticks, unbuiltGoalClauses: finalSnap.unbuiltGoalClauses, agentError: runState.agentError })}`);

  await handle.teardown();
}

await main();
