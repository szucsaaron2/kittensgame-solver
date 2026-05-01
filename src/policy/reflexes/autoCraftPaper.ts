/**
 * Just-in-time crafting for the paper chain (parchment → manuscript →
 * compendium → blueprint). Without these, mid-game tech research
 * (theology, electricity, industrialization, ...) is permanently
 * blocked. Existing craft-beam / craft-slab reflexes only fire on
 * cap-drain; paper-chain inputs (furs, culture, science) typically
 * don't hit cap because they're consumed by other paths.
 *
 * Strategy: maintain a target stockpile of N of each crafted good.
 * When stockpile < target AND the craft is feasible (costs satisfied
 * + recipe unlocked + workshop built), fire one craft. Feasibility
 * already enforces the cost gate — we don't need an extra raw-safety
 * threshold; it would just delay crafting unnecessarily.
 *
 * Iterates the chain in dependency order: parchment first (it's the
 * input to manuscript), then manuscript, then compendium, then
 * blueprint. The Layer-1 pipeline only fires one reflex per tick, so
 * the chain naturally fills bottom-up over multiple ticks.
 */
import type { Reflex } from "@/policy/types";
import type { State, Action } from "@/model";
import { feasible } from "@/model";

interface PaperTarget {
  item: "parchment" | "manuscript" | "compedium" | "blueprint";
  /** Stockpile threshold below which we craft. */
  target: number;
}

const PAPER_CHAIN: PaperTarget[] = [
  { item: "parchment", target: 200 },
  { item: "manuscript", target: 100 },
  { item: "compedium", target: 50 },
  { item: "blueprint", target: 30 },
];

function craftIfNeeded(s: State, plan: PaperTarget): Action | null {
  if (!s.info.unlocked.crafts[plan.item]) return null;
  const stock = (s.physical.resources as Record<string, number>)[plan.item] ?? 0;
  if (stock >= plan.target) return null;
  const a: Action = { kind: "craft", item: plan.item, amount: 1 };
  return feasible(s, a) ? a : null;
}

export const autoCraftPaperReflex: Reflex = (s) => {
  for (const plan of PAPER_CHAIN) {
    const a = craftIfNeeded(s, plan);
    if (a) return a;
  }
  return null;
};
