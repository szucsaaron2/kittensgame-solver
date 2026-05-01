import type { Reflex } from "@/policy/types";

/**
 * Promote the leader to the next rank.
 *
 * Upstream cost (kittensgame-master/js/village.js):
 *   - Gold: 25 × (rank + 1)                                    (line 3044)
 *   - Kitten exp: 500 × 1.75^rank                              (line 167)
 *   - Workshop `register` must be researched                   (line 170)
 *
 * Exp accumulates passively from time-on-job; we read it from the leader
 * snapshot. Gold is a resource we check directly. Rank-cap = 10 prevents
 * runaway late-game promotion attempts.
 */
const RANK_CAP = 10;

export const autoPromoteLeaderReflex: Reflex = (s) => {
  const leader = s.physical.kittens.leader;
  if (!leader) return null;
  if (leader.rank >= RANK_CAP) return null;
  if (!s.info.workshop.register) return null;

  const goldNeeded = 25 * (leader.rank + 1);
  const expNeeded = 500 * Math.pow(1.75, leader.rank);
  const gold = s.physical.resources.gold ?? 0;

  if (gold < goldNeeded) return null;
  if (leader.exp < expNeeded) return null;

  return { kind: "promote-leader" };
};
