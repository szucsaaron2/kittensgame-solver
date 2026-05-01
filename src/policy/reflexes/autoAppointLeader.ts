import type { Reflex } from "@/policy/types";

/**
 * Appoint kitten 0 as leader the first time we have any kittens and no
 * leader yet. Their bonus follows their *current* job (upstream
 * `village.getEffectLeader`), so as JobAssignment moves them between
 * scholar / farmer / priest by phase, the leader-bonus follows. We don't
 * need to be clever about which kitten — the bonus is to *whatever job
 * they hold*, and JobAssignment's priority ladder will route them to the
 * phase-most-important job naturally.
 */
export const autoAppointLeaderReflex: Reflex = (s) => {
  if (s.physical.kittens.leader != null) return null;
  if (s.physical.kittens.total < 1) return null;
  return { kind: "appoint-leader", kittenIndex: 0 };
};
