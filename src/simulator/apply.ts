import type { Action } from "@/model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(_gamePage: any, _action: Action): void {
  throw new Error("apply: not yet implemented (deferred to policy plan)");
}
