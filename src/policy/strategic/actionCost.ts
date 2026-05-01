/**
 * Build-action cost vector at the current state's count + priceRatio.
 *
 * Phase 10 only covers `build` (terrestrial). Other build-style kinds
 * (build-space, build-chronoforge, build-voidspace, build-ziggurat,
 * space-launch, pact) get added in Phase 11 alongside their projectBuild
 * extensions.
 *
 * Uses BUILDING_META.basePrices (the static catalog) — workshop upgrade
 * discounts in the live engine make the actual cost slightly lower, which
 * means our scoring is mildly conservative on cost. Acceptable bias; could
 * be tightened later by snapshotting discounted prices in extract.
 */
import type { State } from "@/model";
import type { ActionBuild } from "@/model";
import { BUILDING_META } from "@/model/catalogs";
import type { CostItem } from "@/model";

export function buildActionCost(s: State, a: ActionBuild): CostItem[] {
  const meta = BUILDING_META[a.building];
  if (!meta) return [];
  const count = s.physical.buildings[a.building] ?? 0;
  const ratio = Math.pow(meta.priceRatio, count);
  return meta.basePrices.map((p) => ({ name: p.name, val: p.val * ratio }));
}
