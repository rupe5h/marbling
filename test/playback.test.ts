import { describe, expect, it } from 'vitest';
import { type Action, type Vec2, drop, pst, rake, stir, styli, stylus, tines } from '../src/marble/actions';
import { forward } from '../src/marble/math';
import { CHUNK, MAX_LIVE, Playback, partial, plan } from '../src/marble/playback';
import { PRESETS } from '../src/marble/presets';

const VISC = 1000;

/** Records what playback does to the document. */
class FakeDoc {
  log: Action[] = [];
  open = false;
  fillEdges = false;
  ended = 0;
  longestPreview = 0;
  clear() {
    this.log = [];
  }
  beginGroup() {
    this.open = true;
  }
  commit(actions: Action[]) {
    expect(this.open).toBe(true);
    this.log.push(...actions);
  }
  preview(actions: Action[] | null) {
    this.longestPreview = Math.max(this.longestPreview, actions?.length ?? 0);
  }
  endGroup() {
    this.open = false;
    this.ended++;
  }
}

/** Ticks at 60 fps until playback ends; returns the time it took (ms). */
function playToEnd(p: Playback, limitMs = 120_000): number {
  let now = 1000;
  for (; p.playing && now < 1000 + limitMs; now += 1000 / 60) p.tick(now);
  return now - 1000;
}

