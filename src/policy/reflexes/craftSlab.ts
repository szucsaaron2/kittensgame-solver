import type { Reflex } from "@/policy/types";
import { feasible } from "@/model";

const CRAFT_AT = 0.95;

/**
 * Convert minerals to slabs when minerals are near cap. Workshop building
 * must be up (feasibility enforces this). Single slab (250 minerals) per
 * click.
 */
export const craftSlabReflex: Reflex = (s) => {
  const minerals = s.physical.resources.minerals ?? 0;
  const cap = s.physical.resourceCaps.minerals ?? 0;
  if (!Number.isFinite(cap) || cap <= 0) return null;
  if (minerals / cap < CRAFT_AT) return null;
  if (!s.info.unlocked.crafts.slab) return null;
  const a = { kind: "craft" as const, item: "slab" as const, amount: 1 };
  return feasible(s, a) ? a : null;
};
