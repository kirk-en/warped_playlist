import '@fontsource/creepster/400.css';
import '@fontsource/fredoka/700.css';
import './SelectionCards.css';

export type SelectionCard = {
  id: string;
  /** The big printed line. */
  title: string;
  /** Optional picture (e.g. a logo) shown above the title. */
  image?: string;
  /** Smaller line under the title. */
  caption?: string;
  /** Greys the card out and blocks selecting it; shown as a tooltip on hover/focus. */
  unavailableNote?: string;
  onSelect: () => void;
};

type SelectionCardsProps = {
  /** What the user is choosing at this step, e.g. "Pick a year". */
  prompt: string;
  cards: SelectionCard[];
  /** "wide" stacks long ticket-style cards, title left and caption right. */
  layout?: 'default' | 'wide';
  /** A short status line under the cards, e.g. "Coming soon". */
  message?: string;
};

/*
 * The hand-inked sign outline, drawn on a 400x250 sheet that matches the card's
 * 16:10 aspect so nothing is stretched. Every edge is a slightly different curve
 * so the sign reads as drawn rather than ruled: the top bows up, the sides lean,
 * the corners are all a little different.
 */
const OUTER =
  'M22 30 C60 12 150 22 210 14 C280 8 350 16 380 26 C392 60 386 120 390 170 C394 205 384 226 372 232 C300 242 200 232 130 240 C80 244 40 236 14 228 C8 190 16 120 10 80 C8 60 14 42 22 30Z';
/** Where the red band ends and the white face begins. */
const FACE =
  'M46 54 C90 42 160 48 212 42 C270 38 330 44 358 52 C364 84 362 130 366 166 C368 190 362 202 354 206 C290 214 210 206 140 212 C96 216 62 210 38 204 C34 170 40 120 36 88 C35 72 40 60 46 54Z';
/** A thin black line drawn inside the red band, just off the outer edge. */
const BAND_LINE =
  'M34 38 C70 26 152 34 210 27 C278 22 344 28 370 38 C378 68 374 124 378 168 C381 196 374 214 366 219 C298 228 200 219 130 226 C84 230 48 224 26 217 C22 186 28 124 24 84 C22 66 28 48 34 38Z';
/** Short flicks of the pen in the band, breaking up the line. */
const SCRIBBLES =
  'M92 24 Q100 19 112 23 M262 17 Q272 12 284 16 M382 96 Q386 104 383 116 M16 150 Q12 160 15 170 M320 234 Q332 230 346 233 M64 236 Q74 232 86 235';

/* The same sign redrawn on a 1000x200 sheet for the wide cards. It is stretched to
   fit (preserveAspectRatio="none") with non-scaling strokes, so the band keeps an
   even thickness at any length. */
const WIDE_OUTER =
  'M22 24 C160 10 380 20 520 12 C700 6 880 16 976 22 C990 50 984 100 990 150 C994 178 984 190 972 194 C800 202 560 192 400 198 C240 202 100 194 14 190 C8 150 16 100 10 62 C8 46 14 32 22 24Z';
const WIDE_FACE =
  'M44 44 C180 34 400 40 530 34 C700 30 860 36 954 42 C960 70 958 110 962 140 C964 160 958 168 950 172 C800 178 570 170 410 175 C260 178 120 172 36 168 C32 138 38 100 34 72 C33 58 38 48 44 44Z';
const WIDE_BAND_LINE =
  'M32 32 C170 22 390 28 525 22 C700 17 870 24 965 30 C973 60 970 105 974 146 C976 168 970 180 962 184 C800 191 560 182 400 188 C245 191 105 184 24 180 C20 145 26 100 22 68 C20 52 26 38 32 32Z';
const WIDE_SCRIBBLES =
  'M200 16 Q212 11 228 15 M700 9 Q712 5 728 8 M982 90 Q986 98 983 110 M14 120 Q10 130 13 140 M840 199 Q856 195 872 198 M150 198 Q162 194 176 197';

function SignFrame({ wide }: { wide: boolean }) {
  const outer = wide ? WIDE_OUTER : OUTER;
  const face = wide ? WIDE_FACE : FACE;
  const bandLine = wide ? WIDE_BAND_LINE : BAND_LINE;
  const scribbles = wide ? WIDE_SCRIBBLES : SCRIBBLES;
  return (
    <svg
      className="pick-card__frame"
      viewBox={wide ? '0 0 1000 200' : '0 0 400 250'}
      preserveAspectRatio={wide ? 'none' : undefined}
      aria-hidden="true"
    >
      <path d={outer} fill="#e3242b" stroke="#000" strokeWidth="6" strokeLinejoin="round" />
      <path
        d={bandLine}
        fill="none"
        stroke="#000"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={scribbles} fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" />
      <path d={face} fill="#fff" stroke="#000" strokeWidth="5" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * One step of the "which schedule do you want" flow: a row of big push-button
 * cards. Each is a hand-inked sign — a red band with black linework around a
 * plain white face — that presses down like a button when clicked.
 */
export default function SelectionCards({ prompt, cards, layout = 'default', message }: SelectionCardsProps) {
  const wide = layout === 'wide';
  return (
    <section
      className={`selection-cards${wide ? ' selection-cards--wide' : ''}`}
      aria-label={prompt}
    >
      <h1 className="selection-cards__prompt">{prompt}</h1>
      <div className="selection-cards__row">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={`pick-card${card.unavailableNote ? ' pick-card--unavailable' : ''}`}
            aria-disabled={card.unavailableNote ? true : undefined}
            aria-describedby={card.unavailableNote ? `${card.id}-note` : undefined}
            onClick={card.unavailableNote ? undefined : card.onSelect}
          >
            <SignFrame wide={wide} />
            <span className={`pick-card__face${card.image ? ' pick-card__face--image' : ''}`}>
              {card.image && <img className="pick-card__image" src={card.image} alt="" />}
              <span className="pick-card__title">{card.title}</span>
              {card.caption && <span className="pick-card__caption">{card.caption}</span>}
            </span>
            {card.unavailableNote && (
              <span id={`${card.id}-note`} role="tooltip" className="pick-card__tooltip">
                {card.unavailableNote}
              </span>
            )}
          </button>
        ))}
      </div>
      {message && (
        <p className="selection-cards__message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
