import type { LayerTrace } from "./types";

const RING_SIZE = 50;

const ring: LayerTrace[] = [];

export function recordTrace(t: LayerTrace): void {
  ring.push(t);
  if (ring.length > RING_SIZE) ring.shift();
}

export function recentTraces(): LayerTrace[] {
  return ring.slice();
}

export function clearTraces(): void {
  ring.length = 0;
}
