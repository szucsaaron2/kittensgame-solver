import type { Reflex } from "@/policy/types";

/**
 * Fire `observe` whenever an astronomical event is active. Pure upside —
 * starcharts/science reward; the flag clears when ignored.
 */
export const observeReflex: Reflex = (s) =>
  s.info.astronomicalEvent ? { kind: "observe" } : null;
