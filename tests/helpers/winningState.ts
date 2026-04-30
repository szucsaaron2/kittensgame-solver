import { initialState } from "@/model";
import type { State } from "@/model";
import {
  BUILDING_META,
  TECH_META,
  WORKSHOP_META,
  RELIGION_UPGRADE_META,
  ZIGGURAT_META,
  CHRONOFORGE_META,
  VOIDSPACE_META,
  SPACE_PROGRAM_META,
  POLICY_META,
  PLANET_NAMES,
  PLANET_BUILDING_META,
  CIV_NAMES,
  PACT_TIERS_MAX,
} from "@/model/catalogs";
import type {
  BuildingName,
  TechName,
  WorkshopName,
  ReligionUpgradeName,
  ZigguratName,
  ChronoforgeName,
  VoidspaceName,
  SpaceProgramName,
  PolicyName,
  CivName,
} from "@/model/catalogs";

export function winningState(): State {
  const s = initialState();
  for (const [name, m] of Object.entries(BUILDING_META)) {
    if (m.inScope) s.physical.buildings[name as BuildingName] = 1;
  }
  for (const [name, m] of Object.entries(TECH_META)) {
    if (m.inScope) s.info.techs[name as TechName] = true;
  }
  for (const [name, m] of Object.entries(WORKSHOP_META)) {
    if (m.inScope) s.info.workshop[name as WorkshopName] = true;
  }
  for (const [name, m] of Object.entries(RELIGION_UPGRADE_META)) {
    if (m.inScope) s.info.religionUpgrades[name as ReligionUpgradeName] = true;
  }
  for (const [name, m] of Object.entries(ZIGGURAT_META)) {
    if (m.inScope) s.physical.zigguratStructures[name as ZigguratName] = 1;
  }
  for (const [name, m] of Object.entries(CHRONOFORGE_META)) {
    if (m.inScope) s.physical.chronoforge[name as ChronoforgeName] = 1;
  }
  for (const [name, m] of Object.entries(VOIDSPACE_META)) {
    if (m.inScope) s.physical.voidspace[name as VoidspaceName] = 1;
  }
  for (const [name, m] of Object.entries(SPACE_PROGRAM_META)) {
    if (m.inScope) s.physical.spaceProgramsCompleted[name as SpaceProgramName] = true;
  }
  for (const planet of PLANET_NAMES) {
    const meta = PLANET_BUILDING_META[planet];
    for (const [name, m] of Object.entries(meta)) {
      if (m.inScope) s.physical.spaceBuildings[planet][name] = 1;
    }
  }
  for (const [name, m] of Object.entries(POLICY_META)) {
    if (m.inScope) s.info.policies[name as PolicyName] = true;
  }
  for (const civ of CIV_NAMES) {
    if ((PACT_TIERS_MAX[civ] ?? 0) > 0) {
      s.info.pactTiers[civ as CivName] = PACT_TIERS_MAX[civ] ?? 0;
    }
  }
  return s;
}
