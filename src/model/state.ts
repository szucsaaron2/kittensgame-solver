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
  PlanetName,
  JobName,
  CivName,
} from "@/model/catalogs";

// ===== Physical state R_t =====

export interface LeaderState {
  job: JobName;
  trait: string;
  rank: number;
  exp: number;
}

export interface KittenState {
  total: number;
  jobs: Record<JobName, number>;
  skills: Record<JobName, number>;
  leader: LeaderState | null;
  freeKittens: number;
}

export interface PhysicalState {
  resources: Record<ResourceName, number>;
  resourceCaps: Record<ResourceName, number>;
  buildings: Record<BuildingName, number>;
  zigguratStructures: Record<ZigguratName, number>;
  spaceBuildings: Record<PlanetName, Record<string, number>>;
  spaceProgramsCompleted: Record<SpaceProgramName, boolean>;
  chronoforge: Record<ChronoforgeName, number>;
  voidspace: Record<VoidspaceName, number>;
  embassies: Record<CivName, number>;
  kittens: KittenState;
}

// ===== Informational state I_t =====

export type Season = 0 | 1 | 2 | 3;
export type Weather = "cold" | "neutral" | "warm";

export interface CalendarState {
  year: number;
  season: Season;
  day: number;
  cycle: number;
  cycleYear: number;
  ticks: number;
}

export interface UnlockState {
  buildings: Record<BuildingName, boolean>;
  techs: Record<TechName, boolean>;
  workshop: Record<WorkshopName, boolean>;
  religion: Record<ReligionUpgradeName, boolean>;
  ziggurat: Record<ZigguratName, boolean>;
  chronoforge: Record<ChronoforgeName, boolean>;
  voidspace: Record<VoidspaceName, boolean>;
  policies: Record<PolicyName, boolean>;
  jobs: Record<JobName, boolean>;
  crafts: Record<string, boolean>;
}

export interface CraftRecipe {
  prices: { name: string; val: number }[];
}

/**
 * Per-tick resource flow snapshot. Populated by extract from the engine's
 * own per-tick numbers so we never re-derive multiplier stacks ourselves.
 *
 * `production[r]` and `consumption[r]` are non-negative; `perTick[r]` =
 * `production[r] - consumption[r]` and matches `gamePage.getResourcePerTick(r)`
 * within rounding.
 *
 * `catnipSeasonalFactor` is the multiplicative factor currently applied to
 * catnip production due to season + weather (e.g., spring × neutral = 1.5).
 * Lets `netFlowAt(s, season, weather)` project to a different season without
 * re-touching the engine.
 */
export interface FlowSnapshot {
  perTick: Record<ResourceName, number>;
  production: Record<ResourceName, number>;
  consumption: Record<ResourceName, number>;
  catnipSeasonalFactor: number;
  /**
   * Energy net (production - consumption) per tick. Tracked outside the
   * resource maps because energy is a flow, not a stockable resource.
   * Mirrors gamePage.workshop.getEnergyDelta() at extract time.
   */
  energyNet: number;
}

export interface InformationalState {
  calendar: CalendarState;
  weather: Weather;
  techs: Record<TechName, boolean>;
  workshop: Record<WorkshopName, boolean>;
  religionUpgrades: Record<ReligionUpgradeName, boolean>;
  transcendenceUpgrades: Record<TranscendenceName, number>;
  policies: Record<PolicyName, boolean>;
  policyBlocked: Record<PolicyName, boolean>;
  pactTiers: Record<CivName, number>;
  diplomacyDiscovered: Record<CivName, boolean>;
  astronomicalEvent: boolean;
  festivalRemaining: number;
  apocrypha: number;
  faith: number;
  praiseCount: number;
  energy: number;
  happiness: number;
  paragon: number;
  karma: number;
  unlocked: UnlockState;
  craftRecipes: Record<string, CraftRecipe>;
  embassyPrices: Record<CivName, { name: string; val: number }[]>;
  // Per-civ tribute resource consumed per caravan (race.buys[0] in upstream).
  tradeTribute: Record<CivName, { name: string; val: number } | null>;
  // Per-caravan catpower / gold cost (post-discount). Same for every civ.
  tradeManpowerCost: number;
  tradeGoldCost: number;
  flow: FlowSnapshot;
}

// ===== Belief state B_t (empty for now) =====

export type BeliefState = Record<string, never>;

// ===== Top-level =====

export interface State {
  physical: PhysicalState;
  info: InformationalState;
  belief: BeliefState;
}
