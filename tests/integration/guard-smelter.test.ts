import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupGame, type GameHandle } from "@/testdriver/setupGame";
import { extract } from "@/simulator";
import { isSafe } from "@/policy/guard";
import type { Action } from "@/model";

/**
 * Smelter over-build rejection on the live engine.
 *
 * Synthesize a state with a tiny wood-flow surplus, then verify the guard
 * blocks an additional smelter (which would consume 0.05 wood/tick — pushing
 * us under the 0.1/tick wood margin).
 */
describe("NetFlowGuard against the live engine", () => {
  let h: GameHandle;
  beforeEach(() => {
    h = setupGame({ seed: 11 });
  });
  afterEach(async () => {
    await h.teardown();
  });

  it("blocks a smelter when wood headroom is below the margin", () => {
    const s = extract(h.gamePage);
    // Override the snapshot to put us right at the danger boundary.
    s.info.flow.perTick.wood = 0.12;
    s.info.flow.perTick.minerals = 1.0;
    expect(isSafe(s, { kind: "build", building: "smelter" } as Action)).toBe(false);
  });

  it("accepts a smelter when wood and minerals have plenty of headroom", () => {
    const s = extract(h.gamePage);
    s.info.flow.perTick.wood = 5.0;
    s.info.flow.perTick.minerals = 5.0;
    expect(isSafe(s, { kind: "build", building: "smelter" } as Action)).toBe(true);
  });
});
