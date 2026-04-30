import type { GameHandle } from "./setupGame";
import type { DriverIO } from "@/driver/loop";
import { extract } from "@/simulator";
import { goal } from "@/model";

export function makeTestIO(handle: GameHandle, ticksPerStep = 1): DriverIO {
  return {
    read: () => extract(handle.gamePage),
    apply: () => {
      // placeholder until apply() is wired
    },
    waitUntilNextEvent: async () => {
      handle.tick(ticksPerStep);
      await Promise.resolve();
    },
    shouldStop: (s) => goal(s),
  };
}
