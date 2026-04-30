import type { Reflex } from "@/policy/types";
import {
  feasible,
  netFlowAt,
  WORST_CATNIP_SEASON,
  WORST_CATNIP_WEATHER,
} from "@/model";

/** Trigger threshold: fire when catnip is at or above this fraction of cap. */
const REFINE_AT = 0.95;

/**
 * Approximate ticks in a winter season. Default game speed: 5 ticks/sec,
 * 1 day = 1 sec, 100 days/season → 500 ticks/season. Conservative — over-
 * estimating the buffer wastes a few catnip clicks; under-estimating risks
 * starvation, which is the failure mode we care about.
 */
const WINTER_TICKS_APPROX = 500;

/**
 * Refine catnip into wood when catnip is near cap, but only if we'd still
 * have enough headroom to survive winter+cold without starving.
 *
 * Single-action signature: the live game accepts one refine per click
 * (50 catnip with `advancedRefinement`, otherwise 100). The driver re-fires
 * the reflex on subsequent ticks while the trigger remains true, draining
 * the surplus over time.
 */
export const refineCatnipReflex: Reflex = (s) => {
  const catnip = s.physical.resources.catnip ?? 0;
  const cap = s.physical.resourceCaps.catnip ?? 0;
  if (!Number.isFinite(cap) || cap <= 0) return null;
  if (catnip / cap < REFINE_AT) return null;

  const a = { kind: "refine-catnip" } as const;
  if (!feasible(s, a)) return null;

  const cost = s.info.workshop.advancedRefinement ? 50 : 100;
  const winterNet = netFlowAt(s, WORST_CATNIP_SEASON, WORST_CATNIP_WEATHER).catnip;
  const buffer = winterNet < 0 ? -winterNet * WINTER_TICKS_APPROX : 0;
  if (catnip - cost < buffer) return null;

  return a;
};
