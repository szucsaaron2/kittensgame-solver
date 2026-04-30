/**
 * Per-tick resource-flow projections.
 *
 * Phase 1 scope: catnip-only seasonal projection. The flow snapshot is
 * populated in extract from the engine's own per-tick numbers, so we never
 * re-derive the full multiplier stack here. We only need to know how to
 * rescale catnip production when projecting to a different season+weather.
 *
 * Source-of-truth references (kittensgame-master/js/):
 *   calendar.js spring=1.5  summer=1.0  autumn=1.0  winter=0.25
 *   calendar.js cold=-0.15 (additive to season)  warm=+0.15  neutral=0
 *   game.js:3193  perTick *= seasonMod
 *   village.js   per-kitten consumption is season-independent
 *
 * Other resources (wood, minerals, etc.) are season-insensitive — their
 * netFlowAt projection equals their snapshot perTick. Phase 2 wires the
 * action-delta projection (`applyActionToFlow`) and extends the guard.
 */
import type { Action, ResourceName, Season, State, Weather } from "@/model";

const SEASON_BASE: Record<Season, number> = {
  0: 1.5, // spring
  1: 1.0, // summer
  2: 1.0, // autumn
  3: 0.25, // winter
};
const WEATHER_DELTA: Record<Weather, number> = {
  cold: -0.15,
  neutral: 0.0,
  warm: 0.15,
};

export const WORST_CATNIP_SEASON: Season = 3; // winter
export const WORST_CATNIP_WEATHER: Weather = "cold";

export function catnipSeasonalFactor(season: Season, weather: Weather): number {
  return SEASON_BASE[season] * (1 + WEATHER_DELTA[weather]);
}

export const WORST_CATNIP_FACTOR = catnipSeasonalFactor(
  WORST_CATNIP_SEASON,
  WORST_CATNIP_WEATHER,
);

/** Current snapshot net flow (engine's getResourcePerTick). */
export function netFlow(s: State): Record<ResourceName, number> {
  return s.info.flow.perTick;
}

/**
 * Project net flow to a hypothetical (season, weather). For Phase 1 only
 * catnip is rescaled; other resources are season-insensitive.
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
 * Phase 1: identity (no per-action delta yet). Phase 2 will fill this in for
 * actions that change resource flow (build {smelter, calciner, magneto,
 * reactor, factory, pasture, ...}, assign, ...).
 */
export function applyActionToFlow(s: State, _a: Action): State {
  return s;
}
