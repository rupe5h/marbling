// Plays a preset back the way it was made: drops land and spread one after
// another, then each rake, stir, vortex, ... sweeps through the paint with
// its tool drawn on the overlay. Presets exported from the tank play the same
// way, each hand-made rake or stir as one motion, and a grid of stirrers turns
// together. An action under way is shown as a partial
// preview and committed whole once it completes, so the finished log is
// exactly the preset's and undoes as one gesture.

import type { Action, Vec2 } from './actions';
import type { MarbleDoc } from './history';
import { forward } from './math';
import type { Overlay } from '../ui/overlay';

/** Gap after each step, so each one reads on its own. */
const PAUSE_MS = 400;
/** Longest frame step: playback waits rather than jumps while the tab is hidden. */
const MAX_FRAME_MS = 100;
/** A run of drops lands one per DROP_INTERVAL_MS, and within DROPS_MS overall. */
const DROP_INTERVAL_MS = 160;
const DROPS_MS = 4000;
/** Time for a drop to spread to full size. */
const DROP_GROW_MS = 700;
/** A run of stylus segments is drawn one per STROKE_INTERVAL_MS, within STROKE_MS. */
const STROKE_INTERVAL_MS = 60;
const STROKE_MS = 4000;
/** Longest a rake or stir made by hand takes to play back. */
const MOTION_MS = 6000;
/** Largest turn of a stir increment taken as part of a hand-made stir. */
const MAX_STIR_STEP = Math.PI / 4;
/** Most actions under way at once, which bounds the cost of the preview. */
export const MAX_LIVE = 24;
/** Completed actions are committed in chunks, so the state is resampled less often. */
export const CHUNK = 16;
/** Stir rods start at 12 o'clock. */
const ROD_START = Math.PI / 2;
const SPOKES = 8;
const SPOKE_LEN = 0.4;

type Doc = Pick<MarbleDoc, 'clear' | 'beginGroup' | 'commit' | 'preview' | 'endGroup' | 'fillEdges'>;

/** Actions [lo, hi): action lo + i starts at start + i * interval and takes grow to complete. */
interface Step {
  label: string;
  lo: number;
  hi: number;
  start: number;
  interval: number;
  grow: number;
  /** A grid of stirrers turning together, one action each. */
  grid: boolean;
}

interface Run {
  name: string;
  actions: Action[];
  steps: Step[];
  step: number;
  /** Step the caption shows. */
  captioned: number;
  /** Playback time (ms). */
  clock: number;
  last: number | null;
  /** actions [0, committed) are in the doc. */
  committed: number;
  previewing: boolean;
}

const NAMES: Record<Action['kind'], string> = {
  drop: 'Drop',
  rake: 'Rake',
  stylus: 'Stylus',
  stir: 'Stir',
  vortex: 'Vortex',
  jiggle: 'Jiggle',
  wriggle: 'Wriggle',
  shift: 'Shift',
  styli: 'Styli',
};

const smooth = (f: number) => f * f * (3 - 2 * f);
const lerp = (a: Vec2, b: Vec2, f: number): Vec2 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

/** Action a carried out to fraction f of the way (f = 1 is a itself). */
export function partial<A extends Action>(a: A, f: number): A;
export function partial(a: Action, f: number): Action {
  if (f >= 1) return a;
  const s = smooth(f);
  switch (a.kind) {
    // Paint poured at a steady rate: the area grows linearly.
    case 'drop': return { ...a, r: a.r * Math.sqrt(f) };
    case 'stylus': return { ...a, e: lerp(a.b, a.e, f) };
    case 'rake': return { ...a, tU: a.tU * s };
    case 'stir': return { ...a, th: a.th * s };
    case 'vortex': return { ...a, circ: a.circ * s };
    case 'jiggle':
    case 'wriggle': return { ...a, A: a.A * s, B: a.B * s };
    case 'shift': return { ...a, d: [a.d[0] * s, a.d[1] * s] };
    // Like a single stylus, drawn at a steady pace; the styli keep together.
    case 'styli': return { ...a, e: a.b.map((b, i) => lerp(b, a.e[i], f)) };
  }
}

