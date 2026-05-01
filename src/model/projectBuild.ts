/**
 * Pure simulator for `build` actions — projects what state would look like
 * if we successfully constructed building `b`. Used by the strategic
 * planner to score candidate builds against their effect on the
 * goal-completion TTA.
 *
 * Does NOT touch gamePage. Does NOT advance time. Models only the immediate
 * effect of the action:
 *   1. Subtract the cost from `physical.resources` (with crafted-cost
 *      decomposition: spend stockpile first, then synthesize remainder
 *      from raw via the craft recipe).
 *   2. Increment `physical.buildings[b]`.
 *   3. Apply storage-cap delta from STORAGE_CAP_DELTAS.
 *   4. Apply flow delta via applyActionToFlow.
 *
 * Out of scope (Phase 9 limit; Phase 10/11 may extend):
 *   - Unlock cascades (workshop-built ⇒ crafts unlock; observatory ⇒
 *     starchart cap; etc.). Reflexes resolve these within 1-3 ticks
 *     after the build applies in the live game.
 *   - Stage upgrades (warehouse → spaceport, library → dataCenter, etc.).
 *   - Build-space / build-chronoforge / build-voidspace / build-ziggurat /
 *     space-launch / pact — same shape but per-class cost/effect tables.
 */
import type { Action, State } from "@/model";
import { applyActionToFlow } from "@/model/flow";
import type { BuildingName, ResourceName } from "@/model/catalogs";
import { BUILDING_META, CRAFT_META, CRAFT_NAMES } from "@/model/catalogs";
import { STORAGE_CAP_DELTAS } from "@/model/storageCapDeltas";

const CRAFT_NAME_SET: ReadonlySet<string> = new Set(CRAFT_NAMES);

/**
 * Resources whose names appear in CRAFT_NAMES but which are also natively
 * raw-produced (woodcutter job, reactor + thoriumReactors). For these, the
 * cost-projection should NOT recurse into the recipe — leave the deficit on
 * raw stockpile and let rawResourceTTA price it from the woodcutter / reactor
 * flow. Otherwise we'd incorrectly bill catnip for wood deficits or uranium
 * for thorium deficits even when the engine won't actually trigger that
 * conversion.
 */
const RAW_PRODUCED_OVERLAP: ReadonlySet<string> = new Set(["wood", "thorium"]);

/**
 * Decompose a cost item into raw-resource subtractions, consuming stockpile
 * first. Mutates `resources` in place.
 *
 * For crafted goods we don't currently have enough of: decompose the recipe
 * recursively. This mirrors what costTTA does — the projection should
 * subtract the same raw resources whose flow costTTA prices.
 */
function spend(
  resources: Record<string, number>,
  name: string,
  amount: number,
  visited: ReadonlySet<string> = new Set(),
): void {
  if (amount <= 0) return;
  const have = resources[name] ?? 0;
  const used = Math.min(have, amount);
  resources[name] = have - used;
  const remaining = amount - used;
  if (remaining <= 0) return;
  if (!CRAFT_NAME_SET.has(name) || RAW_PRODUCED_OVERLAP.has(name)) {
    // Raw resource (or raw-overlap craft like wood/thorium) — go negative.
    // Negative stockpiles are read by rawResourceTTA as "need (need - have)
    // more from flow," correctly.
    resources[name] = (resources[name] ?? 0) - remaining;
    return;
  }
  if (visited.has(name)) return; // cycle paranoia
  const meta = CRAFT_META[name as keyof typeof CRAFT_META];
  if (!meta || !meta.basePrices) {
    resources[name] = (resources[name] ?? 0) - remaining;
    return;
  }
  const next = new Set(visited);
  next.add(name);
  for (const input of meta.basePrices) {
    spend(resources, input.name, remaining * input.val, next);
  }
}

/**
 * Project the state forward as if `a` had been applied. Pure; does not
 * mutate the input. Returns the input unchanged for actions outside the
 * Phase-9 scope.
 */
export function projectBuild(s: State, a: Action): State {
  if (a.kind !== "build") return s;
  const b = a.building as BuildingName;
  const meta = BUILDING_META[b];
  if (!meta) return s;

  const next: State = {
    ...s,
    physical: {
      ...s.physical,
      resources: { ...s.physical.resources },
      resourceCaps: { ...s.physical.resourceCaps },
      buildings: { ...s.physical.buildings },
    },
    info: {
      ...s.info,
      flow: {
        perTick: { ...s.info.flow.perTick },
        production: { ...s.info.flow.production },
        consumption: { ...s.info.flow.consumption },
        catnipSeasonalFactor: s.info.flow.catnipSeasonalFactor,
        energyNet: s.info.flow.energyNet,
        catnipPerFarmer: s.info.flow.catnipPerFarmer,
      },
    },
  };

  // 1. Subtract cost. priceRatio kicks in based on current count.
  const count = next.physical.buildings[b] ?? 0;
  const ratio = Math.pow(meta.priceRatio, count);
  const resources = next.physical.resources as Record<string, number>;
  for (const cost of meta.basePrices) {
    spend(resources, cost.name, cost.val * ratio);
  }

  // 2. Increment count.
  next.physical.buildings[b] = count + 1;

  // 3. Storage cap deltas.
  const capDelta = STORAGE_CAP_DELTAS[b];
  if (capDelta) {
    const caps = next.physical.resourceCaps as Record<string, number>;
    for (const r of Object.keys(capDelta) as ResourceName[]) {
      const d = capDelta[r] ?? 0;
      const current = caps[r];
      if (Number.isFinite(current)) caps[r] = (current ?? 0) + d;
      // If cap was already Infinity, leave it.
    }
  }

  // 4. Flow delta via existing flow machinery.
  return applyActionToFlow(next, a);
}
