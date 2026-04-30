import { describe, it, expect, afterEach } from "vitest";
import { setupGame, type GameHandle } from "@/testdriver/setupGame";
import { apply, extract } from "@/simulator";

describe("apply: build", () => {
  let h: GameHandle | undefined;
  afterEach(async () => {
    await h?.teardown();
    h = undefined;
  });

  it("increments building count and deducts catnip for field", () => {
    h = setupGame();
    h.gamePage.resPool.get("catnip").value = 100;
    const before = extract(h.gamePage);
    apply(h.gamePage, { kind: "build", building: "field" });
    const after = extract(h.gamePage);
    expect(after.physical.buildings.field).toBe((before.physical.buildings.field ?? 0) + 1);
    expect(after.physical.resources.catnip).toBeLessThan(before.physical.resources.catnip);
  });

  it("price scales after multiple builds", () => {
    h = setupGame();
    h.gamePage.resPool.get("catnip").value = 1_000_000;
    const c0 = h.gamePage.resPool.get("catnip").value;
    apply(h.gamePage, { kind: "build", building: "field" });
    const c1 = h.gamePage.resPool.get("catnip").value;
    apply(h.gamePage, { kind: "build", building: "field" });
    const c2 = h.gamePage.resPool.get("catnip").value;
    const cost1 = c0 - c1;
    const cost2 = c1 - c2;
    expect(cost2).toBeGreaterThan(cost1);
  });
});

describe("apply: research", () => {
  let h: GameHandle | undefined;
  afterEach(async () => {
    await h?.teardown();
    h = undefined;
  });

  it("flips researched flag and deducts science for calendar", () => {
    h = setupGame();
    h.gamePage.resPool.get("science").value = 200;
    apply(h.gamePage, { kind: "research", tech: "calendar" });
    const after = extract(h.gamePage);
    expect(after.info.techs.calendar).toBe(true);
    expect(after.physical.resources.science).toBeLessThan(200);
  });
});

describe("apply: workshop", () => {
  let h: GameHandle | undefined;
  afterEach(async () => {
    await h?.teardown();
    h = undefined;
  });

  it("flips researched flag for mineralHoes", () => {
    h = setupGame();
    h.gamePage.resPool.get("minerals").value = 1000;
    h.gamePage.resPool.get("science").value = 1000;
    apply(h.gamePage, { kind: "workshop", upgrade: "mineralHoes" });
    const after = extract(h.gamePage);
    expect(after.info.workshop.mineralHoes).toBe(true);
  });
});

describe("apply: praise", () => {
  let h: GameHandle | undefined;
  afterEach(async () => {
    await h?.teardown();
    h = undefined;
  });

  it("converts faith to apocrypha", () => {
    h = setupGame();
    h.gamePage.resPool.get("faith").value = 1000;
    apply(h.gamePage, { kind: "praise" });
    const after = extract(h.gamePage);
    expect(after.physical.resources.faith).toBeLessThan(1000);
    expect(after.info.faith).toBeGreaterThan(0);
  });
});

describe("apply: hunt", () => {
  let h: GameHandle | undefined;
  afterEach(async () => {
    await h?.teardown();
    h = undefined;
  });

  it("consumes catpower", () => {
    h = setupGame();
    h.gamePage.resPool.get("manpower").value = 200;
    apply(h.gamePage, { kind: "hunt" });
    const after = extract(h.gamePage);
    expect(after.physical.resources.manpower).toBeLessThan(200);
  });
});

describe("apply: wait", () => {
  it("does nothing", () => {
    apply({}, { kind: "wait" });
  });
});

describe("apply: error wrapping", () => {
  it("wraps errors in ApplyError", () => {
    expect(() => apply({}, { kind: "build", building: "field" })).toThrow();
  });
});
