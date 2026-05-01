import type { Reflex } from "@/policy/types";
import { feasible } from "@/model";
import { RELIGION_UPGRADE_NAMES } from "@/model/catalogs";

/**
 * Fire `religion-upgrade` for the first feasible (unlocked + affordable +
 * not yet purchased) religion upgrade. These are one-time and progressive;
 * the auto-praise reflex keeps the faith pool draining into apocrypha to
 * fund them.
 *
 * Karma-gated transcendence-tier entries are out of scope; feasibility
 * already vetoes them.
 */
export const autoReligionUpgradeReflex: Reflex = (s) => {
  for (const upgrade of RELIGION_UPGRADE_NAMES) {
    if (s.info.religionUpgrades[upgrade]) continue;
    const a = { kind: "religion-upgrade" as const, upgrade };
    if (feasible(s, a)) return a;
  }
  return null;
};
