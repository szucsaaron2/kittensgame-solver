/**
 * Layer 0 — NetFlowGuard.
 *
 * Filters out actions whose post-application projected flow would tip a
 * guarded resource below its margin. Uses pure flow.ts machinery; no
 * gamePage access.
 *
 * Margin schedule (Phase 2):
 *   catnip:  ≥ 0 at winter+cold worst case (seasonal projection).
 *   wood:    ≥ 0 + 0.1/tick buffer at current multipliers.
 *   minerals: same buffer as wood.
 *   iron, coal, gold, titanium, oil, uranium: ≥ 0 at current multipliers.
 *   energy: ≥ 0 post-build.
 *   soft resources (catpower, faith, culture, science, crafts): unguarded.
 */
import type { Action, ResourceName, State } from "@/model";
import {
  applyActionToFlow,
  netFlowAt,
  WORST_CATNIP_SEASON,
  WORST_CATNIP_WEATHER,
} from "@/model";

interface Margin {
  threshold: number;
  /** When true, project to winter+cold before comparing. */
  worstCaseSeason?: boolean;
}

const MARGINS: Partial<Record<ResourceName, Margin>> = {
  catnip: { threshold: 0, worstCaseSeason: true },
  wood: { threshold: 0.1 },
  minerals: { threshold: 0.1 },
  iron: { threshold: 0 },
  coal: { threshold: 0 },
  gold: { threshold: 0 },
  titanium: { threshold: 0 },
  oil: { threshold: 0 },
  uranium: { threshold: 0 },
};

export function guardActions(s: State, actions: Action[]): Action[] {
  return actions.filter((a) => isSafe(s, a));
}

export function isSafe(s: State, a: Action): boolean {
  if (a.kind === "wait") return true;
  const projected = applyActionToFlow(s, a);
  for (const r of Object.keys(MARGINS) as ResourceName[]) {
    const m = MARGINS[r];
    if (!m) continue;
    const current = currentFlowFor(s, r, m);
    // Only veto if the action is the cause: pre-action flow is fine but
    // post-action flow tips below margin. That keeps the guard from
    // blanket-rejecting every action while the run is already in deficit
    // due to a prior bad state — those situations need recovery actions
    // (refine, assign, build a producer), not a frozen action set.
    const projectedFlow = currentFlowFor(projected, r, m);
    if (projectedFlow < m.threshold && projectedFlow < current) {
      return false;
    }
  }
  // Energy is special: tracked outside the seasonal flow snapshot. The engine
  // exposes a live `energy` net in info.energy. For a build action that
  // changes energy, we apply the projected delta directly.
  if (!isEnergyPostBuildSafe(s, a)) return false;
  return true;
}

function currentFlowFor(s: State, r: ResourceName, m: Margin): number {
  if (m.worstCaseSeason) {
    return netFlowAt(s, WORST_CATNIP_SEASON, WORST_CATNIP_WEATHER)[r];
  }
  return s.info.flow.perTick[r];
}

function isEnergyPostBuildSafe(s: State, a: Action): boolean {
  const projected = applyActionToFlow(s, a);
  const projectedEnergy = projected.info.flow.energyNet;
  const currentEnergy = s.info.flow.energyNet;
  if (projectedEnergy < 0 && projectedEnergy < currentEnergy) return false;
  return true;
}
