import { describe, it, expect, afterEach } from "vitest";
import { setupGame, type GameHandle } from "@/testdriver/setupGame";

describe("game boot", () => {
  let handle: GameHandle | undefined;
  afterEach(async () => {
    await handle?.teardown();
    handle = undefined;
  });

  it("boots and exposes gamePage", () => {
    handle = setupGame();
    expect(handle.gamePage).toBeDefined();
    expect(handle.gamePage.resPool).toBeDefined();
    const catnip = handle.gamePage.resPool.get("catnip");
    expect(catnip).toBeDefined();
    expect(catnip.value).toBe(0);
  });
});
