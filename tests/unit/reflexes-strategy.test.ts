import { describe, it, expect } from "vitest";
import { initialState } from "@/model/initialState";
import { autoPolicyReflex } from "@/policy/reflexes/autoPolicy";
import { autoAppointLeaderReflex } from "@/policy/reflexes/autoAppointLeader";
import { autoPromoteLeaderReflex } from "@/policy/reflexes/autoPromoteLeader";

describe("auto-policy reflex", () => {
  it("returns null when no policy is unlocked", () => {
    const s = initialState();
    expect(autoPolicyReflex(s)).toBeNull();
  });

  it("fires the first preferred policy that is feasible", () => {
    const s = initialState();
    s.info.unlocked.policies.liberty = true;
    s.physical.resources.culture = 1000;
    const a = autoPolicyReflex(s);
    expect(a).toEqual({ kind: "policy", policy: "liberty" });
  });

  it("skips already-adopted policies", () => {
    const s = initialState();
    s.info.unlocked.policies.liberty = true;
    s.info.policies.liberty = true;
    s.info.unlocked.policies.monarchy = true;
    s.physical.resources.culture = 100000;
    const a = autoPolicyReflex(s);
    expect(a).toEqual({ kind: "policy", policy: "monarchy" });
  });

  it("skips blocked policies", () => {
    const s = initialState();
    s.info.unlocked.policies.tradition = true;
    s.info.policyBlocked.tradition = true;
    s.physical.resources.culture = 100000;
    expect(autoPolicyReflex(s)).toBeNull();
  });
});

describe("auto-appoint-leader reflex", () => {
  it("does not fire when there are no kittens", () => {
    const s = initialState();
    expect(autoAppointLeaderReflex(s)).toBeNull();
  });

  it("fires when there is at least one kitten and no leader", () => {
    const s = initialState();
    s.physical.kittens.total = 1;
    expect(autoAppointLeaderReflex(s)).toEqual({ kind: "appoint-leader", kittenIndex: 0 });
  });

  it("does not fire when a leader is already appointed", () => {
    const s = initialState();
    s.physical.kittens.total = 5;
    s.physical.kittens.leader = { job: "scholar", trait: "manager", rank: 0, exp: 0 };
    expect(autoAppointLeaderReflex(s)).toBeNull();
  });
});

describe("auto-promote-leader reflex", () => {
  it("does not fire without a leader", () => {
    const s = initialState();
    expect(autoPromoteLeaderReflex(s)).toBeNull();
  });

  it("fires when leader exists and manuscripts are above the rank threshold", () => {
    const s = initialState();
    s.physical.kittens.leader = { job: "scholar", trait: "manager", rank: 0, exp: 0 };
    s.physical.resources.manuscript = 200;
    expect(autoPromoteLeaderReflex(s)).toEqual({ kind: "promote-leader" });
  });

  it("does not fire when manuscripts are below threshold", () => {
    const s = initialState();
    s.physical.kittens.leader = { job: "scholar", trait: "manager", rank: 0, exp: 0 };
    s.physical.resources.manuscript = 50;
    expect(autoPromoteLeaderReflex(s)).toBeNull();
  });

  it("threshold scales with rank", () => {
    const s = initialState();
    s.physical.kittens.leader = { job: "scholar", trait: "manager", rank: 5, exp: 0 };
    // threshold = 100 + 5 * 100 = 600
    s.physical.resources.manuscript = 599;
    expect(autoPromoteLeaderReflex(s)).toBeNull();
    s.physical.resources.manuscript = 600;
    expect(autoPromoteLeaderReflex(s)).toEqual({ kind: "promote-leader" });
  });

  it("caps out at rank 10", () => {
    const s = initialState();
    s.physical.kittens.leader = { job: "scholar", trait: "manager", rank: 10, exp: 0 };
    s.physical.resources.manuscript = 1e9;
    expect(autoPromoteLeaderReflex(s)).toBeNull();
  });
});
