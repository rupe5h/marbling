// Built-in presets, loaded from the JSON files in web/presets (the format of
// Export preset). presets/order.json lists the files in gallery order.
//
// From pst-marble 1.6 by Aubrey Jaffer, Jürgen Gilg and Manuel Luque
// (Copyright (C) 2018-2019 Aubrey Jaffer, LaTeX Project Public License 1.3c
// or later, https://ctan.org/pkg/pst-marble): the default palette below, and
// the presets Bouquet, Contour, Curl, Eggcrate, Latte, Leaves, Moiré,
// Nautilus, Nonpareil, Rollers, Spanish wave and Wreath, which are pst-marble's
// examples/*.tex (Spanish wave is Wave.tex) converted to action logs, without
// the shadings and sprays some of them add. The other presets were made in
// this app.

import order from '../../presets/order.json';
import type { RGB } from './actions';
import { type PresetData, importPreset } from './presetFile';

/** pst-marble default `colors` (pst-marble.tex). */
export const PST_COLORS: RGB[] = [
  [0.275, 0.569, 0.796],
  [0.965, 0.882, 0.302],
  [0.176, 0.353, 0.129],
  [0.635, 0.008, 0.094],
  [0.078, 0.165, 0.518],
  [0.824, 0.592, 0.031],
  [0.059, 0.522, 0.392],
  [0.816, 0.333, 0.475],
  [0.365, 0.153, 0.435],
  [0.624, 0.588, 0.439],
];

/** Text of every preset file, keyed by path from web/ (e.g. /presets/curl.json). */
export const PRESET_FILES = import.meta.glob<string>(['/presets/*.json', '!/presets/order.json'], {
  eager: true,
  query: '?raw',
  import: 'default',
});

export const PRESET_ORDER: string[] = order;

export const PRESETS: PresetData[] = PRESET_ORDER.map((file) => {
  const text = PRESET_FILES[`/presets/${file}`];
  if (text === undefined) throw new Error(`presets/order.json lists ${file}, which does not exist`);
  try {
    return importPreset(text, file.replace(/\.json$/i, ''));
  } catch (err) {
    throw new Error(`presets/${file}: ${err instanceof Error ? err.message : err}`);
  }
});