describe('preset playback', () => {
  for (const preset of PRESETS) {
    it(`${preset.name} commits exactly the preset's actions`, () => {
      const doc = new FakeDoc();
      const p = new Playback(doc);
      const actions = preset.actions;
      p.play(preset.name, actions);
      const ms = playToEnd(p);
      expect(p.playing).toBe(false);
      expect(ms).toBeLessThan(40_000);
      expect(doc.log).toEqual(actions);
      expect(doc.open).toBe(false);
      expect(doc.ended).toBe(1);
      expect(doc.fillEdges).toBe(false);
      expect(doc.longestPreview).toBeLessThanOrEqual(CHUNK + MAX_LIVE + 1);
    });
  }

  it('finish() commits the rest at once', () => {
    const doc = new FakeDoc();
    const p = new Playback(doc);
    const actions = PRESETS[0].actions;
    p.play('test', actions);
    for (let now = 0; doc.log.length === 0; now += 16) p.tick(now);
    expect(doc.log.length).toBeGreaterThan(0);
    expect(doc.log.length).toBeLessThan(actions.length);
    p.finish();
    expect(doc.log).toEqual(actions);
    expect(p.playing).toBe(false);
  });

  it('stop() keeps only completed steps', () => {
    const doc = new FakeDoc();
    const p = new Playback(doc);
    const actions = PRESETS[0].actions;
    p.play('test', actions);
    for (let now = 0; doc.log.length === 0; now += 16) p.tick(now);
    const done = doc.log.length;
    p.stop();
    expect(doc.log).toEqual(actions.slice(0, done));
    expect(doc.open).toBe(false);
  });

  it('does not jump ahead across a long frame gap', () => {
    const doc = new FakeDoc();
    const p = new Playback(doc);
    p.play('test', PRESETS[0].actions);
    p.tick(0);
    p.tick(60_000);
    expect(p.playing).toBe(true);
  });

  it('groups runs of drops and stylus segments into one step each', () => {
    const actions: Action[] = [
      drop([0, 0], 0.1, [1, 0, 0]),
      drop([0, 0], 0.05, [0, 1, 0]),
      pst.rake(90, tines(3, 100, 0), 40, 200, 31, VISC),
      stylus([0, 0], [0.01, 0], 20, 30, VISC),
      stylus([0.01, 0], [0.02, 0], 20, 30, VISC),
      pst.shift(0, 100),
    ];
    expect(plan(actions).map((s) => [s.lo, s.hi])).toEqual([
      [0, 2],
      [2, 3],
      [3, 5],
      [5, 6],
    ]);
  });

  it('groups a run of as many styli into one step', () => {
    // Three styli following a path, then a different comb.
    const comb = (y: number, n = 3) =>
      styli(
        Array.from({ length: n }, (_, i): Vec2 => [i * 0.1, y]),
        Array.from({ length: n }, (_, i): Vec2 => [i * 0.1, y + 0.02]),
        20, 30, VISC,
      );
    const actions = [comb(0), comb(0.02), comb(0.04), comb(0.06, 5), pst.shift(0, 100)];
    expect(plan(actions).map((s) => [s.lo, s.hi])).toEqual([
      [0, 3],
      [3, 4],
      [4, 5],
    ]);
  });

  // As the rake and stir tools log them: many small increments per gesture.
  const handRake = (n: number, d: Vec2 = [1, 0]) =>
    Array.from({ length: n }, () => rake(d, [-0.1, 0, 0.1], 0.004, 40, 31, VISC));
  const handStir = (n: number, c: Vec2 = [0, 0]) =>
    Array.from({ length: n }, (_, i) => stir(c, [0.2 + i * 1e-3], -0.02, 20, 31, VISC));

  it('groups a rake or stir made by hand into one step each', () => {
    const actions = [...handRake(50), ...handRake(30, [0, 1]), ...handStir(40), ...handStir(20, [0.1, 0])];
    expect(plan(actions).map((s) => [s.lo, s.hi])).toEqual([
      [0, 50],
      [50, 80],
      [80, 120],
      [120, 140],
    ]);
  });

  it("keeps a preset's stirs around one center as separate steps", () => {
    const actions = [
      pst.stir(0, 0, [100], 40, 300, 31, VISC),
      pst.stir(0, 0, [200, 275], 20, 120, 10, VISC),
      pst.stir(0, 0, [325], 20, 90, 31, VISC),
      pst.stir(0, 0, [325], 20, 90, 31, VISC),
    ];
    expect(plan(actions)).toHaveLength(4);
  });

  // As scripts/stir-grid.ts makes them: a pass over a 2x2 grid, neighbors turning opposite ways.
  const gridPass = () =>
    [-0.25, 0.25].flatMap((x, i) =>
      [-0.25, 0.25].map((y, j) => stir([x, y], [0.05, 0.1], (i + j) % 2 ? -0.2 : 0.2, 20, 31, VISC)),
    );

  it('turns a grid of stirrers together, one step per pass', () => {
    const actions = [...gridPass(), ...gridPass(), ...handStir(10)];
    const steps = plan(actions);
    expect(steps.map((s) => [s.lo, s.hi])).toEqual([
      [0, 4],
      [4, 8],
      [8, 18],
    ]);
    expect(steps[0].label).toBe('4 stirs');
  });

  it('plays a large stir grid quickly, a bounded number at a time', () => {
    const doc = new FakeDoc();
    const p = new Playback(doc);
    const pass = Array.from({ length: 100 }, (_, i) =>
      stir([(i % 10) / 10 - 0.45, Math.floor(i / 10) / 10 - 0.45], [0.05], 0.2, 20, 31, VISC),
    );
    const actions = [...pass, ...pass, ...pass];
    p.play('test', actions);
    expect(playToEnd(p)).toBeLessThan(25_000);
    expect(doc.log).toEqual(actions);
    expect(doc.longestPreview).toBeLessThanOrEqual(CHUNK + MAX_LIVE + 1);
  });

  it('plays a long hand-made gesture as one motion', () => {
    const doc = new FakeDoc();
    const p = new Playback(doc);
    const actions = [...handRake(400), ...handStir(400)];
    p.play('test', actions);
    expect(playToEnd(p)).toBeLessThan(15_000);
    expect(doc.log).toEqual(actions);
    expect(doc.longestPreview).toBeLessThanOrEqual(CHUNK + MAX_LIVE + 1);
  });
});

describe('partial actions', () => {
  const pts: Vec2[] = [
    [0.1, 0.2],
    [-0.3, 0.05],
    [0.25, -0.4],
  ];
  const all: Action[] = [
    drop([0.05, -0.1], 0.08, [1, 0, 0]),
    stylus([0, 0], [0.1, 0.05], 20, 30, VISC),
    pst.rake(90, tines(7, 100, 25), 40, 200, 31, VISC),
    pst.stir(0, 0, [200, -275], 20, 120, 10, VISC),
    pst.vortex(300, 200, -32e2, 750, VISC),
    pst.jiggle(0, 480, 120, 0, -240),
    pst.wriggle(0, -250, 200, 0, 30),
    pst.shift(0, 230),
    styli([[0, 0], [0.1, 0]], [[0.05, 0.1], [0.15, 0.1]], 20, 30, VISC),
  ];
  for (const a of all) {
    it(`${a.kind} starts as the identity and ends as the action`, () => {
      expect(partial(a, 1)).toBe(a);
      for (const q of pts) {
        const p = forward(partial(a, 0), q);
        expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-9);
      }
    });
  }
});
