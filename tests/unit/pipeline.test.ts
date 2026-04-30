import { describe, it, expect } from "vitest";
import { runPipeline, type PipelineContext } from "@/policy";
import { initialState } from "@/model/initialState";
import type { Action, State } from "@/model";
import type { NamedReflex, StrategicPolicy, Subsystem } from "@/policy/types";

const fallbackWait: StrategicPolicy = () => ({ kind: "wait" });

function ctx(over: Partial<PipelineContext> = {}): PipelineContext {
  return {
    prev: null,
    reflexes: [],
    subsystems: [],
    fallback: fallbackWait,
    ...over,
  };
}

describe("policy pipeline (Phase 0)", () => {
  it("falls through to Layer 3 when no reflex/subsystem produces an action", () => {
    const s = initialState();
    const r = runPipeline(s, ctx());
    expect(r.action.kind).toBe("wait");
    expect(r.trace.layer).toBe(3);
    expect(r.trace.source).toBe("fallback");
  });

  it("Layer-1 reflex wins over Layer-3 fallback", () => {
    const s = initialState();
    const reflex: NamedReflex = {
      name: "test-reflex",
      fire: () => ({ kind: "gather-catnip" }),
    };
    const r = runPipeline(s, ctx({ reflexes: [reflex] }));
    expect(r.action.kind).toBe("gather-catnip");
    expect(r.trace.layer).toBe(1);
    expect(r.trace.source).toBe("test-reflex");
  });

  it("Layer-2 subsystem wins over Layer-3 fallback when triggered", () => {
    const s = initialState();
    const sub: Subsystem = {
      name: "test-sub",
      trigger: () => true,
      choose: () => ({ kind: "gather-catnip" } as Action),
    };
    const r = runPipeline(s, ctx({ subsystems: [sub] }));
    expect(r.action.kind).toBe("gather-catnip");
    expect(r.trace.layer).toBe(2);
    expect(r.trace.source).toBe("test-sub");
  });

  it("Layer-2 subsystem is skipped when its trigger is false", () => {
    const s = initialState();
    const sub: Subsystem = {
      name: "test-sub",
      trigger: () => false,
      choose: () => ({ kind: "gather-catnip" } as Action),
    };
    const r = runPipeline(s, ctx({ subsystems: [sub] }));
    expect(r.action.kind).toBe("wait");
    expect(r.trace.layer).toBe(3);
  });

  it("Layer-1 reflex wins over Layer-2 subsystem", () => {
    const s = initialState();
    const reflex: NamedReflex = {
      name: "r1",
      fire: () => ({ kind: "refine-catnip" }),
    };
    const sub: Subsystem = {
      name: "s1",
      trigger: () => true,
      choose: () => ({ kind: "gather-catnip" } as Action),
    };
    const r = runPipeline(s, ctx({ reflexes: [reflex], subsystems: [sub] }));
    expect(r.action.kind).toBe("refine-catnip");
    expect(r.trace.layer).toBe(1);
  });

  it("a reflex that returns null is skipped", () => {
    const s = initialState();
    const r1: NamedReflex = { name: "skip", fire: () => null };
    const r2: NamedReflex = { name: "fire", fire: () => ({ kind: "gather-catnip" }) };
    const r = runPipeline(s, ctx({ reflexes: [r1, r2] }));
    expect(r.action.kind).toBe("gather-catnip");
    expect(r.trace.source).toBe("fire");
  });

  it("trigger receives the prev state argument", () => {
    const s = initialState();
    const prev: State = initialState();
    let seenPrev: State | null | undefined;
    const sub: Subsystem = {
      name: "test",
      trigger: (_s, p) => {
        seenPrev = p;
        return false;
      },
      choose: () => null,
    };
    runPipeline(s, ctx({ prev, subsystems: [sub] }));
    expect(seenPrev).toBe(prev);
  });

  it("wait actions are not blocked by the guard", () => {
    const s = initialState();
    const reflex: NamedReflex = {
      name: "waiter",
      fire: () => ({ kind: "wait" }),
    };
    const r = runPipeline(s, ctx({ reflexes: [reflex] }));
    expect(r.action.kind).toBe("wait");
    expect(r.trace.layer).toBe(1);
    expect(r.trace.source).toBe("waiter");
  });
});
