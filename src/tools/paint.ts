// Paint tools: single drops and drop patterns. Sliders are in pst-marble
// user units (the tank is 1000 across).

import { drop, type RGB, type Vec2 } from '../marble/actions';
import * as P from '../marble/patterns';
import type { DropSpec } from '../marble/patterns';
import type { Overlay } from '../ui/overlay';
import { type ParamDef, type Tool, type ToolContext, W, dist, sub, valuesOf } from './types';

const MAX_GHOSTS = 1500;

function dropTool(): Tool {
  const params: ParamDef[] = [
    { key: 'radius', label: 'Radius', min: 2, max: 300, step: 1, value: 40 },
    { key: 'cycle', label: 'Cycle colors', min: 0, max: 1, step: 1, value: 1, toggle: true },
  ];
  let hover: Vec2 | null = null;
  let center: Vec2 | null = null;
  let r = 0;
  const t: Tool = {
    id: 'drop',
    label: 'Drop',
    group: 'paint',
    hint: 'Click to drop paint. Drag outward to size the drop.',
    params,
    values: valuesOf(params),
    down(p, ctx) {
      center = p;
      r = t.values.radius * W;
      ctx.preview([drop(center, r, ctx.activeColor())]);
    },
    move(p, ctx) {
      if (!center) return;
      const d = dist(p, center);
      r = d > 0.005 ? d : t.values.radius * W;
      ctx.preview([drop(center, r, ctx.activeColor())]);
    },
    up(_p, ctx) {
      if (!center) return;
      ctx.beginGroup();
      ctx.commit([drop(center, r, ctx.activeColor())]);
      ctx.endGroup();
      ctx.preview(null);
      if (t.values.cycle) ctx.advanceColor();
      center = null;
    },
    hover(p) {
      hover = p;
    },
    draw(o: Overlay) {
      if (center) o.circle(center, r);
      else if (hover) o.circle(hover, t.values.radius * W);
    },
  };
  return t;
}

type Drag = 'rotate' | 'line' | 'rect';

interface PatternSpec {
  id: string;
  label: string;
  hint: string;
  drag: Drag;
  params: ParamDef[];
  /** anchor: press point; cur: current drag point (null for a plain click). */
  gen(anchor: Vec2, cur: Vec2 | null, v: Record<string, number>, colors: RGB[], rng: () => number): DropSpec[];
}

/** Rotation from a drag, or 0 if the pointer barely moved. */
const dragAngle = (a: Vec2, b: Vec2 | null) => {
  if (!b || dist(a, b) < 0.01) return 0;
  const d = sub(b, a);
  return Math.atan2(d[1], d[0]);
};

function patternTool(spec: PatternSpec): Tool {
  let hover: Vec2 | null = null;
  let anchor: Vec2 | null = null;
  let cur: Vec2 | null = null;
  let ghosts: DropSpec[] = [];
  const params: ParamDef[] = [
    ...spec.params,
    { key: 'cycle', label: 'Cycle colors', min: 0, max: 1, step: 1, value: 1, toggle: true },
  ];

  // Unchecked, the whole pattern uses the selected color.
  const generate = (ctx: ToolContext, a: Vec2, c: Vec2 | null) =>
    spec.gen(
      a,
      c && dist(a, c) > 0.01 ? c : null,
      t.values,
      t.values.cycle ? ctx.colors() : [ctx.activeColor()],
      P.mulberry32(ctx.seed()),
    );

  const t: Tool = {
    id: spec.id,
    label: spec.label,
    group: 'paint',
    hint: spec.hint,
    params,
    values: valuesOf(params),
    down(p) {
      anchor = p;
      cur = null;
    },
    move(p) {
      if (anchor) cur = p;
    },
    up(_p, ctx) {
      if (!anchor) return;
      const drops = generate(ctx, anchor, cur);
      ctx.beginGroup();
      ctx.commit(P.toActions(drops));
      ctx.endGroup();
      ctx.nextSeed();
      anchor = cur = null;
    },
    hover(p) {
      hover = p;
    },
    draw(o, ctx) {
      const a = anchor ?? hover;
      if (!a) return;
      ghosts = generate(ctx, a, anchor ? cur : null);
      const n = Math.min(ghosts.length, MAX_GHOSTS);
      for (let i = 0; i < n; i++) {
        const [r, g, b] = ghosts[i].color;
        o.circle(ghosts[i].c, ghosts[i].r, `rgba(${r * 255},${g * 255},${b * 255},0.35)`);
      }
      if (anchor && cur && dist(anchor, cur) > 0.01) {
        if (spec.drag === 'rect') {
          o.line(anchor, [cur[0], anchor[1]], true);
          o.line([cur[0], anchor[1]], cur, true);
          o.line(cur, [anchor[0], cur[1]], true);
          o.line([anchor[0], cur[1]], anchor, true);
        } else {
          o.line(anchor, cur, true);
        }
      }
    },
  };
  return t;
}

