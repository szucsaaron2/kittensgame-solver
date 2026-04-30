import { initialState, catnipSeasonalFactor } from "@/model";
import type { State, Season, Weather } from "@/model";
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
  CIV_NAMES,
  JOB_NAMES,
  PLANET_NAMES,
  PLANET_BUILDING_NAMES,
  CRAFT_NAMES,
} from "@/model/catalogs";
import type {
  ResourceName,
  BuildingName,
  TechName,
  WorkshopName,
  ReligionUpgradeName,
  ZigguratName,
  TranscendenceName,
  ChronoforgeName,
  VoidspaceName,
  SpaceProgramName,
  PolicyName,
  CivName,
  JobName,
} from "@/model/catalogs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return fallback;
}
function bool(v: unknown): boolean {
  return v === true;
}

export function extract(g: Any): State {
  const s = initialState();

  // Resources.
  for (const name of RESOURCE_NAMES) {
     
    const r = g.resPool.get(name);
    if (!r) continue;
    s.physical.resources[name as ResourceName] = num(r.value);
    const cap = num(r.maxValue, 0);
    s.physical.resourceCaps[name as ResourceName] = cap > 0 ? cap : Infinity;
  }

  // Buildings (bonfire / terrestrial).
  for (const name of BUILDING_NAMES) {
    const b = g.bld.get(name);
    if (!b) continue;
    s.physical.buildings[name as BuildingName] = num(b.val);
    s.info.unlocked.buildings[name as BuildingName] = bool(b.unlocked);
  }

  // Techs.
  for (const name of TECH_NAMES) {
    const t = g.science.get(name);
    if (!t) continue;
    s.info.techs[name as TechName] = bool(t.researched);
    s.info.unlocked.techs[name as TechName] = bool(t.unlocked);
  }

  // Workshop upgrades.
  for (const name of WORKSHOP_NAMES) {
    const u = g.workshop.get(name);
    if (!u) continue;
    s.info.workshop[name as WorkshopName] = bool(u.researched);
    s.info.unlocked.workshop[name as WorkshopName] = bool(u.unlocked);
  }

  // Religion: religion upgrades, ziggurat structures, transcendence tier.
  for (const name of RELIGION_UPGRADE_NAMES) {
    const u = g.religion.getRU(name);
    if (!u) continue;
    s.info.religionUpgrades[name as ReligionUpgradeName] = bool(u.researched ?? u.val > 0);
    s.info.unlocked.religion[name as ReligionUpgradeName] = bool(u.unlocked);
  }
  for (const name of ZIGGURAT_NAMES) {
    const z = g.religion.getZU(name);
    if (!z) continue;
    s.physical.zigguratStructures[name as ZigguratName] = num(z.val);
    s.info.unlocked.ziggurat[name as ZigguratName] = bool(z.unlocked);
  }
  for (const name of TRANSCENDENCE_NAMES) {
     
    const t = g.religion.getTU(name);
    if (!t) continue;
    s.info.transcendenceUpgrades[name as TranscendenceName] = num(t.val);
  }

  // Time / chronoforge / voidspace.
  for (const name of CHRONOFORGE_NAMES) {
    const c = g.time.getCFU(name);
    if (!c) continue;
    s.physical.chronoforge[name as ChronoforgeName] = num(c.val);
    s.info.unlocked.chronoforge[name as ChronoforgeName] = bool(c.unlocked);
  }
  for (const name of VOIDSPACE_NAMES) {
    const v = g.time.getVSU(name);
    if (!v) continue;
    s.physical.voidspace[name as VoidspaceName] = num(v.val);
    s.info.unlocked.voidspace[name as VoidspaceName] = bool(v.unlocked);
  }

  // Space — per-planet building counts + space programs (one-time research).
  for (const planet of PLANET_NAMES) {
     
    const p = (g.space.planets as Any[])?.find((x: Any) => x.name === planet);
    if (!p) continue;
    for (const bname of PLANET_BUILDING_NAMES[planet]) {
       
      const b = (p.buildings as Any[]).find((x: Any) => x.name === bname);
      if (!b) continue;
      s.physical.spaceBuildings[planet][bname] = num(b.val);
    }
  }
  for (const name of SPACE_PROGRAM_NAMES) {
     
    const program = (g.space.programs as Any[])?.find((x: Any) => x.name === name);
    if (!program) continue;
    s.physical.spaceProgramsCompleted[name as SpaceProgramName] = bool(program.researched);
  }

  // Policies.
  for (const name of POLICY_NAMES) {
    const p = g.science.getPolicy(name);
    if (!p) continue;
    s.info.policies[name as PolicyName] = bool(p.researched);
    s.info.policyBlocked[name as PolicyName] = bool(p.blocked);
    s.info.unlocked.policies[name as PolicyName] = bool(p.unlocked);
  }

  // Diplomacy + per-race embassy price snapshot.
  // Match upstream EmbassyButtonController.getPrices:
  //   price = base * (1 - embassyCostReduction) * 1.15^(embassyLevel + embassyFakeBought)
  const embassyCostReduction = num(g.getEffect?.("embassyCostReduction"), 0);
  const embassyFakeBought = num(g.getEffect?.("embassyFakeBought"), 0);
  for (const civ of CIV_NAMES) {
    const r = (g.diplomacy.races as Any[])?.find((x: Any) => x.name === civ);
    if (!r) continue;
    s.info.diplomacyDiscovered[civ as CivName] = bool(r.unlocked);
    s.physical.embassies[civ as CivName] = num(r.embassyLevel);
    const basePrices: Array<{ name: string; val: number }> = (r.embassyPrices ?? []) as Array<{
      name: string;
      val: number;
    }>;
    const coeff = 1 - embassyCostReduction;
    const ratio = Math.pow(1.15, num(r.embassyLevel) + embassyFakeBought);
    s.info.embassyPrices[civ as CivName] = basePrices.map((p) => ({
      name: String(p.name),
      val: Number(p.val) * coeff * ratio,
    }));
    // Per-caravan tribute (race.buys[0]). Used by feasibility for `trade`.
    const buys = (r.buys as Array<{ name: string; val: number }> | undefined) ?? [];
    s.info.tradeTribute[civ as CivName] = buys[0]
      ? { name: String(buys[0].name), val: Number(buys[0].val) }
      : null;
  }
  // Per-caravan trade base costs (use the live game's getter so policy
  // discounts are picked up).
  if (typeof g.diplomacy?.getManpowerCost === "function") {
    s.info.tradeManpowerCost = num(g.diplomacy.getManpowerCost(), 50);
  }
  if (typeof g.diplomacy?.getGoldCost === "function") {
    s.info.tradeGoldCost = num(g.diplomacy.getGoldCost(), 15);
  }

  // Job unlock flags.
  for (const j of JOB_NAMES) {
    const job = (g.village.jobs as Any[] | undefined)?.find((x: Any) => x.name === j);
    s.info.unlocked.jobs[j] = bool(job?.unlocked);
  }

  // Craft unlock flags + recipe prices. The game's getCraftPrice returns
  // post-discount prices (workshop upgrades reduce costs). Snapshot both so
  // feasibility can stay pure.
  for (const c of CRAFT_NAMES) {
    const recipe = g.workshop?.getCraft?.(c);
    s.info.unlocked.crafts[c] = bool(recipe?.unlocked);
    if (recipe) {
      const priced = typeof g.workshop?.getCraftPrice === "function"
        ? (g.workshop.getCraftPrice(recipe) as Array<{ name: string; val: number }>)
        : (recipe.prices as Array<{ name: string; val: number }>);
      s.info.craftRecipes[c] = {
        prices: (priced ?? []).map((p) => ({ name: String(p.name), val: Number(p.val) })),
      };
    }
  }

  // Kittens.
  const sim = g.village.sim;
  if (sim) {
     
    const kittens: Any[] = sim.kittens ?? [];
    s.physical.kittens.total = kittens.length;
    let assigned = 0;
    for (const k of kittens) {
       
      const job = k.job as string | null | undefined;
      if (job && JOB_NAMES.includes(job as JobName)) {
        s.physical.kittens.jobs[job as JobName]++;
        assigned++;
      }
    }
    s.physical.kittens.freeKittens = kittens.length - assigned;
     
    const leader = sim.leader as Any;
    if (leader && typeof leader.job === "string" && JOB_NAMES.includes(leader.job as JobName)) {
      s.physical.kittens.leader = {
        job: leader.job as JobName,
         
        trait: typeof leader.trait?.name === "string" ? leader.trait.name : "",
        rank: num(leader.rank),
        exp: num(leader.exp),
      };
    }
  }

  // Calendar.
   
  const cal = g.calendar;
  if (cal) {
    s.info.calendar.year = num(cal.year);
    const season = num(cal.season);
    s.info.calendar.season = (season % 4) as Season;
    s.info.calendar.day = num(cal.day);
    s.info.calendar.cycle = num(cal.cycle);
    s.info.calendar.cycleYear = num(cal.cycleYear);
    s.info.calendar.ticks = num(g.ticks);
    const wRaw = (cal.weather as string | null | undefined) ?? "";
    s.info.weather =
      wRaw === "cold" || wRaw === "warm" || wRaw === "neutral" ? (wRaw as Weather) : "neutral";
    s.info.festivalRemaining = num(cal.festivalDays);
  }

  // Religion accumulators / energy / happiness / paragon / karma.
   
  const rel = g.religion;
  if (rel) {
    s.info.faith = num(rel.faith);
    s.info.apocrypha = num(rel.faithRatio ?? rel.tcratio);
    s.info.praiseCount = num(rel.praiseCount);
  }
   
  s.info.energy = num(g.workshop?.getEnergyDelta?.() ?? 0);

  // Per-tick flow snapshot. Read from the engine's own perTick getter so we
  // inherit whatever multipliers are live, then split production / consumption
  // for resources whose seasonal projection we care about (currently only
  // catnip).
  for (const name of RESOURCE_NAMES) {
    const r = g.resPool.get(name);
    if (!r) continue;
    const net =
      typeof g.getResourcePerTick === "function"
        ? num(g.getResourcePerTick(name, true))
        : 0;
    s.info.flow.perTick[name as ResourceName] = net;
  }
  // Catnip split: consumption is season-independent so we can derive
  // production = net + consumption. Source: village.js:9 catnipPerKitten=-0.85,
  // game.js:3312-3322 demand-ratio + happiness extra.
  const kittenCount = num(g.village?.sim?.kittens?.length, 0);
  const catnipPerKittenBase = 0.85;
  const demandRatio = num(g.getEffect?.("catnipDemandRatio"), 0); // negative
  let catnipConsumption = kittenCount * catnipPerKittenBase * (1 + demandRatio);
  // Happiness > 1 increases consumption (anarchy: ignores freeKittens carve-out).
  const hap = num(g.village?.happiness, 1);
  if (hap > 1 && kittenCount > 0) {
    const consumptionRatio = num(g.getEffect?.("hapinnessConsumptionRatio"), 0);
    const happinessExtra = Math.max(hap * (1 + consumptionRatio) - 1, 0);
    const workerRatioGlobal = num(
      g.getEffect?.("catnipDemandWorkerRatioGlobal"),
      0,
    );
    const freeKittens = num(g.village?.sim?.freeKittens, 0);
    const carveOut = kittenCount > 0 ? 1 - freeKittens / kittenCount : 1;
    catnipConsumption +=
      catnipConsumption * happinessExtra * (1 + workerRatioGlobal) * carveOut;
  }
  // Buildings consume catnip too (barn/brewery via catnipPerTickCon). Pull
  // these out of the engine if exposed.
  const bldCatnipCon = num(g.getEffect?.("catnipPerTickCon"), 0);
  if (bldCatnipCon < 0) catnipConsumption += -bldCatnipCon;
  s.info.flow.consumption.catnip = catnipConsumption;
  s.info.flow.production.catnip =
    (s.info.flow.perTick.catnip ?? 0) + catnipConsumption;
  s.info.flow.catnipSeasonalFactor = catnipSeasonalFactor(
    s.info.calendar.season,
    s.info.weather,
  );

   
  s.info.happiness = num(g.village?.happiness, 1);
   
  s.info.paragon = num(g.resPool.get("paragon")?.value);
   
  s.info.karma = num(g.resPool.get("karma")?.value);

  return s;
}
