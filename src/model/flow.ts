/**
 * Per-tick resource-flow projections.
 *
 * Phase 2 scope: catnip-only seasonal projection plus per-action delta
 * tracking for the danger-list build actions (smelter, calciner, magneto,
 * reactor, factory, accelerator, chronosphere, biolab) and the catnip-demand
 * reducers (pasture, unicornPasture). The flow snapshot itself is populated
 * in extract from the engine's own per-tick numbers, so we never re-derive
 * the full multiplier stack.
 *
 * Source-of-truth references (kittensgame-master/js/):
 *   calendar.js spring=1.5  summer=1.0  autumn=1.0  winter=0.25
 *   calendar.js cold=-0.15 (additive to season)  warm=+0.15  neutral=0
 *   game.js:3193  perTick *= seasonMod
 *   village.js   per-kitten consumption is season-independent
 */
import type { Action, ResourceName, Season, State, Weather } from "@/model";
import type { BuildingName } from "@/model/catalogs";
import {
  BUILDING_FLOW_DELTAS,
  BUILDING_ENERGY_DELTAS,
  CATNIP_DEMAND_DELTAS,
  type FlowDelta,
} from "./flowDeltas";

const SEASON_BASE: Record<Season, number> = {
  0: 1.5,
  1: 1.0,
  2: 1.0,
  3: 0.25,
};
const WEATHER_DELTA: Record<Weather, number> = {
  cold: -0.15,
  neutral: 0.0,
  warm: 0.15,
};

export const WORST_CATNIP_SEASON: Season = 3;
export const WORST_CATNIP_WEATHER: Weather = "cold";

export function catnipSeasonalFactor(season: Season, weather: Weather): number {
  return SEASON_BASE[season] * (1 + WEATHER_DELTA[weather]);
}

export const WORST_CATNIP_FACTOR = catnipSeasonalFactor(
  WORST_CATNIP_SEASON,
  WORST_CATNIP_WEATHER,
);

/** Current snapshot net flow. */
export function netFlow(s: State): Record<ResourceName, number> {
  return s.info.flow.perTick;
}

/**
 * Project net flow to a hypothetical (season, weather). Catnip is rescaled
 * via the season factor; other resources are season-insensitive and pass
 * through their snapshot perTick.
 */
export function netFlowAt(
  s: State,
  season: Season,
  weather: Weather,
): Record<ResourceName, number> {
  const out = { ...s.info.flow.perTick };
  const oldFactor = s.info.flow.catnipSeasonalFactor;
  if (oldFactor > 0) {
    const newFactor = catnipSeasonalFactor(season, weather);
    const projectedProd = s.info.flow.production.catnip * (newFactor / oldFactor);
    out.catnip = projectedProd - s.info.flow.consumption.catnip;
  }
  return out;
}

/**
 * Project the flow snapshot under the assumption that `a` has been applied.
 * Pure. Currently handles `build` actions on the danger-list buildings and
 * the catnip-demand reducers; everything else is identity.
 */
export function applyActionToFlow(s: State, a: Action): State {
  if (a.kind !== "build") return s;
  const b = a.building as BuildingName;
  const flowDelta = BUILDING_FLOW_DELTAS[b];
  const energyDelta = BUILDING_ENERGY_DELTAS[b];
  const demandDelta = CATNIP_DEMAND_DELTAS[b];
  if (!flowDelta && energyDelta == null && demandDelta == null) return s;

  const next: State = {
    ...s,
    info: {
      ...s.info,
      flow: {
        perTick: { ...s.info.flow.perTick },
        production: { ...s.info.flow.production },
        consumption: { ...s.info.flow.consumption },
        catnipSeasonalFactor: s.info.flow.catnipSeasonalFactor,
        energyNet: s.info.flow.energyNet,
      },
    },
  };

  if (flowDelta) applyFlowDelta(next, flowDelta);
  if (energyDelta != null) next.info.flow.energyNet += energyDelta;
  if (demandDelta != null) applyCatnipDemandDelta(next, demandDelta);

  return next;
}

function applyFlowDelta(s: State, delta: FlowDelta): void {
  for (const key of Object.keys(delta) as ResourceName[]) {
    const v = delta[key] ?? 0;
    if (v === 0) continue;
    s.info.flow.perTick[key] = (s.info.flow.perTick[key] ?? 0) + v;
    if (v > 0) {
      s.info.flow.production[key] = (s.info.flow.production[key] ?? 0) + v;
    } else {
      s.info.flow.consumption[key] = (s.info.flow.consumption[key] ?? 0) - v;
    }
  }
}

function applyCatnipDemandDelta(s: State, demandDelta: number): void {
  // demandDelta is the additive contribution to catnipDemandRatio (negative).
  // The engine applies it multiplicatively to consumption: new = old * (1 + δ).
  // Since we don't store catnipDemandRatio explicitly, we approximate by
  // scaling current consumption by (1 + δ) and propagate the resulting net.
  const factor = 1 + demandDelta;
  const oldCons = s.info.flow.consumption.catnip;
  const newCons = oldCons * factor;
  s.info.flow.consumption.catnip = newCons;
  s.info.flow.perTick.catnip += oldCons - newCons; // consumption decreased ⇒ net up
}