const radius = (value: number): ParamDef => ({ key: 'radius', label: 'Drop radius', min: 2, max: 150, step: 1, value });
const count = (value: number, max = 2000): ParamDef => ({ key: 'count', label: 'Count', min: 1, max, step: 1, value });

export function paintTools(): Tool[] {
  return [
    dropTool(),
    patternTool({
      id: 'grid',
      label: 'Grid',
      hint: 'Click to place a grid. Drag to rotate it.',
      drag: 'rotate',
      params: [
        { key: 'rows', label: 'Rows', min: 1, max: 40, step: 1, value: 7 },
        { key: 'cols', label: 'Columns', min: 1, max: 40, step: 1, value: 7 },
        { key: 'spacing', label: 'Spacing', min: 5, max: 300, step: 1, value: 120 },
        radius(30),
        { key: 'jitter', label: 'Jitter', min: 0, max: 1, step: 0.01, value: 0, advanced: true },
        { key: 'serpentine', label: 'Serpentine order', min: 0, max: 1, step: 1, value: 0, toggle: true, advanced: true },
      ],
      gen: (a, c, v, colors, rng) =>
        P.grid(a, dragAngle(a, c), v.rows, v.cols, v.spacing * W, v.radius * W, v.jitter, colors, rng, !!v.serpentine),
    }),
    patternTool({
      id: 'concentric',
      label: 'Concentric',
      hint: 'Click to drop concentric rings.',
      drag: 'rotate',
      params: [
        { key: 'count', label: 'Rings', min: 1, max: 100, step: 1, value: 20 },
        { key: 'thick', label: 'Ring thickness', min: 2, max: 100, step: 1, value: 20 },
      ],
      gen: (a, _c, v, colors) => P.concentric(a, v.thick * W, colors, v.count),
    }),
    patternTool({
      id: 'line',
      label: 'Line',
      hint: 'Drag to lay a line of drops. Click for a line at the set angle.',
      drag: 'line',
      params: [
        count(9, 200),
        radius(30),
        { key: 'angle', label: 'Angle (click, °)', min: -90, max: 90, step: 1, value: 0 },
        { key: 'length', label: 'Length (click)', min: 10, max: 1000, step: 5, value: 600, advanced: true },
      ],
      gen: (a, c, v, colors) => {
        const h = (v.length * W) / 2;
        const th = v.angle * (Math.PI / 180);
        const d: Vec2 = [h * Math.cos(th), h * Math.sin(th)];
        const [s, e]: [Vec2, Vec2] = c ? [a, c] : [[a[0] - d[0], a[1] - d[1]], [a[0] + d[0], a[1] + d[1]]];
        return P.line(s, e, v.count, v.radius * W, colors);
      },
    }),
    patternTool({
      id: 'coil',
      label: 'Coil',
      hint: 'Click to drop a spiral of drops. Drag to set the start angle.',
      drag: 'rotate',
      params: [
        count(80, 1000),
        radius(20),
        { key: 'r0', label: 'Start radius', min: 0, max: 300, step: 1, value: 30, advanced: true },
        { key: 'arc', label: 'Arc step', min: 1, max: 200, step: 1, value: 45, advanced: true },
        { key: 'rinc', label: 'Radius step', min: 0, max: 50, step: 0.5, value: 4, advanced: true },
      ],
      gen: (a, c, v, colors) =>
        P.coil(a, dragAngle(a, c), v.r0 * W, v.arc * W, v.rinc * W, v.count, v.radius * W, colors),
    }),
    patternTool({
      id: 'uniform',
      label: 'Uniform',
      hint: 'Click to scatter drops uniformly. Drag a rectangle to set the area.',
      drag: 'rect',
      params: [
        count(150),
        radius(25),
        { key: 'w', label: 'Width (click)', min: 10, max: 1000, step: 5, value: 1000, advanced: true },
        { key: 'h', label: 'Height (click)', min: 10, max: 1000, step: 5, value: 1000, advanced: true },
      ],
      gen: (a, c, v, colors, rng) => {
        if (c) {
          const mid: Vec2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
          return P.uniform(mid, 0, Math.abs(c[0] - a[0]), Math.abs(c[1] - a[1]), v.count, v.radius * W, colors, rng);
        }
        return P.uniform(a, 0, v.w * W, v.h * W, v.count, v.radius * W, colors, rng);
      },
    }),
    patternTool({
      id: 'normal',
      label: 'Normal',
      hint: 'Click to scatter drops in a Gaussian cloud. Drag to rotate it.',
      drag: 'rotate',
      params: [
        count(150),
        radius(25),
        { key: 'sx', label: 'Spread σx', min: 5, max: 500, step: 1, value: 150, advanced: true },
        { key: 'sy', label: 'Spread σy', min: 5, max: 500, step: 1, value: 150, advanced: true },
      ],
      gen: (a, c, v, colors, rng) => P.normal(a, dragAngle(a, c), v.sx * W, v.sy * W, v.count, v.radius * W, colors, rng),
    }),
  ];
}
