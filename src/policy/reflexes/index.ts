import type { NamedReflex } from "@/policy/types";

/**
 * Layer 1 reflexes, in priority order. The first reflex whose `fire(s)` returns
 * a non-null action wins. Empty in Phase 0; populated from Phase 3 onward.
 */
export const REFLEXES: NamedReflex[] = [];
