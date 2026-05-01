import { describe, it, expect } from "vitest";
import { initialState } from "@/model/initialState";
import { projectBuild } from "@/model";
import type { Action } from "@/model";

describe("projectBuild (Phase 9)", () => {
  it("identity for non-build actions", () => {
    const s = initialState();
    s.physical.resources.wood = 100;
    const s2 = projectBuild(s, { kind: "wait" } as Action);
    expect(s2).toBe(s);
  });

  it("subtracts cost, increments count, raises caps for barn", () => {
    const s = initialState();
    s.physical.resources.wood = 1000;
    s.physical.resourceCaps.catnip = 100;
    s.physical.resourceCaps.wood = 200;
    s.physical.resourceCaps.minerals = 250;
    s.physical.resourceCaps.coal = 0;
    s.physical.resourceCaps.iron = 0;
    s.physical.resourceCaps.titanium = 0;
    s.physical.resourceCaps.gold = 0;

    const s2 = projectBuild(s, { kind: "build", building: "barn" });
    // barn base cost = 50 wood (priceRatio 1.75 ^ 0 = 1).
    expect(s2.physical.resources.wood).toBe(950);
    expect(s2.physical.buildings.barn).toBe(1);
    // Barn cap deltas.
    expect(s2.physical.resourceCaps.catnip).toBe(100 + 5000);
    expect(s2.physical.resourceCaps.wood).toBe(200 + 200);
    expect(s2.physical.resourceCaps.minerals).toBe(250 + 250);
    expect(s2.physical.resourceCaps.coal).toBe(60);
    expect(s2.physical.resourceCaps.gold).toBe(10);
  });

  it("scales cost by priceRatio when there's an existing count", () => {
    const s = initialState();
    s.physical.resources.wood = 10000;
    s.physical.buildings.barn = 3;
    const s2 = projectBuild(s, { kind: "build", building: "barn" });
    // 50 × 1.75^3 = 50 × 5.359375 = 267.96875.
    const expected = 10000 - 50 * Math.pow(1.75, 3);
    expect(s2.physical.resources.wood).toBeCloseTo(expected, 4);
    expect(s2.physical.buildings.barn).toBe(4);
  });

  it("does not mutate the input state", () => {
    const s = initialState();
    s.physical.resources.wood = 1000;
    projectBuild(s, { kind: "build", building: "barn" });
    expect(s.physical.resources.wood).toBe(1000);
    expect(s.physical.buildings.barn).toBe(0);
  });

  it("decomposes crafted costs into raw — warehouse needs beam + slab", () => {
    const s = initialState();
    // warehouse stage 0 cost: 1.5 beam + 2 slab.
    // beam = 175 wood per unit. slab = 250 minerals per unit.
    // So projection should subtract 1.5×175 = 262.5 wood and 2×250 = 500 minerals
    // from raw stockpile (when crafted stockpiles are 0).
    s.physical.resources.wood = 1000;
    s.physical.resources.minerals = 1000;
    s.physical.resources.beam = 0;
    s.physical.resources.slab = 0;
    const s2 = projectBuild(s, { kind: "build", building: "warehouse" });
    expect(s2.physical.resources.wood).toBeCloseTo(1000 - 262.5, 4);
    expect(s2.physical.resources.minerals).toBeCloseTo(1000 - 500, 4);
  });

  it("consumes crafted stockpile before falling back to raw", () => {
    const s = initialState();
    s.physical.resources.beam = 10; // more than needed (1.5)
    s.physical.resources.slab = 10;
    s.physical.resources.wood = 1000;
    s.physical.resources.minerals = 1000;
    const s2 = projectBuild(s, { kind: "build", building: "warehouse" });
    expect(s2.physical.resources.beam).toBeCloseTo(10 - 1.5, 4);
    expect(s2.physical.resources.slab).toBeCloseTo(10 - 2, 4);
    // Raw stockpiles untouched.
    expect(s2.physical.resources.wood).toBe(1000);
    expect(s2.physical.resources.minerals).toBe(1000);
  });

  it("applies the flow delta from BUILDING_FLOW_DELTAS via applyActionToFlow", () => {
    const s = initialState();
    s.physical.resources.wood = 100000;
    s.physical.resources.minerals = 100000;
    s.physical.resources.iron = 100000;
    const before = s.info.flow.perTick.wood;
    const s2 = projectBuild(s, { kind: "build", building: "smelter" });
    // smelter flow delta: wood -0.05, minerals -0.1, iron +0.02.
    expect(s2.info.flow.perTick.wood).toBeCloseTo(before - 0.05, 6);
    expect(s2.info.flow.perTick.iron).toBeCloseTo(0.02, 6);
  });

  it("preserves Infinity caps (no NaN from Infinity + delta)", () => {
    const s = initialState();
    s.physical.resources.wood = 1000;
    // Default caps are Infinity for every resource in initialState.
    const s2 = projectBuild(s, { kind: "build", building: "barn" });
    expect(s2.physical.resourceCaps.catnip).toBe(Infinity);
    expect(s2.physical.resourceCaps.wood).toBe(Infinity);
  });
});
