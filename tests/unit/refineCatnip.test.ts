import { describe, it, expect } from "vitest";
import { initialState } from "@/model/initialState";
import { refineCatnipReflex } from "@/policy/reflexes/refineCatnip";
import { catnipSeasonalFactor } from "@/model";

function nearCap(): ReturnType<typeof initialState> {
  const s = initialState();
  s.physical.resources.catnip = 5000;
  s.physical.resourceCaps.catnip = 5000;
  // Healthy net flow (positive in winter+cold) so the buffer is 0.
  s.info.flow.production.catnip = 5.0;
  s.info.flow.consumption.catnip = 0;
  s.info.flow.perTick.catnip = 5.0;
  s.info.flow.catnipSeasonalFactor = catnipSeasonalFactor(0, "neutral");
  return s;
}

describe("refine-catnip reflex (Phase 4)", () => {
  it("fires when catnip is at cap and winter net is positive", () => {
    const s = nearCap();
    expect(refineCatnipReflex(s)).toEqual({ kind: "refine-catnip" });
  });

  it("does not fire below the 95% threshold", () => {
    const s = nearCap();
    s.physical.resources.catnip = 4700; // 94%
    expect(refineCatnipReflex(s)).toBeNull();
  });

  it("does not fire when feasibility fails (catnip < 100)", () => {
    const s = nearCap();
    // Tiny absolute cap so 95% trigger fires but cost can't be paid.
    s.physical.resourceCaps.catnip = 50;
    s.physical.resources.catnip = 50;
    expect(refineCatnipReflex(s)).toBeNull();
  });

  it("does not fire when refining would dip below the winter buffer", () => {
    const s = nearCap();
    // Force a deep catnip-deficit winter projection — large enough that the
    // 500-tick buffer exceeds the 5000-stockpile.
    s.info.flow.production.catnip = 1.0;
    s.info.flow.consumption.catnip = 15.0;
    s.info.flow.perTick.catnip = -14.0;
    s.info.flow.catnipSeasonalFactor = catnipSeasonalFactor(0, "neutral");
    // winter+cold production: 1.0 × 0.2125/1.5 ≈ 0.14; net ≈ -14.86;
    // buffer ≈ 7430 catnip > 4900 (post-refine stockpile) ⇒ reflex must skip.
    expect(refineCatnipReflex(s)).toBeNull();
  });

  it("respects advancedRefinement (50 catnip cost) buffer math", () => {
    const s = nearCap();
    s.info.workshop.advancedRefinement = true;
    expect(refineCatnipReflex(s)).toEqual({ kind: "refine-catnip" });
  });

  it("does not fire when cap is infinite (no 'near cap' is ever reached)", () => {
    const s = nearCap();
    s.physical.resourceCaps.catnip = Infinity;
    s.physical.resources.catnip = 1e9;
    expect(refineCatnipReflex(s)).toBeNull();
  });

  it("does not fire when cap is 0", () => {
    const s = nearCap();
    s.physical.resourceCaps.catnip = 0;
    expect(refineCatnipReflex(s)).toBeNull();
  });
});
