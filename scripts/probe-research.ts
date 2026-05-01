/* eslint-disable no-console */
import { setupGame } from "@/testdriver/setupGame";
import { extract, apply } from "@/simulator";
import {
  runPipeline,
  recordTrace,
  makeStrategicPolicy,
} from "@/policy";
import { feasibilityReport } from "@/model";
import type { State } from "@/model";

const h = setupGame({ seed: 1 });
const fallback = makeStrategicPolicy();
let prevState: State | null = null;

// Run for 150k ticks first.
for (let t = 0; t < 150000; t += 5) {
  const s = extract(h.gamePage);
  const r = runPipeline(s, { prev: prevState, fallback });
  recordTrace(r.trace);
  prevState = s;
  try {
    if (r.trace.action.kind !== "wait") apply(h.gamePage, r.trace.action);
  } catch {
    // ignore
  }
  h.tick(5);
}

// Now probe.
const s = extract(h.gamePage);
console.log("year=", s.info.calendar.year);
console.log("science=", s.physical.resources.science, "/", s.physical.resourceCaps.science);
console.log("catnip=", s.physical.resources.catnip, "/", s.physical.resourceCaps.catnip);
console.log("manpower=", s.physical.resources.manpower, "/", s.physical.resourceCaps.manpower);
console.log("faith=", s.physical.resources.faith, "/", s.physical.resourceCaps.faith);
console.log("astroEvent=", s.info.astronomicalEvent);

// Simulate one pipeline tick on this state — see what fires.
const { runPipeline: rp } = await import("@/policy");
const r = rp(s, { prev: null, fallback });
console.log("pipeline picked:", JSON.stringify(r.trace));

// Check each reflex in order.
const { observeReflex } = await import("@/policy/reflexes/observe");
const { huntReflex } = await import("@/policy/reflexes/hunt");
const { tradeOverflowReflex } = await import("@/policy/reflexes/tradeOverflow");
const { praiseReflex } = await import("@/policy/reflexes/praise");
const { refineCatnipReflex } = await import("@/policy/reflexes/refineCatnip");
const { craftBeamReflex } = await import("@/policy/reflexes/craftBeam");
const { craftSlabReflex } = await import("@/policy/reflexes/craftSlab");
const { autoCraftPaperReflex } = await import("@/policy/reflexes/autoCraftPaper");
const { festivalReflex } = await import("@/policy/reflexes/festival");
const { autoResearchReflex } = await import("@/policy/reflexes/autoResearch");

const order: [string, (s: State) => unknown][] = [
  ["observe", observeReflex],
  ["hunt", huntReflex],
  ["trade-overflow", tradeOverflowReflex],
  ["praise", praiseReflex],
  ["refine-catnip", refineCatnipReflex],
  ["craft-beam", craftBeamReflex],
  ["craft-slab", craftSlabReflex],
  ["craft-paper", autoCraftPaperReflex],
  ["festival", festivalReflex],
  ["auto-research", autoResearchReflex],
];
for (const [name, r] of order) {
  const v = r(s);
  console.log(`  ${name}: ${v ? JSON.stringify(v) : "null"}`);
}

await h.teardown();
