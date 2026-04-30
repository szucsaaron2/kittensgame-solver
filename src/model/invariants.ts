import type { State } from "@/model/state";
import type { ResourceName } from "@/model/catalogs";

export function checkInvariants(s: State): string[] {
  const errors: string[] = [];

  for (const k of Object.keys(s.physical.resources)) {
    const v = s.physical.resources[k as ResourceName];
    if (v < 0) errors.push(`resource ${k} negative: ${String(v)}`);
    const cap = s.physical.resourceCaps[k as ResourceName];
    if (cap !== Infinity && v > cap + 1e-6) {
      errors.push(`resource ${k} exceeds cap: ${String(v)} > ${String(cap)}`);
    }
  }

  for (const k of Object.keys(s.physical.buildings)) {
    const v = s.physical.buildings[k as keyof typeof s.physical.buildings];
    if (v < 0) errors.push(`building ${k} count negative: ${String(v)}`);
    if (!Number.isInteger(v)) errors.push(`building ${k} count non-integer: ${String(v)}`);
  }

  const totalAssigned = Object.values(s.physical.kittens.jobs).reduce((a, b) => a + b, 0);
  if (totalAssigned > s.physical.kittens.total) {
    errors.push(`assigned ${totalAssigned} > total ${s.physical.kittens.total}`);
  }

  if (s.info.calendar.year < 0) errors.push(`year negative: ${s.info.calendar.year}`);
  if (s.info.calendar.day < 0 || s.info.calendar.day >= 401) {
    errors.push(`day out of range: ${s.info.calendar.day}`);
  }
  if (s.info.festivalRemaining < 0) errors.push(`festivalRemaining negative`);
  if (s.info.faith < 0) errors.push(`faith negative`);
  if (s.info.apocrypha < 0) errors.push(`apocrypha negative`);

  return errors;
}
