import { describe, it, expect } from "vitest";
import { initialState } from "@/model/initialState";
import {
  chooseJobs,
  farmerFloor,
  priorityLadder,
  projectedWinterCatnipNet,
  jobAssignmentSubsystem,
} from "@/policy/subsystems/jobs";
import { catnipSeasonalFactor } from "@/model";
import type { State } from "@/model";

function baseState(): State {
  const s = initialState();
  s.info.flow.catnipSeasonalFactor = catnipSeasonalFactor(0, "neutral"); // spring
  return s;
}

function unlockJobs(s: State, ...jobs: ReadonlyArray<keyof typeof s.info.unlocked.jobs>): void {
  for (const j of jobs) s.info.unlocked.jobs[j] = true;
}

describe("JobAssignment subsystem (Phase 6)", () => {
  describe("farmerFloor", () => {
    it("returns 0 when there are no kittens", () => {
      const s = baseState();
      expect(farmerFloor(s)).toBe(0);
    });

    it("returns 0 when winter net is already positive without farmers", () => {
      const s = baseState();
      s.physical.kittens.total = 5;
      // Plenty of fields handling all winter consumption.
      s.info.flow.production.catnip = 100; // current-season production
      s.info.flow.consumption.catnip = 5;
      s.info.flow.perTick.catnip = 95;
      s.info.flow.catnipPerFarmer = 1.5;
      // Winter projection: 100 * 0.2125/1.5 = 14.17 > 5 consumption ⇒ net > 0.
      expect(farmerFloor(s)).toBe(0);
    });

    it("binary-searches the smallest farmer count that keeps winter catnip non-negative", () => {
      const s = baseState();
      s.physical.kittens.total = 10;
      // Set up so 0 farmers → winter deficit, but a few farmers fix it.
      // Spring production = 0 (no fields, no farmers); consumption = 4.0
      // (4 kittens-worth conceptually).
      s.physical.kittens.jobs.farmer = 0;
      s.info.flow.production.catnip = 0;
      s.info.flow.consumption.catnip = 4.0;
      s.info.flow.perTick.catnip = -4.0;
      // perFarmer at spring = 1.5 (= base 1 * spring factor 1.5).
      s.info.flow.catnipPerFarmer = 1.5;
      // Winter perFarmer = 1.5 * 0.2125/1.5 = 0.2125. Need net ≥ 0 ⇒
      // (n - 0) * 0.2125 + (0 - 4.0) ≥ 0 ⇒ n ≥ 18.82. Since total = 10,
      // farmerFloor returns total (insufficient capacity).
      expect(farmerFloor(s)).toBe(10);
    });

    it("returns the exact floor when capacity is sufficient", () => {
      const s = baseState();
      s.physical.kittens.total = 30;
      s.physical.kittens.jobs.farmer = 0;
      s.info.flow.production.catnip = 0;
      s.info.flow.consumption.catnip = 4.0;
      s.info.flow.perTick.catnip = -4.0;
      s.info.flow.catnipPerFarmer = 1.5;
      // Need n × 0.2125 ≥ 4 ⇒ n ≥ 18.82 ⇒ floor returns 19.
      expect(farmerFloor(s)).toBe(19);
    });

    it("falls back to total kittens when catnipPerFarmer is non-positive", () => {
      const s = baseState();
      s.physical.kittens.total = 5;
      s.info.flow.production.catnip = 0;
      s.info.flow.consumption.catnip = 1;
      s.info.flow.perTick.catnip = -1;
      s.info.flow.catnipPerFarmer = 0;
      expect(farmerFloor(s)).toBe(5);
    });
  });

  describe("priorityLadder", () => {
    it("returns only currently-unlocked jobs (excluding farmer)", () => {
      const s = baseState();
      unlockJobs(s, "farmer", "woodcutter", "scholar", "hunter");
      expect(priorityLadder(s)).toEqual(["scholar", "woodcutter", "hunter"]);
    });

    it("orders by canonical priority", () => {
      const s = baseState();
      unlockJobs(
        s,
        "farmer",
        "woodcutter",
        "scholar",
        "hunter",
        "miner",
        "priest",
        "geologist",
        "engineer",
      );
      expect(priorityLadder(s)).toEqual([
        "scholar",
        "woodcutter",
        "miner",
        "hunter",
        "priest",
        "geologist",
        "engineer",
      ]);
    });
  });

  describe("chooseJobs", () => {
    it("returns all-zero when there are no kittens", () => {
      const s = baseState();
      const v = chooseJobs(s);
      for (const j of Object.keys(v) as Array<keyof typeof v>) {
        expect(v[j]).toBe(0);
      }
    });

    it("assigns the farmer floor first, then distributes remainder", () => {
      const s = baseState();
      s.physical.kittens.total = 10;
      unlockJobs(s, "farmer", "woodcutter", "scholar");
      s.info.techs.archery = false;
      s.info.flow.production.catnip = 0;
      s.info.flow.consumption.catnip = 0.5;
      s.info.flow.perTick.catnip = -0.5;
      s.info.flow.catnipPerFarmer = 1.5;
      // farmerFloor = ceil(0.5/0.2125)=3.
      const v = chooseJobs(s);
      expect(v.farmer).toBe(3);
      expect(v.farmer + v.woodcutter + v.scholar + v.hunter + v.miner + v.priest + v.geologist + v.engineer).toBe(10);
      expect(v.woodcutter + v.scholar).toBe(7);
    });

    it("reserves 1 hunter once archery is researched and there is headroom", () => {
      const s = baseState();
      s.physical.kittens.total = 10;
      unlockJobs(s, "farmer", "woodcutter", "scholar", "hunter");
      s.info.techs.archery = true;
      s.info.flow.production.catnip = 100;
      s.info.flow.consumption.catnip = 0;
      s.info.flow.perTick.catnip = 100;
      s.info.flow.catnipPerFarmer = 1.5;
      const v = chooseJobs(s);
      expect(v.hunter).toBeGreaterThanOrEqual(1);
    });

    it("never starves: chooseJobs always satisfies winter+cold catnip ≥ 0 when feasible", () => {
      const s = baseState();
      s.physical.kittens.total = 30;
      unlockJobs(s, "farmer", "woodcutter", "scholar");
      s.info.flow.production.catnip = 0;
      s.info.flow.consumption.catnip = 3;
      s.info.flow.perTick.catnip = -3;
      s.info.flow.catnipPerFarmer = 1.5;
      const v = chooseJobs(s);
      expect(projectedWinterCatnipNet(s, v.farmer)).toBeGreaterThanOrEqual(0);
    });
  });

  describe("subsystem.trigger", () => {
    it("fires on the very first tick (no prev)", () => {
      const s = baseState();
      s.physical.kittens.total = 3;
      expect(jobAssignmentSubsystem.trigger(s, null)).toBe(true);
    });

    it("fires when the season changes", () => {
      const prev = baseState();
      const s = baseState();
      prev.info.calendar.season = 0;
      s.info.calendar.season = 1;
      expect(jobAssignmentSubsystem.trigger(s, prev)).toBe(true);
    });

    it("fires when kitten count changes", () => {
      const prev = baseState();
      const s = baseState();
      prev.physical.kittens.total = 3;
      s.physical.kittens.total = 4;
      expect(jobAssignmentSubsystem.trigger(s, prev)).toBe(true);
    });

    it("fires when a new job becomes unlocked", () => {
      const prev = baseState();
      const s = baseState();
      unlockJobs(prev, "farmer");
      unlockJobs(s, "farmer", "woodcutter");
      expect(jobAssignmentSubsystem.trigger(s, prev)).toBe(true);
    });

    it("does NOT fire when nothing relevant changed", () => {
      const prev = baseState();
      const s = baseState();
      prev.physical.kittens.total = 3;
      s.physical.kittens.total = 3;
      expect(jobAssignmentSubsystem.trigger(s, prev)).toBe(false);
    });
  });

  describe("subsystem.choose", () => {
    it("returns null when no kittens are present", () => {
      const s = baseState();
      expect(jobAssignmentSubsystem.choose(s)).toBeNull();
    });

    it("returns null when current assignment already matches desired", () => {
      const s = baseState();
      s.physical.kittens.total = 3;
      unlockJobs(s, "farmer", "woodcutter");
      s.info.flow.production.catnip = 100;
      s.info.flow.consumption.catnip = 0;
      s.info.flow.perTick.catnip = 100;
      s.info.flow.catnipPerFarmer = 1.5;
      // chooseJobs returns 3 woodcutters (farmer floor = 0, all to ladder).
      s.physical.kittens.jobs.woodcutter = 3;
      expect(jobAssignmentSubsystem.choose(s)).toBeNull();
    });

    it("emits an assign action when current assignment differs from desired", () => {
      const s = baseState();
      s.physical.kittens.total = 3;
      unlockJobs(s, "farmer", "woodcutter");
      s.info.flow.production.catnip = 100;
      s.info.flow.consumption.catnip = 0;
      s.info.flow.perTick.catnip = 100;
      s.info.flow.catnipPerFarmer = 1.5;
      // Currently all kittens are unassigned.
      s.physical.kittens.jobs.woodcutter = 0;
      const a = jobAssignmentSubsystem.choose(s);
      expect(a?.kind).toBe("assign");
    });
  });
});
