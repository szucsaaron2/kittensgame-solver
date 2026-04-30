import { describe, it, expect } from "vitest";
import { initialState, enumerateFeasibleActions } from "@/model";

describe("enumerateFeasibleActions", () => {
  it("on initial state always returns wait", () => {
    const actions = enumerateFeasibleActions(initialState());
    expect(actions.some((a) => a.kind === "wait")).toBe(true);
  });

  it("returns build:field when funded and unlocked", () => {
    const s = initialState();
    s.physical.resources.catnip = 1000;
    s.physical.resourceCaps.catnip = 5000;
    s.info.unlocked.buildings.field = true;
    const actions = enumerateFeasibleActions(s);
    expect(actions.some((a) => a.kind === "build" && a.building === "field")).toBe(true);
  });

  it("returns no research before any tech is unlocked", () => {
    const s = initialState();
    s.physical.resources.science = 999_999;
    s.physical.resourceCaps.science = 999_999;
    const actions = enumerateFeasibleActions(s);
    expect(actions.some((a) => a.kind === "research")).toBe(false);
  });

  it("returns more actions as state advances", () => {
    const s = initialState();
    const before = enumerateFeasibleActions(s).length;
    s.physical.resources.catnip = 1_000_000;
    s.physical.resources.wood = 1_000_000;
    s.physical.resources.minerals = 1_000_000;
    s.physical.resourceCaps.catnip = 10_000_000;
    s.physical.resourceCaps.wood = 10_000_000;
    s.physical.resourceCaps.minerals = 10_000_000;
    s.info.unlocked.buildings.field = true;
    s.info.unlocked.buildings.hut = true;
    s.info.unlocked.buildings.library = true;
    const after = enumerateFeasibleActions(s).length;
    expect(after).toBeGreaterThan(before);
  });
});
