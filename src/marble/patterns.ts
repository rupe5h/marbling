// Drop-pattern generators, ported from pst-marble.pro (concentric-rings,
// coil-drops, line-drops, serpentine-drops, uniform-drops, normal-drops).
// All positions and radii are in world units; angles in radians.
//
// pst-marble 1.6 by Aubrey Jaffer, Jürgen Gilg and Manuel Luque; the drop
// patterns are Jaffer's PostScript in dvips/pst-marble.pro. Copyright (C)
// 2018-2019 Aubrey Jaffer. LaTeX Project Public License 1.3c or later.
// Source: https://ctan.org/pkg/pst-marble.
// This is a modified port, not the original: the changes are listed under
// "Credits" in README.md. Report problems with it to this project, not to
// the pst-marble authors. Each function names the procedure it comes from.

import { type Action, type RGB, type Vec2, drop } from './actions';

export interface DropSpec {
  c: Vec2;
  r: number;
  color: RGB;
}

export const toActions = (ds: DropSpec[]): Action[] => ds.map((d) => drop(d.c, d.r, d.color));

/**
 * Small fast seeded PRNG returning numbers in [0, 1). Not from pst-marble,
 * which uses RC4 (`random:uniform`), so a seed gives different drops there.
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller pair of standard normal samples, as pst-marble `random:normal2`. */
function normal2(rng: () => number): Vec2 {
  const th = rng() * 2 * Math.PI;
  const r = Math.sqrt(-2 * Math.log(1 - rng()));
  return [r * Math.cos(th), r * Math.sin(th)];
}

const place = (c: Vec2, angle: number, x: number, y: number): Vec2 => {
  const co = Math.cos(angle);
  const si = Math.sin(angle);
  return [c[0] + co * x - si * y, c[1] + si * x + co * y];
};

const cycle = (colors: RGB[], i: number) => colors[i % colors.length];

/**
 * pst-marble `concentric-rings`: drops are laid largest-first with radii
 * sqrt(2n+1)*thick, so each spreads into a ring of equal thickness.
 */
export function concentric(c: Vec2, thick: number, colors: RGB[], count: number): DropSpec[] {
  const out: DropSpec[] = [];
  for (let n = count - 1; n >= 0; n--) {
    const r = n === 0 ? thick : Math.sqrt(2 * n + 1) * thick;
    out.push({ c, r, color: cycle(colors, n) });
  }
  return out;
}

/**
 * Rectangular grid; serpentine order (pst-marble `serpentine-drops`) or
 * row-major. Row-major order and jitter are this app's additions.
 */
export function grid(
  c: Vec2,
  angle: number,
  rows: number,
  cols: number,
  spacing: number,
  r: number,
  jitter: number,
  colors: RGB[],
  rng: () => number,
  serpentine: boolean,
): DropSpec[] {
  const out: DropSpec[] = [];
  let i = 0;
  for (let row = 0; row < rows; row++) {
    const y = (row - (rows - 1) / 2) * spacing;
    for (let k = 0; k < cols; k++) {
      const col = serpentine && row % 2 === 1 ? cols - 1 - k : k;
      const x = (col - (cols - 1) / 2) * spacing;
      const jx = (rng() - 0.5) * jitter * spacing;
      const jy = (rng() - 0.5) * jitter * spacing;
      out.push({ c: place(c, angle, x + jx, y + jy), r, color: cycle(colors, i++) });
    }
  }
  return out;
}

/**
 * Evenly spaced drops from a to b. Adapted from pst-marble `line-drops`, which
 * takes an angle and a list of offsets instead of endpoints and a count.
 */
export function line(a: Vec2, b: Vec2, count: number, r: number, colors: RGB[]): DropSpec[] {
  const out: DropSpec[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    out.push({ c: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], r, color: cycle(colors, i) });
  }
  return out;
}

/** pst-marble `coil-drops`: a spiral advancing arcinc along the arc per drop. */
export function coil(
  c: Vec2,
  angle: number,
  r0: number,
  arcinc: number,
  rinc: number,
  count: number,
  r: number,
  colors: RGB[],
): DropSpec[] {
  const out: DropSpec[] = [];
  let th = angle;
  let rad = r0;
  for (let i = 0; i < count; i++) {
    out.push({ c: [c[0] + rad * Math.cos(th), c[1] + rad * Math.sin(th)], r, color: cycle(colors, i) });
    th += Math.asin(Math.max(-1, Math.min(1, arcinc / Math.max(rad, 1e-9))));
    rad += rinc;
  }
  return out;
}

/** pst-marble `uniform-drops`: uniformly random in a w x h rectangle. */
export function uniform(
  c: Vec2,
  angle: number,
  w: number,
  h: number,
  count: number,
  r: number,
  colors: RGB[],
  rng: () => number,
): DropSpec[] {
  const out: DropSpec[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ c: place(c, angle, (rng() - 0.5) * w, (rng() - 0.5) * h), r, color: cycle(colors, i) });
  }
  return out;
}

/**
 * pst-marble `normal-drops`: normally distributed with std devs sx, sy
 * (pst-marble's L_x, L_y are √8 times these).
 */
export function normal(
  c: Vec2,
  angle: number,
  sx: number,
  sy: number,
  count: number,
  r: number,
  colors: RGB[],
  rng: () => number,
): DropSpec[] {
  const out: DropSpec[] = [];
  for (let i = 0; i < count; i++) {
    const [x, y] = normal2(rng);
    out.push({ c: place(c, angle, x * sx, y * sy), r, color: cycle(colors, i) });
  }
  return out;
}
