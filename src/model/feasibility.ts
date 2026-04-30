import type {
  Action,
  ActionBuild,
  ActionBuildZiggurat,
  ActionBuildSpace,
  ActionBuildChronoforge,
  ActionBuildVoidspace,
  ActionResearch,
  ActionWorkshop,
  ActionReligionUpgrade,
  ActionEmbassy,
  ActionTrade,
  ActionPact,
  ActionAssign,
  ActionEngineerAssign,
  ActionAppointLeader,
  ActionCraft,
  ActionPolicy,
  ActionTimeSkip,
  ActionSpaceLaunch,
  State,
} from "@/model";
import { assertNever } from "@/model";
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
  PLANET_BUILDING_META,
  CRAFT_NAMES,
} from "@/model/catalogs";
import type { ResourceName, JobName, CraftName } from "@/model/catalogs";

export interface FeasibilityReport {
  ok: boolean;
  reasons: string[];
}

interface BasicMeta {
  inScope: boolean;
  basePrices: { name: string; val: number }[];
  priceRatio: number;
}

function projectedCost(
  meta: BasicMeta,
  count: number,
): Array<{ name: string; val: number }> {
  const factor = Math.pow(meta.priceRatio, count);
  return meta.basePrices.map((p) => ({ name: p.name, val: p.val * factor }));
}

function affordCheck(
  s: State,
  prices: Array<{ name: string; val: number }>,
  reasons: string[],
): void {
  for (const p of prices) {
    if (p.name === "paragon" || p.name === "karma") {
      reasons.push(`out-of-scope cost: ${p.name}`);
      continue;
    }
    const have = s.physical.resources[p.name as ResourceName] ?? 0;
    if (have < p.val) {
      reasons.push(`insufficient ${p.name}: ${have.toFixed(2)} < ${p.val.toFixed(2)}`);
    }
    const cap = s.physical.resourceCaps[p.name as ResourceName] ?? Infinity;
    if (cap !== Infinity && cap < p.val) {
      reasons.push(`cap too small for ${p.name}: ${cap} < ${p.val.toFixed(2)}`);
    }
  }
}

function checkBuild(s: State, a: ActionBuild): FeasibilityReport {
  const reasons: string[] = [];
  const meta = BUILDING_META[a.building];
  if (!meta) return { ok: false, reasons: [`unknown building: ${a.building}`] };
  if (!meta.inScope) reasons.push(`out of scope`);
  if (!s.info.unlocked.buildings[a.building]) reasons.push(`not unlocked`);
  affordCheck(s, projectedCost(meta, s.physical.buildings[a.building] ?? 0), reasons);
  return { ok: reasons.length === 0, reasons };
}

function checkBuildZiggurat(s: State, a: ActionBuildZiggurat): FeasibilityReport {
  const reasons: string[] = [];
  const meta = ZIGGURAT_META[a.structure];
  if (!meta) return { ok: false, reasons: [`unknown ziggurat: ${a.structure}`] };
  if (!meta.inScope) reasons.push(`out of scope`);
  if (!s.info.unlocked.ziggurat[a.structure]) reasons.push(`not unlocked`);
  affordCheck(s, projectedCost(meta, s.physical.zigguratStructures[a.structure] ?? 0), reasons);
  return { ok: reasons.length === 0, reasons };
}

function checkBuildSpace(s: State, a: ActionBuildSpace): FeasibilityReport {
  const reasons: string[] = [];
  const planetMeta = PLANET_BUILDING_META[a.planet];
  if (!planetMeta) return { ok: false, reasons: [`unknown planet: ${a.planet}`] };
  const meta = planetMeta[a.building];
  if (!meta) return { ok: false, reasons: [`unknown space building: ${a.planet}/${a.building}`] };
  if (!meta.inScope) reasons.push(`out of scope`);
  const count = s.physical.spaceBuildings[a.planet]?.[a.building] ?? 0;
  affordCheck(s, projectedCost(meta, count), reasons);
  return { ok: reasons.length === 0, reasons };
}

function checkBuildChronoforge(s: State, a: ActionBuildChronoforge): FeasibilityReport {
  const reasons: string[] = [];
  const meta = CHRONOFORGE_META[a.building];
  if (!meta) return { ok: false, reasons: [`unknown chronoforge: ${a.building}`] };
  if (!meta.inScope) reasons.push(`out of scope`);
  if (!s.info.unlocked.chronoforge[a.building]) reasons.push(`not unlocked`);
  affordCheck(s, projectedCost(meta, s.physical.chronoforge[a.building] ?? 0), reasons);
  return { ok: reasons.length === 0, reasons };
}

