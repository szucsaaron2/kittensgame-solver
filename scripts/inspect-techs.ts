import { setupGame } from "@/testdriver/setupGame";
import { extract } from "@/simulator";

const h = setupGame({ seed: 1 });
h.tick(100);
const s0 = extract(h.gamePage);
const tList = (h.gamePage.science as { metaCache: { tech: { name: string; unlocked?: boolean; researched?: boolean }[] } }).metaCache.tech;

// eslint-disable-next-line no-console
console.log("=== fresh game (after 100 ticks) ===");
// eslint-disable-next-line no-console
console.log("unlocked techs in our extract:", Object.entries(s0.info.unlocked.techs).filter(([, v]) => v).map(([k]) => k));
// eslint-disable-next-line no-console
console.log("engine raw tech.unlocked flags:");
for (const t of tList) {
  // eslint-disable-next-line no-console
  console.log(`  ${t.name}: unlocked=${t.unlocked} researched=${t.researched}`);
}
await h.teardown();
