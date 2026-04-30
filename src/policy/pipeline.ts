import type { Action, State } from "@/model";
import { enumerateFeasibleActions } from "@/model";
import type { LayerTrace, NamedReflex, StrategicPolicy, Subsystem } from "./types";
import { REFLEXES } from "./reflexes";
import { SUBSYSTEMS } from "./subsystems";
import { guardActions } from "./guard";

export interface PipelineContext {
  prev: State | null;
  reflexes?: NamedReflex[];
  subsystems?: Subsystem[];
  fallback: StrategicPolicy;
}

export interface PipelineResult {
  action: Action;
  trace: LayerTrace;
}

/**
 * Run the layered policy pipeline:
 *   Layer 0: NetFlowGuard filters the candidate set.
 *   Layer 1: reflexes — first non-null wins; guarded.
 *   Layer 2: subsystems — first triggered + non-null wins; guarded.
 *   Layer 3: strategic policy fallback.
 */
export function runPipeline(s: State, ctx: PipelineContext): PipelineResult {
  const reflexes = ctx.reflexes ?? REFLEXES;
  const subsystems = ctx.subsystems ?? SUBSYSTEMS;
  const ts = Date.now();

  for (const r of reflexes) {
    const a = r.fire(s);
    if (a == null) continue;
    if (!isGuarded(s, a)) continue;
    return { action: a, trace: { layer: 1, source: r.name, action: a, ts } };
  }

  for (const sub of subsystems) {
    if (!sub.trigger(s, ctx.prev)) continue;
    const a = sub.choose(s);
    if (a == null) continue;
    if (!isGuarded(s, a)) continue;
    return { action: a, trace: { layer: 2, source: sub.name, action: a, ts } };
  }

  const a = ctx.fallback(s);
  return { action: a, trace: { layer: 3, source: "fallback", action: a, ts } };
}

function isGuarded(s: State, a: Action): boolean {
  if (a.kind === "wait") return true;
  return guardActions(s, [a]).length === 1;
}

/**
 * Convenience: produce the post-guard candidate set the strategic policy sees.
 * Layer-3 implementations should call this rather than enumerateFeasibleActions
 * directly so the guard is honored.
 */
export function guardedFeasibleActions(s: State): Action[] {
  return guardActions(s, enumerateFeasibleActions(s));
}
