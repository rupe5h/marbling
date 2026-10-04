// Deformation tools. Stylus, rake and stir commit small increments live as
// the pointer moves; this is exact for rake and stir (the increments compose
// to the full motion) and is what stylus strokes are designed for. Vortex,
// jiggle, wriggle and shift are previewed while dragging and committed on
// release.

import { type Action, type Vec2, jiggle, rake, shift, stir, stylus, vortex, wriggle } from '../marble/actions';
import { type ParamDef, type Tool, type ToolContext, W, dist, len, sub, valuesOf } from './types';

function base(id: string, label: string, hint: string, params: ParamDef[]) {
  return { id, label, hint, group: 'tool' as const, params, values: valuesOf(params) };
}

/** Unit vector along v, its angle rounded to a multiple of stepDeg (0: not rounded). */
function snapDir(v: Vec2, stepDeg: number): Vec2 {
  let a = Math.atan2(v[1], v[0]);
  const step = stepDeg * (Math.PI / 180);
  if (step > 0) a = Math.round(a / step) * step;
  return [Math.cos(a), Math.sin(a)];
}

/** The drag from a to c, along its snapped direction. */
function snapped(a: Vec2, c: Vec2, stepDeg: number): Vec2 {
  const d = sub(c, a);
  const u = snapDir(d, stepDeg);
  const s = d[0] * u[0] + d[1] * u[1];
  return [u[0] * s, u[1] * s];
}

function stylusTool(): Tool {
  let last: Vec2 | null = null;
  let hover: Vec2 | null = null;
  const t: Tool = {
    ...base('stylus', 'Stylus', 'Drag to draw through the paint.', [
      { key: 'V', label: 'Speed', min: 1, max: 100, step: 1, value: 20, advanced: true },
      { key: 'D', label: 'Diameter', min: 5, max: 100, step: 1, value: 30 },
    ]),
    down(p, ctx) {
      ctx.beginGroup();
      last = p;
    },
    move(p, ctx) {
      hover = p;
      if (!last || dist(p, last) < 0.002) return;
      ctx.commit([stylus(last, p, t.values.V, t.values.D, ctx.visc())]);
      last = p;
    },
    up(_p, ctx) {
      if (last) ctx.endGroup();
      last = null;
    },
    hover(p) {
      hover = p;
    },
    draw(o) {
      if (hover) o.circle(hover, (t.values.D * W) / 2);
    },
  };
  return t;
}

function rakeTool(): Tool {
  let start: Vec2 | null = null;
  let last: Vec2 = [0, 0];
  let dir: Vec2 | null = null;
  let lastDir: Vec2 = [1, 0];
  let travel = 0;
  let hover: Vec2 | null = null;

  /** Tine offsets perpendicular to d, centered on point s. */
  const tineOffsets = (s: Vec2, d: Vec2) => {
    const perp0 = s[0] * d[1] - s[1] * d[0];
    const n = t.values.tines;
    const sp = t.values.spacing * W;
    return Array.from({ length: n }, (_, i) => perp0 + (i - (n - 1) / 2) * sp);
  };
  const tinePos = (r: number, along: number, d: Vec2): Vec2 => [r * d[1] + along * d[0], -r * d[0] + along * d[1]];

  const t: Tool = {
    ...base('rake', 'Rake', 'Drag to pull a rake of tines across the tank.', [
      { key: 'tines', label: 'Tines', min: 1, max: 60, step: 1, value: 9 },
      { key: 'spacing', label: 'Spacing', min: 5, max: 400, step: 1, value: 100 },
      { key: 'V', label: 'Speed', min: 1, max: 200, step: 1, value: 40, advanced: true },
      { key: 'D', label: 'Tine diameter', min: 5, max: 100, step: 1, value: 31, advanced: true },
      { key: 'snap', label: 'Angle snap (°)', min: 0, max: 90, step: 5, value: 15, advanced: true },
    ]),
    down(p, ctx) {
      ctx.beginGroup();
      start = p;
      last = p;
      dir = null;
      travel = 0;
    },
    move(p, ctx) {
      hover = p;
      if (!start) return;
      if (!dir) {
        if (dist(p, start) < 0.01) return;
        dir = snapDir(sub(p, start), t.values.snap);
        lastDir = dir;
        last = start;
      }
      const delta = (p[0] - last[0]) * dir[0] + (p[1] - last[1]) * dir[1];
      if (Math.abs(delta) < 1e-4) return;
      ctx.commit([rake(dir, tineOffsets(start, dir), delta, t.values.V, t.values.D, ctx.visc())]);
      travel += delta;
      last = p;
    },
    up(_p, ctx) {
      if (start) ctx.endGroup();
      start = null;
      dir = null;
    },
    hover(p) {
      hover = p;
    },
    draw(o) {
      const d = dir ?? lastDir;
      const s = start ?? hover;
      if (!s) return;
      const along0 = s[0] * d[0] + s[1] * d[1];
      for (const r of tineOffsets(s, d)) {
        const head = tinePos(r, along0 + travel, d);
        if (start && dir) o.line(tinePos(r, along0, d), head, true);
        o.dot(head, 2.5);
      }
    },
  };
  return t;
}

