import { setupGame } from "@/testdriver/setupGame";
import { extract } from "@/simulator";

const h = setupGame({ seed: 1 });
h.tick(400);
const s = extract(h.gamePage);

const summary = {
  calendar: s.info.calendar,
  weather: s.info.weather,
  resources: Object.fromEntries(
    Object.entries(s.physical.resources).filter(([, v]) => v > 0),
  ),
  resourceCaps: Object.fromEntries(
    Object.entries(s.physical.resourceCaps).filter(([, v]) => v !== Infinity && v > 0),
  ),
  buildings: Object.fromEntries(
    Object.entries(s.physical.buildings).filter(([, v]) => v > 0),
  ),
  techsResearched: Object.entries(s.info.techs).filter(([, v]) => v).map(([k]) => k),
  workshopResearched: Object.entries(s.info.workshop).filter(([, v]) => v).map(([k]) => k),
  policiesAdopted: Object.entries(s.info.policies).filter(([, v]) => v).map(([k]) => k),
  kittens: s.physical.kittens,
  diplomacyDiscovered: Object.entries(s.info.diplomacyDiscovered).filter(([, v]) => v).map(([k]) => k),
  embassies: Object.fromEntries(
    Object.entries(s.physical.embassies).filter(([, v]) => v > 0),
  ),
  faith: s.info.faith,
  apocrypha: s.info.apocrypha,
  paragon: s.info.paragon,
  karma: s.info.karma,
  energy: s.info.energy,
  happiness: s.info.happiness,
  festivalRemaining: s.info.festivalRemaining,
};

// eslint-disable-next-line no-console
console.log(JSON.stringify(summary, null, 2));
await h.teardown();
