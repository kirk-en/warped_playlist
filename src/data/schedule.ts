import index from './schedules/index.json';

export type Stage = { id: string; name: string };
export type SetTime = {
  id: string;
  band: string;
  stageId: string;
  /** 24h HH:MM */
  startTime: string;
  /** As printed on the board. */
  displayTime: string;
};

/** The contents of one date's file in `schedules/`. */
export type Schedule = { stages: Stage[]; sets: SetTime[] };

/** One row of `schedules/index.json`: enough to build the selection cards. */
export type ScheduleSummary = {
  /** Also the file name in `schedules/`, without `.json`. */
  id: string;
  year: number;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  city: string;
  state: string;
  venue: string;
};

export const scheduleIndex: ScheduleSummary[] = index;

// Lazy: each date becomes its own chunk, fetched only when picked.
const loaders = import.meta.glob<Schedule>(['./schedules/*.json', '!./schedules/index.json'], {
  import: 'default',
});

export function loadSchedule(id: string): Promise<Schedule> {
  const load = loaders[`./schedules/${id}.json`];
  if (!load) return Promise.reject(new Error(`No schedule file for "${id}"`));
  return load();
}
