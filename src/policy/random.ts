import type { Policy } from "@/driver/loop";
import { enumerateFeasibleActions } from "@/model";
import { guardActions } from "./guard";

export function makeRandomPolicy(rng: () => number = Math.random): Policy {
  return (s) => {
    const actions = guardActions(s, enumerateFeasibleActions(s));
    if (actions.length === 0) return { kind: "wait" };
    const i = Math.floor(rng() * actions.length);
    return actions[i] ?? { kind: "wait" };
  };
}
