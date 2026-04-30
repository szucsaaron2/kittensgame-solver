import type { Action, State } from "@/model";

export type LayerNumber = 0 | 1 | 2 | 3;

export interface LayerTrace {
  layer: LayerNumber;
  source: string;
  action: Action;
  ts: number;
}

export type Reflex = (s: State) => Action | null;
export interface NamedReflex {
  name: string;
  fire: Reflex;
}

export interface Subsystem {
  name: string;
  trigger: (s: State, prev: State | null) => boolean;
  choose: (s: State) => Action | null;
}

export type StrategicPolicy = (s: State) => Action;

export type GuardFn = (s: State, actions: Action[]) => Action[];
