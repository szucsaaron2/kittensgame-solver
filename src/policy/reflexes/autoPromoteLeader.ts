import type { Reflex } from "@/policy/types";

/**
 * Promote the leader when a comfortable manuscript stockpile is available.
 *
 * Upstream cost grows with rank (≈ rank × tier_base) and the model doesn't
 * yet snapshot the exact rank-cost. Hand-set threshold 100 + rank × 100
 * manuscripts is a conservative gate — it never blocks affordable promotions
 * once we're past the early-religion phase.
 *
 * Caps at rank 10 so this never spins forever in steady-state late game.
 */
const RANK_CAP = 10;

export const autoPromoteLeaderReflex: Reflex = (s) => {
  const leader = s.physical.kittens.leader;
  if (!leader) return null;
  if ((leader.rank ?? 0) >= RANK_CAP) return null;
  const manuscripts = s.physical.resources.manuscript ?? 0;
  const threshold = 100 + leader.rank * 100;
  if (manuscripts < threshold) return null;
  return { kind: "promote-leader" };
};
