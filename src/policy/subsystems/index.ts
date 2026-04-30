import type { Subsystem } from "@/policy/types";

/**
 * Layer 2 subsystem controllers. Each declares its own re-trigger condition;
 * the pipeline only re-runs `choose()` when `trigger(s, prev)` is true.
 * Empty in Phase 0; first subsystem (JobAssignment) lands in Phase 6.
 */
export const SUBSYSTEMS: Subsystem[] = [];
