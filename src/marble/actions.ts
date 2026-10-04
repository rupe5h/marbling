// Marbling actions, ported from pst-marble.
//
// pst-marble 1.6 by Aubrey Jaffer, Jürgen Gilg and Manuel Luque; the actions
// are Jaffer's PostScript in dvips/pst-marble.pro. Copyright (C) 2018-2019
// Aubrey Jaffer. LaTeX Project Public License 1.3c or later.
// Source: https://ctan.org/pkg/pst-marble.
// This is a modified port, not the original: the changes are listed under
// "Credits" in README.md. Report problems with it to this project, not to
// the pst-marble authors. Each function names the procedure it comes from.
//
// Units: "world" coordinates span the tank as [-0.5, 0.5] along each axis
// (y up). pst-marble's user units are world * 1000, so a tank is 1000 units
// across. Constructors take geometry in world units and physical parameters
// (speed V, diameter D, period, amplitudes, circulation) in pst-marble user
// units, so values from the pst-marble examples carry over unchanged.

export type Vec2 = [number, number];
export type RGB = [number, number, number];

export type Action =
  | { kind: 'drop'; c: Vec2; r: number; color: RGB }
  | { kind: 'rake'; d: Vec2; rs: number[]; tU: number; Linv: number }
  | { kind: 'stylus'; b: Vec2; e: Vec2; L: number }
  | { kind: 'styli'; b: Vec2[]; e: Vec2[]; L: number }
  | { kind: 'stir'; c: Vec2; rs: number[]; th: number; Linv: number }
  | { kind: 'vortex'; c: Vec2; circ: number; tcoef: number; nuterm: number }
  | { kind: 'jiggle'; u: Vec2; k: number; ofst: number; A: number; B: number }
  | { kind: 'wriggle'; c: Vec2; k: number; A: number; B: number }
  | { kind: 'shift'; d: Vec2 };

export const KIND = {
  drop: 1,
  rake: 2,
  stylus: 3,
  stir: 4,
  vortex: 5,
  jiggle: 6,
  wriggle: 7,
  shift: 8,
  styli: 9,
} as const;

const DEG = Math.PI / 180;
// Largest k*A allowed for jiggle/wriggle so the phase map stays invertible.
const MAX_KA = 0.95;

/** Kinematic viscosity from the viscosity setting, as pst-marble's `visc 1e-6 mul abs`. */
export const nuOf = (visc: number) => Math.abs(visc) * 1e-6;

/** Paint drop of radius r (world) centered at c (world). pst-marble `drop`. */
export function drop(c: Vec2, r: number, color: RGB): Action {
  return { kind: 'drop', c, r, color };
}

/**
 * Rake moving along unit direction d by distance tU (world). Tines lie on
 * lines perpendicular to d at signed offsets rs (world), measured as
 * p.x*d.y - p.y*d.x. V is speed, D tine diameter (user units).
 * pst-marble `rake`.
 */
export function rake(d: Vec2, rs: number[], tU: number, V: number, D: number, visc: number): Action {
  const Linv = nuOf(visc) / (Math.abs(V) * 1e-3 * (D * 1e-3) ** 2);
  return { kind: 'rake', d, rs, tU, Linv };
}

const stylusL = (V: number, D: number, visc: number) => (Math.abs(V) * 1e-3 * (D * 1e-3) ** 2) / nuOf(visc);

/**
 * Short stylus stroke from b to e (world). V speed, D diameter (user units).
 * pst-marble `stylus`; the sub-steps are worked out in math.ts `stylusMap`.
 */
export function stylus(b: Vec2, e: Vec2, V: number, D: number, visc: number): Action {
  return { kind: 'stylus', b, e, L: stylusL(V, D, visc) };
}

/**
 * Styli moving together, like the tines of a rake: stylus i strokes from b[i]
 * to e[i] (world), all over the same time. V speed, D diameter (user units).
 * Not in pst-marble: this app's extension of its `stylus`.
 */
export function styli(b: Vec2[], e: Vec2[], V: number, D: number, visc: number): Action {
  return { kind: 'styli', b, e, L: stylusL(V, D, visc) };
}

/**
 * Stirrer rods at radii rs (world) around c, swept by angle th (radians).
 * Following pst-marble, a positive radius turns clockwise for positive th.
 * w is angular velocity (deg/s), D rod diameter (user units).
 * pst-marble `stir`.
 */
export function stir(c: Vec2, rs: number[], th: number, w: number, D: number, visc: number): Action {
  const Linv = nuOf(visc) / (Math.abs(w) * DEG * (D * 1e-3) ** 2);
  return { kind: 'stir', c, rs, th, Linv };
}

/** Lamb-Oseen vortex; circ is circulation, t time (user units). pst-marble `vortex`. */
export function vortex(c: Vec2, circ: number, t: number, visc: number): Action {
  return {
    kind: 'vortex',
    c,
    circ: -circ * 1e-6,
    tcoef: (2 * Math.PI) / t,
    nuterm: Math.pow(4 * nuOf(visc), 0.75),
  };
}

/**
 * Sinusoidal shake. Phase advances along unit vector u with the given period;
 * major is peak-to-peak displacement along u, minor across u (user units).
 * pst-marble `jiggle`, with the amplitude limited so it stays invertible.
 */
