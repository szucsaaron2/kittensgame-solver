import { describe, it, expect, beforeEach } from "vitest";
import { recordTrace, recentTraces, clearTraces } from "@/policy";

describe("trace ring buffer (Phase 0)", () => {
  beforeEach(() => clearTraces());

  it("records and returns recent traces in order", () => {
    recordTrace({ layer: 1, source: "a", action: { kind: "wait" }, ts: 1 });
    recordTrace({ layer: 3, source: "b", action: { kind: "wait" }, ts: 2 });
    const t = recentTraces();
    expect(t).toHaveLength(2);
    expect(t[0]?.source).toBe("a");
    expect(t[1]?.source).toBe("b");
  });

  it("caps the ring at the configured size", () => {
    for (let i = 0; i < 100; i++) {
      recordTrace({ layer: 3, source: `s${i}`, action: { kind: "wait" }, ts: i });
    }
    const t = recentTraces();
    expect(t.length).toBeLessThanOrEqual(50);
    // Most recent entries are retained.
    expect(t[t.length - 1]?.source).toBe("s99");
  });
});
