import '@fontsource/titan-one/400.css';
import './SelectionCards.css';

export type SelectionCard = {
  id: string;
  /** The big printed line. */
  title: string;
  /** Smaller line under the title. */
  caption?: string;
  onSelect: () => void;
};

type SelectionCardsProps = {
  /** What the user is choosing at this step, e.g. "Pick a year". */
  prompt: string;
  cards: SelectionCard[];
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

function SignFrame() {
  return (
    <svg className="pick-card__frame" viewBox="0 0 400 250" aria-hidden="true">
      <path d={OUTER} fill="#e3242b" stroke="#000" strokeWidth="6" strokeLinejoin="round" />
      <path
        d={BAND_LINE}
        fill="none"
        stroke="#000"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={SCRIBBLES} fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" />
      <path d={FACE} fill="#fff" stroke="#000" strokeWidth="5" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * One step of the "which schedule do you want" flow: a row of big push-button
 * cards. Each is a hand-inked sign — a red band with black linework around a
 * plain white face — that presses down like a button when clicked.
 */
export default function SelectionCards({ prompt, cards }: SelectionCardsProps) {
  return (
    <section className="selection-cards" aria-label={prompt}>
      <h1 className="selection-cards__prompt">{prompt}</h1>
      <div className="selection-cards__row">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className="pick-card"
            onClick={card.onSelect}
          >
            <SignFrame />
            <span className="pick-card__face">
              <span className="pick-card__title">{card.title}</span>
              {card.caption && <span className="pick-card__caption">{card.caption}</span>}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
