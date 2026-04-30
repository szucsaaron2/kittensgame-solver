import { describe, it, expect } from "vitest";
import { initialState } from "@/model/initialState";
import { observeReflex } from "@/policy/reflexes/observe";
import { huntReflex } from "@/policy/reflexes/hunt";
import { praiseReflex } from "@/policy/reflexes/praise";
import { festivalReflex } from "@/policy/reflexes/festival";

describe("Layer-1 reflexes (Phase 3)", () => {
  describe("observe", () => {
    it("fires when astronomicalEvent is set", () => {
      const s = initialState();
      s.info.astronomicalEvent = true;
      expect(observeReflex(s)).toEqual({ kind: "observe" });
    });

    it("returns null otherwise", () => {
      const s = initialState();
      s.info.astronomicalEvent = false;
      expect(observeReflex(s)).toBeNull();
    });
  });

  describe("hunt", () => {
    it("fires when manpower is at cap and feasibility passes", () => {
      const s = initialState();
      s.physical.resources.manpower = 200;
      s.physical.resourceCaps.manpower = 200;
      expect(huntReflex(s)).toEqual({ kind: "hunt" });
    });

    it("does not fire below cap", () => {
      const s = initialState();
      s.physical.resources.manpower = 199;
      s.physical.resourceCaps.manpower = 200;
      expect(huntReflex(s)).toBeNull();
    });

    it("does not fire when cap is infinite (uncapped)", () => {
      const s = initialState();
      s.physical.resources.manpower = 1000;
      s.physical.resourceCaps.manpower = Infinity;
      expect(huntReflex(s)).toBeNull();
    });

    it("does not fire when feasibility fails (catpower < 100)", () => {
      const s = initialState();
      s.physical.resources.manpower = 50;
      s.physical.resourceCaps.manpower = 50;
      expect(huntReflex(s)).toBeNull();
    });
  });

  describe("praise", () => {
    it("fires when faith is at ≥ 99% of cap", () => {
      const s = initialState();
      s.info.techs.theology = true;
      s.physical.resources.faith = 99;
      s.physical.resourceCaps.faith = 100;
      expect(praiseReflex(s)).toEqual({ kind: "praise" });
    });

    it("does not fire below the 99% threshold", () => {
      const s = initialState();
      s.info.techs.theology = true;
      s.physical.resources.faith = 98.5;
      s.physical.resourceCaps.faith = 100;
      expect(praiseReflex(s)).toBeNull();
    });

    it("does not fire when theology is not researched (feasibility veto)", () => {
      const s = initialState();
      s.physical.resources.faith = 100;
      s.physical.resourceCaps.faith = 100;
      expect(praiseReflex(s)).toBeNull();
    });

    it("does not fire when faith cap is infinite or zero", () => {
      const s = initialState();
      s.info.techs.theology = true;
      s.physical.resources.faith = 100;
      s.physical.resourceCaps.faith = Infinity;
      expect(praiseReflex(s)).toBeNull();
      s.physical.resourceCaps.faith = 0;
      expect(praiseReflex(s)).toBeNull();
    });
  });

  describe("festival", () => {
    it("fires when timer is 0 and mats + tech are present", () => {
      const s = initialState();
      s.info.festivalRemaining = 0;
      s.info.techs.drama = true;
      s.physical.resources.manpower = 1500;
      s.physical.resources.culture = 5000;
      s.physical.resources.parchment = 2500;
      expect(festivalReflex(s)).toEqual({ kind: "festival" });
    });

    it("does not fire while a festival is still active", () => {
      const s = initialState();
      s.info.festivalRemaining = 100;
      s.info.techs.drama = true;
      s.physical.resources.manpower = 1500;
      s.physical.resources.culture = 5000;
      s.physical.resources.parchment = 2500;
      expect(festivalReflex(s)).toBeNull();
    });

    it("does not fire when materials are short", () => {
      const s = initialState();
      s.info.festivalRemaining = 0;
      s.info.techs.drama = true;
      s.physical.resources.manpower = 100;
      expect(festivalReflex(s)).toBeNull();
    });
  });
});