export function jiggle(u: Vec2, period: number, ofst: number, major: number, minor: number): Action {
  const k = (2 * Math.PI) / (period * 1e-3);
  let A = 0.5e-3 * major;
  if (Math.abs(k * A) > MAX_KA) A = (Math.sign(A) * MAX_KA) / k;
  return { kind: 'jiggle', u, k, ofst: ofst * 1e-3, A, B: -0.5e-3 * minor };
}

/**
 * Radial wriggle around c. major is peak-to-peak radial displacement (user
 * units), minorDeg is peak-to-peak angular displacement in degrees.
 * pst-marble `wriggle`, with the amplitude limited so it stays invertible.
 */
export function wriggle(c: Vec2, period: number, major: number, minorDeg: number): Action {
  const k = (2 * Math.PI) / (period * 1e-3);
  let A = 0.5e-3 * major;
  if (Math.abs(k * A) > MAX_KA) A = (Math.sign(A) * MAX_KA) / k;
  return { kind: 'wriggle', c, k, A, B: -0.5 * minorDeg * DEG };
}

/** Moves the whole tank by d (world). pst-marble `shift`. */
export function shift(d: Vec2): Action {
  return { kind: 'shift', d };
}

// ---- pst-marble style constructors (user units, compass angles) ----------

/** pst-marble angle -> unit vector, as `ang cos-sin exch` (measured from +y). */
export const compass = (deg: number): Vec2 => [Math.sin(deg * DEG), Math.cos(deg * DEG)];

/** pst-marble `tines`: `cnt spacing ofst tines`. */
export function tines(cnt: number, spacing: number, ofst: number): number[] {
  const hint = Math.trunc((cnt - 1) / -2);
  const out: number[] = [];
  for (let i = hint; i <= cnt - 1 + hint; i++) out.push(i * spacing + ofst);
  return out;
}

/** The actions with pst-marble's own arguments, as written in its .tex files. */
export const pst = {
  rake: (angle: number, rs: number[], V: number, tU: number, D: number, visc: number) =>
    rake(compass(angle), rs.map((r) => r * 1e-3), tU * 1e-3, V, D, visc),
  stir: (x: number, y: number, rs: number[], w: number, thDeg: number, D: number, visc: number) =>
    stir([x * 1e-3, y * 1e-3], rs.map((r) => r * 1e-3), thDeg * DEG, w, D, visc),
  vortex: (x: number, y: number, circ: number, t: number, visc: number) =>
    vortex([x * 1e-3, y * 1e-3], circ, t, visc),
  jiggle: (angle: number, period: number, ofst: number, major: number, minor: number) => {
    // pst-marble jiggle phase direction is (sin a, cos a) with a = `ang cos-sin` -> (cos, sin)
    const a = angle * DEG;
    return jiggle([Math.sin(a), Math.cos(a)], period, ofst, major, minor);
  },
  wriggle: (x: number, y: number, period: number, major: number, minor: number) =>
    wriggle([x * 1e-3, y * 1e-3], period, major, minor),
  shift: (angle: number, r: number) => shift([Math.sin(angle * DEG) * r * 1e-3, Math.cos(angle * DEG) * r * 1e-3]),
  stylus: (bx: number, by: number, ex: number, ey: number, V: number, D: number, visc: number) =>
    stylus([bx * 1e-3, by * 1e-3], [ex * 1e-3, ey * 1e-3], V, D, visc),
};

// ---- packing for the GPU ---------------------------------------------------
// Layout per action: [kind, ...params]. Variable-length lists are prefixed by
// their count.

export function packedSize(a: Action): number {
  switch (a.kind) {
    case 'drop': return 7;
    case 'rake': return 6 + a.rs.length;
    case 'stylus': return 6;
    case 'stir': return 6 + a.rs.length;
    case 'vortex': return 6;
    case 'jiggle': return 7;
    case 'wriggle': return 6;
    case 'shift': return 3;
    case 'styli': return 3 + 4 * a.b.length;
  }
}

/** Writes a into out at index at; returns the index after it. */
export function pack(a: Action, out: Float32Array, at: number): number {
  const w = (...v: number[]) => {
    out.set(v, at);
    at += v.length;
  };
  w(KIND[a.kind]);
  switch (a.kind) {
    case 'drop': w(a.c[0], a.c[1], a.r, ...a.color); break;
    case 'rake': w(a.d[0], a.d[1], a.tU, a.Linv, a.rs.length, ...a.rs); break;
    case 'stylus': w(a.b[0], a.b[1], a.e[0], a.e[1], a.L); break;
    case 'stir': w(a.c[0], a.c[1], a.th, a.Linv, a.rs.length, ...a.rs); break;
    case 'vortex': w(a.c[0], a.c[1], a.circ, a.tcoef, a.nuterm); break;
    case 'jiggle': w(a.u[0], a.u[1], a.k, a.ofst, a.A, a.B); break;
    case 'wriggle': w(a.c[0], a.c[1], a.k, a.A, a.B); break;
    case 'shift': w(a.d[0], a.d[1]); break;
    case 'styli': w(a.L, a.b.length, ...a.b.flatMap((b, i) => [...b, ...a.e[i]])); break;
  }
  return at;
}
