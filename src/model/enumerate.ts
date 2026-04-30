/**
 * enumerateFeasibleActions(s): every legal *discrete-payload* action.
 *
 * Continuous- or large-discrete-payload actions (assign, engineer-assign,
 * craft, time-skip, appoint-leader, space-launch with mission options) are
 * NOT enumerated here — the policy generates candidates for those on demand.
 */
import type { Action, State } from "@/model";
import { feasible } from "@/model";
import {
  BUILDING_NAMES,
  ZIGGURAT_NAMES,
  CHRONOFORGE_NAMES,
  VOIDSPACE_NAMES,
  TECH_NAMES,
  WORKSHOP_NAMES,
  RELIGION_UPGRADE_NAMES,
  PLANET_NAMES,
  PLANET_BUILDING_NAMES,
  CIV_NAMES,
  POLICY_NAMES,
  SPACE_PROGRAM_NAMES,
} from "@/model/catalogs";

export function enumerateFeasibleActions(s: State): Action[] {
  const out: Action[] = [{ kind: "wait" }, { kind: "gather-catnip" }];

  const tryAdd = (a: Action): void => {
    if (feasible(s, a)) out.push(a);
  };

  for (const b of BUILDING_NAMES) tryAdd({ kind: "build", building: b });
  for (const z of ZIGGURAT_NAMES) tryAdd({ kind: "build-ziggurat", structure: z });
  for (const planet of PLANET_NAMES) {
    for (const bld of PLANET_BUILDING_NAMES[planet] ?? []) {
      tryAdd({ kind: "build-space", planet, building: bld });
    }
  }
  for (const c of CHRONOFORGE_NAMES) tryAdd({ kind: "build-chronoforge", building: c });
  for (const v of VOIDSPACE_NAMES) tryAdd({ kind: "build-voidspace", building: v });
  for (const t of TECH_NAMES) tryAdd({ kind: "research", tech: t });
  for (const w of WORKSHOP_NAMES) tryAdd({ kind: "workshop", upgrade: w });
  for (const ru of RELIGION_UPGRADE_NAMES) tryAdd({ kind: "religion-upgrade", upgrade: ru });
  for (const p of POLICY_NAMES) tryAdd({ kind: "policy", policy: p });
  for (const m of SPACE_PROGRAM_NAMES) tryAdd({ kind: "space-launch", mission: m });

  // Field actions (no payload).
  tryAdd({ kind: "praise" });
  tryAdd({ kind: "hunt" });
  tryAdd({ kind: "observe" });
  tryAdd({ kind: "share-knowledge" });
  tryAdd({ kind: "festival" });
  tryAdd({ kind: "promote-leader" });
  tryAdd({ kind: "refine-tears" });
  tryAdd({ kind: "refine-tc" });

  // Diplomacy.
  for (const civ of CIV_NAMES) {
    tryAdd({ kind: "embassy", civ });
    tryAdd({ kind: "pact", civ });
    tryAdd({ kind: "trade", civ, caravans: 1 });
  }

  return out;
}
