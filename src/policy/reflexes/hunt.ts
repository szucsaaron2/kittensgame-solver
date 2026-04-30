import type { Reflex } from "@/policy/types";
import { feasible } from "@/model";

/**
 * Fire `hunt` when catpower (manpower) is at or near cap. Drains it back
 * before the cap silently throttles passive accumulation.
 */
export const huntReflex: Reflex = (s) => {
  const mp = s.physical.resources.manpower ?? 0;
  const cap = s.physical.resourceCaps.manpower ?? 0;
  if (!Number.isFinite(cap) || cap <= 0) return null;
  if (mp / cap < 1.0) return null;
  const a = { kind: "hunt" } as const;
  return feasible(s, a) ? a : null;
};