function checkBuildVoidspace(s: State, a: ActionBuildVoidspace): FeasibilityReport {
  const reasons: string[] = [];
  const meta = VOIDSPACE_META[a.building];
  if (!meta) return { ok: false, reasons: [`unknown voidspace: ${a.building}`] };
  if (!meta.inScope) reasons.push(`out of scope`);
  if (!s.info.unlocked.voidspace[a.building]) reasons.push(`not unlocked`);
  affordCheck(s, projectedCost(meta, s.physical.voidspace[a.building] ?? 0), reasons);
  return { ok: reasons.length === 0, reasons };
}

function checkResearch(s: State, a: ActionResearch): FeasibilityReport {
  const reasons: string[] = [];
  const meta = TECH_META[a.tech];
  if (!meta) return { ok: false, reasons: [`unknown tech: ${a.tech}`] };
  if (!meta.inScope) reasons.push(`out of scope`);
  if (s.info.techs[a.tech]) reasons.push(`already researched`);
  if (!s.info.unlocked.techs[a.tech]) reasons.push(`not unlocked`);
  affordCheck(s, projectedCost(meta, 0), reasons);
  return { ok: reasons.length === 0, reasons };
}

function checkWorkshop(s: State, a: ActionWorkshop): FeasibilityReport {
  const reasons: string[] = [];
  const meta = WORKSHOP_META[a.upgrade];
  if (!meta) return { ok: false, reasons: [`unknown workshop: ${a.upgrade}`] };
  if (!meta.inScope) reasons.push(`out of scope`);
  if (s.info.workshop[a.upgrade]) reasons.push(`already purchased`);
  if (!s.info.unlocked.workshop[a.upgrade]) reasons.push(`not unlocked`);
  affordCheck(s, projectedCost(meta, 0), reasons);
  return { ok: reasons.length === 0, reasons };
}

function checkReligionUpgrade(s: State, a: ActionReligionUpgrade): FeasibilityReport {
  const reasons: string[] = [];
  const meta = RELIGION_UPGRADE_META[a.upgrade];
  if (!meta) return { ok: false, reasons: [`unknown religion upgrade: ${a.upgrade}`] };
  if (!meta.inScope) reasons.push(`out of scope`);
  if (s.info.religionUpgrades[a.upgrade]) reasons.push(`already researched`);
  if (!s.info.unlocked.religion[a.upgrade]) reasons.push(`not unlocked`);
  affordCheck(s, projectedCost(meta, 0), reasons);
  return { ok: reasons.length === 0, reasons };
}

function checkPraise(s: State): FeasibilityReport {
  const reasons: string[] = [];
  if ((s.physical.resources.faith ?? 0) <= 0) reasons.push(`no faith to praise`);
  return { ok: reasons.length === 0, reasons };
}

function checkRefineTears(s: State): FeasibilityReport {
  const reasons: string[] = [];
  if ((s.physical.resources.tears ?? 0) < 1) reasons.push(`no tears`);
  return { ok: reasons.length === 0, reasons };
}

function checkRefineTC(s: State): FeasibilityReport {
  const reasons: string[] = [];
  if ((s.physical.resources.timeCrystal ?? 0) < 1) reasons.push(`no time crystals`);
  return { ok: reasons.length === 0, reasons };
}

function checkEmbassy(s: State, a: ActionEmbassy): FeasibilityReport {
  const reasons: string[] = [];
  if (!s.info.diplomacyDiscovered[a.civ]) reasons.push(`civ ${a.civ} not discovered`);
  // Embassy cost: 100 culture + 500 gold base, scales per embassy. Approximate.
  const count = s.physical.embassies[a.civ] ?? 0;
  const cultureCost = 100 * Math.pow(1.15, count);
  const goldCost = 500 * Math.pow(1.15, count);
  if ((s.physical.resources.culture ?? 0) < cultureCost) reasons.push(`insufficient culture`);
  if ((s.physical.resources.gold ?? 0) < goldCost) reasons.push(`insufficient gold`);
  return { ok: reasons.length === 0, reasons };
}

