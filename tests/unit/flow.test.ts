import { describe, it, expect } from "vitest";
import { initialState } from "@/model/initialState";
import {
  netFlow,
  netFlowAt,
  applyActionToFlow,
  catnipSeasonalFactor,
  WORST_CATNIP_FACTOR,
} from "@/model";

describe("flow helpers (Phase 1)", () => {
  it("catnipSeasonalFactor matches the documented spring/summer/autumn/winter values with neutral weather", () => {
    expect(catnipSeasonalFactor(0, "neutral")).toBeCloseTo(1.5, 6);
    expect(catnipSeasonalFactor(1, "neutral")).toBeCloseTo(1.0, 6);
    expect(catnipSeasonalFactor(2, "neutral")).toBeCloseTo(1.0, 6);
    expect(catnipSeasonalFactor(3, "neutral")).toBeCloseTo(0.25, 6);
  });

  it("cold weather subtracts 0.15 from the season multiplier (worst case = winter+cold)", () => {
    expect(catnipSeasonalFactor(3, "cold")).toBeCloseTo(0.25 * (1 - 0.15), 6);
    expect(catnipSeasonalFactor(0, "cold")).toBeCloseTo(1.5 * (1 - 0.15), 6);
    expect(WORST_CATNIP_FACTOR).toBeCloseTo(0.25 * (1 - 0.15), 6);
  });

  it("warm weather adds 0.15 to the season multiplier", () => {
    expect(catnipSeasonalFactor(0, "warm")).toBeCloseTo(1.5 * 1.15, 6);
  });

  it("netFlow returns the snapshotted perTick map", () => {
    const s = initialState();
    s.info.flow.perTick.catnip = 1.7;
    s.info.flow.perTick.wood = -0.3;
    expect(netFlow(s).catnip).toBeCloseTo(1.7);
    expect(netFlow(s).wood).toBeCloseTo(-0.3);
  });

  it("netFlowAt rescales catnip production by the season factor ratio", () => {
    const s = initialState();
    // Pretend we're in spring+neutral with 3.0 production, 1.0 consumption,
    // hence net = 2.0.
    s.info.flow.production.catnip = 3.0;
    s.info.flow.consumption.catnip = 1.0;
    s.info.flow.perTick.catnip = 2.0;
    s.info.flow.catnipSeasonalFactor = catnipSeasonalFactor(0, "neutral"); // 1.5

    // Project to winter+cold (factor 0.2125). Production becomes
    // 3.0 * 0.2125 / 1.5 = 0.425; net = 0.425 - 1.0 = -0.575.
    const projected = netFlowAt(s, 3, "cold").catnip;
    expect(projected).toBeCloseTo(0.425 - 1.0, 4);
  });

  it("netFlowAt leaves non-catnip resources unchanged in Phase 1", () => {
    const s = initialState();
    s.info.flow.perTick.wood = 0.5;
    s.info.flow.perTick.minerals = -0.2;
    const projected = netFlowAt(s, 3, "cold");
    expect(projected.wood).toBeCloseTo(0.5);
    expect(projected.minerals).toBeCloseTo(-0.2);
  });

  it("netFlowAt is a no-op when projected to the current season+weather", () => {
    const s = initialState();
    s.info.flow.production.catnip = 2.4;
    s.info.flow.consumption.catnip = 1.0;
    s.info.flow.perTick.catnip = 1.4;
    s.info.flow.catnipSeasonalFactor = catnipSeasonalFactor(1, "neutral"); // 1.0
    const projected = netFlowAt(s, 1, "neutral").catnip;
    expect(projected).toBeCloseTo(1.4, 6);
  });

  it("applyActionToFlow is identity in Phase 1", () => {
    const s = initialState();
    s.info.flow.perTick.catnip = 0.5;
    const s2 = applyActionToFlow(s, { kind: "wait" });
    expect(s2.info.flow.perTick.catnip).toBe(0.5);
  });
});