function stirTool(): Tool {
  let center: Vec2 | null = null;
  let lastAng: number | null = null;
  let hover: Vec2 | null = null;
  let swept = 0;
  let startAng = 0;

  const t: Tool = {
    ...base('stir', 'Stir', 'Press at the center, then drag around it to stir.', [
      { key: 'rods', label: 'Rods', min: 1, max: 12, step: 1, value: 1 },
      { key: 'w', label: 'Angular speed', min: 1, max: 100, step: 1, value: 20, advanced: true },
      { key: 'D', label: 'Rod diameter', min: 5, max: 100, step: 1, value: 31, advanced: true },
    ]),
    down(p, ctx) {
      ctx.beginGroup();
      center = p;
      lastAng = null;
      swept = 0;
    },
    move(p, ctx) {
      hover = p;
      if (!center) return;
      const d = sub(p, center);
      const r = len(d);
      if (r < 0.01) {
        lastAng = null;
        return;
      }
      const ang = Math.atan2(d[1], d[0]);
      if (lastAng === null) {
        lastAng = ang;
        startAng = ang;
        return;
      }
      let da = ang - lastAng;
      da -= 2 * Math.PI * Math.round(da / (2 * Math.PI));
      lastAng = ang;
      if (Math.abs(da) < 1e-4) return;
      swept += da;
      const n = t.values.rods;
      const rs = Array.from({ length: n }, (_, i) => (r * (i + 1)) / n);
      // Positive radius turns clockwise for positive th, so th = -da turns
      // the fluid at each rod along with the pointer.
      ctx.commit([stir(center, rs, -da, t.values.w, t.values.D, ctx.visc())]);
    },
    up(_p, ctx) {
      if (center) ctx.endGroup();
      center = null;
    },
    hover(p) {
      hover = p;
    },
    draw(o) {
      if (!center) {
        if (hover) o.dot(hover);
        return;
      }
      o.dot(center);
      if (hover) {
        const r = dist(hover, center);
        const n = t.values.rods;
        for (let i = 1; i <= n; i++) o.circle(center, (r * i) / n);
        if (lastAng !== null) o.arc(center, r, startAng, Math.max(-2 * Math.PI, Math.min(2 * Math.PI, swept)));
        o.circle(hover, (t.values.D * W) / 2);
      }
    },
  };
  return t;
}

