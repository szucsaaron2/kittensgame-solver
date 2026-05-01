import type { Reflex } from "@/policy/types";
import { feasible } from "@/model";
import { TECH_NAMES } from "@/model/catalogs";

/**
 * Fire `research` for the first feasible (unlocked + affordable + not yet
 * researched) tech. Tech research is one-time, monotone, and the tech tree
 * is a DAG with no mutually-exclusive branches — buying ASAP compounds
 * downstream production / unlocks.
 *
 * Iterates catalog order; "first feasible" wins. Order doesn't materially
 * matter since every reachable tech gets bought eventually.
 */
export const autoResearchReflex: Reflex = (s) => {
  for (const tech of TECH_NAMES) {
    if (s.info.techs[tech]) continue;
    const a = { kind: "research" as const, tech };
    if (feasible(s, a)) return a;
  }
  return null;
};
