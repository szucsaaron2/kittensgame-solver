import { describe, it, expect } from "vitest";
import { initialState, goal, goalReport } from "@/model";
import { winningState } from "../helpers/winningState";
import {
  BUILDING_NAMES,
  BUILDING_META,
  TECH_NAMES,
  TECH_META,
  WORKSHOP_NAMES,
  WORKSHOP_META,
  POLICY_NAMES,
  POLICY_META,
  CIV_NAMES,
  PACT_TIERS_MAX,
} from "@/model/catalogs";

describe("goal predicate", () => {
  it("returns false on initial state", () => {
    expect(goal(initialState())).toBe(false);
  });

  it("returns true on hand-crafted winning state", () => {
    expect(goal(winningState())).toBe(true);
  });

  it("returns false if any single in-scope building is missing", () => {
    const s = winningState();
    const first = BUILDING_NAMES.find((n) => BUILDING_META[n].inScope);
    expect(first).toBeDefined();
    s.physical.buildings[first!] = 0;
    const r = goalReport(s);
    expect(r.satisfied).toBe(false);
    expect(r.unsatisfiedBuildings).toContain(first);
  });

  it("returns false if any single in-scope tech is missing", () => {
    const s = winningState();
    const first = TECH_NAMES.find((n) => TECH_META[n].inScope);
    expect(first).toBeDefined();
    s.info.techs[first!] = false;
    expect(goal(s)).toBe(false);
  });

  it("returns false if any single workshop upgrade is missing", () => {
    const s = winningState();
    const first = WORKSHOP_NAMES.find((n) => WORKSHOP_META[n].inScope);
    expect(first).toBeDefined();
    s.info.workshop[first!] = false;
    expect(goal(s)).toBe(false);
  });

  it("ignores out-of-scope (paragon/karma-gated) techs", () => {
    const s = winningState();
    const oos = TECH_NAMES.find((n) => !TECH_META[n].inScope);
    if (oos) {
      s.info.techs[oos] = false;
      expect(goal(s)).toBe(true);
    }
  });

  it("requires every in-scope policy to be researched", () => {
    const s = winningState();
    const inScope = POLICY_NAMES.find((p) => POLICY_META[p].inScope);
    expect(inScope).toBeDefined();
    s.info.policies[inScope!] = false;
    expect(goal(s)).toBe(false);
    expect(goalReport(s).unsatisfiedPolicies).toContain(inScope);
  });

  it("ignores civs without a tiered pact", () => {
    const s = winningState();
    const civWithoutPact = CIV_NAMES.find((c) => (PACT_TIERS_MAX[c] ?? 0) === 0);
    if (civWithoutPact) {
      s.info.pactTiers[civWithoutPact] = 0;
      expect(goal(s)).toBe(true);
    }
  });
});
