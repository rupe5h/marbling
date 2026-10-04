// Presets as JSON files: exported from the tank, imported on the landing
// page. Actions are stored as they are in the log (world units, viscosity
// already applied), so a file plays back exactly as it was made.

import type { Action, RGB } from './actions';

const FORMAT = 'marbling-preset';
const VERSION = 1;

export interface PresetData {
  name: string;
  background: RGB;
  actions: Action[];
}

type Field = 'num' | 'vec2' | 'rgb' | 'list' | 'vec2list';
type Kind = Action['kind'];

/** The fields of each kind of action. */
const FIELDS: { [K in Kind]: Record<Exclude<keyof Extract<Action, { kind: K }>, 'kind'>, Field> } = {
  drop: { c: 'vec2', r: 'num', color: 'rgb' },
  rake: { d: 'vec2', rs: 'list', tU: 'num', Linv: 'num' },
  stylus: { b: 'vec2', e: 'vec2', L: 'num' },
  stir: { c: 'vec2', rs: 'list', th: 'num', Linv: 'num' },
  vortex: { c: 'vec2', circ: 'num', tcoef: 'num', nuterm: 'num' },
  jiggle: { u: 'vec2', k: 'num', ofst: 'num', A: 'num', B: 'num' },
  wriggle: { c: 'vec2', k: 'num', A: 'num', B: 'num' },
  shift: { d: 'vec2' },
  styli: { b: 'vec2list', e: 'vec2list', L: 'num' },
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nums = (v: unknown, n?: number): v is number[] =>
  Array.isArray(v) && (n === undefined ? v.length > 0 : v.length === n) && v.every(isNum);
const VALID: Record<Field, (v: unknown) => boolean> = {
  num: isNum,
  vec2: (v) => nums(v, 2),
  rgb: (v) => nums(v, 3),
  list: (v) => nums(v),
  vec2list: (v) => Array.isArray(v) && v.length > 0 && v.every((p) => nums(p, 2)),
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Rejects values the maps divide by, or that would make them non-invertible. */
function usable(a: Action): boolean {
  switch (a.kind) {
    case 'drop': return a.r > 0;
    case 'stylus': return a.L > 0;
    case 'styli': return a.L > 0 && a.b.length === a.e.length;
    case 'stir': return a.rs.every((r) => r !== 0);
    case 'jiggle': return Math.abs(a.k * a.A) < 1;
    case 'wriggle': return a.k !== 0 && Math.abs(a.k * a.A) < 1;
    default: return true;
  }
}

/** Copies only the known fields, so nothing else reaches the GPU packing. */
function readAction(raw: unknown, i: number): Action {
  const where = `action ${i + 1}`;
  if (!isObject(raw)) throw new Error(`${where} is not an object`);
  const kind = raw.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(FIELDS, kind)) throw new Error(`${where} has an unknown kind "${String(kind)}"`);
  const out: Record<string, unknown> = { kind };
  for (const [key, field] of Object.entries(FIELDS[kind as Kind])) {
    const v = raw[key];
    if (!VALID[field](v)) throw new Error(`${where} (${kind}) has a missing or invalid "${key}"`);
    out[key] = Array.isArray(v) ? v.map((x) => (Array.isArray(x) ? [...x] : x)) : v;
  }
  const a = out as Action;
  if (!usable(a)) throw new Error(`${where} (${kind}) has out-of-range values`);
  return a;
}

/** One action per line, so files stay readable and diff well. */
export function exportPreset(p: PresetData): string {
  const actions = p.actions.map((a) => `    ${JSON.stringify(a)}`).join(',\n');
  return `{
  "format": ${JSON.stringify(FORMAT)},
  "version": ${VERSION},
  "name": ${JSON.stringify(p.name)},
  "background": ${JSON.stringify(p.background)},
  "actions": [
${actions}
  ]
}
`;
}

/** Parses and checks a preset file; throws an Error saying what is wrong. */
export function importPreset(text: string, fallbackName: string): PresetData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('the file is not valid JSON');
  }
  if (!isObject(data) || data.format !== FORMAT) throw new Error('the file is not a marbling preset');
  if (data.version !== VERSION) throw new Error(`unsupported version ${String(data.version)}`);
  if (!nums(data.background, 3)) throw new Error('"background" must be three numbers');
  if (!Array.isArray(data.actions)) throw new Error('"actions" must be a list');
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackName;
  return { name, background: [...data.background] as RGB, actions: data.actions.map(readAction) };
}
