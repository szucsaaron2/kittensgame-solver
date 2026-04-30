import { describe, it, expect } from "vitest";
import { initialState } from "@/model/initialState";
import { applyActionToFlow, catnipSeasonalFactor } from "@/model";
import type { Action } from "@/model";

describe("applyActionToFlow per-building deltas (Phase 2)", () => {
  it("identity for actions outside the danger list", () => {
    const s = initialState();
    s.info.flow.perTick.wood = 1.0;
    const s2 = applyActionToFlow(s, { kind: "research", tech: "calendar" } as Action);
    expect(s2.info.flow.perTick.wood).toBe(1.0);
  });

  it("smelter: wood -0.05, minerals -0.1, iron +0.02", () => {
    const s = initialState();
    const s2 = applyActionToFlow(s, { kind: "build", building: "smelter" } as Action);
    expect(s2.info.flow.perTick.wood).toBeCloseTo(-0.05, 6);
    expect(s2.info.flow.perTick.minerals).toBeCloseTo(-0.1, 6);
    expect(s2.info.flow.perTick.iron).toBeCloseTo(0.02, 6);
    expect(s2.info.flow.consumption.wood).toBeCloseTo(0.05, 6);
    expect(s2.info.flow.production.iron).toBeCloseTo(0.02, 6);
  });

  it("calciner: minerals -1.5, oil -0.024, energy -1, iron +0.15, titanium +0.0005", () => {
    const s = initialState();
    const s2 = applyActionToFlow(s, { kind: "build", building: "calciner" } as Action);
    expect(s2.info.flow.perTick.minerals).toBeCloseTo(-1.5, 6);
    expect(s2.info.flow.perTick.oil).toBeCloseTo(-0.024, 6);
    expect(s2.info.flow.energyNet).toBeCloseTo(-1, 6);
    expect(s2.info.flow.perTick.iron).toBeCloseTo(0.15, 6);
    expect(s2.info.flow.perTick.titanium).toBeCloseTo(0.0005, 6);
  });

  it("magneto: oil -0.05, energy +5", () => {
    const s = initialState();
    const s2 = applyActionToFlow(s, { kind: "build", building: "magneto" } as Action);
    expect(s2.info.flow.perTick.oil).toBeCloseTo(-0.05, 6);
    expect(s2.info.flow.energyNet).toBeCloseTo(5, 6);
  });

  it("reactor: uranium -0.001, energy +10", () => {
    const s = initialState();
    const s2 = applyActionToFlow(s, { kind: "build", building: "reactor" } as Action);
    expect(s2.info.flow.perTick.uranium).toBeCloseTo(-0.001, 6);
    expect(s2.info.flow.energyNet).toBeCloseTo(10, 6);
  });

  it("factory: energy -2", () => {
    const s = initialState();
    const s2 = applyActionToFlow(s, { kind: "build", building: "factory" } as Action);
    expect(s2.info.flow.energyNet).toBeCloseTo(-2, 6);
  });

  it("chronosphere: energy -20", () => {
    const s = initialState();
    const s2 = applyActionToFlow(s, { kind: "build", building: "chronosphere" } as Action);
    expect(s2.info.flow.energyNet).toBeCloseTo(-20, 6);
  });

  it("pasture reduces catnip consumption multiplicatively (-0.5%)", () => {
    const s = initialState();
    s.info.flow.consumption.catnip = 2.0;
    s.info.flow.production.catnip = 3.0;
    s.info.flow.perTick.catnip = 1.0;
    s.info.flow.catnipSeasonalFactor = catnipSeasonalFactor(0, "neutral");
    const s2 = applyActionToFlow(s, { kind: "build", building: "pasture" } as Action);
    expect(s2.info.flow.consumption.catnip).toBeCloseTo(2.0 * 0.995, 6);
    // Net should rise by the consumption reduction (0.01).
    expect(s2.info.flow.perTick.catnip).toBeCloseTo(1.0 + 0.01, 6);
  });

  it("unicornPasture reduces catnip consumption by 0.15%", () => {
    const s = initialState();
    s.info.flow.consumption.catnip = 4.0;
    s.info.flow.perTick.catnip = 1.0;
    const s2 = applyActionToFlow(s, { kind: "build", building: "unicornPasture" } as Action);
    expect(s2.info.flow.consumption.catnip).toBeCloseTo(4.0 * 0.9985, 6);
  });

  it("does not mutate the input state", () => {
    const s = initialState();
    s.info.flow.perTick.wood = 0.5;
    applyActionToFlow(s, { kind: "build", building: "smelter" } as Action);
    expect(s.info.flow.perTick.wood).toBe(0.5);
  });
});
