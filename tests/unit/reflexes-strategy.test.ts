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
  function readyState(rank = 0, exp = 1e6, gold = 1e6) {
    const s = initialState();
    s.info.workshop.register = true;
    s.physical.kittens.leader = { job: "scholar", trait: "manager", rank, exp };
    s.physical.resources.gold = gold;
    return s;
  }

  it("does not fire without a leader", () => {
    const s = initialState();
    s.info.workshop.register = true;
    expect(autoPromoteLeaderReflex(s)).toBeNull();
  });

  it("does not fire if `register` workshop upgrade is not researched", () => {
    const s = readyState();
    s.info.workshop.register = false;
    expect(autoPromoteLeaderReflex(s)).toBeNull();
  });

  it("fires when leader has enough gold and enough exp", () => {
    const s = readyState(0, 500, 25);
    expect(autoPromoteLeaderReflex(s)).toEqual({ kind: "promote-leader" });
  });

  it("does not fire when gold is short of 25 × (rank+1)", () => {
    const s = readyState(0, 500, 24);
    expect(autoPromoteLeaderReflex(s)).toBeNull();
  });

  it("does not fire when kitten exp is short of 500 × 1.75^rank", () => {
    const s = readyState(0, 499, 1e6);
    expect(autoPromoteLeaderReflex(s)).toBeNull();
  });

  it("respects rank-scaled costs (rank 3 needs 100 gold and 500×1.75^3 ≈ 2680 exp)", () => {
    const s = readyState(3, 2700, 100);
    expect(autoPromoteLeaderReflex(s)).toEqual({ kind: "promote-leader" });

    const tooLittleGold = readyState(3, 2700, 99);
    expect(autoPromoteLeaderReflex(tooLittleGold)).toBeNull();

    const tooLittleExp = readyState(3, 2679, 100);
    expect(autoPromoteLeaderReflex(tooLittleExp)).toBeNull();
  });

  it("caps out at rank 10", () => {
    const s = readyState(10, 1e9, 1e9);
    expect(autoPromoteLeaderReflex(s)).toBeNull();
  });
});
