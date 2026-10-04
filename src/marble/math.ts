// CPU reference implementations of every deformation: forward maps (as in
// pst-marble.pro) and the inverse maps that the GPU walker uses. The WGSL in
// shaders/marble.wgsl mirrors the inverse functions here line for line.
//
// The maps are ported from pst-marble 1.6 by Aubrey Jaffer, Jürgen Gilg and
// Manuel Luque; the deformations are Jaffer's PostScript in
// dvips/pst-marble.pro. Copyright (C) 2018-2019 Aubrey Jaffer. LaTeX Project
// Public License 1.3c or later.
// Source: https://ctan.org/pkg/pst-marble.
// This is a modified port, not the original: the changes are listed under
// "Credits" in README.md. Report problems with it to this project, not to
// the pst-marble authors. Each function names the procedure it comes from.

import type { Action, Vec2 } from './actions';

const TAU = 2 * Math.PI;

const rot = (v: Vec2, a: number): Vec2 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1]];
};

/**
 * Solves t + m*sin(t) = t1 for t, |m| < 1: the inverse of jiggle and wriggle.
 * Does the job of pst-marble's `g_1`, which takes one Newton step from a
 * closed-form guess; this iterates Newton to convergence instead.
 */
export function solvePhase(t1: number, m: number): number {
  const w = TAU * Math.round(t1 / TAU);
  const tr = t1 - w;
  let t = tr;
  const lo = tr - Math.abs(m);
  const hi = tr + Math.abs(m);
  for (let i = 0; i < 10; i++) {
    t -= (t + m * Math.sin(t) - tr) / (1 + m * Math.cos(t));
    t = Math.min(hi, Math.max(lo, t));
  }
  return t + w;
}

/**
 * Displacement of the fluid at p while a stylus moves from b to e, one
 * sub-step of tU along unit direction n. The loop body of pst-marble
 * `stylus-deformation`.
 */
function stylusStep(px: number, py: number, bx: number, by: number, ex: number, ey: number, nx: number, ny: number, tU: number, L: number): Vec2 {
  const dxB = bx - px;
  const dyB = by - py;
  const dxE = ex - px;
  const dyE = ey - py;
  const r = Math.hypot(dxB, dyB);
  const rr = r / L;
  if (!(rr < 6 && rr > 0)) return [0, 0];
  const s = Math.hypot(dxE, dyE);
  const txB = dxB * nx + dyB * ny;
  const txE = dxE * nx + dyE * ny;
  const ty = dxB * ny - dyB * nx;
  const denr = Math.exp(rr) * r * L * 2;
  let inx = ((r * L - ty * ty) * tU) / denr;
  let iny = (txB * ty * tU) / denr;
  if (s > 1e-9) {
    const dens = Math.exp(s / L) * s * L * 2;
    inx += ((s * L - ty * ty) * tU) / dens;
    iny += (txE * ty * tU) / dens;
  }
  return [inx * nx + iny * ny, inx * ny - iny * nx];
}

/**
 * pst-marble `stylus-deformation`: a stroke from b to e, cut into sub-steps
 * no longer than L as pst-marble `stylus` does.
 */
export function stylusMap(p: Vec2, b0: Vec2, e0: Vec2, L: number): Vec2 {
  const Dx = e0[0] - b0[0];
  const Dy = e0[1] - b0[1];
  const len = Math.hypot(Dx, Dy);
  if (len < 1e-9) return p;
  const rpts = Math.min(Math.ceil(len / L), 512);
  const nx = Dx / len;
  const ny = Dy / len;
  const tU = len / rpts;
  const sx = Dx / rpts;
  const sy = Dy / rpts;
  let [bx, by] = b0;
  let ex = bx + sx;
  let ey = by + sy;
  let [px, py] = p;
  for (let k = 0; k < rpts; k++) {
    const [dx, dy] = stylusStep(px, py, bx, by, ex, ey, nx, ny, tU, L);
    px += dx;
    py += dy;
    bx = ex;
    by = ey;
    ex += sx;
    ey += sy;
  }
  return [px, py];
}

