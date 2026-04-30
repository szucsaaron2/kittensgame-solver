import type { State, Action } from "@/model";

export type Policy = (s: State) => Action;

export interface DriverIO {
  read(): State;
  apply(a: Action): void;
  waitUntilNextEvent(): Promise<void>;
  shouldStop(s: State): boolean;
  onStep?(s: State, a: Action): void;
}

export async function run(policy: Policy, io: DriverIO): Promise<void> {
  for (;;) {
    const s = io.read();
    if (io.shouldStop(s)) return;
    const a = policy(s);
    io.onStep?.(s, a);
    io.apply(a);
    await io.waitUntilNextEvent();
  }
}
