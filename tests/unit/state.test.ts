import { describe, it, expect } from "vitest";
import { initialState, checkInvariants } from "@/model";
import {
  RESOURCE_NAMES,
  BUILDING_NAMES,
  TECH_NAMES,
  JOB_NAMES,
  CIV_NAMES,
  PLANET_NAMES,
  PLANET_BUILDING_NAMES,
} from "@/model/catalogs";

describe("initialState", () => {
  it("populates every catalog key", () => {
    const s = initialState();
    for (const r of RESOURCE_NAMES) expect(s.physical.resources[r]).toBe(0);
    for (const b of BUILDING_NAMES) expect(s.physical.buildings[b]).toBe(0);
    for (const t of TECH_NAMES) expect(s.info.techs[t]).toBe(false);
    for (const j of JOB_NAMES) expect(s.physical.kittens.jobs[j]).toBe(0);
    for (const c of CIV_NAMES) expect(s.physical.embassies[c]).toBe(0);
  });

  it("populates every planet's buildings", () => {
    const s = initialState();
    for (const p of PLANET_NAMES) {
      const planetBuildings = s.physical.spaceBuildings[p];
      expect(planetBuildings).toBeDefined();
      for (const b of PLANET_BUILDING_NAMES[p]) {
        expect(planetBuildings[b]).toBe(0);
      }
    }
  });

  it("starts with zero kittens, no leader", () => {
    const s = initialState();
    expect(s.physical.kittens.total).toBe(0);
    expect(s.physical.kittens.leader).toBeNull();
  });

  it("starts at year 0, spring, day 0, neutral weather", () => {
    const s = initialState();
    expect(s.info.calendar.year).toBe(0);
    expect(s.info.calendar.season).toBe(0);
    expect(s.info.calendar.day).toBe(0);
    expect(s.info.weather).toBe("neutral");
  });

  it("passes invariants", () => {
    expect(checkInvariants(initialState())).toEqual([]);
  });
});
