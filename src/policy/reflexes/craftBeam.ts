import type { Reflex } from "@/policy/types";
import { feasible } from "@/model";

const CRAFT_AT = 0.95;

/**
 * Convert wood to beams when wood is near cap. Workshop building must be up
 * (feasibility enforces this). Single beam (175 wood) per click; the engine
 * accepts an `amount` field but we keep it simple — re-fires on subsequent
 * ticks while the trigger holds.
 */
export const craftBeamReflex: Reflex = (s) => {
  const wood = s.physical.resources.wood ?? 0;
  const cap = s.physical.resourceCaps.wood ?? 0;
  if (!Number.isFinite(cap) || cap <= 0) return null;
  if (wood / cap < CRAFT_AT) return null;
  if (!s.info.unlocked.crafts.beam) return null;
  const a = { kind: "craft" as const, item: "beam" as const, amount: 1 };
  return feasible(s, a) ? a : null;
};
