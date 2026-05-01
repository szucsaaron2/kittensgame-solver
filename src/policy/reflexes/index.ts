import type { NamedReflex } from "@/policy/types";
import { observeReflex } from "./observe";
import { huntReflex } from "./hunt";
import { praiseReflex } from "./praise";
import { festivalReflex } from "./festival";
import { refineCatnipReflex } from "./refineCatnip";
import { tradeOverflowReflex } from "./tradeOverflow";
import { craftBeamReflex } from "./craftBeam";
import { craftSlabReflex } from "./craftSlab";
import { autoCraftPaperReflex } from "./autoCraftPaper";
import { autoResearchReflex } from "./autoResearch";
import { autoWorkshopReflex } from "./autoWorkshop";
import { autoReligionUpgradeReflex } from "./autoReligionUpgrade";
import { autoPolicyReflex } from "./autoPolicy";
import { autoAppointLeaderReflex } from "./autoAppointLeader";
import { autoPromoteLeaderReflex } from "./autoPromoteLeader";

/**
 * Layer 1 reflexes, in priority order. The first reflex whose `fire(s)`
 * returns a non-null action wins.
 *
 * Tier 0 — monotone permanent gains. Removing a goal-clause is strictly
 * more valuable than capturing stockpile overflow. These run first so
 * tech / workshop / religion / policy progress can't be starved by a
 * pinned cap (e.g., catnip-at-cap firing refine every tick forever).
 *
 * Tier 1 — time-sensitive captures. Missing them wastes the resource:
 * astro events expire, catpower / catnip / faith caps stop accumulating.
 *
 * Tier 2 — opportunistic.
 *
 * Original order had Tier 1 above Tier 0 and produced an indefinite
 * tech-research stall: catnip cap pinning fired refine on nearly every
 * tick, blocking auto-research from ever firing despite plenty of
 * science. See DIARY Phase 11.x.
 */
export const REFLEXES: NamedReflex[] = [
  // Tier 0: monotone permanent gains.
  { name: "auto-research", fire: autoResearchReflex },
  { name: "auto-workshop", fire: autoWorkshopReflex },
  { name: "auto-religion-upgrade", fire: autoReligionUpgradeReflex },
  { name: "auto-policy", fire: autoPolicyReflex },
  { name: "auto-appoint-leader", fire: autoAppointLeaderReflex },
  { name: "auto-promote-leader", fire: autoPromoteLeaderReflex },

  // Tier 1: time-sensitive captures.
  { name: "auto-observe", fire: observeReflex },
  { name: "auto-hunt", fire: huntReflex },
  { name: "auto-trade-overflow", fire: tradeOverflowReflex },
  { name: "auto-praise", fire: praiseReflex },
  { name: "auto-refine-catnip", fire: refineCatnipReflex },
  { name: "auto-craft-beam", fire: craftBeamReflex },
  { name: "auto-craft-slab", fire: craftSlabReflex },
  { name: "auto-craft-paper", fire: autoCraftPaperReflex },

  // Tier 2: opportunistic.
  { name: "auto-festival", fire: festivalReflex },
];
