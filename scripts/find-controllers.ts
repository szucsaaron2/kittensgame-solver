import { setupGame } from "@/testdriver/setupGame";

const h = setupGame();
const g = h.gamePage as Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function listKeys(obj: any, prefix = "", depth = 0, max = 4): void {
  if (depth > max || obj === null || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (key.toLowerCase().includes("controller") || key.toLowerCase().includes("btn")) {
      // eslint-disable-next-line no-console
      console.log(path, typeof v);
    }
    if (typeof v === "object" && v !== null && !(v instanceof Function) && depth < max) {
      listKeys(v, path, depth + 1, max);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cls = (globalThis as any).classes;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const com = (globalThis as any).com;

// eslint-disable-next-line no-console
console.log("=== classes.* ===");
listKeys(cls);
// eslint-disable-next-line no-console
console.log("\n=== com.* ===");
listKeys(com);

// eslint-disable-next-line no-console
console.log("\n=== gamePage methods of interest ===");
for (const k of ["observeStars", "observeHandler", "observeBtn", "observeBtnRender"]) {
  // eslint-disable-next-line no-console
  console.log(`gamePage.${k}: ${typeof g[k]}`);
}

await h.teardown();
