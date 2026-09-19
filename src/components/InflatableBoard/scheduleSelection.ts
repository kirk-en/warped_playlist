import type { SetTime } from '../../data/schedule';

/** Every set is treated as occupying its start minute through start + 29 min. */
export const SET_WINDOW_MINUTES = 30;

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** Two sets clash when their windows overlap: starts closer than 30 minutes apart. */
export function overlaps(a: SetTime, b: SetTime): boolean {
  return Math.abs(toMinutes(a.startTime) - toMinutes(b.startTime)) < SET_WINDOW_MINUTES;
}

/** Ids of every set (other than the chosen ones) that clashes with a chosen set. */
export function blockedIds(sets: SetTime[], chosen: SetTime[]): Set<string> {
  const blocked = new Set<string>();
  for (const set of sets) {
    if (chosen.some((pick) => pick.id !== set.id && overlaps(pick, set))) {
      blocked.add(set.id);
    }
  }
  return blocked;
}
