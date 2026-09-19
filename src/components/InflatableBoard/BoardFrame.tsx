import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/** Tube thickness and corner radius stay constant in px at every board size. */
export const TUBE = 50;
const RADIUS = 56;

export type FrameState = {
  /** Wrinkle amplitude in px. 0 = smooth rounded rectangle. */
  amp: number;
  /** Current tube thickness in px (animated up from 4 while inflating). */
  stroke: number;
};

export type BoardFrameHandle = {
  setFrameState: (state: FrameState) => void;
};

type Pt = { x: number; y: number; nx: number; ny: number };
type Seg = { len: number; at: (u: number) => Pt };

/** The rounded-rect outline as eight length-parameterised segments with outward normals. */
function segments(w: number, h: number, inset: number, radius: number): Seg[] {
  const x1 = inset;
  const y1 = inset;
  const x2 = w - inset;
  const y2 = h - inset;
  const r = Math.max(0, Math.min(radius, (x2 - x1) / 2, (y2 - y1) / 2));
  const hx = Math.max(0, x2 - x1 - 2 * r);
  const vy = Math.max(0, y2 - y1 - 2 * r);
  const quarter = (Math.PI / 2) * r;

  const arc = (cx: number, cy: number, a0: number): Seg => ({
    len: quarter,
    at: (u) => {
      const a = a0 + u * (Math.PI / 2);
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      return { x: cx + r * nx, y: cy + r * ny, nx, ny };
    },
  });

  return [
    { len: hx, at: (u) => ({ x: x1 + r + u * hx, y: y1, nx: 0, ny: -1 }) },
    arc(x2 - r, y1 + r, -Math.PI / 2),
    { len: vy, at: (u) => ({ x: x2, y: y1 + r + u * vy, nx: 1, ny: 0 }) },
    arc(x2 - r, y2 - r, 0),
    { len: hx, at: (u) => ({ x: x2 - r - u * hx, y: y2, nx: 0, ny: 1 }) },
    arc(x1 + r, y2 - r, Math.PI / 2),
    { len: vy, at: (u) => ({ x: x1, y: y2 - r - u * vy, nx: -1, ny: 0 }) },
    arc(x1 + r, y1 + r, Math.PI),
  ];
}

/** Sum of sines at integer frequencies, so the noise wraps seamlessly around the loop. */
const WAVES = [
  { f: 7, a: 0.55, p: 0.9 },
  { f: 13, a: 0.3, p: 2.3 },
  { f: 23, a: 0.15, p: 5.1 },
];

function wrinkle(t: number): number {
  let n = 0;
  for (const w of WAVES) n += w.a * Math.sin(2 * Math.PI * w.f * t + w.p);
  return n;
}

function catmullRomClosed(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d +=
      ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)},` +
      ` ${c2x.toFixed(2)} ${c2y.toFixed(2)},` +
      ` ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return `${d} Z`;
}

function exactPath(w: number, h: number, inset: number, radius: number): string {
  const x1 = inset;
  const y1 = inset;
  const x2 = w - inset;
  const y2 = h - inset;
  const r = Math.max(0, Math.min(radius, (x2 - x1) / 2, (y2 - y1) / 2));
  return (
    `M ${x1 + r} ${y1} L ${x2 - r} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y1 + r}` +
    ` L ${x2} ${y2 - r} A ${r} ${r} 0 0 1 ${x2 - r} ${y2}` +
    ` L ${x1 + r} ${y2} A ${r} ${r} 0 0 1 ${x1} ${y2 - r}` +
    ` L ${x1} ${y1 + r} A ${r} ${r} 0 0 1 ${x1 + r} ${y1} Z`
  );
}

/**
 * Sample the wrinkled centreline once per frame, keeping each point's outward
 * normal. Every tube layer is a concentric offset of these same points, so the
 * expensive sampling happens once no matter how many layers are stacked.
 */
