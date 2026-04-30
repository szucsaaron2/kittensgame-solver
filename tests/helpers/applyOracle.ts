import { expect } from "vitest";
import { extract, apply } from "@/simulator";
import type { Action, State } from "@/model";
import type { GameHandle } from "@/testdriver/setupGame";

export interface ApplyExpectation {
  buildings?: Partial<Record<string, number>>;
  resourcesDelta?: Partial<Record<string, "down" | "up" | "same">>;
  techs?: Partial<Record<string, boolean>>;
  workshop?: Partial<Record<string, boolean>>;
}

export function applyAndAssert(
  handle: GameHandle,
  action: Action,
  expectation: ApplyExpectation,
): { before: State; after: State } {
  const before = extract(handle.gamePage);
  apply(handle.gamePage, action);
  const after = extract(handle.gamePage);

  if (expectation.buildings) {
    for (const [name, expected] of Object.entries(expectation.buildings)) {
      if (expected !== undefined) {
        expect((after.physical.buildings as Record<string, number>)[name]).toBe(expected);
      }
    }
  }
  if (expectation.resourcesDelta) {
    for (const [name, dir] of Object.entries(expectation.resourcesDelta)) {
      const b = (before.physical.resources as Record<string, number>)[name] ?? 0;
      const a = (after.physical.resources as Record<string, number>)[name] ?? 0;
      if (dir === "down") expect(a).toBeLessThan(b);
      else if (dir === "up") expect(a).toBeGreaterThan(b);
      else expect(a).toBe(b);
    }
  }
  if (expectation.techs) {
    for (const [name, expected] of Object.entries(expectation.techs)) {
      expect((after.info.techs as Record<string, boolean>)[name]).toBe(expected);
    }
  }
  if (expectation.workshop) {
    for (const [name, expected] of Object.entries(expectation.workshop)) {
      expect((after.info.workshop as Record<string, boolean>)[name]).toBe(expected);
    }
  }
  return { before, after };
}
