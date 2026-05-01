import { describe, it, expect } from "vitest";
import { initialState } from "@/model/initialState";
import {
  unbuiltGoalTTAs,
  goalCompletionTTA,
  infiniteTTAClauseCount,
  cheapestUnbuiltGoalTTA,
} from "@/model";

describe("goalCompletion (Phase 9)", () => {
  it("returns one entry per unbought in-scope goal-clause kind", () => {
    const s = initialState();
    const entries = unbuiltGoalTTAs(s);
    // Should include buildings + techs + workshop + religion + ziggurat +
    // chronoforge + voidspace + space-launch — many entries.
    const kinds = new Set(entries.map((e) => e.kind));
    expect(kinds.has("build")).toBe(true);
    expect(kinds.has("research")).toBe(true);
    expect(kinds.has("workshop")).toBe(true);
    expect(kinds.has("religion-upgrade")).toBe(true);
    expect(kinds.has("space-launch")).toBe(true);
  });

  it("excludes already-bought items", () => {
    const s = initialState();
    const before = unbuiltGoalTTAs(s).filter((e) => e.kind === "research" && e.name === "calendar");
    expect(before.length).toBe(1);
    s.info.techs.calendar = true;
    const after = unbuiltGoalTTAs(s).filter((e) => e.kind === "research" && e.name === "calendar");
    expect(after.length).toBe(0);
  });

  it("excludes already-built buildings (count >= 1)", () => {
    const s = initialState();
    const before = unbuiltGoalTTAs(s).filter((e) => e.kind === "build" && e.name === "field");
    expect(before.length).toBe(1);
    s.physical.buildings.field = 1;
    const after = unbuiltGoalTTAs(s).filter((e) => e.kind === "build" && e.name === "field");
    expect(after.length).toBe(0);
  });

  it("goalCompletionTTA sums only finite-TTA clauses", () => {
    const s = initialState();
    // Fresh state: no flows, almost everything is Infinity.
    const sum = goalCompletionTTA(s);
    // Some items have 0 cost or trivial 30-science costs which are 0 in our
    // state since cap is Infinity but flow is 0 → Infinity. Confirm it's
    // a non-negative finite number (there might be 0-cost items but no
    // affordable-without-flow cases beyond stockpile=0 + cost=0).
    expect(sum).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(sum)).toBe(true);
  });

  it("infiniteTTAClauseCount is large in a fresh state with no flows", () => {
    const s = initialState();
    const n = infiniteTTAClauseCount(s);
    expect(n).toBeGreaterThan(50); // most goals are infeasible from scratch
  });

  it("cheapestUnbuiltGoalTTA reflects the easiest available flip", () => {
    const s = initialState();
    s.physical.resources.science = 30; // exactly affords calendar (30 sci)
    s.info.unlocked.techs.calendar = true; // not strictly required by costTTA
    const cheapest = cheapestUnbuiltGoalTTA(s);
    expect(cheapest).toBe(0);
  });

  it("includes tech-research costs that compete with building costs for science", () => {
    // The whole motivation for this module: techs/workshop drain science /
    // crafts / faith too. Verify biology tech (85000 science + 100 compendium)
    // shows up as a clause.
    const s = initialState();
    const biology = unbuiltGoalTTAs(s).find((e) => e.kind === "research" && e.name === "biology");
    expect(biology).toBeDefined();
    // With zero stockpile/flow biology's TTA is Infinity — but it's enumerated.
    expect(biology?.tta).toBe(Infinity);
  });
});