/** Shared flow for press-drag-release tools with a live preview. */
function previewTool(
  id: string,
  label: string,
  hint: string,
  params: ParamDef[],
  make: (anchor: Vec2, cur: Vec2, v: Record<string, number>, ctx: ToolContext) => Action | null,
  draw: (o: import('../ui/overlay').Overlay, anchor: Vec2, cur: Vec2, v: Record<string, number>) => void,
): Tool {
  let anchor: Vec2 | null = null;
  let cur: Vec2 | null = null;
  let hover: Vec2 | null = null;
  const t: Tool = {
    ...base(id, label, hint, params),
    down(p) {
      anchor = p;
      cur = p;
    },
    move(p, ctx) {
      if (!anchor) return;
      cur = p;
      const a = make(anchor, cur, t.values, ctx);
      ctx.preview(a ? [a] : null);
    },
    up(_p, ctx) {
      if (!anchor || !cur) return;
      const a = make(anchor, cur, t.values, ctx);
      if (a) {
        ctx.beginGroup();
        ctx.commit([a]);
        ctx.endGroup();
      }
      ctx.preview(null);
      anchor = cur = null;
    },
    hover(p) {
      hover = p;
    },
    draw(o) {
      if (anchor && cur) draw(o, anchor, cur, t.values);
      else if (hover) o.dot(hover);
    },
  };
  return t;
}

export function deformTools(): Tool[] {
  return [
    stylusTool(),
    rakeTool(),
    stirTool(),
    previewTool(
      'vortex',
      'Vortex',
      'Press at the center and drag sideways: right turns clockwise, left counter-clockwise. Farther is stronger.',
      [
        { key: 'strength', label: 'Strength', min: 10, max: 500, step: 5, value: 100 },
        { key: 't', label: 'Time', min: 50, max: 3000, step: 10, value: 750, advanced: true },
      ],
      (a, c, v, ctx) => {
        const d = sub(c, a);
        if (len(d) < 0.005) return null;
        const circ = Math.sign(d[0] || 1) * len(d) * 1000 * v.strength;
        return vortex(a, circ, v.t, ctx.visc());
      },
      (o, a, c) => {
        o.dot(a);
        o.circle(a, dist(a, c));
        o.arrow(a, c);
      },
    ),
    previewTool(
      'jiggle',
      'Jiggle',
      'Drag to shake the whole tank. The drag direction sets the wave direction and its length sets how far the paint sways.',
      [
        { key: 'period', label: 'Period', min: 20, max: 1000, step: 5, value: 300 },
        { key: 'major', label: 'Along-wave amplitude', min: -90, max: 90, step: 1, value: 0, advanced: true },
        { key: 'ofst', label: 'Phase offset', min: 0, max: 1000, step: 5, value: 0, advanced: true },
      ],
      (a, c, v) => {
        const d = sub(c, a);
        const l = len(d);
        if (l < 0.005) return null;
        return jiggle([d[0] / l, d[1] / l], v.period, v.ofst, v.major, l * 1000);
      },
      (o, a, c) => o.arrow(a, c),
    ),
    previewTool(
      'wriggle',
      'Wriggle',
      'Press at the center and drag outward to twist rings back and forth around it.',
      [
        { key: 'period', label: 'Period', min: 20, max: 1000, step: 5, value: 200 },
        { key: 'major', label: 'Radial amplitude', min: -90, max: 90, step: 1, value: 0, advanced: true },
        { key: 'gain', label: 'Degrees per 100 units', min: 1, max: 60, step: 1, value: 15, advanced: true },
      ],
      (a, c, v) => {
        const l = dist(a, c);
        if (l < 0.005) return null;
        return wriggle(a, v.period, v.major, l * 1000 * (v.gain / 100));
      },
      (o, a, c) => {
        o.dot(a);
        o.circle(a, dist(a, c));
      },
    ),
    previewTool(
      'shift',
      'Shift',
      'Drag to slide all the paint in the tank. It follows the pointer, and paint pushed off one edge comes back if you shift it back.',
      [{ key: 'snap', label: 'Angle snap (°)', min: 0, max: 90, step: 5, value: 0 }],
      (a, c, v) => {
        const d = snapped(a, c, v.snap);
        return len(d) < 0.005 ? null : shift(d);
      },
      (o, a, c, v) => {
        const [dx, dy] = snapped(a, c, v.snap);
        // The tank's edge, moved along: past it is paint carried in from beyond the tank.
        const corners: Vec2[] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5]];
        o.path(corners.map(([x, y]): Vec2 => [x + dx, y + dy]), true);
        o.arrow(a, [a[0] + dx, a[1] + dy]);
      },
    ),
  ];
}
