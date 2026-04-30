import { describe, it, expect, afterEach } from "vitest";
import { setupGame, type GameHandle } from "@/testdriver/setupGame";
import { extract } from "@/simulator";

describe("adapter", () => {
  let handle: GameHandle | undefined;
  afterEach(async () => {
    await handle?.teardown();
    handle = undefined;
  });

  it("extract returns a valid State from a fresh game", () => {
    handle = setupGame();
    const s = extract(handle.gamePage);
    expect(s.physical).toBeDefined();
    expect(s.info).toBeDefined();
    expect(s.belief).toEqual({});
  });
});
