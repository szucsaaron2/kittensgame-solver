import { describe, it, expect, afterEach } from "vitest";
import { setupGame, type GameHandle } from "@/testdriver/setupGame";
import { run, type DriverIO } from "@/driver/loop";
import { noopPolicy } from "@/policy/noop";
import { makeTestIO } from "@/testdriver/driver";

describe("driver loop", () => {
  let handle: GameHandle | undefined;
  afterEach(async () => {
    await handle?.teardown();
    handle = undefined;
  });

  it("runs no-op policy for many iterations without crashing", async () => {
    handle = setupGame();
    const base = makeTestIO(handle, 10);
    let iterations = 0;
    const cap: DriverIO = {
      read: base.read,
      apply: base.apply,
      waitUntilNextEvent: base.waitUntilNextEvent,
      shouldStop: (s) => {
        iterations++;
        return base.shouldStop(s) || iterations > 50;
      },
    };
    await run(noopPolicy, cap);
    expect(iterations).toBeGreaterThan(40);
  });
});
