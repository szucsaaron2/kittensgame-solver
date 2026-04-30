import { describe, it, expect } from "vitest";
import { setupGame } from "@/testdriver/setupGame";

interface Snapshot {
  catnip: number;
  catpower: number;
  year: number;
  season: number;
  day: number;
  ticks: number;
}

function snapshot(handle: ReturnType<typeof setupGame>): Snapshot {
   
  const catnip = handle.gamePage.resPool.get("catnip").value as number;
   
  const catpower = handle.gamePage.resPool.get("manpower").value as number;
  return {
    catnip,
    catpower,
     
    year: handle.gamePage.calendar.year as number,
     
    season: handle.gamePage.calendar.season as number,
     
    day: handle.gamePage.calendar.day as number,
     
    ticks: handle.gamePage.ticks as number,
  };
}

describe("determinism", () => {
  it("same seed + tick count produces identical state", async () => {
    const runOnce = async (): Promise<Snapshot> => {
      const h = setupGame({ seed: 42 });
      h.tick(200);
      const s = snapshot(h);
      await h.teardown();
      return s;
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(a).toEqual(b);
  });

  it("ten runs with identical seed all match", async () => {
    const snaps: Snapshot[] = [];
    for (let i = 0; i < 10; i++) {
      const h = setupGame({ seed: 7 });
      h.tick(100);
      snaps.push(snapshot(h));
      await h.teardown();
    }
    expect(new Set(snaps.map((s) => JSON.stringify(s))).size).toBe(1);
  });
});
