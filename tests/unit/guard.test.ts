import { describe, it, expect } from "vitest";
import { initialState } from "@/model/initialState";
import { catnipSeasonalFactor } from "@/model";
import { guardActions, isSafe } from "@/policy/guard";
import type { Action } from "@/model";

function freshHealthyState() {
  // A baseline state where every guarded resource is comfortably positive.
  // We can then perturb it per-test to exercise specific guard branches.
  const s = initialState();
  s.info.flow.production.catnip = 5.0;
  s.info.flow.consumption.catnip = 1.0;
  s.info.flow.perTick.catnip = 4.0;
  s.info.flow.catnipSeasonalFactor = catnipSeasonalFactor(0, "neutral");
  s.info.flow.perTick.wood = 1.5;
  s.info.flow.perTick.minerals = 1.5;
  s.info.flow.perTick.iron = 0.5;
  s.info.flow.perTick.coal = 0.2;
  s.info.flow.perTick.gold = 0.05;
  s.info.flow.perTick.titanium = 0.05;
  s.info.flow.perTick.oil = 0.5;
  s.info.flow.perTick.uranium = 0.05;
  s.info.energy = 5;
  s.info.flow.energyNet = 5;
  return s;
}

describe("NetFlowGuard (Phase 2)", () => {
  it("wait is always safe", () => {
    const s = initialState();
    expect(isSafe(s, { kind: "wait" })).toBe(true);
  });

  it("a no-flow-effect action passes when current flow is already healthy", () => {
    const s = freshHealthyState();
    expect(isSafe(s, { kind: "research", tech: "calendar" } as Action)).toBe(true);
  });

  it("a no-flow-effect action passes even when current flow is below margin (we only veto when the action is the cause)", () => {
    const s = freshHealthyState();
    s.info.flow.perTick.wood = -0.5; // already in deficit; not this action's fault
    expect(isSafe(s, { kind: "research", tech: "calendar" } as Action)).toBe(true);
  });

  it("rejects a smelter that would tip wood below the 0.1/tick margin", () => {
    const s = freshHealthyState();
    s.info.flow.perTick.wood = 0.12; // tight; smelter is -0.05/tick
    expect(isSafe(s, { kind: "build", building: "smelter" } as Action)).toBe(false);
  });

  it("accepts a smelter when wood/minerals have plenty of headroom", () => {
    const s = freshHealthyState();
    s.info.flow.perTick.wood = 5.0;
    s.info.flow.perTick.minerals = 5.0;
    expect(isSafe(s, { kind: "build", building: "smelter" } as Action)).toBe(true);
  });

  it("rejects a calciner that would tip minerals below margin", () => {
    const s = freshHealthyState();
    s.info.flow.perTick.minerals = 1.0; // calciner is -1.5/tick on minerals
    expect(isSafe(s, { kind: "build", building: "calciner" } as Action)).toBe(false);
  });

  it("rejects a magneto that would tip oil negative", () => {
    const s = freshHealthyState();
    s.info.flow.perTick.oil = 0.04; // magneto is -0.05/tick
    expect(isSafe(s, { kind: "build", building: "magneto" } as Action)).toBe(false);
  });

  it("rejects a reactor that would tip uranium negative", () => {
    const s = freshHealthyState();
    s.info.flow.perTick.uranium = 0.0005; // reactor is -0.001/tick
    expect(isSafe(s, { kind: "build", building: "reactor" } as Action)).toBe(false);
  });

  it("rejects a factory that would tip energy negative", () => {
    const s = freshHealthyState();
    s.info.energy = 1;
    s.info.flow.energyNet = 1; // factory is -2 energy
    expect(isSafe(s, { kind: "build", building: "factory" } as Action)).toBe(false);
  });

  it("accepts a factory when there is enough energy headroom", () => {
    const s = freshHealthyState();
    s.info.energy = 10;
    s.info.flow.energyNet = 10;
    expect(isSafe(s, { kind: "build", building: "factory" } as Action)).toBe(true);
  });

  it("accepts producers like field/oilWell/quarry without issue", () => {
    const s = freshHealthyState();
    expect(isSafe(s, { kind: "build", building: "field" } as Action)).toBe(true);
    expect(isSafe(s, { kind: "build", building: "oilWell" } as Action)).toBe(true);
    expect(isSafe(s, { kind: "build", building: "quarry" } as Action)).toBe(true);
  });

  it("accepts pasture/unicornPasture which only reduce catnip demand", () => {
    const s = freshHealthyState();
    expect(isSafe(s, { kind: "build", building: "pasture" } as Action)).toBe(true);
    expect(isSafe(s, { kind: "build", building: "unicornPasture" } as Action)).toBe(true);
  });

  it("rejects builds that tip catnip negative under winter+cold projection", () => {
    const s = freshHealthyState();
    // Spring net is +4.0 catnip; winter+cold rescales production by 0.2125/1.5,
    // so projected production = 5.0 * 0.2125/1.5 = 0.7083; net = 0.7083 - 1.0
    // = -0.292. So winter is already negative; a no-effect action passes
    // (not this action's fault). A biolab (-1 catnip) makes it worse → block.
    expect(isSafe(s, { kind: "build", building: "biolab" } as Action)).toBe(false);
  });

  it("guardActions filters a list", () => {
    const s = freshHealthyState();
    s.info.flow.perTick.wood = 0.12;
    const actions: Action[] = [
      { kind: "wait" },
      { kind: "build", building: "smelter" } as Action,
      { kind: "build", building: "field" } as Action,
    ];
    const safe = guardActions(s, actions);
    expect(safe).toHaveLength(2); // wait + field; smelter blocked
    expect(safe.find((a) => a.kind === "build" && a.building === "smelter")).toBeUndefined();
  });
});
