import type {
  BuildingName,
  TechName,
  WorkshopName,
  ReligionUpgradeName,
  ZigguratName,
  ChronoforgeName,
  VoidspaceName,
  SpaceProgramName,
  PlanetName,
  JobName,
  CivName,
  PolicyName,
  CraftName,
} from "@/model/catalogs";

export interface ActionWait {
  kind: "wait";
  ticks?: number;
}

// The bootstrap action: click "Gather catnip" once. Always feasible. Adds 1
// catnip (modulo bonuses). Without this, a fresh game with 0 kittens has no
// way to escape its starting state since passive catnip trickle is too slow
// to ever afford the first field.
export interface ActionGatherCatnip {
  kind: "gather-catnip";
}

// Refine 100 catnip (50 with advancedRefinement) → 1+ wood. The first way to
// get wood before huts/kittens are available.
export interface ActionRefineCatnip {
  kind: "refine-catnip";
}

// Send explorers: 1000 catpower, attempts to discover a new race (nagas →
// zebras → spiders → dragons → ...). On failure refunds 950 catpower.
export interface ActionSendExplorers {
  kind: "send-explorers";
}

export interface ActionBuild {
  kind: "build";
  building: BuildingName;
}
export interface ActionBuildZiggurat {
  kind: "build-ziggurat";
  structure: ZigguratName;
}
export interface ActionBuildSpace {
  kind: "build-space";
  planet: PlanetName;
  building: string;
}
export interface ActionBuildChronoforge {
  kind: "build-chronoforge";
  building: ChronoforgeName;
}
export interface ActionBuildVoidspace {
  kind: "build-voidspace";
  building: VoidspaceName;
}

export interface ActionResearch {
  kind: "research";
  tech: TechName;
}
export interface ActionWorkshop {
  kind: "workshop";
  upgrade: WorkshopName;
}
export interface ActionReligionUpgrade {
  kind: "religion-upgrade";
  upgrade: ReligionUpgradeName;
}

export interface ActionPraise {
  kind: "praise";
}
export interface ActionRefineTears {
  kind: "refine-tears";
  amount?: number;
}
export interface ActionRefineTC {
  kind: "refine-tc";
  amount?: number;
}

export interface ActionEmbassy {
  kind: "embassy";
  civ: CivName;
  count?: number;
}
export interface ActionTrade {
  kind: "trade";
  civ: CivName;
  caravans: number;
}
export interface ActionPact {
  kind: "pact";
  civ: CivName;
}

export interface ActionAssign {
  kind: "assign";
  jobs: Partial<Record<JobName, number>>;
}
export interface ActionEngineerAssign {
  kind: "engineer-assign";
  crafts: Record<string, number>;
}
export interface ActionAppointLeader {
  kind: "appoint-leader";
  kittenIndex: number;
}
export interface ActionPromoteLeader {
  kind: "promote-leader";
}

export interface ActionCraft {
  kind: "craft";
  item: CraftName;
  amount: number;
}

export interface ActionHunt {
  kind: "hunt";
}
export interface ActionObserve {
  kind: "observe";
}
export interface ActionFestival {
  kind: "festival";
}

// Policies in this game are individual one-time researches; no slot mechanic.
export interface ActionPolicy {
  kind: "policy";
  policy: PolicyName;
}

export interface ActionTimeSkip {
  kind: "time-skip";
  years: number;
}

export interface ActionSpaceLaunch {
  kind: "space-launch";
  mission: SpaceProgramName;
}

export type Action =
  | ActionWait
  | ActionGatherCatnip
  | ActionRefineCatnip
  | ActionSendExplorers
  | ActionBuild
  | ActionBuildZiggurat
  | ActionBuildSpace
  | ActionBuildChronoforge
  | ActionBuildVoidspace
  | ActionResearch
  | ActionWorkshop
  | ActionReligionUpgrade
  | ActionPraise
  | ActionRefineTears
  | ActionRefineTC
  | ActionEmbassy
  | ActionTrade
  | ActionPact
  | ActionAssign
  | ActionEngineerAssign
  | ActionAppointLeader
  | ActionPromoteLeader
  | ActionCraft
  | ActionHunt
  | ActionObserve
  | ActionFestival
  | ActionPolicy
  | ActionTimeSkip
  | ActionSpaceLaunch;

export type ActionKind = Action["kind"];

type ActionByKind<K extends ActionKind> = Extract<Action, { kind: K }>;

export function isAction<K extends ActionKind>(a: Action, k: K): a is ActionByKind<K> {
  return a.kind === k;
}

export function assertNever(x: never): never {
  throw new Error(`Unhandled action kind: ${JSON.stringify(x)}`);
}
