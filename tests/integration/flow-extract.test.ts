import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupGame, type GameHandle } from "@/testdriver/setupGame";
import { extract } from "@/simulator";
import { netFlow, netFlowAt, catnipSeasonalFactor } from "@/model";

describe("extract populates flow snapshot from the live engine", () => {
  let h: GameHandle;
  beforeEach(() => {
    h = setupGame({ seed: 7 });
  });
  afterEach(async () => {
    await h.teardown();
  });

  it("netFlow.catnip matches gamePage.getResourcePerTick('catnip') within 1%", () => {
    // Seed enough state for non-trivial catnip dynamics: a couple of fields,
    // a handful of kittens, a farmer.
    h.gamePage.bld.get("field").val = 3;
    h.gamePage.bld.get("field").unlocked = true;
    h.gamePage.resPool.get("catnip").value = 200;
    h.tick(20);
    const s = extract(h.gamePage);
    const engine = h.gamePage.getResourcePerTick("catnip", true);
    const ours = netFlow(s).catnip;
    expect(Math.abs(ours - engine)).toBeLessThan(Math.max(0.01 * Math.abs(engine), 1e-6));
  });

  it("flow.production.catnip equals net + consumption (algebraic identity)", () => {
    h.gamePage.bld.get("field").val = 2;
    h.gamePage.bld.get("field").unlocked = true;
    h.tick(5);
    const s = extract(h.gamePage);
    expect(s.info.flow.production.catnip).toBeCloseTo(
      s.info.flow.perTick.catnip + s.info.flow.consumption.catnip,
      6,
    );
  });

  it("catnipSeasonalFactor in the snapshot matches the calendar+weather we extracted", () => {
    const s = extract(h.gamePage);
    expect(s.info.flow.catnipSeasonalFactor).toBeCloseTo(
      catnipSeasonalFactor(s.info.calendar.season, s.info.weather),
      6,
    );
  });

  it("netFlowAt rescales catnip production lower in winter+cold than in spring+neutral", () => {
    // Inject a known catnip production directly into the snapshot so we can
    // verify the seasonal projection without depending on the engine's
    // internal cache update behavior.
    const s = extract(h.gamePage);
    s.info.flow.production.catnip = 3.0;
    s.info.flow.consumption.catnip = 0.5;
    s.info.flow.perTick.catnip = 2.5;
    s.info.flow.catnipSeasonalFactor = catnipSeasonalFactor(0, "neutral");
    const winter = netFlowAt(s, 3, "cold").catnip;
    const spring = netFlowAt(s, 0, "neutral").catnip;
    expect(spring).toBeGreaterThan(winter);
    // Spring projection equals current snapshot net.
    expect(spring).toBeCloseTo(2.5, 6);
    // Winter+cold: production scaled by 0.2125/1.5; net = scaled - consumption.
    expect(winter).toBeCloseTo(3.0 * (0.25 * 0.85) / 1.5 - 0.5, 4);
  });

  it("non-catnip resources have a perTick snapshot from the engine", () => {
    const s = extract(h.gamePage);
    // Resources we haven't unlocked still have a perTick number (typically 0).
    expect(typeof s.info.flow.perTick.wood).toBe("number");
    expect(typeof s.info.flow.perTick.minerals).toBe("number");
    expect(typeof s.info.flow.perTick.iron).toBe("number");
  });
});
