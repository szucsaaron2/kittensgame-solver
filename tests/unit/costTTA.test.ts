import { describe, it, expect } from "vitest";
import { initialState } from "@/model/initialState";
import { rawResourceTTA, craftDagTTA, costTTA } from "@/model";

describe("rawResourceTTA", () => {
  it("returns 0 when we already have enough", () => {
    const s = initialState();
    s.physical.resources.wood = 200;
    expect(rawResourceTTA(s, "wood", 100)).toBe(0);
  });

  it("returns wait time scaled by 5 ticks/sec when we have flow", () => {
    const s = initialState();
    s.physical.resources.wood = 50;
    s.info.flow.perTick.wood = 2; // 2 wood/tick = 10 wood/sec
    s.physical.resourceCaps.wood = Infinity;
    // need = 100, have = 50, deficit = 50, /(2*5) = 5 seconds.
    expect(rawResourceTTA(s, "wood", 100)).toBeCloseTo(5, 6);
  });

  it("returns Infinity when flow is non-positive and we don't have enough", () => {
    const s = initialState();
    s.physical.resources.wood = 50;
    s.info.flow.perTick.wood = 0;
    s.physical.resourceCaps.wood = Infinity;
    expect(rawResourceTTA(s, "wood", 100)).toBe(Infinity);
  });

  it("returns a finite deficit-proportional TTA when cost exceeds finite cap", () => {
    // Cap-bound goals get a finite TTA proportional to the cap deficit so
    // the planner can give partial credit to cap-raising builds. Returning
    // Infinity here would make single-step lookahead unable to see
    // cumulative cap-raising as worth pursuing.
    const s = initialState();
    s.physical.resources.wood = 0;
    s.physical.resourceCaps.wood = 50;
    s.info.flow.perTick.wood = 2;
    const tta = rawResourceTTA(s, "wood", 100);
    expect(Number.isFinite(tta)).toBe(true);
    // Deficit = 100 - 50 = 50, weighted at 1 → contributes 50 seconds.
    // Plus flow-component cap/flowPerSec = 50 / (2*5) = 5 seconds.
    expect(tta).toBeCloseTo(55, 4);
  });

  it("returns 0 for negative or zero need", () => {
    const s = initialState();
    expect(rawResourceTTA(s, "wood", 0)).toBe(0);
    expect(rawResourceTTA(s, "wood", -10)).toBe(0);
  });
});

describe("craftDagTTA", () => {
  it("returns 0 when we already have enough crafted stockpile", () => {
    const s = initialState();
    s.physical.resources.beam = 50;
    expect(craftDagTTA(s, "beam", 25)).toBe(0);
  });

  it("recurses through one level (beam → wood)", () => {
    const s = initialState();
    s.physical.resources.beam = 0;
    s.physical.resources.wood = 0;
    s.info.flow.perTick.wood = 7;
    s.physical.resourceCaps.wood = Infinity;
    // 1 beam = 175 wood. flow = 7/tick = 35/sec. tta = 175/35 = 5s.
    expect(craftDagTTA(s, "beam", 1)).toBeCloseTo(5, 4);
  });

  it("recurses through two levels (manuscript → parchment + culture)", () => {
    const s = initialState();
    // recipe: manuscript = 400 culture + 25 parchment per unit.
    // parchment = 175 furs per unit. So 1 manuscript = 25 parchment = 4375 furs.
    s.physical.resources.manuscript = 0;
    s.physical.resources.parchment = 0;
    s.physical.resources.culture = 0;
    s.physical.resources.furs = 0;
    s.info.flow.perTick.furs = 1; // 5 furs/sec
    s.info.flow.perTick.culture = 100; // 500 culture/sec → trivial
    s.physical.resourceCaps.furs = Infinity;
    s.physical.resourceCaps.culture = Infinity;
    // furs gates: need 4375 furs at 5/sec = 875 sec.
    expect(craftDagTTA(s, "manuscript", 1)).toBeCloseTo(875, 1);
  });

  it("uses the slowest input (max across recipe)", () => {
    const s = initialState();
    // 1 manuscript = 25 parchment + 400 culture.
    // Provide enough parchment in stockpile so that input is satisfied;
    // culture flow is the gate.
    s.physical.resources.parchment = 1000;
    s.physical.resources.culture = 0;
    s.info.flow.perTick.culture = 2; // 10 culture/sec
    s.physical.resourceCaps.culture = Infinity;
    // 1 manuscript = 400 culture / 10 sec = 40 sec.
    expect(craftDagTTA(s, "manuscript", 1)).toBeCloseTo(40, 4);
  });

  it("returns Infinity if any input has TTA = Infinity", () => {
    const s = initialState();
    s.physical.resources.beam = 0;
    s.physical.resources.wood = 0;
    s.info.flow.perTick.wood = 0;
    s.physical.resourceCaps.wood = Infinity;
    expect(craftDagTTA(s, "beam", 1)).toBe(Infinity);
  });
});

describe("costTTA", () => {
  it("returns the max across cost items", () => {
    const s = initialState();
    s.physical.resources.wood = 100;
    s.physical.resources.minerals = 0;
    s.info.flow.perTick.wood = 10;
    s.info.flow.perTick.minerals = 1;
    s.physical.resourceCaps.wood = Infinity;
    s.physical.resourceCaps.minerals = Infinity;
    // wood: have 100, need 200, deficit 100 / 50/sec = 2s.
    // minerals: have 0, need 100, /5/sec = 20s.
    // max = 20.
    const tta = costTTA(s, [
      { name: "wood", val: 200 },
      { name: "minerals", val: 100 },
    ]);
    expect(tta).toBeCloseTo(20, 4);
  });

  it("returns 0 when every cost is already affordable", () => {
    const s = initialState();
    s.physical.resources.wood = 1000;
    s.physical.resources.minerals = 500;
    expect(
      costTTA(s, [
        { name: "wood", val: 200 },
        { name: "minerals", val: 100 },
      ]),
    ).toBe(0);
  });

  it("recurses for crafted-good costs (e.g. tech requiring compendium)", () => {
    const s = initialState();
    // biology cost: 85000 science + 100 compendium.
    // compendium = 50 manuscript + 10000 science per unit.
    // manuscript = 400 culture + 25 parchment per unit.
    // We synthesize a state where culture flow is the bottleneck.
    s.physical.resources.science = 90000; // enough for biology + 100×10000 cmp
    s.physical.resources.compedium = 0;
    s.physical.resources.manuscript = 0;
    s.physical.resources.parchment = 1e9; // not the bottleneck
    s.physical.resources.culture = 0;
    s.info.flow.perTick.culture = 10; // 50 culture/sec
    s.info.flow.perTick.science = 100; // ample
    s.physical.resourceCaps.culture = Infinity;
    s.physical.resourceCaps.science = Infinity;
    const tta = costTTA(s, [
      { name: "science", val: 85000 },
      { name: "compedium", val: 100 },
    ]);
    // 100 cmp = 5000 manuscripts = 2,000,000 culture / 50 culture-sec = 40000 s.
    expect(tta).toBeGreaterThan(35000);
    expect(tta).toBeLessThan(45000);
  });
});
