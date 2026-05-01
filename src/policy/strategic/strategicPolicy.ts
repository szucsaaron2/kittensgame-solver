import type { Policy } from "@/driver/loop";
import { chooseBuildingAction } from "./buildingPlanner";
import { makeRandomPolicy } from "@/policy/random";

/**
 * Layer 3 strategic policy: try the building planner first, fall back to
 * random for everything outside its scope (gather-catnip, send-explorers,
 * refine-tears, refine-tc, build-space / build-chronoforge / build-voidspace
 * / build-ziggurat / space-launch / pact — these latter classes graduate
 * to the planner in Phase 11).
 */
export function makeStrategicPolicy(rng: () => number = Math.random): Policy {
  const fallback = makeRandomPolicy(rng);
  return (s) => {
    const a = chooseBuildingAction(s);
    if (a) return a;
    return fallback(s);
  };
}
