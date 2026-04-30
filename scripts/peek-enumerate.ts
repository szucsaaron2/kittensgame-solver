import { setupGame } from "@/testdriver/setupGame";
import { extract } from "@/simulator";
import { enumerateFeasibleActions } from "@/model";

const h = setupGame({ seed: 1 });
const g = h.gamePage;

// Mid-game: give moderate resources, unlock several techs and buildings.
g.resPool.get("catnip").value = 5000;
g.resPool.get("wood").value = 3000;
g.resPool.get("minerals").value = 2000;
g.resPool.get("science").value = 1000;
g.resPool.get("culture").value = 200;
g.resPool.get("manpower").value = 600;
g.resPool.get("faith").value = 300;
g.resPool.get("iron").value = 200;
g.resPool.get("coal").value = 100;

// Unlock starter buildings + first wave of techs.
for (const b of ["field", "hut", "library", "barn", "mine", "lumberMill", "pasture", "academy"]) {
  const m = g.bld.get(b);
  if (m) m.unlocked = true;
}
for (const t of ["calendar", "agriculture", "archery", "mining"]) {
  const m = g.science.get(t);
  if (m) m.unlocked = true;
}
g.science.get("calendar").researched = true;

const s = extract(g);
const actions = enumerateFeasibleActions(s);

// eslint-disable-next-line no-console
console.log(`total feasible actions: ${actions.length}`);
const byKind: Record<string, number> = {};
for (const a of actions) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
// eslint-disable-next-line no-console
console.log("by kind:", byKind);
// eslint-disable-next-line no-console
console.log("\nsample (first 30):");
for (const a of actions.slice(0, 30)) {
  // eslint-disable-next-line no-console
  console.log(" ", JSON.stringify(a));
}

await h.teardown();