function duration(a: Action): number {
  switch (a.kind) {
    case 'rake': return 1000 + 2000 * Math.abs(a.tU);
    case 'stir': return 1000 + (1200 * Math.abs(a.th)) / Math.PI;
    case 'vortex': return 3000;
    case 'jiggle':
    case 'wriggle': return 2000;
    case 'shift': return 800 + 2000 * Math.hypot(a.d[0], a.d[1]);
    case 'drop': return DROP_GROW_MS;
    case 'stylus': return STROKE_INTERVAL_MS;
    case 'styli': return 1000 + 2000 * reach(a);
  }
}

/** Length of the longest stroke of a styli action; 0 for other actions. */
const reach = (a: Action) =>
  a.kind === 'styli' ? Math.max(...a.b.map((b, i) => Math.hypot(a.e[i][0] - b[0], a.e[i][1] - b[1]))) : 0;

/** How far a rake (tU) or stir (th) moves; 0 for other actions. */
const sweep = (a: Action) => (a.kind === 'rake' ? a.tU : a.kind === 'stir' ? a.th : 0);
const withSweep = (a: Action, v: number): Action =>
  a.kind === 'rake' ? { ...a, tU: v } : a.kind === 'stir' ? { ...a, th: v } : a;
const swept = (actions: Action[], lo: number, hi: number) => actions.slice(lo, hi).reduce((s, a) => s + sweep(a), 0);
const same = (x: number[], y: number[]) => x.length === y.length && x.every((v, i) => v === y[i]);

/**
 * Whether b belongs to the run that a starts. Besides runs of drops and
 * stylus segments, a rake or stir made by hand is logged as many small
 * increments, which play as one motion: rakes along the same tines, or small
 * turns of the same stirrer, whose rods follow the pointer's radius. A run
 * of styli with as many styli is one motion along their paths.
 */
function continues(a: Action, b: Action): boolean {
  if (a.kind === 'rake') return b.kind === 'rake' && same(a.d, b.d) && same(a.rs, b.rs);
  if (a.kind === 'stir') {
    return (
      b.kind === 'stir' && same(a.c, b.c) && a.Linv === b.Linv && a.rs.length === b.rs.length &&
      Math.max(Math.abs(a.th), Math.abs(b.th)) < MAX_STIR_STEP
    );
  }
  if (a.kind === 'styli') return b.kind === 'styli' && b.b.length === a.b.length;
  return (a.kind === 'drop' || a.kind === 'stylus') && b.kind === a.kind;
}

/**
 * Whether stir b turns alongside stir a, as in a grid of stirrers turned
 * together (scripts/stir-grid.ts): the same rods, as far either way, about
 * another center.
 */
function alongside(a: Action, b: Action): boolean {
  return (
    a.kind === 'stir' && b.kind === 'stir' && !same(a.c, b.c) && same(a.rs, b.rs) && a.Linv === b.Linv &&
    Math.abs(a.th) === Math.abs(b.th)
  );
}

/**
 * Splits actions into steps: a run of drops, stylus segments, rakes, stirs or
 * styli, a pass over a grid of stirrers, or one other action.
 */
