import { Fragment } from 'react';
import type { CSSProperties } from 'react';
import type { SetTime, Stage } from '../../data/mockSchedule2008';

type StageLabelsProps = {
  stages: Stage[];
};

/**
 * The row of stage names in the header panel. Shares `--board-columns` with the
 * grid below, so each label sits over its own stage column.
 */
export function StageLabels({ stages }: StageLabelsProps) {
  return (
    <div className="board-stages">
      {stages.map((stage) => (
        <div key={stage.id} className="board-stages__label">
          {stage.name}
        </div>
      ))}
    </div>
  );
}

const hourOf = (time: string) => Number(time.slice(0, 2));
const minutesOf = (time: string) => time.slice(3);
/** 24h hour to the 12h label printed on the board: 11 -> 11, 13 -> 1, 20 -> 8. */
const hourLabel = (hour: number) => (hour % 12 === 0 ? 12 : hour % 12);

type ScheduleGridProps = {
  stages: Stage[];
  sets: SetTime[];
  /** False until the inflation timeline finishes; slots are inert before then. */
  interactive: boolean;
  onPick: (set: SetTime) => void;
};

/**
 * One row per hour, shared across every stage, with the hour printed in each
 * stage's time column and only the minutes varying — the way the real boards are
 * laid out. An hour with no set on a stage is simply left blank. Where a stage
 * runs two sets inside one hour they stack, and that hour's row is given extra
 * height so the rows still read as aligned.
 */
export function ScheduleGrid({ stages, sets, interactive, onPick }: ScheduleGridProps) {
  const byStageHour = stages.map((stage) => {
    const hours = new Map<number, SetTime[]>();
    for (const set of sets) {
      if (set.stageId !== stage.id) continue;
      const hour = hourOf(set.startTime);
      const list = hours.get(hour);
      if (list) list.push(set);
      else hours.set(hour, [set]);
    }
    for (const list of hours.values()) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return hours;
  });

  const allHours = sets.map((set) => hourOf(set.startTime));
  const first = Math.min(...allHours);
  const last = Math.max(...allHours);
  const hours = Array.from({ length: last - first + 1 }, (_unused, i) => first + i);

  // A doubled-up hour gets more room, but not double, so the rows stay legible
  // as rows rather than turning into two obviously different sizes.
  const rowTemplate = hours
    .map((hour) => {
      const busiest = byStageHour.reduce(
        (max, stageHours) => Math.max(max, stageHours.get(hour)?.length ?? 0),
        0,
      );
      return `minmax(0, ${1 + 0.6 * Math.max(0, busiest - 1)}fr)`;
    })
    .join(' ');

  return (
    <div
      className={`schedule-grid${interactive ? ' is-interactive' : ''}`}
      style={{ '--grid-rows': `auto ${rowTemplate}` } as CSSProperties}
    >
      {stages.map((stage) => (
        <div key={`head-${stage.id}`} className="grid-head">
          <span className="grid-head__time">Time</span>
          <span className="grid-head__band">Band</span>
        </div>
      ))}

      {hours.map((hour) =>
        stages.map((stage, stageIndex) => {
          const slots = byStageHour[stageIndex].get(hour) ?? [];
          return (
            <Fragment key={`${stage.id}-${hour}`}>
              <div className="hour-cell" data-stage={stageIndex}>
                <span className="hour-cell__hour">{hourLabel(hour)}:</span>
                <span className="hour-cell__slots">
                  {slots.map((set) => (
                    <button
                      key={set.id}
                      type="button"
                      className="slot"
                      disabled={!interactive}
                      onClick={() => onPick(set)}
                    >
                      <span className="slot__min">{minutesOf(set.startTime)}</span>
                      <span className="slot__band">{set.band}</span>
                    </button>
                  ))}
                </span>
              </div>
            </Fragment>
          );
        }),
      )}
    </div>
  );
}
