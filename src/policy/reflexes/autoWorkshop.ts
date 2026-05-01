import type { Reflex } from "@/policy/types";
import { feasible } from "@/model";
import { WORKSHOP_NAMES } from "@/model/catalogs";

/**
 * Fire `workshop` for the first feasible (unlocked + affordable + not yet
 * researched) workshop upgrade. Upgrades are one-time, monotone, almost
 * always multiplier bonuses — buying ASAP compounds.
 */
export const autoWorkshopReflex: Reflex = (s) => {
  for (const upgrade of WORKSHOP_NAMES) {
    if (s.info.workshop[upgrade]) continue;
    const a = { kind: "workshop" as const, upgrade };
    if (feasible(s, a)) return a;
  }
  return null;
};
