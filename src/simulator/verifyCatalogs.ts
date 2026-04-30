import {
  RESOURCE_NAMES,
  BUILDING_NAMES,
  TECH_NAMES,
  WORKSHOP_NAMES,
  RELIGION_UPGRADE_NAMES,
  ZIGGURAT_NAMES,
  TRANSCENDENCE_NAMES,
  CHRONOFORGE_NAMES,
  VOIDSPACE_NAMES,
  SPACE_PROGRAM_NAMES,
  POLICY_NAMES,
  PRESTIGE_PERK_NAMES,
  JOB_NAMES,
  CIV_NAMES,
  PLANET_NAMES,
  PLANET_BUILDING_NAMES,
} from "@/model/catalogs";

export interface CatalogMismatch {
  catalog: string;
  inCatalogNotInGame: string[];
  inGameNotInCatalog: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function namesFromArray(arr: any): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((x: any) => x?.name as unknown)
    .filter((n: unknown): n is string => typeof n === "string");
}

function compare(
  out: CatalogMismatch[],
  name: string,
  ours: readonly string[],
  theirs: readonly string[],
): void {
  const inCatalogNotInGame = ours.filter((n) => !theirs.includes(n));
  const inGameNotInCatalog = theirs.filter((n) => !ours.includes(n));
  if (inCatalogNotInGame.length || inGameNotInCatalog.length) {
    out.push({ catalog: name, inCatalogNotInGame, inGameNotInCatalog });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function verifyCatalogs(g: any): CatalogMismatch[] {
  const out: CatalogMismatch[] = [];

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  compare(out, "resources", RESOURCE_NAMES, namesFromArray(g.resPool.resources));
  compare(
    out,
    "buildings",
    BUILDING_NAMES,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    namesFromArray(g.bld.buildingsData ?? g.bld.meta?.[0]?.meta),
  );
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  compare(out, "techs", TECH_NAMES, namesFromArray(g.science.techs));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  compare(out, "workshop", WORKSHOP_NAMES, namesFromArray(g.workshop.upgrades));
  compare(
    out,
    "religionUpgrades",
    RELIGION_UPGRADE_NAMES,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    namesFromArray(g.religion.religionUpgrades),
  );
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  compare(out, "ziggurat", ZIGGURAT_NAMES, namesFromArray(g.religion.zigguratUpgrades));
  compare(
    out,
    "transcendence",
    TRANSCENDENCE_NAMES,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    namesFromArray(g.religion.transcendenceUpgrades),
  );
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  compare(out, "chronoforge", CHRONOFORGE_NAMES, namesFromArray(g.time.chronoforgeUpgrades));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  compare(out, "voidspace", VOIDSPACE_NAMES, namesFromArray(g.time.voidspaceUpgrades));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  compare(out, "spacePrograms", SPACE_PROGRAM_NAMES, namesFromArray(g.space.programs));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  compare(out, "policies", POLICY_NAMES, namesFromArray(g.science.policies));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  compare(out, "prestigePerks", PRESTIGE_PERK_NAMES, namesFromArray(g.prestige?.perks));

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
  const liveJobs = namesFromArray(g.village.jobs ?? g.village.sim?.jobs);
  compare(out, "jobs", JOB_NAMES, liveJobs);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  compare(out, "civs", CIV_NAMES, namesFromArray(g.diplomacy.races));

  // Planets:
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
  const planets = (g.space.planets ?? []) as Array<{ name: string; buildings: unknown }>;
  const livePlanetNames = planets.map((p) => p.name);
  compare(out, "planets", PLANET_NAMES, livePlanetNames);
  for (const p of planets) {
    const ours = (PLANET_BUILDING_NAMES as Record<string, readonly string[]>)[p.name] ?? [];
    const theirs = namesFromArray(p.buildings);
    compare(out, `planet:${p.name}`, ours, theirs);
  }

  return out;
}
