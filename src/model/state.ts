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
}

// ===== Belief state B_t (empty for now) =====

export type BeliefState = Record<string, never>;

// ===== Top-level =====

export interface State {
  physical: PhysicalState;
  info: InformationalState;
  belief: BeliefState;
}
