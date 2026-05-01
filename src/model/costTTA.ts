/**
 * Time-to-afford computations.
 *
 * `costTTA(s, costs)` returns the wall-clock seconds (in tick-units) until
 * the cost vector is payable from the current state. Recurses through the
 * craft DAG so a building costing "concrete" decomposes into its raw inputs
 * (slab + steel → minerals + coal + iron). The recursion bottoms out at
 * raw resources, where TTA = max(0, (need − have) / max(0, netFlow)).
 *
 * Crafted intermediates with stockpile are subtracted before falling back
 * to recursive raw cost — i.e., if we already have 25 beams and need 50,
 * only 25 more beams' worth of wood needs to be projected.
 *
 * Pure. Used by:
 *   - the strategic planner's per-action `tta(s, a)`
 *   - aggregate goal-completion projections via goalCompletion.ts
 *   - the JobAssignment subsystem for "can we afford the next housing tier"
 */
import type { State } from "@/model";
import { CRAFT_NAMES, CRAFT_META } from "@/model/catalogs";
import type { CraftName, ResourceName } from "@/model/catalogs";

export interface CostItem {
  name: string;
  val: number;
}

const CRAFT_NAME_SET: ReadonlySet<string> = new Set(CRAFT_NAMES);

function isCraft(name: string): name is CraftName {
  return CRAFT_NAME_SET.has(name);
}

/**
 * TTA in seconds (positive = wait that many seconds; 0 = afford now;
 * Infinity = unaffordable from steady-state production).
 */
export function rawResourceTTA(s: State, name: string, need: number): number {
  if (need <= 0) return 0;
  const have = (s.physical.resources as Record<string, number>)[name] ?? 0;
  if (have >= need) return 0;
  const cap = (s.physical.resourceCaps as Record<string, number>)[name];
  const flow = s.info.flow.perTick[name as ResourceName] ?? 0;
  // 5 ticks/sec — convert per-tick flow to per-second.
  const flowPerSec = flow * 5;
  // Storage cap check: if cost exceeds cap, the resource can never be
  // accumulated past the cap from flow alone — a cap-raising build is
  // required first. Return a finite deficit-proportional TTA (rather
  // than Infinity) so the planner gives partial credit to cap-raising
  // actions even when one build doesn't fully unblock the goal. Without
  // this, a 20000-cost tech vs an 8750 cap leaves the goal at ∞ forever
  // and the single-step planner picks no cap-raise (savings stays at 0
  // because one academy doesn't cross the threshold).
  if (cap !== undefined && Number.isFinite(cap) && cap < need) {
    const deficit = need - cap;
    // Add the flow-time component so a partly-cap-bound goal that's also
    // flow-bound still has flow-bound contribution.
    const flowComponent = flowPerSec > 0 ? cap / flowPerSec : 0;
    return CAP_DEFICIT_WEIGHT * deficit + flowComponent;
  }
  if (flow <= 0) return Infinity;
  return (need - have) / flowPerSec;
}

/**
 * Seconds-per-unit-of-cap-deficit. Tunes how aggressively the planner
 * pursues cap-raising vs flow-multipliers. Setting this to 1 makes a
 * 10000-resource cap deficit worth ~10000 seconds of TTA, comparable to
 * a multi-game-day tech research wait. Empirically chosen so the
 * planner picks academy / observatory builds that progressively raise
 * science cap without overshooting (over-investing in cap to the
 * detriment of production).
 */
const CAP_DEFICIT_WEIGHT = 1;

/**
 * TTA for a single resource need, preferring the raw-production path when
 * it's available and only recursing into craft recipes when raw fails.
 *
 * This handles the (wood, thorium, ...) overlap cases — resources that
 * appear in both RESOURCE_NAMES (raw production path) and CRAFT_NAMES
 * (auxiliary conversion path). When woodcutters are producing wood, the
 * raw flow is fast; we should not recurse to "175 catnip per wood." Only
 * if raw production is genuinely unavailable does the conversion path
 * become relevant.
 */
function inputTTA(
  s: State,
  name: string,
  need: number,
  visited: ReadonlySet<string>,
): number {
  const direct = rawResourceTTA(s, name, need);
  if (Number.isFinite(direct)) return direct;
  if (isCraft(name) && !visited.has(name)) {
    return craftDagTTA(s, name, need, visited);
  }
  return Infinity;
}

/**
 * Recursive TTA for a crafted good. Compute "additional units to produce"
 * = max(0, need - stockpile), then for each input in the recipe recurse
 * via inputTTA (which prefers raw when raw is finite). Take the max
 * across inputs (parallel pipeline — slowest input gates the produced rate).
 *
 * Cycle protection via a visited set; the Kittens Game craft DAG is
 * acyclic so this is paranoia.
 */
export function craftDagTTA(
  s: State,
  item: CraftName,
  need: number,
  visited: ReadonlySet<string> = new Set(),
): number {
  if (need <= 0) return 0;
  const have = (s.physical.resources as Record<string, number>)[item] ?? 0;
  const remaining = need - have;
  if (remaining <= 0) return 0;
  if (visited.has(item)) return Infinity;
  const meta = CRAFT_META[item];
  if (!meta || !meta.basePrices || meta.basePrices.length === 0) return Infinity;
  const next = new Set(visited);
  next.add(item);
  let worst = 0;
  for (const input of meta.basePrices) {
    const inputNeed = remaining * input.val;
    const tta = inputTTA(s, input.name, inputNeed, next);
    if (tta > worst) worst = tta;
    if (worst === Infinity) return Infinity;
  }
  return worst;
}

/**
 * TTA for a cost vector — max over resources, preferring raw paths.
 */
export function costTTA(s: State, costs: ReadonlyArray<CostItem>): number {
  let worst = 0;
  const empty: ReadonlySet<string> = new Set();
  for (const cost of costs) {
    const tta = inputTTA(s, cost.name, cost.val, empty);
    if (tta > worst) worst = tta;
    if (worst === Infinity) return Infinity;
  }
  return worst;
}