export function plan(actions: Action[]): Step[] {
  const steps: Step[] = [];
  let start = 0;
  for (let lo = 0; lo < actions.length; ) {
    const a = actions[lo];
    let hi = lo + 1;
    const grid = hi < actions.length && alongside(a, actions[hi]);
    if (grid) {
      // The pass ends when a stirrer turns again.
      while (hi < actions.length && actions.slice(lo, hi).every((b) => alongside(b, actions[hi]))) hi++;
    } else {
      while (hi < actions.length && continues(a, actions[hi])) hi++;
    }
    const n = hi - lo;
    let interval = 0;
    let grow = duration(a);
    if (a.kind === 'drop') {
      interval = Math.min(DROP_INTERVAL_MS, DROPS_MS / n);
      grow = Math.min(DROP_GROW_MS, interval * MAX_LIVE);
    } else if (grid) {
      // Together, each a moment after the last, so at most MAX_LIVE turn at once.
      interval = Math.min(grow / MAX_LIVE, MOTION_MS / n);
      grow = Math.min(grow, interval * MAX_LIVE);
    } else if (a.kind === 'stylus') {
      interval = grow = Math.min(STROKE_INTERVAL_MS, STROKE_MS / n);
    } else if (a.kind === 'styli' && n > 1) {
      // As for a rake, at the pace of one stroke as long as the whole path.
      const travel = actions.slice(lo, hi).reduce((s, b) => s + reach(b), 0);
      interval = grow = Math.min(1000 + 2000 * travel, MOTION_MS) / n;
    } else if (n > 1) {
      // One after another, at the pace of a single motion as long as all of them.
      const travel = actions.slice(lo, hi).reduce((s, b) => s + Math.abs(sweep(b)), 0);
      interval = grow = Math.min(duration(withSweep(a, travel)), MOTION_MS) / n;
    }
    const label = (a.kind === 'drop' || grid) && n > 1 ? `${n} ${a.kind}s` : NAMES[a.kind];
    steps.push({ label, lo, hi, start, interval, grow, grid });
    start += (n - 1) * interval + grow + PAUSE_MS;
    lo = hi;
  }
  return steps;
}

const landed = (s: Step, i: number, t: number) => t >= (i - s.lo) * s.interval;
const progress = (s: Step, i: number, t: number) =>
  Math.min(1, Math.max(0, (t - (i - s.lo) * s.interval) / s.grow));
const stepEnd = (s: Step) => (s.hi - s.lo - 1) * s.interval + s.grow;

export class Playback {
  private run: Run | null = null;
  /** Called with a caption for each step; null when playback ends. */
  onStep: (text: string | null) => void = () => {};

  constructor(private doc: Doc) {}

  get playing() {
    return this.run !== null;
  }

  /** Clears the document and starts playing actions into it as one gesture. */
  play(name: string, actions: Action[]) {
    this.stop();
    this.doc.clear();
    this.doc.beginGroup();
    // Rakes and shifts bring back paint that drops pushed out of the tank.
    this.doc.fillEdges = true;
    this.run = { name, actions, steps: plan(actions), step: 0, captioned: -1, clock: 0, last: null, committed: 0, previewing: false };
  }

  /** Advances playback to time now (ms). Call once per frame, before the doc flushes. */
  tick(now: number) {
    const run = this.run;
    if (!run) return;
    run.clock += run.last === null ? 0 : Math.min(now - run.last, MAX_FRAME_MS);
    run.last = now;
    for (; run.step < run.steps.length; run.step++) {
      const s = run.steps[run.step];
      const t = run.clock - s.start;
      this.perform(run, s, t);
      if (t < stepEnd(s) + PAUSE_MS) break;
    }
    if (run.step === run.steps.length) {
      this.finish();
    } else if (run.step !== run.captioned) {
      run.captioned = run.step;
      const s = run.steps[run.step];
      this.onStep(`${run.name}: ${s.label} (${run.step + 1}/${run.steps.length})`);
    }
  }

  private perform(run: Run, s: Step, t: number) {
    let done = run.committed;
    while (done < s.hi && progress(s, done, t) >= 1) done++;
    if (done > run.committed && (done === s.hi || done - run.committed >= CHUNK)) {
      this.doc.commit(run.actions.slice(run.committed, done));
      run.committed = done;
    }
    const live: Action[] = [];
    for (let i = run.committed; i < s.hi && landed(s, i, t); i++) live.push(partial(run.actions[i], progress(s, i, t)));
    if (live.length) this.doc.preview(live);
    else if (run.previewing) this.doc.preview(null);
    run.previewing = live.length > 0;
  }

  /** Skips to the end: commits the rest of the preset at once. */
  finish() {
    const run = this.run;
    if (!run) return;
    this.doc.commit(run.actions.slice(run.committed));
    run.committed = run.actions.length;
    this.stop();
  }

  /** Stops where it is, keeping what has been committed so far. */
  stop() {
    if (!this.run) return;
    this.run = null;
    this.doc.preview(null);
    this.doc.endGroup();
    this.doc.fillEdges = false;
    this.onStep(null);
  }

