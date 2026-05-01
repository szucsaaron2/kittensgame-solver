import type { NamedReflex } from "@/policy/types";
import { observeReflex } from "./observe";
import { huntReflex } from "./hunt";
import { praiseReflex } from "./praise";
import { festivalReflex } from "./festival";
import { refineCatnipReflex } from "./refineCatnip";
import { tradeOverflowReflex } from "./tradeOverflow";
import { craftBeamReflex } from "./craftBeam";
import { craftSlabReflex } from "./craftSlab";
import { autoResearchReflex } from "./autoResearch";
import { autoWorkshopReflex } from "./autoWorkshop";
import { autoReligionUpgradeReflex } from "./autoReligionUpgrade";

/**
 * Layer 1 reflexes, in priority order. The first reflex whose `fire(s)`
 * returns a non-null action wins.
 *
 * Order rationale:
 *   - Cap-driven leak-stoppers fire first (observe / hunt / trade-overflow
 *     for catpower; praise for faith; refine-catnip + craft-beam +
 *     craft-slab for production stockpiles). Missing the cap wastes the
 *     resource entirely.
 *   - Festival is opportunistic (cheap upside).
 *   - Auto-buy reflexes (research / workshop / religion) come last:
 *     monotone, one-time purchases that compound when bought ASAP. Order
 *     among them doesn't matter since each fires independently and every
 *     reachable item gets bought eventually.
 *
 * promote-leader is intentionally NOT here yet — it requires a manuscript-
 * cost projection we haven't snapshotted.
 */
export const REFLEXES: NamedReflex[] = [
  { name: "auto-observe", fire: observeReflex },
  { name: "auto-hunt", fire: huntReflex },
  { name: "auto-trade-overflow", fire: tradeOverflowReflex },
  { name: "auto-praise", fire: praiseReflex },
  { name: "auto-refine-catnip", fire: refineCatnipReflex },
  { name: "auto-craft-beam", fire: craftBeamReflex },
  { name: "auto-craft-slab", fire: craftSlabReflex },
  { name: "auto-festival", fire: festivalReflex },
  { name: "auto-research", fire: autoResearchReflex },
  { name: "auto-workshop", fire: autoWorkshopReflex },
  { name: "auto-religion-upgrade", fire: autoReligionUpgradeReflex },
];
