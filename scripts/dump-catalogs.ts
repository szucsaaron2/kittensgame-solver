/**
 * Boot the game, dump every catalog as JSON to stdout.
 * Run: pnpm tsx scripts/dump-catalogs.ts > /tmp/catalogs.json
 */
import { setupGame } from "@/testdriver/setupGame";

const h = setupGame();
const g = h.gamePage;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function names(arr: any): string[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
  return (arr ?? []).map((x: any) => x?.name).filter((n: unknown): n is string => typeof n === "string");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasParagonOrKarma(entry: any): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
  const prices: unknown = entry?.prices ?? entry?.cost ?? [];
  if (!Array.isArray(prices)) return false;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  return prices.some((p: any) => p?.name === "paragon" || p?.name === "karma");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function namesWithScope(arr: any): Array<{ name: string; inScope: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
  return (arr ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((x: any) => typeof x?.name === "string")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((x: any) => ({ name: x.name as string, inScope: !hasParagonOrKarma(x) }));
}

const out = {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  resources: namesWithScope(g.resPool.resources),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  buildings: namesWithScope(g.bld.buildingsData ?? g.bld.meta?.[0]?.meta),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  techs: namesWithScope(g.science.techs),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  workshop: namesWithScope(g.workshop.upgrades),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  crafts: names(g.workshop.crafts),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  religionUpgrades: namesWithScope(g.religion.religionUpgrades),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  zigguratUpgrades: namesWithScope(g.religion.zigguratUpgrades),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  transcendenceUpgrades: namesWithScope(g.religion.transcendenceUpgrades),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  cryptotheology: namesWithScope(g.religion.cryptotheologyUpgrades),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  pacts: names(g.religion.pacts),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  chronoforge: namesWithScope(g.time.chronoforgeUpgrades),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  voidspace: namesWithScope(g.time.voidspaceUpgrades),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  voidUpgrades: namesWithScope(g.void?.voidUpgrades),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  planets: (g.space.planets ?? []).map((p: any) => ({
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    name: p.name,
    buildings: namesWithScope(p.buildings),
  })),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  spacePrograms: namesWithScope(g.space.programs),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  jobs: names(g.village.jobs ?? g.village.sim?.jobs),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  races: names(g.diplomacy.races),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  policies: namesWithScope(g.science.policies),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  challenges: names(g.challenges?.challenges),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  prestigePerks: namesWithScope(g.prestige?.perks),
};

// eslint-disable-next-line no-console
console.log(JSON.stringify(out, null, 2));
await h.teardown();