  /** Draws the tools of the current step. */
  draw(o: Overlay) {
    const run = this.run;
    if (!run || run.step >= run.steps.length) return;
    const s = run.steps[run.step];
    const t = run.clock - s.start;
    const first = run.actions[s.lo];
    if (s.hi - s.lo > 1 && !s.grid && (first.kind === 'rake' || first.kind === 'stir')) {
      // A rake or stir made by hand: the motion so far, drawn as one.
      let i = s.lo;
      while (i + 1 < s.hi && landed(s, i + 1, t)) i++;
      const cur = run.actions[i];
      const now = withSweep(cur, swept(run.actions, s.lo, i) + sweep(partial(cur, progress(s, i, t))));
      drawAction(o, now, 1, withSweep(first, swept(run.actions, s.lo, s.hi)));
      return;
    }
    for (let i = s.lo; i < s.hi && landed(s, i, t); i++) {
      const f = progress(s, i, t);
      // A lone action keeps its tool on screen through the pause after it.
      if (f < 1 || s.hi - s.lo === 1) drawAction(o, run.actions[i], f);
    }
  }
}

/**
 * Draws the tool performing a, a fraction f of the way through. A rake is
 * centered on the tank over the length of whole, which a is part of.
 */
function drawAction(o: Overlay, a: Action, f: number, whole: Action = a) {
  switch (a.kind) {
    case 'drop':
      o.circle(a.c, partial(a, f).r);
      break;
    case 'stylus': {
      const e = partial(a, f).e;
      o.line(a.b, e, true);
      o.dot(e);
      break;
    }
    case 'rake': {
      // Tine r runs along the line p.x*d.y - p.y*d.x = r; the rake crosses
      // the tank centered on it.
      const [dx, dy] = a.d;
      const from = -sweep(whole) / 2;
      const to = from + partial(a, f).tU;
      const tine = (r: number, along: number): Vec2 => [r * dy + along * dx, -r * dx + along * dy];
      for (const r of a.rs) {
        o.line(tine(r, from), tine(r, to), true);
        o.dot(tine(r, to), 2.5);
      }
      break;
    }
    case 'stir': {
      const th = partial(a, f).th;
      o.dot(a.c);
      for (const r of a.rs) {
        // The fluid at a rod turns with it: clockwise for positive radius and th.
        const sweep = r > 0 ? -th : th;
        const end = ROD_START + sweep;
        o.arc(a.c, Math.abs(r), ROD_START, sweep);
        o.dot([a.c[0] + Math.abs(r) * Math.cos(end), a.c[1] + Math.abs(r) * Math.sin(end)], 2.5);
      }
      break;
    }
    case 'vortex':
    case 'wriggle': {
      // Straight spokes around the center, carried along by the flow.
      const p = partial(a, f);
      for (let k = 0; k < SPOKES; k++) {
        const phi = (k / SPOKES) * 2 * Math.PI;
        const pts = Array.from({ length: 41 }, (_, i): Vec2 => {
          const r = (i / 40) * SPOKE_LEN;
          return forward(p, [a.c[0] + r * Math.cos(phi), a.c[1] + r * Math.sin(phi)]);
        });
        o.path(pts);
      }
      o.dot(a.c);
      break;
    }
    case 'jiggle': {
      // Lines along the wave direction, shaken into the wave.
      const p = partial(a, f);
      const [ux, uy] = a.u;
      for (const off of [-0.3, 0, 0.3]) {
        const pts = Array.from({ length: 121 }, (_, i): Vec2 => {
          const s = (i / 120 - 0.5) * 1.5;
          return forward(p, [s * ux + off * uy, s * uy - off * ux]);
        });
        o.path(pts);
      }
      break;
    }
    case 'shift':
      o.arrow([0, 0], partial(a, f).d);
      break;
    case 'styli': {
      const e = partial(a, f).e;
      a.b.forEach((b, i) => {
        o.line(b, e[i], true);
        o.dot(e[i]);
      });
      break;
    }
  }
}