function checkTrade(s: State, a: ActionTrade): FeasibilityReport {
  const reasons: string[] = [];
  if (!s.info.diplomacyDiscovered[a.civ]) reasons.push(`civ ${a.civ} not discovered`);
  if (a.caravans < 1 || !Number.isInteger(a.caravans)) reasons.push(`bad caravan count`);
  const cp = s.physical.resources.manpower ?? 0;
  if (cp < 50 * a.caravans) reasons.push(`catpower < 50 per caravan`);
  const gold = s.physical.resources.gold ?? 0;
  if (gold < 15 * a.caravans) reasons.push(`gold < 15 per caravan`);
  return { ok: reasons.length === 0, reasons };
}

function checkPact(s: State, a: ActionPact): FeasibilityReport {
  const reasons: string[] = [];
  if (!s.info.diplomacyDiscovered[a.civ]) reasons.push(`civ ${a.civ} not discovered`);
  if (a.civ !== "leviathans") reasons.push(`pacts only available with leviathans in base game`);
  return { ok: reasons.length === 0, reasons };
}

function checkAssign(s: State, a: ActionAssign): FeasibilityReport {
  const reasons: string[] = [];
  let total = 0;
  for (const [job, n] of Object.entries(a.jobs)) {
    if (n === undefined) continue;
    if (!Number.isInteger(n) || n < 0) reasons.push(`bad count for ${job}: ${n}`);
    if (!s.info.unlocked.jobs[job as JobName]) reasons.push(`job ${job} not unlocked`);
    total += n;
  }
  if (total > s.physical.kittens.total) {
    reasons.push(`assigned ${total} > total ${s.physical.kittens.total}`);
  }
  return { ok: reasons.length === 0, reasons };
}

function checkEngineerAssign(s: State, a: ActionEngineerAssign): FeasibilityReport {
  const reasons: string[] = [];
  const engineers = s.physical.kittens.jobs.engineer;
  let total = 0;
  for (const [, n] of Object.entries(a.crafts)) {
    if (!Number.isInteger(n) || n < 0) reasons.push(`bad engineer count: ${n}`);
    total += n;
  }
  if (total > engineers) reasons.push(`assigned engineers ${total} > available ${engineers}`);
  return { ok: reasons.length === 0, reasons };
}

function checkAppointLeader(s: State, a: ActionAppointLeader): FeasibilityReport {
  const reasons: string[] = [];
  if (a.kittenIndex < 0 || a.kittenIndex >= s.physical.kittens.total) {
    reasons.push(`kitten index out of range`);
  }
  return { ok: reasons.length === 0, reasons };
}

function checkPromoteLeader(s: State): FeasibilityReport {
  const reasons: string[] = [];
  if (!s.physical.kittens.leader) reasons.push(`no leader`);
  return { ok: reasons.length === 0, reasons };
}

function checkCraft(s: State, a: ActionCraft): FeasibilityReport {
  const reasons: string[] = [];
  if (!CRAFT_NAMES.includes(a.item as CraftName)) reasons.push(`unknown craft: ${a.item}`);
  if (a.amount < 1 || !Number.isInteger(a.amount)) reasons.push(`bad amount`);
  // Crafting (other than wood-via-refine) requires the workshop building to
  // exist. Wood crafting goes through refine-catnip, not this action.
  if (a.item !== "wood" && (s.physical.buildings.workshop ?? 0) < 1) {
    reasons.push(`workshop building not yet built`);
  }
  return { ok: reasons.length === 0, reasons };
}

function checkHunt(s: State): FeasibilityReport {
  const reasons: string[] = [];
  if ((s.physical.resources.manpower ?? 0) < 100) reasons.push(`catpower < 100`);
  return { ok: reasons.length === 0, reasons };
}

function checkObserve(s: State): FeasibilityReport {
  return s.info.astronomicalEvent
    ? { ok: true, reasons: [] }
    : { ok: false, reasons: [`no astronomical event`] };
}

function checkFestival(s: State): FeasibilityReport {
  const reasons: string[] = [];
  if (!s.info.techs.drama) reasons.push(`drama tech not researched`);
  if ((s.physical.resources.manpower ?? 0) < 1500) reasons.push(`catpower < 1500`);
  if ((s.physical.resources.culture ?? 0) < 5000) reasons.push(`culture < 5000`);
  if ((s.physical.resources.parchment ?? 0) < 2500) reasons.push(`parchment < 2500`);
  return { ok: reasons.length === 0, reasons };
}

