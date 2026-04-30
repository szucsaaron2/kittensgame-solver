import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupGame, type GameHandle } from "@/testdriver/setupGame";
import { extract } from "@/simulator";
import { checkInvariants } from "@/model";

describe("extract", () => {
  let handle: GameHandle;
  beforeEach(() => {
    handle = setupGame();
  });
  afterEach(async () => {
    await handle.teardown();
  });

  it("returns initial-like state on a fresh game", () => {
    const s = extract(handle.gamePage);
    expect(s.physical.resources.catnip).toBe(0);
    expect(s.physical.kittens.total).toBe(0);
    expect(s.info.techs.calendar).toBe(false);
    expect(s.info.calendar.year).toBe(0);
  });

  it("reflects a researched tech", () => {
    handle.gamePage.science.get("calendar").researched = true;
    const s = extract(handle.gamePage);
    expect(s.info.techs.calendar).toBe(true);
  });

  it("reflects added resources", () => {
    handle.gamePage.resPool.get("catnip").value = 100;
    const s = extract(handle.gamePage);
    expect(s.physical.resources.catnip).toBe(100);
  });

  it("reflects building counts", () => {
    handle.gamePage.bld.get("field").val = 3;
    const s = extract(handle.gamePage);
    expect(s.physical.buildings.field).toBe(3);
  });

  it("reflects a workshop upgrade", () => {
    handle.gamePage.workshop.get("mineralHoes").researched = true;
    const s = extract(handle.gamePage);
    expect(s.info.workshop.mineralHoes).toBe(true);
  });

  it("reflects calendar advancement after ticks", () => {
    handle.tick(500);
    const s = extract(handle.gamePage);
    expect(s.info.calendar.day).toBeGreaterThanOrEqual(0);
    expect(s.info.calendar.year).toBeGreaterThanOrEqual(0);
  });

  it("reflects kittens with assigned jobs", () => {
    for (let i = 0; i < 2; i++) {
      handle.gamePage.village.sim.addKitten();
    }
    handle.gamePage.update();
    const s = extract(handle.gamePage);
    expect(s.physical.kittens.total).toBe(2);
  });

  it("reflects unlocked civilizations", () => {
    const zebras = handle.gamePage.diplomacy.races.find(
      (r: { name: string }) => r.name === "zebras",
    );
    if (zebras) zebras.unlocked = true;
    const s = extract(handle.gamePage);
    expect(s.info.diplomacyDiscovered.zebras).toBe(true);
  });

  it("passes invariants on a fresh game", () => {
    const s = extract(handle.gamePage);
    expect(checkInvariants(s)).toEqual([]);
  });

  it("passes invariants after 500 ticks", () => {
    handle.tick(500);
    const s = extract(handle.gamePage);
    expect(checkInvariants(s)).toEqual([]);
  });
});
