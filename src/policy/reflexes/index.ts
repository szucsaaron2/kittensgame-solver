import type { NamedReflex } from "@/policy/types";
import { observeReflex } from "./observe";
import { huntReflex } from "./hunt";
import { praiseReflex } from "./praise";
import { festivalReflex } from "./festival";
import { refineCatnipReflex } from "./refineCatnip";
import { tradeOverflowReflex } from "./tradeOverflow";

/**
 * Layer 1 reflexes, in priority order. The first reflex whose `fire(s)`
 * returns a non-null action wins.
 *
 * Order rationale:
 *   - observe goes first because the astro flag expires; missing it wastes the
 *     event entirely.
 *   - hunt next: catpower at cap stops accumulating, so draining it ASAP is
 *     pure upside.
 *   - praise: faith cap throttles religion progress similarly.
 *   - festival: opportunistic; only fires when timer empty AND mats affordable.
 *
 * promote-leader is intentionally NOT here yet — it depends on a manuscript-
 * cost projection we haven't snapshotted.
 */
export const REFLEXES: NamedReflex[] = [
  { name: "auto-observe", fire: observeReflex },
  { name: "auto-hunt", fire: huntReflex },
  // auto-trade-overflow runs *after* hunt: hunt drains catpower toward gold/
  // furs first; trade is the fallback drain when hunt isn't available or
  // didn't bring us below cap.
  { name: "auto-trade-overflow", fire: tradeOverflowReflex },
  { name: "auto-praise", fire: praiseReflex },
  { name: "auto-refine-catnip", fire: refineCatnipReflex },
  { name: "auto-festival", fire: festivalReflex },
];
