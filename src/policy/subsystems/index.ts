import type { Subsystem } from "@/policy/types";
import { jobAssignmentSubsystem } from "./jobs";

/**
 * Layer 2 subsystem controllers. Each declares its own re-trigger condition;
 * the pipeline only re-runs `choose()` when `trigger(s, prev)` is true.
 */
export const SUBSYSTEMS: Subsystem[] = [jobAssignmentSubsystem];

export { jobAssignmentSubsystem, chooseJobs, farmerFloor, priorityLadder } from "./jobs";
