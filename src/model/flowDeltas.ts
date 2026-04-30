/**
 * Per-building base per-tick flow deltas.
 *
 * Source: kittensgame-master/js/buildings.js — see citations on each row.
 * Negative values are consumption (drain); positive values are production.
 *
 * These are STATIC base rates. The live engine wraps them in:
 *   - production: workshop / religion / policy / paragon / season multiplier stacks
 *   - consumption: per-unit linear, scaled only by `val`/`on` count
 *
 * The guard uses these conservatively: consumption is captured accurately
 * (no multiplier stack on consumption), production deltas underestimate
 * (we ignore the ratio multipliers). That bias is correct for the guard's
 * purpose — we'd rather refuse to build a producer that would in fact have
 * helped than green-light a consumer that will brick the run.
 *
 * Conditional bonuses (smelter+coalFurnace produces coal, smelter+goldOre
 * produces gold, smelter+nuclearSmelters produces titanium, calciner with
 * various ratios, magneto/reactor self-regulation) are intentionally NOT
 * baked in here. Phase 2 keeps the static table; Phase 8/9 may layer in
 * tech-conditional production where the planner needs it.
 */
import type { BuildingName } from "@/model/catalogs";
import type { ResourceName } from "@/model/catalogs";

export type FlowDelta = Partial<Record<ResourceName, number>>;

/** Per-building per-tick effect on the engine's energy net (info.energy). */
export const BUILDING_ENERGY_DELTAS: Partial<Record<BuildingName, number>> = {
  steamworks: 1, // buildings.js:1220
  magneto: 5, // 1328
  reactor: 10, // 1535
  factory: -2, // 1503 (automation doubles to -4 if opted in)
  calciner: -1, // 1099
  chronosphere: -20, // 2041
  // pasture stage 1 (solarFarm), aqueduct stage 1 (hydroPlant), library stage 1
  // (dataCenter) are stage upgrades on existing buildings — out of scope for
  // the static delta table.
};

/**
 * Per-building per-tick deltas (one unit, one tick). Source citations are
 * file:line in kittensgame-master/js/buildings.js unless stated otherwise.
 */
export const BUILDING_FLOW_DELTAS: Partial<Record<BuildingName, FlowDelta>> = {
  // Production-only buildings.
  field: { catnip: 0.125 }, // 328
  quarry: { coal: 0.015 }, // 973
  oilWell: { oil: 0.02 }, // 1396

  // Consumer buildings.
  smelter: { wood: -0.05, minerals: -0.1, iron: 0.02 }, // 1019, 1040
  calciner: { minerals: -1.5, oil: -0.024, iron: 0.15, titanium: 0.0005 }, // 1099, 1111, 1112
  magneto: { oil: -0.05 }, // 1327
  reactor: { uranium: -0.001 }, // 1539
  accelerator: { titanium: -0.015, uranium: 0.0025 }, // 1577, 1578, 1615, 1616
  biolab: { catnip: -1, oil: 0.02 }, // 699, 700, 1723 — biofuel-conditional, conservative
  // factory/chronosphere are energy-only consumers (see BUILDING_ENERGY_DELTAS).
  // pasture catnip-demand reduction is handled separately (multiplicative
  // on catnip consumption — see CATNIP_DEMAND_DELTAS).
};

/**
 * Multiplicative consumption-side effects (currently catnip-only).
 * Each value is the per-unit ratio added to `catnipDemandRatio`
 * (negative = reduction). Source: buildings.js:349 (pasture), 1956
 * (unicornPasture). Aqueduct stage 0 is a production multiplier (not in this
 * table); hydroponics is a workshop upgrade, also not here.
 */
export const CATNIP_DEMAND_DELTAS: Partial<Record<BuildingName, number>> = {
  pasture: -0.005,
  unicornPasture: -0.0015,
};
