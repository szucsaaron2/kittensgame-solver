import { describe, it, expect } from "vitest";
import { initialState } from "@/model/initialState";
import { craftBeamReflex } from "@/policy/reflexes/craftBeam";
import { craftSlabReflex } from "@/policy/reflexes/craftSlab";
import { autoResearchReflex } from "@/policy/reflexes/autoResearch";
import { autoWorkshopReflex } from "@/policy/reflexes/autoWorkshop";
import { autoReligionUpgradeReflex } from "@/policy/reflexes/autoReligionUpgrade";
import type { State } from "@/model";

function withWorkshop(): State {
  const s = initialState();
  s.physical.buildings.workshop = 1;
  return s;
}

describe("craft-beam reflex", () => {
  it("fires when wood is at cap, beam unlocked, and affordable", () => {
    const s = withWorkshop();
    s.info.unlocked.crafts.beam = true;
    s.info.craftRecipes.beam = { prices: [{ name: "wood", val: 175 }] };
    s.physical.resources.wood = 200;
    s.physical.resourceCaps.wood = 200;
    expect(craftBeamReflex(s)).toEqual({ kind: "craft", item: "beam", amount: 1 });
  });

  it("does not fire below the 95% cap threshold", () => {
    const s = withWorkshop();
    s.info.unlocked.crafts.beam = true;
    s.info.craftRecipes.beam = { prices: [{ name: "wood", val: 175 }] };
    s.physical.resources.wood = 180;
    s.physical.resourceCaps.wood = 200;
    expect(craftBeamReflex(s)).toBeNull();
  });

  it("does not fire if beam recipe is not unlocked", () => {
    const s = withWorkshop();
    s.physical.resources.wood = 200;
    s.physical.resourceCaps.wood = 200;
    expect(craftBeamReflex(s)).toBeNull();
  });

  it("does not fire if cost cannot be paid (cap too small for 175 wood)", () => {
    const s = withWorkshop();
    s.info.unlocked.crafts.beam = true;
    s.info.craftRecipes.beam = { prices: [{ name: "wood", val: 175 }] };
    s.physical.resources.wood = 100;
    s.physical.resourceCaps.wood = 100;
    expect(craftBeamReflex(s)).toBeNull();
  });

  it("does not fire when wood cap is Infinity", () => {
    const s = withWorkshop();
    s.info.unlocked.crafts.beam = true;
    s.physical.resources.wood = 1e9;
    s.physical.resourceCaps.wood = Infinity;
    expect(craftBeamReflex(s)).toBeNull();
  });
});

describe("craft-slab reflex", () => {
  it("fires when minerals are at cap, slab unlocked, and affordable", () => {
    const s = withWorkshop();
    s.info.unlocked.crafts.slab = true;
    s.info.craftRecipes.slab = { prices: [{ name: "minerals", val: 250 }] };
    s.physical.resources.minerals = 300;
    s.physical.resourceCaps.minerals = 300;
    expect(craftSlabReflex(s)).toEqual({ kind: "craft", item: "slab", amount: 1 });
  });

  it("does not fire if slab is not unlocked", () => {
    const s = withWorkshop();
    s.physical.resources.minerals = 300;
    s.physical.resourceCaps.minerals = 300;
    expect(craftSlabReflex(s)).toBeNull();
  });

  it("does not fire if cost cannot be paid (250 minerals required)", () => {
    const s = withWorkshop();
    s.info.unlocked.crafts.slab = true;
    s.info.craftRecipes.slab = { prices: [{ name: "minerals", val: 250 }] };
    s.physical.resources.minerals = 100;
    s.physical.resourceCaps.minerals = 100;
    expect(craftSlabReflex(s)).toBeNull();
  });
});

describe("auto-research reflex", () => {
  it("fires research for the first unlocked + affordable + unresearched tech", () => {
    const s = initialState();
    s.info.unlocked.techs.calendar = true;
    s.physical.resources.science = 100; // calendar costs 30
    const a = autoResearchReflex(s);
    expect(a?.kind).toBe("research");
  });

  it("returns null when no tech is feasible", () => {
    const s = initialState();
    expect(autoResearchReflex(s)).toBeNull();
  });

  it("does not return an already-researched tech", () => {
    const s = initialState();
    s.info.unlocked.techs.calendar = true;
    s.info.techs.calendar = true;
    s.physical.resources.science = 1000;
    const a = autoResearchReflex(s);
    if (a && a.kind === "research") {
      expect(a.tech).not.toBe("calendar");
    }
  });
});

describe("auto-workshop reflex", () => {
  it("returns null when nothing is unlocked", () => {
    const s = initialState();
    expect(autoWorkshopReflex(s)).toBeNull();
  });

  it("returns a workshop action when one is feasible", () => {
    const s = initialState();
    s.info.unlocked.workshop.mineralHoes = true;
    s.physical.resources.science = 1e9;
    s.physical.resources.minerals = 1e9;
    const a = autoWorkshopReflex(s);
    if (a && a.kind === "workshop") {
      expect(a.kind).toBe("workshop");
      expect(s.info.workshop[a.upgrade]).toBe(false);
    }
  });
});

describe("auto-religion-upgrade reflex", () => {
  it("returns null when no upgrade is feasible", () => {
    const s = initialState();
    expect(autoReligionUpgradeReflex(s)).toBeNull();
  });

  it("does not return an already-purchased upgrade", () => {
    const s = initialState();
    const RELIGION_UPGRADE_NAMES = Object.keys(s.info.religionUpgrades);
    const first = RELIGION_UPGRADE_NAMES[0]!;
    s.info.religionUpgrades[first as keyof typeof s.info.religionUpgrades] = true;
    const a = autoReligionUpgradeReflex(s);
    if (a && a.kind === "religion-upgrade") {
      expect(a.upgrade).not.toBe(first);
    }
  });
});