/**
 * Styli moving together, stylus i from bs[i] to es[i]: in each sub-step the
 * fluid moves by the sum of their displacements (Stokes flow superposes).
 * Not in pst-marble: this app's extension of `stylus-deformation`.
 */
export function styliMap(p: Vec2, bs: Vec2[], es: Vec2[], L: number): Vec2 {
  let maxLen = 0;
  for (let i = 0; i < bs.length; i++) maxLen = Math.max(maxLen, Math.hypot(es[i][0] - bs[i][0], es[i][1] - bs[i][1]));
  if (maxLen < 1e-9) return p;
  const rpts = Math.min(Math.ceil(maxLen / L), 512);
  let [px, py] = p;
  for (let k = 0; k < rpts; k++) {
    let mx = 0;
    let my = 0;
    for (let i = 0; i < bs.length; i++) {
      const [bx, by] = bs[i];
      const Dx = es[i][0] - bx;
      const Dy = es[i][1] - by;
      const len = Math.hypot(Dx, Dy);
      if (len < 1e-9) continue;
      const sx = Dx / rpts;
      const sy = Dy / rpts;
      const [dx, dy] = stylusStep(px, py, bx + sx * k, by + sy * k, bx + sx * (k + 1), by + sy * (k + 1), Dx / len, Dy / len, len / rpts, L);
      mx += dx;
      my += dy;
    }
    px += mx;
    py += my;
  }
  return [px, py];
}

/** pst-marble `rake-deformation`: how far the rake moves the fluid at p. */
function rakeShift(p: Vec2, a: Extract<Action, { kind: 'rake' }>): number {
  const perp = p[0] * a.d[1] - p[1] * a.d[0];
  let s = 0;
  for (const r of a.rs) s += Math.exp(-Math.abs(perp - r) * a.Linv);
  return s * a.tU;
}

/** pst-marble `stir-deformation`: the angle the stir turns the fluid at radius pc. */
function stirAngle(pc: number, a: Extract<Action, { kind: 'stir' }>): number {
  let s = 0;
  for (const r of a.rs) {
    const ar = Math.abs(r);
    const t = a.th * Math.exp((-Math.abs(pc - ar) * a.Linv) / ar);
    s += r > 0 ? -t : t;
  }
  return s;
}

/** pst-marble `vortex-deformation`: the angle the vortex turns the fluid at radius² r2. */
function vortexAngle(r2: number, a: Extract<Action, { kind: 'vortex' }>): number {
  return Math.pow(a.nuterm + Math.pow(r2 * a.tcoef, 0.75), -4 / 3) * a.circ;
}

/**
 * Forward map: where the fluid at p ends up after action a. The cases follow
 * pst-marble's forward maps: `spread` (drop), `rake-deformation`,
 * `stylus-deformation`, `stir-deformation`, `vortex-deformation`,
 * `jiggle-deformation`, `wriggle-deformation` and `offset-deformation` (shift).
 */
export function forward(a: Action, p: Vec2): Vec2 {
  switch (a.kind) {
    case 'drop': {
      const dx = p[0] - a.c[0];
      const dy = p[1] - a.c[1];
      const d2 = dx * dx + dy * dy;
      if (d2 < 1e-20) return p;
      const s = Math.sqrt(1 + (a.r * a.r) / d2);
      return [a.c[0] + dx * s, a.c[1] + dy * s];
    }
    case 'rake': {
      const s = rakeShift(p, a);
      return [p[0] + a.d[0] * s, p[1] + a.d[1] * s];
    }
    case 'stylus':
      return stylusMap(p, a.b, a.e, a.L);
    case 'styli':
      return styliMap(p, a.b, a.e, a.L);
    case 'stir': {
      const d: Vec2 = [p[0] - a.c[0], p[1] - a.c[1]];
      const pc = Math.hypot(d[0], d[1]);
      if (pc < 1e-6) return p;
      const r = rot(d, stirAngle(pc, a));
      return [a.c[0] + r[0], a.c[1] + r[1]];
    }
    case 'vortex': {
      const d: Vec2 = [p[0] - a.c[0], p[1] - a.c[1]];
      const r2 = d[0] * d[0] + d[1] * d[1];
      if (r2 < 1e-12) return p;
      const r = rot(d, vortexAngle(r2, a));
      return [a.c[0] + r[0], a.c[1] + r[1]];
    }
    case 'jiggle': {
      const [ux, uy] = a.u;
      const t = a.k * (p[0] * ux + p[1] * uy + a.ofst);
      const sa = a.A * Math.sin(t);
      const cb = a.B * Math.cos(t);
      return [p[0] + sa * ux + cb * uy, p[1] + sa * uy - cb * ux];
    }
    case 'wriggle': {
      const dx = p[0] - a.c[0];
      const dy = p[1] - a.c[1];
      const r = Math.hypot(dx, dy);
      if (r < 1e-9) return p;
      const t = a.k * r;
      const r1 = r + a.A * Math.sin(t);
      const phi = Math.atan2(dy, dx) + a.B * Math.cos(t);
      return [a.c[0] + r1 * Math.cos(phi), a.c[1] + r1 * Math.sin(phi)];
    }
    case 'shift':
      return [p[0] + a.d[0], p[1] + a.d[1]];
  }
}

