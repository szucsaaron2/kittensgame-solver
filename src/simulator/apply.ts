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
  ActionRefineTears,
  ActionRefineTC,
} from "@/model";
import { assertNever } from "@/model";

export class ApplyError extends Error {
  constructor(
    public action: Action,
    cause: unknown,
  ) {
    super(`apply failed for ${action.kind}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

// Class controllers live on `classes` and `com` namespaces. Their location
// depends on the runtime:
//   - jsdom/Node tests: installed on globalThis directly (test/setup.js mock).
//   - Tampermonkey userscript: live on unsafeWindow (the real page window),
//     since the userscript's globalThis is a sandboxed wrapper.
// Try unsafeWindow first if it exists; fall back to globalThis.
function ns(): { classes: Any; com: Any } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gt = globalThis as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uw: any = (gt as any).unsafeWindow;
  if (uw && (uw.classes || uw.com)) {
    return { classes: uw.classes, com: uw.com };
  }
  return { classes: gt.classes, com: gt.com };
}

/**
 * Apply an action to the live game. Each handler invokes the game's own
 * controller / manager methods so the game's cost-deduction, prereq-check,
 * and side-effect logic all run.
 *
 * The game has a forest of button controllers under classes.ui.btn / classes.ui;
 * the standard pattern is:
 *   1. instantiate the right controller with `new ControllerClass(game)`
 *   2. fetchModel(metadata)
 *   3. controller.buyItem(model, null)
 *
 * For simple state-changing actions (praise, hunt, holdFestival, shatter,
 * tradeAll), the manager exposes the method directly.
 */
export function apply(g: Any, a: Action): void {
  try {
    switch (a.kind) {
      case "wait":
        return;
      case "gather-catnip":
        return applyGatherCatnip(g);
      case "refine-catnip":
        return applyRefineCatnip(g);
      case "build":
        return applyBuild(g, a);
      case "build-ziggurat":
        return applyBuildZiggurat(g, a);
      case "build-space":
        return applyBuildSpace(g, a);
      case "build-chronoforge":
        return applyBuildChronoforge(g, a);
      case "build-voidspace":
        return applyBuildVoidspace(g, a);
      case "research":
        return applyResearch(g, a);
      case "workshop":
        return applyWorkshop(g, a);
      case "religion-upgrade":
        return applyReligionUpgrade(g, a);
      case "praise":
        return applyPraise(g);
      case "refine-tears":
        return applyRefineTears(g, a);
      case "refine-tc":
        return applyRefineTC(g, a);
      case "embassy":
        return applyEmbassy(g, a);
      case "trade":
        return applyTrade(g, a);
      case "pact":
        return applyPact(g, a);
      case "assign":
        return applyAssign(g, a);
      case "engineer-assign":
        return applyEngineerAssign(g, a);
      case "appoint-leader":
        return applyAppointLeader(g, a);
      case "promote-leader":
        return applyPromoteLeader(g);
      case "craft":
        return applyCraft(g, a);
      case "hunt":
        return applyHunt(g);
      case "observe":
        return applyObserve(g);
      case "share-knowledge":
        return applyShareKnowledge(g);
      case "festival":
        return applyFestival(g);
      case "policy":
        return applyPolicy(g, a);
      case "time-skip":
        return applyTimeSkip(g, a);
      case "space-launch":
        return applySpaceLaunch(g, a);
      default:
        return assertNever(a);
    }
  } catch (e) {
    throw new ApplyError(a, e);
  }
}

// -- Gather catnip ---------------------------------------------------------

function applyGatherCatnip(g: Any): void {
  // Manager method first; controller fallback for completeness.
  if (typeof g.bld?.gatherCatnip === "function") {
    g.bld.gatherCatnip();
    return;
  }
  const { classes } = ns();
  const C = classes?.game?.ui?.GatherCatnipButtonController;
  if (C) {
    const controller = new C(g);
    const model = controller.fetchModel({});
    controller.updateEnabled(model);
    const result = controller.buyItem(model, null);
    if (result?.itemBought !== true && result?.reason !== "item-is-free") {
      throw new Error(`gather-catnip failed: ${result?.reason ?? "unknown"}`);
    }
    return;
  }
  // Last-ditch: directly add 1 catnip.
  const catnip = g.resPool.get("catnip");
  if (!catnip) throw new Error("no catnip resource");
  catnip.value = (catnip.value as number) + 1;
}

function applyRefineCatnip(g: Any): void {
  // Manager method first — it's what the button ultimately calls and avoids
  // dojo's `this.inherited(arguments)` chain which can fail when we
  // instantiate the controller standalone outside the rendered button tree.
  // We do the cost deduction manually since the manager method only handles
  // the gain side.
  const cost = g.workshop?.get?.("advancedRefinement")?.researched ? 50 : 100;
  const catnip = g.resPool?.get?.("catnip");
  if (!catnip || catnip.value < cost) {
    throw new Error(`refine-catnip: insufficient catnip (need ${cost}, have ${catnip?.value ?? 0})`);
  }
  if (typeof g.bld?.refineCatnip === "function") {
    catnip.value -= cost;
    g.bld.refineCatnip();
    return;
  }
  // Last-ditch: try the controller. (Won't normally be reached.)
  const { classes } = ns();
  const C = classes?.game?.ui?.RefineCatnipButtonController;
  if (C) {
    const controller = new C(g);
    const model = controller.fetchModel({ prices: [{ name: "catnip", val: cost }] });
    controller.updateEnabled(model);
    const result = controller.buyItem(model, null);
    if (result?.itemBought !== true && result?.reason !== "item-is-free") {
      throw new Error(`refine-catnip failed: ${result?.reason ?? "unknown"}`);
    }
    return;
  }
  throw new Error("refine-catnip: no manager method and no controller");
}

// -- Building / construction -----------------------------------------------

function buyViaController(g: Any, ControllerCtor: Any, modelInit: Any): void {
  const controller = new ControllerCtor(g);
  const model = controller.fetchModel(modelInit);
  controller.updateEnabled(model);
  const result = controller.buyItem(model, null);
  if (result?.itemBought !== true) {
    throw new Error(`buyItem failed: ${result?.reason ?? "unknown"}`);
  }
}

function applyBuild(g: Any, a: ActionBuild): void {
  const { classes, com } = ns();
  // Live game and jsdom expose different paths. Try modern path first,
  // then fall back to the base stackable / non-stackable controllers
  // (which are what the modern controller extends).
  const C =
    classes?.ui?.btn?.BuildingBtnModernController ??
    classes?.ui?.btn?.StagingBldBtnController ??
    com?.nuclearunicorn?.game?.ui?.BuildingStackableBtnController ??
    com?.nuclearunicorn?.game?.ui?.BuildingNotStackableBtnController ??
    com?.nuclearunicorn?.game?.ui?.BuildingBtnController;
  if (!C) throw new Error("no building controller class available");
  buyViaController(g, C, { key: a.building, building: a.building });
}

function applyBuildZiggurat(g: Any, a: ActionBuildZiggurat): void {
  const { com } = ns();
  const C = com?.nuclearunicorn?.game?.ui?.ZigguratBtnController;
  if (!C) throw new Error("ZigguratBtnController not available");
  buyViaController(g, C, { id: a.structure });
}

function applyBuildSpace(g: Any, a: ActionBuildSpace): void {
  const { classes } = ns();
  const C = classes?.ui?.space?.PlanetBuildingBtnController;
  if (!C) throw new Error("PlanetBuildingBtnController not available");
  buyViaController(g, C, { id: a.building, planet: a.planet });
}

function applyBuildChronoforge(g: Any, a: ActionBuildChronoforge): void {
  const { classes } = ns();
  const C = classes?.ui?.time?.ChronoforgeBtnController;
  if (!C) throw new Error("ChronoforgeBtnController not available");
  buyViaController(g, C, { id: a.building });
}

function applyBuildVoidspace(g: Any, a: ActionBuildVoidspace): void {
  const { classes } = ns();
  const C = classes?.ui?.time?.VoidSpaceBtnController;
  if (!C) throw new Error("VoidSpaceBtnController not available");
  buyViaController(g, C, { id: a.building });
}

// -- Research / unlocks ----------------------------------------------------

function applyResearch(g: Any, a: ActionResearch): void {
  const { com } = ns();
  const C = com?.nuclearunicorn?.game?.ui?.TechButtonController;
  if (!C) throw new Error("TechButtonController not available");
  buyViaController(g, C, { id: a.tech });
}

function applyWorkshop(g: Any, a: ActionWorkshop): void {
  const { com } = ns();
  const C = com?.nuclearunicorn?.game?.ui?.UpgradeButtonController;
  if (!C) throw new Error("UpgradeButtonController not available");
  buyViaController(g, C, { id: a.upgrade });
}

function applyReligionUpgrade(g: Any, a: ActionReligionUpgrade): void {
  const { com } = ns();
  const C = com?.nuclearunicorn?.game?.ui?.ReligionBtnController;
  if (!C) throw new Error("ReligionBtnController not available");
  buyViaController(g, C, { id: a.upgrade });
}

// -- Religion flow ---------------------------------------------------------

function applyPraise(g: Any): void {
  g.religion.praise();
}

function applyRefineTears(g: Any, _a: ActionRefineTears): void {
  if (typeof g.religion.refineTears === "function") {
    g.religion.refineTears();
    return;
  }
  throw new Error("religion.refineTears not available");
}

function applyRefineTC(g: Any, a: ActionRefineTC): void {
  if (typeof g.religion.refineTCs === "function") {
    g.religion.refineTCs(a.amount ?? 1);
    return;
  }
  throw new Error("religion.refineTCs not available");
}

// -- Diplomacy --------------------------------------------------------------

function applyEmbassy(g: Any, a: ActionEmbassy): void {
  const race = (g.diplomacy.races as Any[]).find((r: Any) => r.name === a.civ);
  if (!race) throw new Error(`unknown civ: ${a.civ}`);
  const count = a.count ?? 1;
  if (typeof g.diplomacy.buyEcorBLS === "function") {
    g.diplomacy.buyEcorBLS(race, count);
    return;
  }
  // Fallback: direct embassy increment, since the cost formula is well-defined.
  for (let i = 0; i < count; i++) {
    const lvl = (race.embassyLevel as number | undefined) ?? 0;
    const cultureCost = 100 * Math.pow(1.15, lvl);
    const goldCost = 500 * Math.pow(1.15, lvl);
    const culture = g.resPool.get("culture");
    const gold = g.resPool.get("gold");
    if (culture.value < cultureCost) throw new Error(`embassy: insufficient culture`);
    if (gold.value < goldCost) throw new Error(`embassy: insufficient gold`);
    culture.value -= cultureCost;
    gold.value -= goldCost;
    race.embassyLevel = lvl + 1;
  }
}

function applyTrade(g: Any, a: ActionTrade): void {
  const race = (g.diplomacy.races as Any[]).find((r: Any) => r.name === a.civ);
  if (!race) throw new Error(`unknown civ: ${a.civ}`);
  if (a.caravans <= 1 && typeof g.diplomacy.tradeMultiple === "function") {
    g.diplomacy.tradeMultiple(race, 1);
  } else if (typeof g.diplomacy.tradeMultiple === "function") {
    g.diplomacy.tradeMultiple(race, a.caravans);
  } else {
    g.diplomacy.tradeAll(race);
  }
}

function applyPact(g: Any, a: ActionPact): void {
  const race = (g.diplomacy.races as Any[]).find((r: Any) => r.name === a.civ);
  if (!race) throw new Error(`unknown civ: ${a.civ}`);
  if (typeof g.diplomacy.unlockPact === "function") {
    g.diplomacy.unlockPact(race);
    return;
  }
  throw new Error("diplomacy.unlockPact not available");
}

// -- Village / labour -------------------------------------------------------

function applyAssign(g: Any, a: ActionAssign): void {
  // village.sim API:
  //   clearJobs(hard?) — unassign every kitten
  //   assignJob(jobName, amt) — assign `amt` free kittens to the named job
  //   removeJob(jobName, amt) — unassign `amt` kittens from the named job
  // (NOT removeJob(kitten) — earlier draft had this wrong.)
  const sim = g.village?.sim;
  if (!sim) throw new Error("village.sim not available");

  if (typeof sim.clearJobs === "function") {
    sim.clearJobs();
  } else {
    for (const k of (sim.kittens as Any[]) ?? []) {
      k.job = null;
    }
  }

  for (const [job, count] of Object.entries(a.jobs)) {
    if (count === undefined || count <= 0) continue;
    if (typeof sim.assignJob === "function") {
      sim.assignJob(job, count);
    } else {
      let assigned = 0;
      for (const k of (sim.kittens as Any[]) ?? []) {
        if (assigned >= count) break;
        if (!k.job) {
          k.job = job;
          assigned++;
        }
      }
    }
  }

  if (typeof g.village?.updateResourceProduction === "function") {
    g.village.updateResourceProduction();
  }
}

function applyEngineerAssign(g: Any, a: ActionEngineerAssign): void {
  const sim = g.village.sim;
  // Reset engineer crafts, then assign target counts.
  if (typeof sim.assignCraftJobs === "function") {
    sim.assignCraftJobs(a.crafts);
    return;
  }
  // Fallback: per-engineer iteration.
  const engineers = (sim.kittens as Any[]).filter((k: Any) => k.job === "engineer");
  let idx = 0;
  for (const [craft, n] of Object.entries(a.crafts)) {
    for (let i = 0; i < n && idx < engineers.length; i++) {
      const k = engineers[idx++];
      k.engineerSpeciality = craft;
    }
  }
}

function applyAppointLeader(g: Any, a: ActionAppointLeader): void {
  const sim = g.village.sim;
  const k = (sim.kittens as Any[])[a.kittenIndex];
  if (!k) throw new Error(`no kitten at index ${a.kittenIndex}`);
  if (typeof sim.makeLeader === "function") {
    sim.makeLeader(k);
    return;
  }
  sim.leader = k;
}

function applyPromoteLeader(g: Any): void {
  const sim = g.village.sim;
  if (!sim.leader) throw new Error("no leader to promote");
  if (typeof sim.promote === "function") {
    sim.promote(sim.leader, (sim.leader.rank as number | undefined ?? 0) + 1);
    return;
  }
  throw new Error("village.sim.promote not available");
}

// -- Crafting ---------------------------------------------------------------

function applyCraft(g: Any, a: ActionCraft): void {
  if (typeof g.workshop.craft === "function") {
    g.workshop.craft(a.item, a.amount);
    return;
  }
  throw new Error("workshop.craft not available");
}

// -- Field actions ----------------------------------------------------------

function applyHunt(g: Any): void {
  if (typeof g.village.huntAll === "function") {
    g.village.huntAll();
    return;
  }
  throw new Error("village.huntAll not available");
}

function applyObserve(g: Any): void {
  // Astronomical event: gamePage.observeBtn or g.observeStars
  if (typeof g.observeStars === "function") {
    g.observeStars();
    return;
  }
  if (typeof g.observeHandler === "function") {
    g.observeHandler();
    return;
  }
  throw new Error("no observe method available");
}

function applyShareKnowledge(g: Any): void {
  // Share-knowledge with leviathans; depends on diplomacy state.
  if (typeof g.diplomacy.unlockRandomRace === "function") {
    // Not the right method, fall through.
  }
  if (typeof g.diplomacy.shareKnowledge === "function") {
    g.diplomacy.shareKnowledge();
    return;
  }
  throw new Error("share-knowledge method not available");
}

function applyFestival(g: Any): void {
  if (typeof g.village.holdFestival === "function") {
    g.village.holdFestival(1);
    return;
  }
  throw new Error("village.holdFestival not available");
}

// -- Policy -----------------------------------------------------------------

function applyPolicy(g: Any, a: ActionPolicy): void {
  const { classes } = ns();
  const C = classes?.ui?.PolicyBtnController;
  if (!C) throw new Error("PolicyBtnController not available");
  buyViaController(g, C, { id: a.policy });
}

// -- Time travel ------------------------------------------------------------

function applyTimeSkip(g: Any, a: ActionTimeSkip): void {
  if (typeof g.time.shatter === "function") {
    g.time.shatter(a.years);
    return;
  }
  throw new Error("time.shatter not available");
}

// -- Space launch -----------------------------------------------------------

function applySpaceLaunch(g: Any, a: ActionSpaceLaunch): void {
  const { classes, com } = ns();
  const C =
    classes?.ui?.space?.SpaceProgramBtnController ??
    com?.nuclearunicorn?.game?.ui?.SpaceProgramBtnController;
  if (C) {
    buyViaController(g, C, { id: a.mission });
    return;
  }
  if (typeof g.space.launchProgram === "function") {
    g.space.launchProgram(a.mission);
    return;
  }
  throw new Error("space program controller not available");
}
