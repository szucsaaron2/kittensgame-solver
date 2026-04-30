import { describe, it, expect, afterEach } from "vitest";
import { setupGame, type GameHandle } from "@/testdriver/setupGame";
import { readPrices, affordable, fitsInCap } from "@/simulator/costs";
import { extract } from "@/simulator";

describe("cost extraction", () => {
  let h: GameHandle | undefined;
  afterEach(async () => {
    await h?.teardown();
    h = undefined;
  });

  it("reads building base price", () => {
    h = setupGame();
    const prices = readPrices(h.gamePage.bld.get("field"), 0);
    expect(prices.length).toBeGreaterThan(0);
    expect(prices[0]?.name).toBe("catnip");
    expect(prices[0]?.val).toBeGreaterThan(0);
  });

  it("scales building price by count via priceRatio", () => {
    h = setupGame();
    const field = h.gamePage.bld.get("field");
    const p0 = readPrices(field, 0);
    const p3 = readPrices(field, 3);
    expect(p3[0]!.val).toBeGreaterThan(p0[0]!.val);
    // priceRatio defaults to ~1.12 for fields; 1.12^3 ≈ 1.4
    expect(p3[0]!.val / p0[0]!.val).toBeCloseTo(Math.pow(field.priceRatio as number, 3), 2);
  });

  it("affordable returns false when underfunded", () => {
    h = setupGame();
    const s = extract(h.gamePage);
    expect(affordable(s, [{ name: "wood", val: 999_999 }])).toBe(false);
  });

  it("affordable returns true when funded", () => {
    h = setupGame();
    h.gamePage.resPool.get("wood").value = 1000;
    const s = extract(h.gamePage);
    expect(affordable(s, [{ name: "wood", val: 100 }])).toBe(true);
  });

  it("affordable refuses paragon/karma costs", () => {
    h = setupGame();
    const s = extract(h.gamePage);
    expect(affordable(s, [{ name: "paragon", val: 0 }])).toBe(false);
    expect(affordable(s, [{ name: "karma", val: 0 }])).toBe(false);
  });

  it("fitsInCap detects undersized cap", () => {
    h = setupGame();
    const s = extract(h.gamePage);
    s.physical.resourceCaps.wood = 50;
    expect(fitsInCap(s, [{ name: "wood", val: 100 }])).toBe(false);
    expect(fitsInCap(s, [{ name: "wood", val: 25 }])).toBe(true);
  });
});
