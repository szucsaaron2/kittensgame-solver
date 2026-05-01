import type { Reflex } from "@/policy/types";
import { feasible } from "@/model";
import type { PolicyName } from "@/model/catalogs";

/**
 * Canonical policy picks, in preference order.
 *
 * Each line resolves a mutually-exclusive slot per upstream science.js
 * `blocks: [...]` definitions. Choices follow consensus-strategy guidance
 * from the Kittens Game wiki (Monstrous Advice / Sagefault's Endgame Guide):
 *
 *  - liberty over tradition: stronger long-term job production buff.
 *  - monarchy over authocracy/republic/communism: leader bonus is the most
 *    impactful early/mid-game buff.
 *  - liberalism over communism/fascism: trade-heavy economies dominate.
 *  - scientificCommunism: solo policy (no blocks).
 *  - theocracy over technocracy/expansionism: religion → apocrypha → upgrades
 *    is the canonical late-game multiplier loop.
 *  - transkittenism over necrocracy/radicalXenophobia: highest production
 *    ceiling.
 *  - diplomacy over isolationism, zebraRelationsAppeasement over Bellicosity,
 *    knowledgeSharing over culturalExchange, cityOnAHill over bigStickPolicy,
 *    outerSpaceTreaty over militarizeSpace: consistently buff trade rolls.
 *  - Civ-relation triplets: pick the variant that produces the resource we
 *    can't easily farm (manuscripts, compendium, megalith, science).
 *  - stoicism / carnivale / frugality / rationality: lifestyle policies that
 *    pair best with monarchy + transkittenism.
 *  - environmentalism (over stripMining/clearCutting), fullIndustrialization
 *    (over sustainability), openWoodlands (over conservation): production-
 *    biased mid-late ecology.
 *  - siphoning: only relevant if we accumulate necrocorn; low priority.
 *
 * Implementation: iterate the list; fire the first policy that's unlocked,
 * not yet researched, not blocked, and affordable (feasibility wraps all
 * four). Policies blocked by an earlier pick simply fail feasibility, so
 * the order encodes the strategy without explicit branching.
 */
const PREFERRED_POLICIES: readonly PolicyName[] = [
  "liberty",
  "monarchy",
  "scientificCommunism",
  "liberalism",
  "theocracy",
  "transkittenism",
  "diplomacy",
  "zebraRelationsAppeasement",
  "knowledgeSharing",
  "cityOnAHill",
  "outerSpaceTreaty",
  "lizardRelationsEcologists",
  "sharkRelationsScribes",
  "griffinRelationsMachinists",
  "nagaRelationsArchitects",
  "spiderRelationsPaleontologists",
  "dragonRelationsPhysicists",
  "stoicism",
  "carnivale",
  "frugality",
  "rationality",
  "environmentalism",
  "fullIndustrialization",
  "openWoodlands",
  "terraformingInsight",
  "siphoning",
];

export const autoPolicyReflex: Reflex = (s) => {
  for (const policy of PREFERRED_POLICIES) {
    if (s.info.policies[policy]) continue;
    if (s.info.policyBlocked[policy]) continue;
    const a = { kind: "policy" as const, policy };
    if (feasible(s, a)) return a;
  }
  return null;
};