/**
 * Inverse map: where the fluid now at q came from. For drops, returns null
 * when q lies inside the new drop (its color is the drop's). The drop case is
 * pst-marble `actions2rgb`'s. The others invert the forward maps the way
 * pst-marble does when it renders in reverse (`oversample` > 0): the motion
 * negated for rake, stir, vortex and shift, the stroke reversed for a stylus,
 * and a phase solve (`g_1`, here `solvePhase`) for jiggle and wriggle.
 */
export function inverse(a: Action, q: Vec2): Vec2 | null {
  switch (a.kind) {
    case 'drop': {
      const dx = q[0] - a.c[0];
      const dy = q[1] - a.c[1];
      const a2 = dx * dx + dy * dy;
      const r2 = a.r * a.r;
      if (a2 <= r2) return null;
      const s = Math.sqrt(1 - r2 / a2);
      return [a.c[0] + dx * s, a.c[1] + dy * s];
    }
    case 'rake': {
      const s = rakeShift(q, a);
      return [q[0] - a.d[0] * s, q[1] - a.d[1] * s];
    }
    case 'stylus':
      // Stokes flow is reversible: running the stroke backwards undoes it.
      return stylusMap(q, a.e, a.b, a.L);
    case 'styli':
      return styliMap(q, a.e, a.b, a.L);
    case 'stir': {
      const d: Vec2 = [q[0] - a.c[0], q[1] - a.c[1]];
      const pc = Math.hypot(d[0], d[1]);
      if (pc < 1e-6) return q;
      const r = rot(d, -stirAngle(pc, a));
      return [a.c[0] + r[0], a.c[1] + r[1]];
    }
    case 'vortex': {
      const d: Vec2 = [q[0] - a.c[0], q[1] - a.c[1]];
      const r2 = d[0] * d[0] + d[1] * d[1];
      if (r2 < 1e-12) return q;
      const r = rot(d, -vortexAngle(r2, a));
      return [a.c[0] + r[0], a.c[1] + r[1]];
    }
    case 'jiggle': {
      const [ux, uy] = a.u;
      const t1 = a.k * (q[0] * ux + q[1] * uy + a.ofst);
      const t = solvePhase(t1, a.k * a.A);
      const sa = a.A * Math.sin(t);
      const cb = a.B * Math.cos(t);
      return [q[0] - sa * ux - cb * uy, q[1] - sa * uy + cb * ux];
    }
    case 'wriggle': {
      const dx = q[0] - a.c[0];
      const dy = q[1] - a.c[1];
      const r1 = Math.hypot(dx, dy);
      if (r1 < 1e-9) return q;
      const t = solvePhase(a.k * r1, a.k * a.A);
      const r = Math.max(t / a.k, 0);
      const phi = Math.atan2(dy, dx) - a.B * Math.cos(t);
      return [a.c[0] + r * Math.cos(phi), a.c[1] + r * Math.sin(phi)];
    }
    case 'shift':
      return [q[0] - a.d[0], q[1] - a.d[1]];
  }
}
