import { setupGame } from "@/testdriver/setupGame";

const h = setupGame();
const g = h.gamePage;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dump = (label: string, entry: any): void => {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} ===`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry, (_k, v) => (typeof v === "function" ? "[fn]" : v), 2).slice(0, 800));
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
dump("building:field", g.bld.get("field"));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
dump("building:hut", g.bld.get("hut"));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
dump("tech:calendar", g.science.get("calendar"));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
dump("tech:civilService", g.science.get("civilService"));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
dump("workshop:mineralHoes", g.workshop.get("mineralHoes"));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
dump("religion:solarchant", g.religion.getRU("solarchant"));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
dump("ziggurat:unicornTomb", g.religion.getZU("unicornTomb"));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
dump("chronoforge:temporalBattery", g.time.getCFU("temporalBattery"));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
dump("voidspace:cryochambers", g.time.getVSU("cryochambers"));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
dump("policy:liberty", g.science.getPolicy("liberty"));

await h.teardown();
