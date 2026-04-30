import { describe, it, expect } from "vitest";
import {
  RESOURCE_NAMES,
  RESOURCE_META,
  BUILDING_NAMES,
  BUILDING_META,
  TECH_NAMES,
  TECH_META,
  WORKSHOP_NAMES,
  WORKSHOP_META,
  POLICY_NAMES,
  POLICY_META,
  CIV_NAMES,
  JOB_NAMES,
  PLANET_NAMES,
  PLANET_BUILDING_NAMES,
  PACT_TIERS_MAX,
} from "@/model/catalogs";

describe("catalog scope flags", () => {
  it("every resource has metadata", () => {
    for (const n of RESOURCE_NAMES) expect(RESOURCE_META[n]).toBeDefined();
  });
  it("every building has metadata", () => {
    for (const n of BUILDING_NAMES) expect(BUILDING_META[n]).toBeDefined();
  });
  it("every tech has metadata", () => {
    for (const n of TECH_NAMES) expect(TECH_META[n]).toBeDefined();
  });
  it("every workshop upgrade has metadata", () => {
    for (const n of WORKSHOP_NAMES) expect(WORKSHOP_META[n]).toBeDefined();
  });
  it("every policy has metadata", () => {
    for (const n of POLICY_NAMES) expect(POLICY_META[n]).toBeDefined();
  });
  it("at least 80% of techs are in scope", () => {
    const inScope = TECH_NAMES.filter((n) => TECH_META[n].inScope).length;
    expect(inScope / TECH_NAMES.length).toBeGreaterThan(0.8);
  });
  it("expected counts roughly match", () => {
    expect(RESOURCE_NAMES.length).toBeGreaterThan(40);
    expect(BUILDING_NAMES.length).toBeGreaterThan(30);
    expect(TECH_NAMES.length).toBeGreaterThan(50);
    expect(WORKSHOP_NAMES.length).toBeGreaterThan(100);
    expect(JOB_NAMES.length).toBe(8);
    expect(CIV_NAMES.length).toBe(8);
    expect(PLANET_NAMES.length).toBeGreaterThan(8);
  });
  it("PACT_TIERS_MAX has an entry per civ", () => {
    for (const c of CIV_NAMES) expect(PACT_TIERS_MAX[c]).toBeDefined();
  });
  it("PLANET_BUILDING_NAMES covers every planet", () => {
    for (const p of PLANET_NAMES) {
      expect(PLANET_BUILDING_NAMES[p]).toBeDefined();
      expect(Array.isArray(PLANET_BUILDING_NAMES[p])).toBe(true);
    }
  });
});
