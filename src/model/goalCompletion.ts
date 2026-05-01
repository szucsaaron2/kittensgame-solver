/**
 * Aggregate goal-completion TTA.
 *
 * `goalCompletionTTA(s)` = sum of TTAs across every unbought goal-clause:
 *   - in-scope buildings whose count is 0
 *   - in-scope techs not yet researched
 *   - in-scope workshop upgrades not yet purchased
 *   - in-scope religion upgrades not yet purchased
 *   - in-scope ziggurat structures whose count is 0
 *   - in-scope chronoforge buildings whose count is 0
 *   - in-scope voidspace buildings whose count is 0
 *   - in-scope space programs not yet completed
 *
 * The strategic planner uses this to score candidate actions by ΔT —
 * the reduction in remaining work. Because tech / workshop / religion
 * upgrades are auto-bought by Layer-1 reflexes (not Layer-3 emit), but
 * they still consume shared resources (science / culture / faith / crafts),
 * including their TTAs ensures the planner sees the full resource
 * contention picture rather than over-budgeting against stockpile.
 *
 * Pure. Recurses through crafts via costTTA.
 */
import type { State } from "@/model";
import {
  BUILDING_META,
  BUILDING_NAMES,
  TECH_META,
  TECH_NAMES,
  WORKSHOP_META,
  WORKSHOP_NAMES,
  RELIGION_UPGRADE_META,
  RELIGION_UPGRADE_NAMES,
  ZIGGURAT_META,
  ZIGGURAT_NAMES,
  CHRONOFORGE_META,
  CHRONOFORGE_NAMES,
  VOIDSPACE_META,
  VOIDSPACE_NAMES,
  SPACE_PROGRAM_META,
  SPACE_PROGRAM_NAMES,
} from "@/model/catalogs";
import { costTTA } from "@/model/costTTA";

export interface ClauseTTA {
  /** Discriminator on the goal-clause kind, mostly for debugging traces. */
  kind:
    | "build"
    | "research"
    | "workshop"
    | "religion-upgrade"
    | "build-ziggurat"
    | "build-chronoforge"
    | "build-voidspace"
    | "space-launch";
  name: string;
  tta: number;
}

/**
 * One TTA entry per still-unsatisfied goal clause. Items not in scope or
 * already bought are excluded. Cost uses `basePrices` (i.e., projecting the
 * marginal next purchase, which is what we'd pay to flip the clause from
 * 0 to 1).
 */
export function unbuiltGoalTTAs(s: State): ClauseTTA[] {
  const out: ClauseTTA[] = [];

  for (const b of BUILDING_NAMES) {
    const meta = BUILDING_META[b];
    if (!meta?.inScope) continue;
    // Skip phantom entries with no cost vector (e.g., usedCryochambers in
    // voidspace: it's an engine-managed reset artifact, not a buildable item).
    if (!meta.basePrices || meta.basePrices.length === 0) continue;
    if ((s.physical.buildings[b] ?? 0) >= 1) continue;
    out.push({ kind: "build", name: b, tta: costTTA(s, meta.basePrices) });
  }

  for (const t of TECH_NAMES) {
    const meta = TECH_META[t];
    if (!meta?.inScope) continue;
    // Skip phantom entries with no cost vector (e.g., usedCryochambers in
    // voidspace: it's an engine-managed reset artifact, not a buildable item).
    if (!meta.basePrices || meta.basePrices.length === 0) continue;
    if (s.info.techs[t]) continue;
    out.push({ kind: "research", name: t, tta: costTTA(s, meta.basePrices) });
  }

  for (const w of WORKSHOP_NAMES) {
    const meta = WORKSHOP_META[w];
    if (!meta?.inScope) continue;
    // Skip phantom entries with no cost vector (e.g., usedCryochambers in
    // voidspace: it's an engine-managed reset artifact, not a buildable item).
    if (!meta.basePrices || meta.basePrices.length === 0) continue;
    if (s.info.workshop[w]) continue;
    out.push({ kind: "workshop", name: w, tta: costTTA(s, meta.basePrices) });
  }

  for (const u of RELIGION_UPGRADE_NAMES) {
    const meta = RELIGION_UPGRADE_META[u];
    if (!meta?.inScope) continue;
    // Skip phantom entries with no cost vector (e.g., usedCryochambers in
    // voidspace: it's an engine-managed reset artifact, not a buildable item).
    if (!meta.basePrices || meta.basePrices.length === 0) continue;
    if (s.info.religionUpgrades[u]) continue;
    out.push({ kind: "religion-upgrade", name: u, tta: costTTA(s, meta.basePrices) });
  }

  for (const z of ZIGGURAT_NAMES) {
    const meta = ZIGGURAT_META[z];
    if (!meta?.inScope) continue;
    // Skip phantom entries with no cost vector (e.g., usedCryochambers in
    // voidspace: it's an engine-managed reset artifact, not a buildable item).
    if (!meta.basePrices || meta.basePrices.length === 0) continue;
    if ((s.physical.zigguratStructures[z] ?? 0) >= 1) continue;
    out.push({ kind: "build-ziggurat", name: z, tta: costTTA(s, meta.basePrices) });
  }

  for (const c of CHRONOFORGE_NAMES) {
    const meta = CHRONOFORGE_META[c];
    if (!meta?.inScope) continue;
    // Skip phantom entries with no cost vector (e.g., usedCryochambers in
    // voidspace: it's an engine-managed reset artifact, not a buildable item).
    if (!meta.basePrices || meta.basePrices.length === 0) continue;
    if ((s.physical.chronoforge[c] ?? 0) >= 1) continue;
    out.push({ kind: "build-chronoforge", name: c, tta: costTTA(s, meta.basePrices) });
  }

  for (const v of VOIDSPACE_NAMES) {
    const meta = VOIDSPACE_META[v];
    if (!meta?.inScope) continue;
    // Skip phantom entries with no cost vector (e.g., usedCryochambers in
    // voidspace: it's an engine-managed reset artifact, not a buildable item).
    if (!meta.basePrices || meta.basePrices.length === 0) continue;
    if ((s.physical.voidspace[v] ?? 0) >= 1) continue;
    out.push({ kind: "build-voidspace", name: v, tta: costTTA(s, meta.basePrices) });
  }

  for (const m of SPACE_PROGRAM_NAMES) {
    const meta = SPACE_PROGRAM_META[m];
    if (!meta?.inScope) continue;
    // Skip phantom entries with no cost vector (e.g., usedCryochambers in
    // voidspace: it's an engine-managed reset artifact, not a buildable item).
    if (!meta.basePrices || meta.basePrices.length === 0) continue;
    if (s.physical.spaceProgramsCompleted[m]) continue;
    out.push({ kind: "space-launch", name: m, tta: costTTA(s, meta.basePrices) });
  }

  return out;
}

