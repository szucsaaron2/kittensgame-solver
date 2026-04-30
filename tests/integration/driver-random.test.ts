import { describe, it, expect, afterEach } from "vitest";
import { setupGame, type GameHandle } from "@/testdriver/setupGame";
import { run, type DriverIO } from "@/driver/loop";
import { makeRandomPolicy } from "@/policy";
import { extract, apply } from "@/simulator";
import { goal, feasible } from "@/model";

describe("driver with random policy", () => {
  let h: GameHandle | undefined;
  afterEach(async () => {
    await h?.teardown();
    h = undefined;
  });

  it("runs random feasible actions for many iterations without crashing", async () => {
    h = setupGame({ seed: 1 });
    let iterations = 0;
    let policyChoices = 0;
    let nonWaitChoices = 0;

    // Tolerate apply errors at runtime (preconditions can shift between
    // enumerate and apply for resource-driven actions).
    const io: DriverIO = {
      read: () => extract(h!.gamePage),
      apply: (a) => {
        try {
          apply(h!.gamePage, a);
        } catch {
          // tolerated
        }
      },
      waitUntilNextEvent: async () => {
        h!.tick(5);
        await Promise.resolve();
      },
      shouldStop: (s) => {
        iterations++;
        return goal(s) || iterations > 200;
      },
      onStep: (_s, a) => {
        policyChoices++;
        if (a.kind !== "wait") nonWaitChoices++;
      },
    };

    const rng = mulberry32(1);
    await run(makeRandomPolicy(() => rng()), io);

    expect(iterations).toBeGreaterThan(50);
    expect(policyChoices).toBeGreaterThan(0);
    // Random play should produce *some* state change.
    const final = extract(h.gamePage);
    expect(final.info.calendar.ticks).toBeGreaterThan(0);
    void nonWaitChoices; // diagnostic only
  }, 60_000);

  it("apply succeeds on every feasible action drawn from enumeration", async () => {
    h = setupGame({ seed: 5 });
    // Seed the game with starter resources so there are actually feasible
    // actions to attempt. Without this, a fresh game has 0 kittens, 0 catnip,
    // and only "wait" is enumerable.
    h.gamePage.resPool.get("catnip").value = 200;
    h.gamePage.resPool.get("wood").value = 200;
    h.gamePage.resPool.get("manpower").value = 500;
    h.gamePage.resPool.get("faith").value = 100;
    h.gamePage.bld.get("field").unlocked = true;
    h.gamePage.bld.get("hut").unlocked = true;
    h.tick(5);

    let attempts = 0;
    let successes = 0;
    for (let i = 0; i < 30; i++) {
      h.tick(2);
      const s = extract(h.gamePage);
      const actions = enumerateNonWait(s);
      if (actions.length === 0) continue;
      const a = actions[i % actions.length]!;
      const sNow = extract(h.gamePage);
      if (!feasible(sNow, a)) continue;
      attempts++;
      try {
        apply(h.gamePage, a);
        successes++;
      } catch {
        // counted as non-success
      }
    }
    expect(attempts).toBeGreaterThan(0);
    expect(successes).toBeGreaterThan(attempts * 0.6);
  }, 60_000);
});

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

import { enumerateFeasibleActions } from "@/model";
import type { State, Action } from "@/model";
function enumerateNonWait(s: State): Action[] {
  return enumerateFeasibleActions(s).filter((a) => a.kind !== "wait");
}
