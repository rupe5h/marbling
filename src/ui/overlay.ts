// 2D canvas drawn over the tank for tool gizmos and drop ghosts.

import type { Vec2 } from '../marble/actions';

export class Overlay {
  readonly g: CanvasRenderingContext2D;
  private px = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
  }

  resize(cssSize: number) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(cssSize * dpr);
    this.canvas.height = Math.round(cssSize * dpr);
    this.px = this.canvas.width;
  }

  clear() {
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** World -> canvas pixels. */
  at(p: Vec2): Vec2 {
    return [(p[0] + 0.5) * this.px, (0.5 - p[1]) * this.px];
  }

  private stroke(color: string, width: number, dash: number[] = []) {
    const dpr = window.devicePixelRatio || 1;
    this.g.strokeStyle = color;
    this.g.lineWidth = width * dpr;
    this.g.setLineDash(dash.map((d) => d * dpr));
    this.g.stroke();
  }

  /** Outline with a dark and a light pass so it shows on any paint. */
  private contrast(width = 1.25, dash: number[] = []) {
    this.stroke('rgba(0,0,0,0.55)', width + 1.5, dash);
    this.stroke('rgba(255,255,255,0.9)', width, dash);
  }

  circle(c: Vec2, r: number, fill?: string) {
    const [x, y] = this.at(c);
    this.g.beginPath();
    this.g.arc(x, y, Math.max(r * this.px, 1), 0, 2 * Math.PI);
    if (fill) {
      this.g.fillStyle = fill;
      this.g.fill();
    }
    this.contrast(1);
  }

  dot(p: Vec2, radiusPx = 3) {
    const dpr = window.devicePixelRatio || 1;
    const [x, y] = this.at(p);
    this.g.beginPath();
    this.g.arc(x, y, radiusPx * dpr, 0, 2 * Math.PI);
    this.g.fillStyle = 'rgba(255,255,255,0.95)';
    this.g.fill();
    this.stroke('rgba(0,0,0,0.6)', 1);
  }

  line(a: Vec2, b: Vec2, dashed = false) {
    this.path([a, b], dashed);
  }

  /** Polyline through points (world). */
  path(points: Vec2[], dashed = false) {
    this.g.beginPath();
    for (const p of points) this.g.lineTo(...this.at(p));
    this.contrast(1.25, dashed ? [5, 4] : []);
  }

  arrow(a: Vec2, b: Vec2) {
    this.line(a, b);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const h = Math.min(0.025, len * 0.4);
    const ux = dx / len;
    const uy = dy / len;
    for (const s of [1, -1]) {
      this.line(b, [b[0] - h * (ux - s * 0.5 * uy), b[1] - h * (uy + s * 0.5 * ux)]);
    }
  }

  /** Circular arc around c from angle a0 sweeping by da (radians, CCW). */
  arc(c: Vec2, r: number, a0: number, da: number) {
    const [x, y] = this.at(c);
    this.g.beginPath();
    // Canvas y is down, so CCW in world is clockwise on screen.
    this.g.arc(x, y, r * this.px, -a0, -(a0 + da), da > 0);
    this.contrast(1.5);
  }
}
