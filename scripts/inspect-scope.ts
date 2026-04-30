import * as c from "@/model/catalogs";

const tag = (name: string, oos: string[]): void => {
  // eslint-disable-next-line no-console
  console.log(`${name} oos (${oos.length}): ${oos.length ? oos.join(", ") : "(none)"}`);
};

tag(
  "TECH",
  Object.entries(c.TECH_META)
    .filter(([, v]) => !v.inScope)
    .map(([k]) => k),
);
tag(
  "WORKSHOP",
  Object.entries(c.WORKSHOP_META)
    .filter(([, v]) => !v.inScope)
    .map(([k]) => k),
);
tag(
  "CHRONOFORGE",
  Object.entries(c.CHRONOFORGE_META)
    .filter(([, v]) => !v.inScope)
    .map(([k]) => k),
);
tag(
  "VOIDSPACE",
  Object.entries(c.VOIDSPACE_META)
    .filter(([, v]) => !v.inScope)
    .map(([k]) => k),
);
tag(
  "TRANSCENDENCE",
  Object.entries(c.TRANSCENDENCE_META)
    .filter(([, v]) => !v.inScope)
    .map(([k]) => k),
);
tag(
  "RELIGION",
  Object.entries(c.RELIGION_UPGRADE_META)
    .filter(([, v]) => !v.inScope)
    .map(([k]) => k),
);
tag(
  "ZIGGURAT",
  Object.entries(c.ZIGGURAT_META)
    .filter(([, v]) => !v.inScope)
    .map(([k]) => k),
);
tag(
  "POLICY",
  Object.entries(c.POLICY_META)
    .filter(([, v]) => !v.inScope)
    .map(([k]) => k),
);
tag(
  "VOID_UPGRADE",
  Object.entries(c.VOID_UPGRADE_META)
    .filter(([, v]) => !v.inScope)
    .map(([k]) => k),
);
const prestigeTotal = Object.keys(c.PRESTIGE_PERK_META).length;
const prestigeOos = Object.values(c.PRESTIGE_PERK_META).filter((v) => !v.inScope).length;
// eslint-disable-next-line no-console
console.log(`PRESTIGE_PERK total=${prestigeTotal} oos=${prestigeOos}`);
// eslint-disable-next-line no-console
console.log(`CRYPTOTHEOLOGY total=${Object.keys(c.CRYPTOTHEOLOGY_META).length}`);