function samplePoints(w: number, h: number, inset: number, radius: number, amp: number): Pt[] {
  const segs = segments(w, h, inset, radius);
  const total = segs.reduce((sum, seg) => sum + seg.len, 0);
  if (total <= 0) return [];

  // Every band rebuilds its own path each tick, so the point count is the cost
  // driver; this is ample while the frame is crumpled and animating.
  const count = Math.min(260, Math.max(96, Math.round(total / 18)));
  const pts: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    let s = t * total;
    let si = 0;
    while (si < segs.length - 1 && s > segs[si].len) {
      s -= segs[si].len;
      si += 1;
    }
    const seg = segs[si];
    const p = seg.at(seg.len > 0 ? s / seg.len : 0);
    const d = amp * wrinkle(t);
    pts.push({ x: p.x + p.nx * d, y: p.y + p.ny * d, nx: p.nx, ny: p.ny });
  }
  return pts;
}

/**
 * A rounded rectangle offset inward by k along its outward normal is exactly the
 * rounded rectangle at inset+k with radius-k, so concentric layers are a cheap
 * displacement of the sampled points rather than a fresh sampling pass.
 */
function offsetPath(pts: Pt[], k: number): string {
  if (pts.length === 0) return '';
  return catmullRomClosed(pts.map((p) => ({ x: p.x - p.nx * k, y: p.y - p.ny * k })));
}

type Layer = {
  offset: number;
  width: number;
  stroke: string;
  opacity?: number;
  mask?: string;
};

/**
 * Cross-section of the vinyl bolster as a colour ramp: position 0 is the outer
 * edge, 1 is where it meets the panel.
 *
 * The profile is deliberately asymmetric rather than a centred cylinder. There
 * is a short, steep rise on the outside to a crest about a third of the way
 * across, then a long graded fall into deep shade at the panel. That is the
 * silhouette of a ramp seen from the landing, and it is what makes the border
 * read as a thick wedge rather than as a pipe.
 */
const PROFILE: [number, string][] = [
  [0.0, '#5E0A0A'],
  [0.06, '#9A1717'],
  [0.16, '#CE2525'],
  [0.26, '#E85555'],
  [0.33, '#F47C7C'],
  [0.42, '#E04242'],
  [0.55, '#C92424'],
  [0.7, '#A81818'],
  [0.84, '#851010'],
  [1.0, '#5A0909'],
];

/** Bands the ramp is drawn with. Enough that the steps read as a smooth slope. */
const BANDS = 18;

function sampleProfile(t: number): string {
  let i = 1;
  while (i < PROFILE.length - 1 && PROFILE[i][0] < t) i += 1;
  const [t0, c0] = PROFILE[i - 1];
  const [t1, c1] = PROFILE[i];
  const k = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const mix = (a: string, b: string, at: number) => {
    const ch = (h: string, o: number) => parseInt(h.slice(o, o + 2), 16);
    const v = (o: number) => Math.round(ch(a, o) + (ch(b, o) - ch(a, o)) * at);
    return `#${[1, 3, 5].map((o) => v(o).toString(16).padStart(2, '0')).join('')}`;
  };
  return mix(c0, c1, k);
}

/**
 * Concentric bands across the tube, painted outer to inner. Each is slightly
 * wider than its slice so it covers its predecessor's seam. `offset` and `width`
 * are fractions of the tube thickness; positive offset moves a band inward.
 */
const LAYERS: Layer[] = [
  ...Array.from({ length: BANDS }, (_unused, i): Layer => {
    const a = i / BANDS;
    const b = (i + 1) / BANDS;
    const centre = (a + b) / 2;
    return {
      offset: centre - 0.5,
      width: b - a + 0.03,
      stroke: sampleProfile(centre),
    };
  }),
  // A sheen along the crest, upper edges only. Kept soft: a hot white line reads
  // as chrome rather than vinyl.
  {
    offset: -0.17,
    width: 0.08,
    stroke: '#FFC0C0',
    opacity: 0.45,
    mask: 'board-light-top',
  },
  {
    offset: 0.24,
    width: 0.08,
    stroke: '#E86A6A',
    opacity: 0.28,
    mask: 'board-light-bottom',
  },
  // Welded seam where the bolster meets the panels.
  { offset: 0.48, width: 0.035, stroke: '#4A0707', opacity: 0.6 },
];

