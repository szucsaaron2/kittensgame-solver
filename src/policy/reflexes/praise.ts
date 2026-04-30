import type { Reflex } from "@/policy/types";
import { feasible } from "@/model";

const PRAISE_AT = 0.99;

/**
 * Fire `praise` when faith is near cap. Converts the faith pool into
 * apocrypha; faith stops accumulating once at cap so it's a leak-stopper.
 */
export const praiseReflex: Reflex = (s) => {
  const faith = s.physical.resources.faith ?? 0;
  const cap = s.physical.resourceCaps.faith ?? 0;
  if (!Number.isFinite(cap) || cap <= 0) return null;
  if (faith / cap < PRAISE_AT) return null;
  const a = { kind: "praise" } as const;
  return feasible(s, a) ? a : null;
};
