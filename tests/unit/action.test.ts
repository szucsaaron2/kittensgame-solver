import { describe, it, expect } from "vitest";
import { isAction, assertNever, type Action } from "@/model";

describe("Action discrimination", () => {
  it("isAction narrows correctly", () => {
    const a: Action = { kind: "build", building: "field" };
    if (isAction(a, "build")) {
      expect(a.building).toBe("field");
    } else {
      throw new Error("should have narrowed to build");
    }
  });

  it("exhaustiveness check covers every variant", () => {
    function handle(a: Action): string {
      switch (a.kind) {
        case "wait":
          return "wait";
        case "build":
          return `build ${a.building}`;
        case "build-ziggurat":
          return `zig ${a.structure}`;
        case "build-space":
          return `space ${a.planet}/${a.building}`;
        case "build-chronoforge":
          return `cf ${a.building}`;
        case "build-voidspace":
          return `vs ${a.building}`;
        case "research":
          return `research ${a.tech}`;
        case "workshop":
          return `ws ${a.upgrade}`;
        case "religion-upgrade":
          return `ru ${a.upgrade}`;
        case "praise":
          return "praise";
        case "refine-tears":
          return "refine-tears";
        case "refine-tc":
          return "refine-tc";
        case "embassy":
          return `embassy ${a.civ}`;
        case "trade":
          return `trade ${a.civ}x${a.caravans}`;
        case "pact":
          return `pact ${a.civ}`;
        case "assign":
          return "assign";
        case "engineer-assign":
          return "eng";
        case "appoint-leader":
          return `leader ${a.kittenIndex}`;
        case "promote-leader":
          return "promote";
        case "craft":
          return `craft ${a.item} ${a.amount}`;
        case "hunt":
          return "hunt";
        case "observe":
          return "observe";
        case "share-knowledge":
          return "sk";
        case "festival":
          return "fest";
        case "policy":
          return `pol ${a.policy}`;
        case "time-skip":
          return `skip ${a.years}`;
        case "space-launch":
          return `launch ${a.mission}`;
        default:
          return assertNever(a);
      }
    }
    expect(handle({ kind: "wait" })).toBe("wait");
    expect(handle({ kind: "build", building: "field" })).toBe("build field");
  });
});
