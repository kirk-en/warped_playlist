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
export type Schedule = {
  stages: Stage[];
  sets: SetTime[];
  /** Set when the set times aren't known yet (stages and sets are then empty). */
  note?: string;
};

/** One row of a year's `index.json`: enough to build the selection cards. */
export type ScheduleSummary = {
  /** Also the file name in `schedules/<year>/`, without `.json`. */
  id: string;
  year: number;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  city: string;
  state: string;
  venue: string;
  /** Set when the date can't be picked yet (e.g. no set times); shown as a tooltip. */
  note?: string;
};

// Data lives in schedules/<year>/: an index.json listing that year's dates, plus one
// <id>.json per date. Everything is lazy, so nothing is fetched until it's needed.
const indexLoaders = import.meta.glob<ScheduleSummary[]>('./schedules/*/index.json', {
  import: 'default',
});
const scheduleLoaders = import.meta.glob<Schedule>(['./schedules/*/*.json', '!./schedules/*/index.json'], {
  import: 'default',
});

/** Years that have a folder of data; known from the file names alone, no fetching. */
export const scheduleYears: number[] = Object.keys(indexLoaders)
  .map((path) => Number(path.match(/schedules\/(\d{4})\//)?.[1]))
  .filter(Boolean)
  .sort((a, b) => a - b);

export function loadYearIndex(year: number): Promise<ScheduleSummary[]> {
  const load = indexLoaders[`./schedules/${year}/index.json`];
  if (!load) return Promise.reject(new Error(`No schedules for ${year}`));
  return load();
}

export function loadSchedule(year: number, id: string): Promise<Schedule> {
  const load = scheduleLoaders[`./schedules/${year}/${id}.json`];
  if (!load) return Promise.reject(new Error(`No schedule file for "${id}"`));
  return load();
}
