/**
 * Layer 2 — JobAssignment subsystem.
 *
 * Allocates kittens across jobs. Triggered on season change, kitten count
 * delta, or a new-job-unlocked event. Pure function of S.
 *
 * Algorithm:
 *   1. Determine the minimum farmers needed to keep catnip net ≥ 0 in
 *      winter+cold (worst-case season). Binary-search over [0, kittens].
 *   2. Reserve a hunter once archery is researched, unless we're already
 *      at floor.
 *   3. Distribute the rest down a phase-keyed priority ladder over the
 *      currently-unlocked jobs.
 */
import type { Action, State } from "@/model";
import type { Subsystem } from "@/policy/types";
import type { JobName } from "@/model/catalogs";
import { JOB_NAMES } from "@/model/catalogs";
import {
  netFlowAt,
  catnipSeasonalFactor,
  WORST_CATNIP_SEASON,
  WORST_CATNIP_WEATHER,
} from "@/model";

const CATNIP_MARGIN = 0; // ≥ 0 net catnip in winter+cold

/**
 * Project catnip net at winter+cold given a hypothetical farmer count.
 * Pure: derives the new production from `catnipPerFarmer`, holds
 * consumption constant (consumption is season-independent and not job-
 * dependent at our resolution).
 */
export function projectedWinterCatnipNet(s: State, nFarmers: number): number {
  const currentFarmers = s.physical.kittens.jobs.farmer ?? 0;
  const currentFactor = s.info.flow.catnipSeasonalFactor;
  const winterFactor = catnipSeasonalFactor(
    WORST_CATNIP_SEASON,
    WORST_CATNIP_WEATHER,
  );
  const factorRatio = currentFactor > 0 ? winterFactor / currentFactor : 1;
  const baseWinterNet = netFlowAt(s, WORST_CATNIP_SEASON, WORST_CATNIP_WEATHER).catnip;

  // perFarmer is at the *current* season; rescale to winter via the same
  // factor ratio that production uses.
  const perFarmerWinter = s.info.flow.catnipPerFarmer * factorRatio;
  const delta = (nFarmers - currentFarmers) * perFarmerWinter;
  return baseWinterNet + delta;
}

/**
 * Smallest non-negative integer farmer count that keeps catnip net ≥ MARGIN
 * in winter+cold. Bounded by total kittens. If perFarmer is non-positive
 * (extraction fallback or a degenerate state), returns total kittens —
 * conservative.
 */
export function farmerFloor(s: State): number {
  const total = s.physical.kittens.total;
  if (total <= 0) return 0;
  if (projectedWinterCatnipNet(s, 0) >= CATNIP_MARGIN) return 0;
  if (s.info.flow.catnipPerFarmer <= 0) return total;

  let lo = 0;
  let hi = total;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (projectedWinterCatnipNet(s, mid) >= CATNIP_MARGIN) hi = mid;
    else lo = mid + 1;
  }
  return Math.min(lo, total);
}

/**
 * Phase-keyed priority order over the *currently-unlocked* jobs (excluding
 * farmer, which gets the floor first). Phases are derived from unlock bits,
 * not a separate enum.
 */
export function priorityLadder(s: State): JobName[] {
  const u = s.info.unlocked.jobs;
  const out: JobName[] = [];
  const push = (j: JobName): void => {
    if (u[j] && j !== "farmer" && !out.includes(j)) out.push(j);
  };
  // Pre-library / early game: scholar > woodcutter > miner > hunter.
  push("scholar");
  push("woodcutter");
  push("miner");
  push("hunter");
  // Mid game: priest, geologist, engineer slot in once unlocked.
  push("priest");
  push("geologist");
  push("engineer");
  return out;
}

export interface JobVector {
  farmer: number;
  woodcutter: number;
  scholar: number;
  hunter: number;
  miner: number;
  priest: number;
  geologist: number;
  engineer: number;
}

export function emptyJobVector(): JobVector {
  return {
    farmer: 0,
    woodcutter: 0,
    scholar: 0,
    hunter: 0,
    miner: 0,
    priest: 0,
    geologist: 0,
    engineer: 0,
  };
}

/**
 * Maximum fraction of kittens we ever route to farmer, even when winter
 * worst-case demands more. The remainder is reserved for non-farmer
 * priority jobs (scholar / woodcutter / etc.). Catnip stockpile +
 * non-winter accumulation cushions the seasonal dip.
 *
 * Without this cap, early-game JobAssignment puts every kitten on farmer
 * (per-kitten consumption × 8 outpaces 8-farmer × winter-multiplier),
 * which means zero scholars, zero science, no tech research, indefinite
 * stall. This cap is the "small dip in winter, recover in spring"
 * tradeoff that lets science get going.
 */
const MAX_FARMER_FRACTION = 0.75;

export function chooseJobs(s: State): JobVector {
  const total = s.physical.kittens.total;
  const out = emptyJobVector();
  if (total <= 0) return out;

  const ladder = priorityLadder(s);
  const wantedFloor = farmerFloor(s);
  // Cap farmer count when there are non-farmer jobs unlocked AND we have
  // enough kittens to reserve at least one for them. Otherwise (no non-
  // farmer jobs unlocked, or 1-2 kittens), let the floor stand.
  const cap =
    ladder.length > 0 && total >= 2
      ? Math.max(1, Math.floor(total * MAX_FARMER_FRACTION))
      : total;
  const minFarmers = Math.min(total, wantedFloor, cap);
  out.farmer = minFarmers;
  let remaining = total - minFarmers;

  if (ladder.length === 0) return out; // nothing else unlocked

  // Reserve 1 hunter once archery is researched, when we have headroom.
  if (s.info.techs.archery && ladder.includes("hunter") && remaining >= 1) {
    out.hunter = 1;
    remaining -= 1;
  }

  // Distribute remainder evenly down the ladder. The first jobs in the
  // ladder absorb the modulo remainder.
  if (remaining > 0 && ladder.length > 0) {
    const baseShare = Math.floor(remaining / ladder.length);
    let extra = remaining - baseShare * ladder.length;
    for (const job of ladder) {
      const bonus = extra > 0 ? 1 : 0;
      out[job] += baseShare + bonus;
      if (extra > 0) extra -= 1;
    }
  }

  return out;
}

function vectorsEqual(a: JobVector, b: Partial<Record<JobName, number>>): boolean {
  for (const j of JOB_NAMES) {
    if ((a[j] ?? 0) !== (b[j] ?? 0)) return false;
  }
  return true;
}

function jobUnlocksDiffer(s: State, prev: State): boolean {
  for (const j of JOB_NAMES) {
    if (s.info.unlocked.jobs[j] !== prev.info.unlocked.jobs[j]) return true;
  }
  return false;
}

export const jobAssignmentSubsystem: Subsystem = {
  name: "job-assignment",
  trigger(s, prev) {
    if (prev == null) return true; // first tick: always assign.
    if (s.info.calendar.season !== prev.info.calendar.season) return true;
    if (s.physical.kittens.total !== prev.physical.kittens.total) return true;
    if (jobUnlocksDiffer(s, prev)) return true;
    return false;
  },
  choose(s): Action | null {
    if (s.physical.kittens.total <= 0) return null;
    const desired = chooseJobs(s);
    if (vectorsEqual(desired, s.physical.kittens.jobs)) return null;
    return { kind: "assign", jobs: desired };
  },
};
