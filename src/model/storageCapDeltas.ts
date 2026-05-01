/**
 * Per-building stockpile cap deltas. Each entry is the per-unit `*Max`
 * effect from `kittensgame-master/js/buildings.js` (calculateEffects).
 *
 * Hand-curated to the storage / science-cap-bearing buildings; non-storage
 * buildings have no entry (treated as 0 deltas). Projections for buildings
 * not in this table will under-estimate storage capacity gains, which is
 * the correct safety bias for the planner — we'd rather be too cautious
 * about cap than too eager.
 *
 * Conditional bonuses (warehouse + concreteHuts upgrade, observatory +
 * astrolabe, biolab + biofuel, temple + scholastics/sunAltar) are NOT
 * baked in. Phase 9 keeps the static table; later phases may layer in
 * upgrade-conditional cap increases when scoring shows they matter.
 *
 * The keys reference stockpile resources only (catnip / wood / minerals /
 * coal / iron / titanium / gold / science / culture / faith / manpower).
 * Non-stockpile flow resources (energy) are not affected by storage.
 */
import type { BuildingName, ResourceName } from "@/model/catalogs";

export type CapDelta = Partial<Record<ResourceName, number>>;

export const STORAGE_CAP_DELTAS: Partial<Record<BuildingName, CapDelta>> = {
  // buildings.js barn calculateEffects.
  barn: { catnip: 5000, wood: 200, minerals: 250, coal: 60, iron: 50, titanium: 2, gold: 10 },
  // buildings.js warehouse stage 0 calculateEffects.
  warehouse: { wood: 150, minerals: 200, coal: 30, iron: 25, titanium: 10, gold: 5 },
  // buildings.js harbor calculateEffects.
  harbor: { catnip: 2500, wood: 700, minerals: 950, coal: 100, iron: 150, titanium: 50, gold: 25 },
  // buildings.js library calculateEffects (science 250, culture 10).
  library: { science: 250, culture: 10 },
  // buildings.js academy calculateEffects (science 500, culture 25).
  academy: { science: 500, culture: 25 },
  // buildings.js observatory: 1000 base; +500 with astrolabe upgrade (skip).
  observatory: { science: 1000 },
  // buildings.js biolab base.
  biolab: { science: 1500 },
  // buildings.js temple stage 0: faith 100, plus dynamic science/culture
  // additions from upgrades. Keep the conservative baseline.
  temple: { faith: 100 },
  // Housing buildings (hut/logHouse/mansion) raise the kittens cap, which
  // we don't currently track as a stockpile resource. They also add to
  // manpowerMax: hut +75, logHouse +50, mansion +50.
  hut: { manpower: 75 },
  logHouse: { manpower: 50 },
  mansion: { manpower: 50 },
};