function checkPolicy(s: State, a: ActionPolicy): FeasibilityReport {
  const reasons: string[] = [];
  const meta = POLICY_META[a.policy];
  if (!meta) return { ok: false, reasons: [`unknown policy: ${a.policy}`] };
  if (!meta.inScope) reasons.push(`out of scope`);
  if (s.info.policies[a.policy]) reasons.push(`already adopted`);
  if (s.info.policyBlocked[a.policy]) reasons.push(`blocked by mutually-exclusive policy`);
  if (!s.info.unlocked.policies[a.policy]) reasons.push(`not unlocked`);
  affordCheck(s, projectedCost(meta, 0), reasons);
  return { ok: reasons.length === 0, reasons };
}

function checkTimeSkip(s: State, a: ActionTimeSkip): FeasibilityReport {
  const reasons: string[] = [];
  if (a.years < 1 || !Number.isInteger(a.years)) reasons.push(`years must be a positive integer`);
  // Chronoforge required to time-skip; using temporalBattery as proxy for the
  // chronoforge subsystem being available.
  if ((s.physical.chronoforge.temporalBattery ?? 0) < 1) {
    reasons.push(`chronoforge not available`);
  }
  const tcCost = a.years * 10;
  if ((s.physical.resources.timeCrystal ?? 0) < tcCost) reasons.push(`not enough time crystals`);
  return { ok: reasons.length === 0, reasons };
}

function checkSpaceLaunch(s: State, a: ActionSpaceLaunch): FeasibilityReport {
  const reasons: string[] = [];
  const meta = SPACE_PROGRAM_META[a.mission];
  if (!meta) return { ok: false, reasons: [`unknown mission: ${a.mission}`] };
  if (!meta.inScope) reasons.push(`out of scope`);
  if (s.physical.spaceProgramsCompleted[a.mission]) reasons.push(`already launched`);
  affordCheck(s, projectedCost(meta, 0), reasons);
  return { ok: reasons.length === 0, reasons };
}

export function feasibilityReport(s: State, a: Action): FeasibilityReport {
  switch (a.kind) {
    case "wait":
      return { ok: true, reasons: [] };
    case "gather-catnip":
      return { ok: true, reasons: [] };
    case "refine-catnip": {
      const cost = s.info.workshop.advancedRefinement ? 50 : 100;
      const have = s.physical.resources.catnip ?? 0;
      return have >= cost
        ? { ok: true, reasons: [] }
        : { ok: false, reasons: [`insufficient catnip: ${have} < ${cost}`] };
    }
    case "send-explorers": {
      const reasons: string[] = [];
      if ((s.physical.resources.manpower ?? 0) < 1000) reasons.push(`catpower < 1000`);
      // Need archery tech (catpower exists) + at least one race left to discover.
      if (!s.info.techs.archery) reasons.push(`archery tech not researched`);
      const allDiscovered = Object.values(s.info.diplomacyDiscovered).every((v) => v);
      if (allDiscovered) reasons.push(`all civilizations already discovered`);
      return { ok: reasons.length === 0, reasons };
    }
    case "build":
      return checkBuild(s, a);
    case "build-ziggurat":
      return checkBuildZiggurat(s, a);
    case "build-space":
      return checkBuildSpace(s, a);
    case "build-chronoforge":
      return checkBuildChronoforge(s, a);
    case "build-voidspace":
      return checkBuildVoidspace(s, a);
    case "research":
      return checkResearch(s, a);
    case "workshop":
      return checkWorkshop(s, a);
    case "religion-upgrade":
      return checkReligionUpgrade(s, a);
    case "praise":
      return checkPraise(s);
    case "refine-tears":
      return checkRefineTears(s);
    case "refine-tc":
      return checkRefineTC(s);
    case "embassy":
      return checkEmbassy(s, a);
    case "trade":
      return checkTrade(s, a);
    case "pact":
      return checkPact(s, a);
    case "assign":
      return checkAssign(s, a);
    case "engineer-assign":
      return checkEngineerAssign(s, a);
    case "appoint-leader":
      return checkAppointLeader(s, a);
    case "promote-leader":
      return checkPromoteLeader(s);
    case "craft":
      return checkCraft(s, a);
    case "hunt":
      return checkHunt(s);
    case "observe":
      return checkObserve(s);
    case "festival":
      return checkFestival(s);
    case "policy":
      return checkPolicy(s, a);
    case "time-skip":
      return checkTimeSkip(s, a);
    case "space-launch":
      return checkSpaceLaunch(s, a);
    default:
      return assertNever(a);
  }
}

export function feasible(s: State, a: Action): boolean {
  return feasibilityReport(s, a).ok;
}
