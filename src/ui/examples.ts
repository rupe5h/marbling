// A small action log per tool for the figures in the docs (ui/about.html): a few drops, then one use
// of the tool with its default settings where that reads well. Rendered on the GPU like the gallery
// previews.

import { type Action, type RGB, type Vec2, drop, jiggle, pst, rake, shift, stir, stylus, tines, vortex } from '../marble/actions';
import * as P from '../marble/patterns';
import { PST_COLORS } from '../marble/presets';

export interface Example {
  background: RGB;
  actions: Action[];
}

const VISC = 1000;
const WHITE: RGB = [1, 1, 1];
const colors = PST_COLORS;

const rings = (thick = 0.02, count = 20, c: Vec2 = [0, 0]) => P.toActions(P.concentric(c, thick, colors, count));
/** Near-straight horizontal bands: rings around a center far below the tank. */
const bands = () => P.toActions(P.concentric([0, -3.6], 0.04, colors.slice(0, 5), 105));
const grid = (n: number, spacing: number, r: number) =>
  P.toActions(P.grid([0, 0], 0, n, n, spacing, r, 0, colors, P.mulberry32(1), false));

/** A wavy stylus stroke across the tank, as short segments like a hand-drawn one. */
function wave(): Action[] {
  const pts: Vec2[] = Array.from({ length: 41 }, (_, i) => {
    const x = -0.42 + (0.84 * i) / 40;
    return [x, 0.16 * Math.sin((x + 0.42) * 2 * Math.PI * 1.25)];
  });
  return pts.slice(1).map((p, i) => stylus(pts[i], p, 20, 30, VISC));
}

const ex = (actions: Action[], background = WHITE): Example => ({ background, actions });

export const EXAMPLES: Record<string, Example> = {
  drop: ex([
    drop([-0.12, 0.1], 0.2, colors[0]),
    drop([0.16, 0.08], 0.17, colors[1]),
    drop([0.02, -0.16], 0.16, colors[3]),
    drop([0.02, 0.02], 0.09, colors[4]),
    drop([-0.24, -0.26], 0.07, colors[6]),
  ]),
  grid: ex(grid(7, 0.12, 0.03)),
  concentric: ex(rings()),
  line: ex([-0.25, 0, 0.25].flatMap((y) => P.toActions(P.line([-0.36, y], [0.36, y], 9, 0.035, colors)))),
  coil: ex(P.toActions(P.coil([0, 0], 0, 0.03, 0.045, 0.004, 80, 0.02, colors))),
  uniform: ex(P.toActions(P.uniform([0, 0], 0, 1, 1, 150, 0.025, colors, P.mulberry32(1)))),
  normal: ex(P.toActions(P.normal([0, 0], 0, 0.15, 0.15, 150, 0.025, colors, P.mulberry32(1)))),
  stylus: ex([...rings(), ...wave()]),
  rake: ex([...rings(0.017, 20, [-0.12, 0]), rake([1, 0], tines(9, 100, 0).map((r) => r * 1e-3), 0.2, 40, 31, VISC)]),
  stir: ex([...grid(9, 0.11, 0.045), stir([0, 0], [0.1, 0.2, 0.3], (120 * Math.PI) / 180, 20, 31, VISC)]),
  vortex: ex([...grid(9, 0.11, 0.045), vortex([0, 0], 30000, 750, VISC)]),
  jiggle: ex([...bands(), jiggle([1, 0], 300, 0, 0, 100)]),
  wriggle: ex([...rings(0.022), pst.wriggle(0, -250, 200, 0, 30)]),
  shift: ex([...rings(), shift([0.18, 0.12])]),
};
