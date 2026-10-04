import type { Action, RGB, Vec2 } from '../marble/actions';
import type { Overlay } from '../ui/overlay';

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Renders as a checkbox (value 0/1). */
  toggle?: boolean;
  /** Shown only when Advanced options is open. */
  advanced?: boolean;
}

export interface ToolContext {
  commit(actions: Action[]): void;
  preview(actions: Action[] | null): void;
  beginGroup(): void;
  endGroup(): void;
  /** Colors used by patterns, in palette order. */
  colors(): RGB[];
  activeColor(): RGB;
  advanceColor(): void;
  visc(): number;
  seed(): number;
  nextSeed(): void;
}

export interface Tool {
  id: string;
  label: string;
  group: 'paint' | 'tool';
  hint: string;
  params: ParamDef[];
  values: Record<string, number>;
  down(p: Vec2, ctx: ToolContext, e: PointerEvent): void;
  move(p: Vec2, ctx: ToolContext, e: PointerEvent): void;
  up(p: Vec2, ctx: ToolContext, e: PointerEvent): void;
  /** Pointer position while not pressed (null when outside the tank). */
  hover(p: Vec2 | null): void;
  draw(o: Overlay, ctx: ToolContext): void;
}

export const valuesOf = (params: ParamDef[]) => Object.fromEntries(params.map((p) => [p.key, p.value]));

export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const len = (v: Vec2) => Math.hypot(v[0], v[1]);
export const dist = (a: Vec2, b: Vec2) => len(sub(a, b));
/** pst-marble user units (tank = 1000) -> world (tank = 1). */
export const W = 1e-3;
