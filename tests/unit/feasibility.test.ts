import { describe, it, expect } from "vitest";
import { feasible, feasibilityReport, initialState } from "@/model";

describe("feasibility", () => {
  describe("wait", () => {
    it("always feasible", () => {
      expect(feasible(initialState(), { kind: "wait" })).toBe(true);
    });
  });

  describe("build", () => {
    it("infeasible without resources", () => {
      expect(feasible(initialState(), { kind: "build", building: "field" })).toBe(false);
    });
    it("infeasible without unlock", () => {
      const s = initialState();
      s.physical.resources.catnip = 1000;
      // unlock flag is false in initialState
      expect(feasible(s, { kind: "build", building: "field" })).toBe(false);
    });
    it("feasible with resources, unlock, and cap", () => {
      const s = initialState();
      s.physical.resources.catnip = 1000;
      s.physical.resourceCaps.catnip = 5000;
      s.info.unlocked.buildings.field = true;
      expect(feasible(s, { kind: "build", building: "field" })).toBe(true);
    });
    it("infeasible if cap below cost", () => {
      const s = initialState();
      s.physical.resources.catnip = 1000;
      s.physical.resourceCaps.catnip = 1;
      s.info.unlocked.buildings.field = true;
      expect(feasible(s, { kind: "build", building: "field" })).toBe(false);
    });
  });

  describe("research", () => {
    it("infeasible without science", () => {
      expect(feasible(initialState(), { kind: "research", tech: "calendar" })).toBe(false);
    });
    it("infeasible if already researched", () => {
      const s = initialState();
      s.info.techs.calendar = true;
      s.info.unlocked.techs.calendar = true;
      s.physical.resources.science = 999_999;
      expect(feasible(s, { kind: "research", tech: "calendar" })).toBe(false);
    });
    it("feasible when funded, unlocked, and not yet researched", () => {
      const s = initialState();
      s.info.unlocked.techs.calendar = true;
      s.physical.resources.science = 999_999;
      s.physical.resourceCaps.science = 1_000_000;
      expect(feasible(s, { kind: "research", tech: "calendar" })).toBe(true);
    });
  });

  describe("workshop", () => {
    it("infeasible if already purchased", () => {
      const s = initialState();
      s.info.workshop.mineralHoes = true;
      s.info.unlocked.workshop.mineralHoes = true;
      s.physical.resources.minerals = 999_999;
      s.physical.resources.science = 999_999;
      expect(feasible(s, { kind: "workshop", upgrade: "mineralHoes" })).toBe(false);
    });
  });

  describe("religion-upgrade", () => {
    it("infeasible without faith", () => {
      const s = initialState();
      s.info.unlocked.religion.solarchant = true;
      expect(feasible(s, { kind: "religion-upgrade", upgrade: "solarchant" })).toBe(false);
    });
  });

  describe("praise", () => {
    it("infeasible without faith", () => {
      expect(feasible(initialState(), { kind: "praise" })).toBe(false);
    });
    it("feasible with faith", () => {
      const s = initialState();
      s.physical.resources.faith = 10;
      expect(feasible(s, { kind: "praise" })).toBe(true);
    });
  });

  describe("hunt", () => {
    it("requires 100 catpower", () => {
      const s = initialState();
      s.physical.resources.manpower = 50;
      expect(feasible(s, { kind: "hunt" })).toBe(false);
      s.physical.resources.manpower = 150;
      expect(feasible(s, { kind: "hunt" })).toBe(true);
    });
  });

  describe("observe", () => {
    it("requires astronomical event", () => {
      expect(feasible(initialState(), { kind: "observe" })).toBe(false);
      const s = initialState();
      s.info.astronomicalEvent = true;
      expect(feasible(s, { kind: "observe" })).toBe(true);
    });
  });

  describe("assign", () => {
    it("infeasible if total exceeds kittens", () => {
      const s = initialState();
      s.physical.kittens.total = 3;
      s.info.unlocked.jobs.woodcutter = true;
      expect(feasible(s, { kind: "assign", jobs: { woodcutter: 5 } })).toBe(false);
    });
    it("feasible at exactly capacity with unlocked job", () => {
      const s = initialState();
      s.physical.kittens.total = 3;
      s.info.unlocked.jobs.woodcutter = true;
      expect(feasible(s, { kind: "assign", jobs: { woodcutter: 3 } })).toBe(true);
    });
    it("infeasible if job not unlocked", () => {
      const s = initialState();
      s.physical.kittens.total = 3;
      expect(feasible(s, { kind: "assign", jobs: { priest: 1 } })).toBe(false);
    });
  });

  describe("trade", () => {
    it("infeasible if civ not discovered", () => {
      expect(feasible(initialState(), { kind: "trade", civ: "zebras", caravans: 1 })).toBe(false);
    });
    it("infeasible without catpower or gold", () => {
      const s = initialState();
      s.info.diplomacyDiscovered.zebras = true;
      expect(feasible(s, { kind: "trade", civ: "zebras", caravans: 1 })).toBe(false);
    });
  });

  describe("pact", () => {
    it("non-leviathan civs infeasible", () => {
      const s = initialState();
      s.info.diplomacyDiscovered.zebras = true;
      expect(feasible(s, { kind: "pact", civ: "zebras" })).toBe(false);
    });
  });

  describe("policy", () => {
    it("infeasible if blocked", () => {
      const s = initialState();
      s.info.policyBlocked.tradition = true;
      s.info.unlocked.policies.tradition = true;
      s.physical.resources.culture = 9999;
      expect(feasible(s, { kind: "policy", policy: "tradition" })).toBe(false);
    });
  });

  describe("craft", () => {
    it("rejects unknown craft", () => {
      const s = initialState();
      // @ts-expect-error testing runtime guard against bogus value
      expect(feasible(s, { kind: "craft", item: "nonsense", amount: 1 })).toBe(false);
    });
    it("rejects bad amount", () => {
      expect(feasible(initialState(), { kind: "craft", item: "wood", amount: 0 })).toBe(false);
    });
  });

  describe("space-launch", () => {
    it("infeasible if already completed", () => {
      const s = initialState();
      s.physical.spaceProgramsCompleted.orbitalLaunch = true;
      s.physical.resources.science = 999_999;
      s.physical.resources.oil = 999_999;
      expect(feasible(s, { kind: "space-launch", mission: "orbitalLaunch" })).toBe(false);
    });
  });

  describe("time-skip", () => {
    it("rejects non-positive years", () => {
      expect(feasible(initialState(), { kind: "time-skip", years: 0 })).toBe(false);
    });
  });

  describe("appoint-leader", () => {
    it("rejects out-of-range index", () => {
      expect(feasible(initialState(), { kind: "appoint-leader", kittenIndex: 5 })).toBe(false);
    });
  });

  describe("promote-leader", () => {
    it("infeasible without leader", () => {
      expect(feasible(initialState(), { kind: "promote-leader" })).toBe(false);
    });
  });

  describe("refine actions", () => {
    it("refine-tears infeasible without tears", () => {
      expect(feasible(initialState(), { kind: "refine-tears" })).toBe(false);
    });
    it("refine-tc infeasible without time crystals", () => {
      expect(feasible(initialState(), { kind: "refine-tc" })).toBe(false);
    });
  });

  describe("feasibilityReport", () => {
    it("returns reasons for infeasibility", () => {
      const r = feasibilityReport(initialState(), { kind: "build", building: "field" });
      expect(r.ok).toBe(false);
      expect(r.reasons.length).toBeGreaterThan(0);
    });
  });
});