/**
 * Sum of TTAs across all finite-TTA unbought goal clauses. Infinite-TTA
 * clauses (storage-gated, locked tech/unbuildable, etc.) are EXCLUDED
 * from the sum. Useful for diagnostics; the planner uses `plannerScore`
 * which clamps ∞ to a finite proxy and adds a per-flip bonus.
 */
export function goalCompletionTTA(s: State): number {
  let sum = 0;
  for (const c of unbuiltGoalTTAs(s)) {
    if (Number.isFinite(c.tta)) sum += c.tta;
  }
  return sum;
}

export interface PlannerScoreOptions {
  /**
   * Bonus seconds added to every unbought goal-clause's contribution.
   * Ensures free flips (TTA = 0) score positive savings when removed
   * from the sum — otherwise the metric is indifferent between taking
   * a free flip and skipping it. Default 1 second.
   */
  perFlipBonus?: number;
  /**
   * Finite stand-in value for ∞-TTA clauses. Without this, multipliers
   * that turn ∞ goals into high-but-finite TTAs would *increase* the
   * sum (they bring previously-excluded goals back in) and look like
   * negative savings. With a clamp of, e.g., 86400 (one day), an
   * unblock action shows the actual finite-TTA difference as savings.
   * Default 86400.
   */
  infProxy?: number;
}

/**
 * The metric the strategic planner minimizes. Combines:
 *   - Finite TTAs of unbought goal-clauses (existing flow / cost picture).
 *   - A clamp value for ∞ goals so that finite-izing them shows as
 *     positive savings.
 *   - A per-flip bonus so that taking a free flip is preferred to
 *     leaving it on the table.
 */
export function plannerScore(s: State, options: PlannerScoreOptions = {}): number {
  const perFlipBonus = options.perFlipBonus ?? 1;
  const infProxy = options.infProxy ?? 86400;
  let sum = 0;
  for (const c of unbuiltGoalTTAs(s)) {
    sum += (Number.isFinite(c.tta) ? c.tta : infProxy) + perFlipBonus;
  }
  return sum;
}

/**
 * Number of unbought goal clauses currently at TTA = ∞. A "finite-izing"
 * action (one that turns a previously-∞ TTA into finite) is high-value
 * even when goalCompletionTTA wouldn't change much, because it unblocks
 * future progress.
 */
export function infiniteTTAClauseCount(s: State): number {
  let n = 0;
  for (const c of unbuiltGoalTTAs(s)) {
    if (!Number.isFinite(c.tta)) n++;
  }
  return n;
}

/**
 * Smallest TTA among all unbought goal clauses. Returns Infinity if none.
 * Useful for the planner's "any flip we can buy right now?" pre-pass.
 */
export function cheapestUnbuiltGoalTTA(s: State): number {
  let min = Infinity;
  for (const c of unbuiltGoalTTAs(s)) {
    if (c.tta < min) min = c.tta;
  }
  return min;
}
