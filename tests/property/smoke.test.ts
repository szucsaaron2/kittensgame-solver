import { describe, it, expect } from "vitest";
import fc from "fast-check";

describe("property smoke", () => {
  it("addition commutes", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a);
      }),
    );
  });
});
