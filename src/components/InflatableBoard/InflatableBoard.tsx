import { useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/barlow-semi-condensed/700.css';
import BoardFrame, { TUBE } from './BoardFrame';
import type { BoardFrameHandle } from './BoardFrame';
import { ScheduleGrid, StageLabels } from './ScheduleGrid';
import { blockedIds, overlaps } from './scheduleSelection';
import logo2008 from '../../assets/warped_tour_2008_logo.gif';
import type { SetTime, Stage } from '../../data/schedule';
import './InflatableBoard.css';

gsap.registerPlugin(useGSAP);

/** Peak idle deflection at the top of the board, in degrees. */
const SWAY_DEG = 0.2;

type InflatableBoardProps = {
  stages: Stage[];
  sets: SetTime[];
  /** Bump to replay the inflation from the deflated state. */
  replaySignal?: number;
};

export default function InflatableBoard({
  stages,
  sets,
  replaySignal = 0,
}: InflatableBoardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<BoardFrameHandle>(null);
  const [inflated, setInflated] = useState(false);

  useGSAP(
    (_context, contextSafe) => {
      const board = stageRef.current;
      const frame = frameRef.current;
      if (!board || !frame) return;

      // The yellow skin lives in the frame SVG and is up from the first frame;
      // what fades in here is everything printed on top of it.
      const printed = gsap.utils.toArray<HTMLElement>('.board-inner', board);
      const headerFooter = gsap.utils.toArray<HTMLElement>(
        '.board-panel--header, .board-panel--footer',
        board,
      );
      const cells = gsap.utils.toArray<HTMLElement>('.hour-cell', board);

      // Spread the column stagger across the 0.2s the grid phase has left after the
      // cells' own 0.3s fade, capped at the brief's 0.04s for small stage counts.
      const COLUMN_STAGGER = Math.min(0.04, 0.2 / Math.max(1, stages.length - 1));

      // The frame is driven imperatively: tweening this proxy and repainting on each
      // tick avoids a React render per animation frame.
      const frameState = { amp: 40, stroke: 4 };
      const paintFrame = () => frame.setFrameState(frameState);

      setInflated(false);

      // contextSafe registers the tween with the useGSAP context even though it is
      // created later, from the timeline's onComplete.
      const scoped = contextSafe ?? ((fn: () => void) => fn);
      const startIdle = scoped(() => {
        // Anchored at the base, like an inflatable pegged to the ground: both
        // parts pivot about the bottom edge, so displacement is nil down there
        // and greatest at the top. Splitting the same total deflection between a
        // rotation and a shear, with the shear running a beat behind, makes the
        // top lag and catch up rather than swinging as one rigid slab.
        const sway = { rotate: SWAY_DEG * 0.55, skew: SWAY_DEG * 0.45 };
        const cycle = {
          duration: 2,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
          transformOrigin: 'bottom center',
        } as const;
        gsap.fromTo(board, { rotation: -sway.rotate }, { rotation: sway.rotate, ...cycle });
        gsap.fromTo(
          board,
          { skewX: -sway.skew },
          { skewX: sway.skew, ...cycle, delay: 0.34 },
        );
      });

      // A direct query rather than gsap.matchMedia(): a matchMedia context nested
      // inside the useGSAP context forms a cycle with contextSafe that revert()
      // walks until the stack overflows.
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;

      if (reduceMotion) {
        frameState.amp = 0;
        frameState.stroke = TUBE;
        paintFrame();
        gsap.set(board, {
          scaleX: 1,
          scaleY: 1,
          skewX: 0,
          rotation: 0,
          transformOrigin: 'bottom center',
        });
        gsap.set(printed, { autoAlpha: 1 });
        gsap.set(headerFooter, { scaleY: 1 });
        gsap.set(cells, { autoAlpha: 1, y: 0 });
        setInflated(true);
        return;
      }

      paintFrame();

      const tl = gsap.timeline({
        onComplete: () => {
          setInflated(true);
          startIdle();
        },
      });

      tl.set(board, {
        transformOrigin: 'bottom center',
        scaleY: 0.06,
        scaleX: 1.04,
        skewX: -6,
        rotation: -1.2,
      })
        .set(printed, { autoAlpha: 0 })
        // Only the header and footer stretch in; the grid panel just fades.
        .set(headerFooter, { scaleY: 0.9, transformOrigin: 'center center' })
        .set(cells, { autoAlpha: 0, y: 6 })
        // Inflate: height and tube thickness rise together, the wrinkle flattens out.
        .to(
          frameState,
          {
            amp: 0,
            stroke: TUBE,
            duration: 1.2,
            ease: 'power2.out',
            onUpdate: paintFrame,
          },
          0,
        )
        .to(
          board,
          { scaleY: 1.08, scaleX: 0.96, duration: 1.2, ease: 'power2.out' },
          0,
        )
        // The left side leads, then the lean resolves to square.
        .to(
          board,
          { skewX: 0, rotation: 0, duration: 1, ease: 'power2.out' },
          0.1,
        )
        // Overshoot settles like squishy vinyl.
        .to(
          board,
          { scaleY: 1, scaleX: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' },
          1.2,
        )
        .to(
          headerFooter,
          { autoAlpha: 1, scaleY: 1, duration: 0.5, ease: 'power2.out' },
          1.4,
        )
        .to(printed, { autoAlpha: 1, duration: 0.4, ease: 'power1.out' }, 1.4)
        // Band names get posted stage column by stage column. The brief's 0.04s step
        // assumed two stages; with nine it would run the grid phase past its 1.7-2.2s
        // window, so the step is scaled to land the last column on 2.2s.
        .to(
          cells,
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.3,
            ease: 'power2.out',
            stagger: (_i, target: HTMLElement) =>
              Number(target.dataset.stage ?? 0) * COLUMN_STAGGER,
          },
          1.7,
        );
    },
    { scope: rootRef, dependencies: [replaySignal], revertOnUpdate: true },
  );

  // Clicking a set adds it to the day; clicking it again removes it. Sets that
  // overlap a chosen one are greyed out as a guide. Clicking a greyed set swaps it
  // in, dropping whichever picks it clashed with.
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const picked = useMemo(
    () => sets.filter((set) => pickedIds.includes(set.id)),
    [sets, pickedIds],
  );
  const blocked = useMemo(() => blockedIds(sets, picked), [sets, picked]);

  const handlePick = (set: SetTime) => {
    setPickedIds((ids) => {
      if (ids.includes(set.id)) return ids.filter((id) => id !== set.id);
      const kept = sets.filter((s) => ids.includes(s.id) && !overlaps(s, set));
      return [...kept.map((s) => s.id), set.id];
    });
  };

  return (
    <div
      className="inflatable-board"
      ref={rootRef}
      style={
        {
          '--board-columns': `repeat(${stages.length}, minmax(0, 1fr))`,
        } as CSSProperties
      }
    >
      {/* The static three-quarter lean lives on its own wrapper: GSAP owns the
          stage's transform, so the two must not share an element. */}
      <div className="inflatable-board__tilt">
        <div className="inflatable-board__stage" ref={stageRef}>
          <BoardFrame ref={frameRef} />
          <div className="board-inner">
            <div className="board-panel board-panel--header">
              <div className="board-header__logo">
                <img src={logo2008} alt="Warped Tour 2008" />
              </div>
              <StageLabels stages={stages} />
            </div>
            <div className="board-panel board-panel--grid">
              <ScheduleGrid
                stages={stages}
                sets={sets}
                interactive={inflated}
                pickedIds={pickedIds}
                blocked={blocked}
                onPick={handlePick}
              />
            </div>
            <div className="board-panel board-panel--footer" />
          </div>
        </div>
      </div>
    </div>
  );
}
