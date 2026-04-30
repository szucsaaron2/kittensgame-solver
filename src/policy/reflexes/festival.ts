import type { Reflex } from "@/policy/types";
import { feasible } from "@/model";

/**
 * Fire `festival` whenever the previous festival has expired and the
 * materials (manpower + culture + parchment) are affordable. Festivals
 * grant a flat happiness boost while active — pure upside.
 */
export const festivalReflex: Reflex = (s) => {
  if (s.info.festivalRemaining > 0) return null;
  const a = { kind: "festival" } as const;
  return feasible(s, a) ? a : null;
};