const BoardFrame = forwardRef<BoardFrameHandle>(function BoardFrame(_props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<SVGPathElement>(null);
  const maskRef = useRef<SVGPathElement>(null);
  const layerRefs = useRef<(SVGPathElement | null)[]>([]);

  const sizeRef = useRef({ w: 0, h: 0 });
  const stateRef = useRef<FrameState>({ amp: 0, stroke: TUBE });
  const [size, setSize] = useState({ w: 0, h: 0 });

  const paint = useCallback(() => {
    const { w, h } = sizeRef.current;
    const { amp, stroke } = stateRef.current;
    if (w <= 0 || h <= 0) return;

    const half = stroke / 2;
    const wrinkled = amp >= 0.05;
    // One sampling pass feeds every layer while the frame is still crumpled; at
    // rest each layer emits exact arcs so the corner radius stays geometrically true.
    const pts = wrinkled ? samplePoints(w, h, half, RADIUS, amp) : [];
    const pathAt = (k: number) =>
      wrinkled ? offsetPath(pts, k) : exactPath(w, h, half + k, Math.max(2, RADIUS - k));

    LAYERS.forEach((layer, i) => {
      const el = layerRefs.current[i];
      if (!el) return;
      el.setAttribute('d', pathAt(layer.offset * stroke));
      el.setAttribute('stroke-width', String(layer.width * stroke));
    });

    const silhouette = pathAt(0);
    for (const el of [shadowRef.current, maskRef.current]) {
      if (!el) continue;
      el.setAttribute('d', silhouette);
      el.setAttribute('stroke-width', String(stroke));
    }
  }, []);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0].contentRect;
      const w = Math.round(box.width);
      const h = Math.round(box.height);
      sizeRef.current = { w, h };
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-lay out the frame whenever the container changes size, keeping the current
  // wrinkle/stroke state so a resize never restarts the animation.
  useLayoutEffect(() => {
    paint();
  }, [size, paint]);

  useImperativeHandle(
    ref,
    () => ({
      setFrameState: (next: FrameState) => {
        stateRef.current = next;
        paint();
      },
    }),
    [paint],
  );

  return (
    <div className="board-frame-host" ref={hostRef}>
      <svg
        className="board-frame"
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <filter id="board-frame-shadow" x="-14%" y="-14%" width="128%" height="142%">
            <feGaussianBlur stdDeviation="13" />
          </filter>

          {/* Specular only on the upper edges, bounce light only on the lower ones. */}
          <linearGradient id="board-light-top-grad" x1="0.1" y1="0" x2="0.5" y2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.4" stopColor="#fff" stopOpacity="0.6" />
            <stop offset="0.78" stopColor="#000" />
          </linearGradient>
          <linearGradient id="board-light-bottom-grad" x1="0" y1="0" x2="0.2" y2="1">
            <stop offset="0.5" stopColor="#000" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.85" />
          </linearGradient>
          {/* Overall form: light falling from the upper left across the whole tube. */}
          <linearGradient id="board-dir-grad" x1="0" y1="0" x2="0.85" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.17" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.75" stopColor="#3A0505" stopOpacity="0.1" />
            <stop offset="1" stopColor="#2A0303" stopOpacity="0.28" />
          </linearGradient>

          <mask
            id="board-light-top"
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={size.w}
            height={size.h}
          >
            <rect width={size.w} height={size.h} fill="url(#board-light-top-grad)" />
          </mask>
          <mask
            id="board-light-bottom"
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={size.w}
            height={size.h}
          >
            <rect width={size.w} height={size.h} fill="url(#board-light-bottom-grad)" />
          </mask>
          <mask
            id="board-tube-mask"
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={size.w}
            height={size.h}
          >
            <path ref={maskRef} fill="none" stroke="#fff" strokeLinejoin="round" />
          </mask>
        </defs>

        <g transform="translate(2 14)" filter="url(#board-frame-shadow)" opacity="0.4">
          <path ref={shadowRef} fill="none" stroke="#0E2338" strokeLinejoin="round" />
        </g>

        {LAYERS.map((layer, i) => (
          <path
            key={i}
            ref={(el) => {
              layerRefs.current[i] = el;
            }}
            fill="none"
            stroke={layer.stroke}
            strokeLinejoin="round"
            opacity={layer.opacity}
            mask={layer.mask ? `url(#${layer.mask})` : undefined}
          />
        ))}

        <rect
          width={size.w}
          height={size.h}
          fill="url(#board-dir-grad)"
          mask="url(#board-tube-mask)"
        />
      </svg>
    </div>
  );
});

export default BoardFrame;
