import type { State } from "@/model/state";
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

export interface GoalReport {
  satisfied: boolean;
  unsatisfiedBuildings: string[];
  unsatisfiedTechs: string[];
  unsatisfiedWorkshop: string[];
  unsatisfiedReligion: string[];
  unsatisfiedZiggurats: string[];
  unsatisfiedSpaceBuildings: string[];
  unsatisfiedSpacePrograms: string[];
  unsatisfiedChronoforge: string[];
  unsatisfiedVoidspace: string[];
  unsatisfiedPolicies: string[];
  unsatisfiedPacts: string[];
}

function inScopeKeys<T extends string>(meta: Record<T, { inScope: boolean }>): T[] {
  return (Object.keys(meta) as T[]).filter((k) => meta[k].inScope);
}

export function goalReport(s: State): GoalReport {
  const unsatisfiedBuildings = inScopeKeys(BUILDING_META).filter(
    (n) => (s.physical.buildings[n as BuildingName] ?? 0) < 1,
  );
  const unsatisfiedTechs = inScopeKeys(TECH_META).filter(
    (n) => !(s.info.techs[n as TechName] ?? false),
  );
  const unsatisfiedWorkshop = inScopeKeys(WORKSHOP_META).filter(
    (n) => !(s.info.workshop[n as WorkshopName] ?? false),
  );
  const unsatisfiedReligion = inScopeKeys(RELIGION_UPGRADE_META).filter(
    (n) => !(s.info.religionUpgrades[n as ReligionUpgradeName] ?? false),
  );
  const unsatisfiedZiggurats = inScopeKeys(ZIGGURAT_META).filter(
    (n) => (s.physical.zigguratStructures[n as ZigguratName] ?? 0) < 1,
  );
  const unsatisfiedChronoforge = inScopeKeys(CHRONOFORGE_META).filter(
    (n) => (s.physical.chronoforge[n as ChronoforgeName] ?? 0) < 1,
  );
  const unsatisfiedVoidspace = inScopeKeys(VOIDSPACE_META).filter(
    (n) => (s.physical.voidspace[n as VoidspaceName] ?? 0) < 1,
  );
  const unsatisfiedSpacePrograms = inScopeKeys(SPACE_PROGRAM_META).filter(
    (n) => !(s.physical.spaceProgramsCompleted[n as SpaceProgramName] ?? false),
  );

  const unsatisfiedSpaceBuildings: string[] = [];
  for (const planet of PLANET_NAMES) {
    const meta = PLANET_BUILDING_META[planet];
    for (const name of Object.keys(meta)) {
      const m = meta[name];
      if (!m || !m.inScope) continue;
      const count = s.physical.spaceBuildings[planet]?.[name] ?? 0;
      if (count < 1) unsatisfiedSpaceBuildings.push(`${planet}/${name}`);
    }
  }

  const unsatisfiedPolicies = inScopeKeys(POLICY_META).filter(
    (n) => !(s.info.policies[n as PolicyName] ?? false),
  );

  const unsatisfiedPacts = CIV_NAMES.filter((c) => (PACT_TIERS_MAX[c] ?? 0) > 0).filter(
    (c) => (s.info.pactTiers[c as CivName] ?? 0) < (PACT_TIERS_MAX[c] ?? 0),
  );

  const satisfied =
    unsatisfiedBuildings.length === 0 &&
    unsatisfiedTechs.length === 0 &&
    unsatisfiedWorkshop.length === 0 &&
    unsatisfiedReligion.length === 0 &&
    unsatisfiedZiggurats.length === 0 &&
    unsatisfiedSpaceBuildings.length === 0 &&
    unsatisfiedSpacePrograms.length === 0 &&
    unsatisfiedChronoforge.length === 0 &&
    unsatisfiedVoidspace.length === 0 &&
    unsatisfiedPolicies.length === 0 &&
    unsatisfiedPacts.length === 0;

  return {
    satisfied,
    unsatisfiedBuildings,
    unsatisfiedTechs,
    unsatisfiedWorkshop,
    unsatisfiedReligion,
    unsatisfiedZiggurats,
    unsatisfiedSpaceBuildings,
    unsatisfiedSpacePrograms,
    unsatisfiedChronoforge,
    unsatisfiedVoidspace,
    unsatisfiedPolicies,
    unsatisfiedPacts,
  };
}

export function goal(s: State): boolean {
  return goalReport(s).satisfied;
}
