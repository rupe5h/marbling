import { describe, expect, it } from 'vitest';
import type { Action, RGB, Vec2 } from '../src/marble/actions';
import { deformTools } from '../src/tools/deform';
import { paintTools } from '../src/tools/paint';
import type { Tool, ToolContext } from '../src/tools/types';

/** Records what a tool does to the document. */
class FakeCtx implements ToolContext {
  groups: Action[][] = [];
  open = false;
  previewing = false;
  commit(actions: Action[]) {
    expect(this.open).toBe(true);
    this.groups[this.groups.length - 1].push(...actions);
  }
  preview(actions: Action[] | null) {
    this.previewing = actions !== null;
  }
  beginGroup() {
    this.open = true;
    this.groups.push([]);
  }
  endGroup() {
    this.open = false;
  }
  colors = (): RGB[] => [[0, 0, 0]];
  activeColor = (): RGB => [0, 0, 0];
  advanceColor() {}
  visc = () => 1000;
  seed = () => 1;
  nextSeed() {}
}

const ev = {} as PointerEvent;

function drag(t: Tool, from: Vec2, to: Vec2): FakeCtx {
  const ctx = new FakeCtx();
  t.down(from, ctx, ev);
  t.move(to, ctx, ev);
  t.up(to, ctx, ev);
  return ctx;
}

describe('shift tool', () => {
  const shiftTool = () => deformTools().find((t) => t.id === 'shift')!;

  it('commits one shift that moves the paint with the pointer', () => {
    const ctx = drag(shiftTool(), [0.1, 0.1], [0.2, 0.15]);
    expect(ctx.groups).toHaveLength(1);
    expect(ctx.groups[0]).toHaveLength(1);
    const a = ctx.groups[0][0];
    expect(a.kind).toBe('shift');
    if (a.kind !== 'shift') return;
    expect(a.d[0]).toBeCloseTo(0.1, 12);
    expect(a.d[1]).toBeCloseTo(0.05, 12);
    expect(ctx.open).toBe(false);
    expect(ctx.previewing).toBe(false);
  });

  it('snaps the direction to the angle step', () => {
    const t = shiftTool();
    t.values.snap = 90;
    const ctx = drag(t, [0, 0], [0.1, 0.05]);
    const a = ctx.groups[0][0];
    if (a.kind !== 'shift') throw new Error(a.kind);
    expect(a.d[0]).toBeCloseTo(0.1, 12);
    expect(a.d[1]).toBeCloseTo(0, 12);
  });

  it('ignores a click without a drag', () => {
    const ctx = drag(shiftTool(), [0, 0], [0.002, 0]);
    expect(ctx.groups).toEqual([]);
    expect(ctx.previewing).toBe(false);
  });
});

describe('line tool', () => {
  const lineTool = () => paintTools().find((t) => t.id === 'line')!;
  const centers = (ctx: FakeCtx) =>
    ctx.groups[0].map((a) => {
      if (a.kind !== 'drop') throw new Error(a.kind);
      return a.c;
    });

  it('lays a click line at the set angle', () => {
    const t = lineTool();
    t.values.count = 3;
    t.values.length = 400;
    t.values.angle = 30;
    const cs = centers(drag(t, [0.1, 0], [0.1, 0]));
    const h = 0.2;
    const th = Math.PI / 6;
    expect(cs).toHaveLength(3);
    expect(cs[0][0]).toBeCloseTo(0.1 - h * Math.cos(th), 12);
    expect(cs[0][1]).toBeCloseTo(-h * Math.sin(th), 12);
    expect(cs[1][0]).toBeCloseTo(0.1, 12);
    expect(cs[1][1]).toBeCloseTo(0, 12);
    expect(cs[2][0]).toBeCloseTo(0.1 + h * Math.cos(th), 12);
    expect(cs[2][1]).toBeCloseTo(h * Math.sin(th), 12);
  });

  it('follows the drag regardless of the angle setting', () => {
    const t = lineTool();
    t.values.count = 2;
    t.values.angle = 45;
    const cs = centers(drag(t, [0, 0], [0.3, 0]));
    expect(cs[0]).toEqual([0, 0]);
    expect(cs[1]).toEqual([0.3, 0]);
  });
});
