import type { State } from "@/model";
import type { ResourceName } from "@/model/catalogs";

export interface PriceComponent {
  name: ResourceName | "paragon" | "karma";
  val: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * Read base prices from a catalog entry and scale by the price ratio.
 * For unique-purchase items (techs, workshop, policies), pass currentCount=0
 * (they have no priceRatio).
 */
export function readPrices(entry: Any, currentCount = 0): PriceComponent[] {
  const raw = ((entry?.prices ?? entry?.cost ?? []) as Array<{ name: string; val: number }>) || [];
  const ratio = typeof entry?.priceRatio === "number" ? (entry.priceRatio as number) : 1;
  const factor = Math.pow(ratio, currentCount);
  return raw.map((p) => ({
    name: p.name as PriceComponent["name"],
    val: p.val * factor,
  }));
}

/**
 * Returns true iff every price component is paid (paragon/karma costs always
 * fail since those are out of scope).
 */
export function affordable(s: State, prices: PriceComponent[]): boolean {
  for (const p of prices) {
    if (p.name === "paragon" || p.name === "karma") return false;
    const have = s.physical.resources[p.name as ResourceName] ?? 0;
    if (have < p.val) return false;
  }
  return true;
}

/**
 * For storage-limited resources: returns true if every cost can fit under the
 * resource's cap (i.e., we *could* eventually afford it without first
 * upgrading caps).
 */
export function fitsInCap(s: State, prices: PriceComponent[]): boolean {
  for (const p of prices) {
    if (p.name === "paragon" || p.name === "karma") return false;
    const cap = s.physical.resourceCaps[p.name as ResourceName] ?? Infinity;
    if (cap !== Infinity && cap < p.val) return false;
  }
  return true;
}
