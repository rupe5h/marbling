import { describe, expect, it } from 'vitest';
import { type Action, type Vec2, drop, pst, styli, stylus, tines } from '../src/marble/actions';
import { forward, inverse, solvePhase } from '../src/marble/math';
import { concentric, mulberry32 } from '../src/marble/patterns';

const VISC = 1000;

function randomPoints(n: number, seed = 1): Vec2[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => [rng() - 0.5, rng() - 0.5] as Vec2);
}

function maxRoundTripError(a: Action, pts: Vec2[]): number {
  let worst = 0;
  for (const p of pts) {
    const q = forward(a, p);
    const back = inverse(a, q);
    expect(back).not.toBeNull();
    worst = Math.max(worst, Math.hypot(back![0] - p[0], back![1] - p[1]));
  }
  return worst;
}

describe('inverse(forward(p)) ≈ p', () => {
  const pts = randomPoints(500);
  const exact: [string, Action][] = [
    ['drop', drop([0.05, -0.1], 0.08, [1, 0, 0])],
    ['rake', pst.rake(90, tines(7, 100, 25), 40, 200, 31, VISC)],
    ['rake reversed', pst.rake(-30, [-150, 450], 100, -750, 31, VISC)],
    ['stir', pst.stir(0, 0, [200, -275], 20, 120, 10, VISC)],
    ['vortex', pst.vortex(300, 200, -32e2, 750, VISC)],
    ['jiggle', pst.jiggle(-51, 120, 0, -25, -10)],
    ['jiggle strong', pst.jiggle(30, 300, 40, 90, 90)],
    ['wriggle', pst.wriggle(0, -250, 200, 0, 30)],
    ['wriggle radial', pst.wriggle(0, 0, 300, 80, 10)],
    ['shift', pst.shift(0, 230)],
  ];
  for (const [name, a] of exact) {
    it(name, () => expect(maxRoundTripError(a, pts)).toBeLessThan(1e-6));
  }

  it('stylus (reversible to within the Oseen approximation)', () => {
    const a = stylus([-0.3, 0.2], [0.3, 0.35], 20, 30, VISC);
    // Points far from the stroke are untouched; near it the reverse stroke
    // undoes most of the motion.
    const err = maxRoundTripError(a, pts);
    expect(err).toBeLessThan(0.02);
  });

  it('short stylus segments invert closely', () => {
    const a = stylus([0, 0], [0.01, 0.005], 20, 30, VISC);
    expect(maxRoundTripError(a, pts)).toBeLessThan(1e-3);
  });

  it('styli (reversible to within the Oseen approximation)', () => {
    const a = styli(
      [[-0.3, 0.2], [-0.3, 0.25], [0.1, -0.3]],
      [[0.3, 0.35], [0.3, 0.4], [0.1, 0.1]],
      20, 30, VISC,
    );
    expect(maxRoundTripError(a, pts)).toBeLessThan(0.02);
  });
});

describe('styli', () => {
  const pts = randomPoints(500, 2);
  const gap = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]);

  it('one stylus moves the paint as a stylus does', () => {
    const one = styli([[-0.3, 0.2]], [[0.3, 0.35]], 20, 30, VISC);
    const a = stylus([-0.3, 0.2], [0.3, 0.35], 20, 30, VISC);
    for (const p of pts) expect(gap(forward(one, p), forward(a, p))).toBeLessThan(1e-12);
  });

  it('styli far apart move the paint as strokes one after another do', () => {
    const b: Vec2[] = [[-0.4, -0.3], [-0.4, 0.3]];
    const e: Vec2[] = [[0.4, -0.3], [0.4, 0.3]];
    const both = styli(b, e, 20, 30, VISC);
    const [s0, s1] = [0, 1].map((i) => stylus(b[i], e[i], 20, 30, VISC));
    for (const p of pts) expect(gap(forward(both, p), forward(s1, forward(s0, p)))).toBeLessThan(1e-9);
  });

  it('styli close together move the paint between them further than strokes one after another', () => {
    // Two tines 0.04 apart: paint between them is carried by both at once.
    const b: Vec2[] = [[-0.2, -0.02], [-0.2, 0.02]];
    const e: Vec2[] = [[0.2, -0.02], [0.2, 0.02]];
    const both = styli(b, e, 20, 30, VISC);
    const p: Vec2 = [0, 0];
    const q = forward(both, p);
    const [s0, s1] = [0, 1].map((i) => stylus(b[i], e[i], 20, 30, VISC));
    expect(q[0]).toBeGreaterThan(forward(s0, p)[0]);
    expect(Math.abs(q[1])).toBeLessThan(1e-9);
    expect(gap(q, forward(s1, forward(s0, p)))).toBeGreaterThan(1e-4);
  });
});

describe('solvePhase', () => {
  it('solves t + m sin t = t1', () => {
    for (const m of [-0.95, -0.5, 0, 0.3, 0.95]) {
      for (let t1 = -20; t1 <= 20; t1 += 0.37) {
        const t = solvePhase(t1, m);
        expect(t + m * Math.sin(t) - t1).toBeCloseTo(0, 6);
      }
    }
  });
});

describe('patterns', () => {
  it('concentric rings drop largest first, as pst-marble does', () => {
    const d = concentric([0, 0], 0.01, [[1, 0, 0], [0, 0, 1]], 5);
    expect(d).toHaveLength(5);
    expect(d[0].r).toBeCloseTo(Math.sqrt(9) * 0.01);
    expect(d[4].r).toBeCloseTo(0.01);
  });

  it('tines are centred like pst-marble', () => {
    expect(tines(3, 100, 0)).toEqual([-100, 0, 100]);
    expect(tines(4, 10, 5)).toEqual([-5, 5, 15, 25]);
  });
});
