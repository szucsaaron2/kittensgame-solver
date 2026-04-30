import type { Reflex } from "@/policy/types";
import { feasible } from "@/model";
import { CIV_NAMES } from "@/model/catalogs";

/**
 * When catpower is at cap, fire a single-caravan trade with any discovered
 * civ we can afford. Strictly a leak-stopper — civ choice is intentionally
 * dumb (first feasible match wins). Strategic civ-selection lives in
 * Layer 3.
 *
 * Upstream Diplomacy silently no-ops a wrong-season trade without consuming
 * resources, so picking the wrong civ here is benign — the next tick we
 * just try again.
 */
export const tradeOverflowReflex: Reflex = (s) => {
  const mp = s.physical.resources.manpower ?? 0;
  const cap = s.physical.resourceCaps.manpower ?? 0;
  if (!Number.isFinite(cap) || cap <= 0) return null;
  if (mp / cap < 1.0) return null;

  for (const civ of CIV_NAMES) {
    if (!s.info.diplomacyDiscovered[civ]) continue;
    const a = { kind: "trade" as const, civ, caravans: 1 };
    if (feasible(s, a)) return a;
  }
  return null;
};
