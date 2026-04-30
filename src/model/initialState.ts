import type { State, KittenState } from "@/model/state";
import {
  RESOURCE_NAMES,
  BUILDING_NAMES,
  ZIGGURAT_NAMES,
  CHRONOFORGE_NAMES,
  VOIDSPACE_NAMES,
  SPACE_PROGRAM_NAMES,
  TECH_NAMES,
  WORKSHOP_NAMES,
  RELIGION_UPGRADE_NAMES,
  TRANSCENDENCE_NAMES,
  POLICY_NAMES,
  CIV_NAMES,
  JOB_NAMES,
  PLANET_NAMES,
  PLANET_BUILDING_NAMES,
} from "@/model/catalogs";

function fillNumber<K extends string>(keys: readonly K[], v: number): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = v;
  return out;
}
function fillBool<K extends string>(keys: readonly K[], v: boolean): Record<K, boolean> {
  const out = {} as Record<K, boolean>;
  for (const k of keys) out[k] = v;
  return out;
}

function initKittens(): KittenState {
  return {
    total: 0,
    jobs: fillNumber(JOB_NAMES, 0),
    skills: fillNumber(JOB_NAMES, 0),
    leader: null,
    freeKittens: 0,
  };
}

export function initialState(): State {
  const spaceBuildings: Record<string, Record<string, number>> = {};
  for (const p of PLANET_NAMES) {
    const planetBuildings: Record<string, number> = {};
    for (const b of PLANET_BUILDING_NAMES[p]) {
      planetBuildings[b] = 0;
    }
    spaceBuildings[p] = planetBuildings;
  }

  return {
    physical: {
      resources: fillNumber(RESOURCE_NAMES, 0),
      resourceCaps: fillNumber(RESOURCE_NAMES, Infinity),
      buildings: fillNumber(BUILDING_NAMES, 0),
      zigguratStructures: fillNumber(ZIGGURAT_NAMES, 0),
      spaceBuildings: spaceBuildings as State["physical"]["spaceBuildings"],
      spaceProgramsCompleted: fillBool(SPACE_PROGRAM_NAMES, false),
      chronoforge: fillNumber(CHRONOFORGE_NAMES, 0),
      voidspace: fillNumber(VOIDSPACE_NAMES, 0),
      embassies: fillNumber(CIV_NAMES, 0),
      kittens: initKittens(),
    },
    info: {
      calendar: { year: 0, season: 0, day: 0, cycle: 0, cycleYear: 0, ticks: 0 },
      weather: "neutral",
      techs: fillBool(TECH_NAMES, false),
      workshop: fillBool(WORKSHOP_NAMES, false),
      religionUpgrades: fillBool(RELIGION_UPGRADE_NAMES, false),
      transcendenceUpgrades: fillNumber(TRANSCENDENCE_NAMES, 0),
      policies: fillBool(POLICY_NAMES, false),
      policyBlocked: fillBool(POLICY_NAMES, false),
      pactTiers: fillNumber(CIV_NAMES, 0),
      diplomacyDiscovered: fillBool(CIV_NAMES, false),
      astronomicalEvent: false,
      festivalRemaining: 0,
      apocrypha: 0,
      faith: 0,
      praiseCount: 0,
      energy: 0,
      happiness: 1.0,
      paragon: 0,
      karma: 0,
    },
    belief: {},
  };
}
