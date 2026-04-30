import { describe, it, expect } from "vitest";
import { initialState } from "@/model/initialState";
import { tradeOverflowReflex } from "@/policy/reflexes/tradeOverflow";

function atCap() {
  const s = initialState();
  s.physical.resources.manpower = 1000;
  s.physical.resourceCaps.manpower = 1000;
  s.physical.resources.gold = 1000;
  return s;
}

describe("trade-overflow reflex (Phase 5)", () => {
  it("fires a single-caravan trade with the first discovered + affordable civ", () => {
    const s = atCap();
    s.info.diplomacyDiscovered.zebras = true;
    s.info.tradeTribute.zebras = { name: "titanium", val: 0 };
    const a = tradeOverflowReflex(s);
    expect(a).toEqual({ kind: "trade", civ: "zebras", caravans: 1 });
  });

  it("does not fire below cap", () => {
    const s = atCap();
    s.physical.resources.manpower = 999;
    s.info.diplomacyDiscovered.zebras = true;
    s.info.tradeTribute.zebras = { name: "titanium", val: 0 };
    expect(tradeOverflowReflex(s)).toBeNull();
  });

  it("does not fire if no civ is discovered", () => {
    const s = atCap();
    expect(tradeOverflowReflex(s)).toBeNull();
  });

  it("does not fire if discovered civ requires unaffordable tribute", () => {
    const s = atCap();
    s.physical.resources.gold = 1000;
    s.info.diplomacyDiscovered.griffins = true;
    s.info.tradeTribute.griffins = { name: "wood", val: 99999 };
    expect(tradeOverflowReflex(s)).toBeNull();
  });

  it("skips an unaffordable civ and trades with the next affordable one", () => {
    const s = atCap();
    // griffins listed first in CIV_NAMES is irrelevant; pick whichever order
    // exists. Both discovered; griffins unaffordable, zebras affordable.
    s.info.diplomacyDiscovered.griffins = true;
    s.info.tradeTribute.griffins = { name: "wood", val: 99999 };
    s.info.diplomacyDiscovered.zebras = true;
    s.info.tradeTribute.zebras = { name: "titanium", val: 0 };
    const a = tradeOverflowReflex(s);
    expect(a).not.toBeNull();
    expect(a?.kind).toBe("trade");
  });

  it("does not fire when manpower cap is Infinity (no 'at cap' state)", () => {
    const s = atCap();
    s.physical.resourceCaps.manpower = Infinity;
    s.info.diplomacyDiscovered.zebras = true;
    s.info.tradeTribute.zebras = { name: "titanium", val: 0 };
    expect(tradeOverflowReflex(s)).toBeNull();
  });
});
