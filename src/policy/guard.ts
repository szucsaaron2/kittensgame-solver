import type { Action, State } from "@/model";

/**
 * Layer 0 — NetFlowGuard.
 *
 * Phase 0 stub: identity. Phase 1 wires in netFlow + the catnip winter check.
 * Phase 2 extends to wood/minerals/iron/coal/gold/titanium/oil/uranium/energy.
 */
export function guardActions(_s: State, actions: Action[]): Action[] {
  return actions;
}
