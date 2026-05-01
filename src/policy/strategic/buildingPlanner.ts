/**
 * Layer 3 — strategic building planner.
 *
 * Single-step lookahead over feasible build actions, scored by reduction
 * in goal-completion TTA. Replaces the random Layer-3 fallback for build
 * decisions; non-build moves (gather-catnip, refine-tears, etc.) fall
 * through to the random policy.
 *
 * Algorithm (per the design discussion):
 *
 *   1. Enumerate feasible + guarded `build` candidates.
 *   2. Compute T_now = plannerScore(s).
 *   3. For each candidate a:
 *        cost  = costTTA(s, basePrices(a))
 *        s'    = projectBuild(s, a)
 *        T'    = plannerScore(s')
 *        save  = T_now - T' - cost
 *      Pick the best by ratio (save / cost), with a special-case for
 *      cost=0 actions (highest absolute savings wins immediately).
 *   4. If no candidate has positive savings, fall back to the unblock
 *      heuristic: the action that turns the most ∞-TTA goal-clauses into
 *      finite ones (storage caps, prereq cascades).
 *   5. If still nothing, return null and let the caller fall back to the
 *      random policy.
 *
 * Single-step lookahead is myopic about cascading multipliers (lumberMill →
 * smelter → factory chains). Phase 11 may add iterative-deepening 2-step
 * lookahead when 1-step deadlocks, but Phase 10 keeps it simple.
 */
import type { ActionBuild, State } from "@/model";
import {
  costTTA,
  enumerateFeasibleActions,
  infiniteTTAClauseCount,
  plannerScore,
  projectBuild,
} from "@/model";
import { isSafe } from "@/policy/guard";
import { buildActionCost } from "./actionCost";

export interface CandidateScore {
  action: ActionBuild;
  costSeconds: number;
  savingsSeconds: number;
  ratio: number;
}

export interface PlannerDebug {
  candidatesEvaluated: number;
  T_now: number;
  zeroCostBest: CandidateScore | null;
  positiveRatioBest: CandidateScore | null;
  unblockerBest: { action: ActionBuild; deltaInfinite: number } | null;
}

function buildCandidates(s: State): ActionBuild[] {
  const out: ActionBuild[] = [];
  for (const a of enumerateFeasibleActions(s)) {
    if (a.kind !== "build") continue;
    if (!isSafe(s, a)) continue;
    out.push(a);
  }
  return out;
}

/**
 * Score a candidate against the current state. Returns null when the
 * candidate is unaffordable (cost = ∞), otherwise a {cost, savings, ratio}.
 */
function score(s: State, a: ActionBuild, T_now: number): CandidateScore | null {
  const cost = costTTA(s, buildActionCost(s, a));
  if (!Number.isFinite(cost)) return null;
  const sNext = projectBuild(s, a);
  const T_after = plannerScore(sNext);
  const savings = T_now - T_after - cost;
  const ratio = cost > 0 ? savings / cost : savings > 0 ? Infinity : 0;
  return { action: a, costSeconds: cost, savingsSeconds: savings, ratio };
}

/**
 * Pick the best build action, or null if no candidate is worth taking.
 * Mirrors the algorithm above; populates `debug` for trace diagnostics.
 */
export function chooseBuildingAction(
  s: State,
  debug?: PlannerDebug,
): ActionBuild | null {
  const candidates = buildCandidates(s);
  if (debug) debug.candidatesEvaluated = candidates.length;
  if (candidates.length === 0) return null;

  const T_now = plannerScore(s);
  if (debug) debug.T_now = T_now;

  let bestZero: CandidateScore | null = null;
  let bestRatio: CandidateScore | null = null;

  for (const a of candidates) {
    const sc = score(s, a, T_now);
    if (sc == null) continue;
    if (sc.savingsSeconds <= 0) continue;
    if (sc.costSeconds === 0) {
      if (!bestZero || sc.savingsSeconds > bestZero.savingsSeconds) bestZero = sc;
    } else {
      if (!bestRatio || sc.ratio > bestRatio.ratio) bestRatio = sc;
    }
  }
  if (debug) {
    debug.zeroCostBest = bestZero;
    debug.positiveRatioBest = bestRatio;
  }

  // Zero-cost positive-savings actions strictly dominate — taking them
  // costs no time and reduces remaining work.
  if (bestZero) return bestZero.action;
  // Otherwise pick the most efficient (savings-per-second) candidate.
  if (bestRatio) return bestRatio.action;

  // Deadlock: no candidate has positive savings against the finite-TTA
  // sum. Try unblocking — the action that turns the most ∞-TTA clauses
  // into finite (storage gates, capacity walls, prereq cascades). This
  // happens early game when most goals are ∞ and direct savings are 0.
  const infiniteBefore = infiniteTTAClauseCount(s);
  let bestUnblock: { action: ActionBuild; deltaInfinite: number } | null = null;
  for (const a of candidates) {
    const cost = costTTA(s, buildActionCost(s, a));
    if (!Number.isFinite(cost)) continue;
    const sNext = projectBuild(s, a);
    const infiniteAfter = infiniteTTAClauseCount(sNext);
    const deltaInfinite = infiniteBefore - infiniteAfter;
    if (deltaInfinite > 0 && (!bestUnblock || deltaInfinite > bestUnblock.deltaInfinite)) {
      bestUnblock = { action: a, deltaInfinite };
    }
  }
  if (debug) {
    debug.unblockerBest = bestUnblock;
  }
  if (bestUnblock) return bestUnblock.action;

  return null;
}
