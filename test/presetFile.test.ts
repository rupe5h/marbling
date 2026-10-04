import { describe, expect, it } from 'vitest';
import { type Action, drop, pst, styli, stylus, tines } from '../src/marble/actions';
import { exportPreset, importPreset } from '../src/marble/presetFile';
import { PRESETS, PRESET_FILES, PRESET_ORDER } from '../src/marble/presets';

const VISC = 1000;

const file = (fields: Record<string, unknown>) =>
  JSON.stringify({ format: 'marbling-preset', version: 1, name: 'x', background: [1, 1, 1], actions: [], ...fields });

describe('preset files', () => {
  for (const preset of PRESETS) {
    it(`${preset.name} round-trips exactly`, () => {
      const actions = preset.actions;
      const text = exportPreset({ name: preset.name, background: preset.background, actions });
      expect(importPreset(text, 'fallback')).toEqual({ name: preset.name, background: preset.background, actions });
    });
  }

  it('lists every built-in preset file once in presets/order.json', () => {
    const files = Object.keys(PRESET_FILES).map((path) => path.replace('/presets/', ''));
    expect([...PRESET_ORDER].sort()).toEqual(files.sort());
    expect(PRESETS).toHaveLength(files.length);
  });

  it('round-trips every kind of action', () => {
    const actions: Action[] = [
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
    const text = exportPreset({ name: 'All', background: [0.1, 0.2, 0.3], actions });
    expect(importPreset(text, 'fallback').actions).toEqual(actions);
  });

  it('writes one action per line', () => {
    const actions = PRESETS[0].actions;
    const text = exportPreset({ name: 'n', background: [1, 1, 1], actions });
    expect(text.split('\n').filter((l) => l.includes('"kind"'))).toHaveLength(actions.length);
  });

  it('falls back to the file name', () => {
    expect(importPreset(file({ name: undefined }), 'my file').name).toBe('my file');
    expect(importPreset(file({ name: '  ' }), 'my file').name).toBe('my file');
    expect(importPreset(file({ name: 'Mine' }), 'my file').name).toBe('Mine');
  });

  it('keeps only the known fields of an action', () => {
    const p = importPreset(file({ actions: [{ kind: 'shift', d: [0.1, 0], extra: 1 }] }), 'f');
    expect(p.actions).toEqual([{ kind: 'shift', d: [0.1, 0] }]);
  });

  const bad: [string, string][] = [
    ['not JSON', '{'],
    ['another format', JSON.stringify({ format: 'other', version: 1 })],
    ['a later version', file({ version: 2 })],
    ['a bad background', file({ background: [1, 1] })],
    ['missing actions', file({ actions: undefined })],
    ['an unknown kind', file({ actions: [{ kind: 'toString' }] })],
    ['a missing field', file({ actions: [{ kind: 'drop', c: [0, 0], color: [1, 0, 0] }] })],
    ['a non-finite number', file({ actions: [{ kind: 'shift', d: [0, null] }] })],
    ['a string for a number', file({ actions: [{ kind: 'drop', c: [0, 0], r: '0.1', color: [1, 0, 0] }] })],
    ['an empty tine list', file({ actions: [{ kind: 'rake', d: [1, 0], rs: [], tU: 0.1, Linv: 1 }] })],
    ['a drop of radius 0', file({ actions: [{ kind: 'drop', c: [0, 0], r: 0, color: [1, 0, 0] }] })],
    ['a stir rod at the center', file({ actions: [{ kind: 'stir', c: [0, 0], rs: [0], th: 1, Linv: 1 }] })],
    ['styli with more ends than beginnings', file({ actions: [{ kind: 'styli', b: [[0, 0]], e: [[0.1, 0], [0.2, 0]], L: 0.01 }] })],
    ['styli with no styli', file({ actions: [{ kind: 'styli', b: [], e: [], L: 0.01 }] })],
    ['a stylus point of three numbers', file({ actions: [{ kind: 'styli', b: [[0, 0, 0]], e: [[0.1, 0]], L: 0.01 }] })],
    ['styli of zero size', file({ actions: [{ kind: 'styli', b: [[0, 0]], e: [[0.1, 0]], L: 0 }] })],
    ['a jiggle that folds over', file({ actions: [{ kind: 'jiggle', u: [0, 1], k: 10, ofst: 0, A: 0.2, B: 0 }] })],
  ];
  for (const [what, text] of bad) {
    it(`rejects ${what}`, () => {
      expect(() => importPreset(text, 'f')).toThrow();
    });
  }
});
