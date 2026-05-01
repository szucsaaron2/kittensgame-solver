/* eslint-disable no-console */
import { setupGame } from "@/testdriver/setupGame";
import { extract, apply } from "@/simulator";

const h = setupGame({ seed: 1 });
const g = h.gamePage as {
  village: {
    sim: { kittens: { job: string | null }[]; freeKittens?: number };
    getJob: (name: string) => { value: number; unlocked: boolean };
  };
  bld: { get: (name: string) => { val: number; unlocked: boolean; on: number } };
  resPool: { get: (name: string) => { value: number; maxValue: number } };
  getResourcePerTick: (name: string, fast: boolean) => number;
};

// Bootstrap state to ~6 kittens, libraries unlocked, scholar unlocked.
g.bld.get("field").val = 25;
g.bld.get("field").on = 25;
g.bld.get("field").unlocked = true;
g.bld.get("hut").val = 4;
g.bld.get("hut").on = 4;
g.bld.get("hut").unlocked = true;
g.bld.get("library").val = 5;
g.bld.get("library").on = 5;
g.bld.get("library").unlocked = true;
g.resPool.get("catnip").value = 5000;
g.resPool.get("wood").value = 200;

// Manually trigger scholar.calculateEffects to set its modifiers.
type JobMeta = { name: string; modifiers?: Record<string, number>; calculateEffects?: (self: unknown, game: unknown) => void; unlocked?: boolean };
const village = g.village as unknown as { jobs: JobMeta[] };
const scholar = village.jobs.find((j) => j.name === "scholar")!;
console.log("scholar pre-calc modifiers:", scholar.modifiers);
scholar.unlocked = true;
scholar.calculateEffects?.(scholar, g);
console.log("scholar post-calc modifiers:", scholar.modifiers);

h.tick(50);

// Spawn kittens via the engine's own growth.
console.log("after 50 ticks: kittens=", g.village.sim.kittens.length);

// Manually nudge kittens via engine's makeNewKitten if available.
type SimWithMake = { makeNewKitten?: () => void };
const simWithMake = g.village.sim as unknown as SimWithMake;
for (let i = 0; i < 6; i++) {
  if (typeof simWithMake.makeNewKitten === "function") simWithMake.makeNewKitten();
}
h.tick(10);
console.log("after spawn: kittens=", g.village.sim.kittens.length);

console.log(
  "scholar job pre-assign: value=",
  g.village.getJob("scholar")?.value,
  "unlocked=",
  g.village.getJob("scholar")?.unlocked,
);

apply(h.gamePage, { kind: "assign", jobs: { farmer: 4, scholar: 1, woodcutter: 1 } });

console.log("kitten jobs:", g.village.sim.kittens.map((k) => k.job));
console.log("scholar job: value=", g.village.getJob("scholar")?.value);
console.log("farmer job: value=", g.village.getJob("farmer")?.value);

h.tick(20);

console.log("science perTick (engine)=", g.getResourcePerTick("science", true));
console.log("science cap=", g.resPool.get("science").maxValue);
console.log("science value=", g.resPool.get("science").value);

const s = extract(h.gamePage);
console.log("our extract: flow.perTick.science=", s.info.flow.perTick.science);
console.log("our extract: kittens.jobs=", s.physical.kittens.jobs);
console.log("our extract: unlocked.jobs.scholar=", s.info.unlocked.jobs.scholar);

await h.teardown();
