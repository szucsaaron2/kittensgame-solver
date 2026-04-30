import { describe, it, expect, afterEach } from "vitest";
import { setupGame, type GameHandle } from "@/testdriver/setupGame";
import { verifyCatalogs } from "@/simulator/verifyCatalogs";

describe("catalogs", () => {
  let handle: GameHandle | undefined;
  afterEach(async () => {
    await handle?.teardown();
    handle = undefined;
  });

  it("exactly match the live game's metadata", () => {
    handle = setupGame();
    const mismatches = verifyCatalogs(handle.gamePage);
    if (mismatches.length > 0) {
       
      console.error("Catalog mismatches:", JSON.stringify(mismatches, null, 2));
    }
    expect(mismatches).toEqual([]);
  });
});
