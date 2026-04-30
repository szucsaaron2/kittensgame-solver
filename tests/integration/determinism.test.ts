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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const catnip = handle.gamePage.resPool.get("catnip").value as number;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const catpower = handle.gamePage.resPool.get("manpower").value as number;
  return {
    catnip,
    catpower,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    year: handle.gamePage.calendar.year as number,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    season: handle.gamePage.calendar.season as number,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    day: handle.gamePage.calendar.day as number,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
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
