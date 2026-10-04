# Marbling (web)

Interactive paint marbling in the browser, built on WebGPU. It is a port of the closed-form marbling maps in
[pst-marble](https://ctan.org/pkg/pst-marble) by Aubrey Jaffer, Jürgen Gilg and Manuel Luque
(`../tex/pst-marble/dvips/pst-marble.pro`, LPPL 1.3c). See [Credits](#credits).

```sh
npm install
npm run dev     # http://localhost:5173 (needs a WebGPU browser: Chrome, Edge or Safari)
npm run dev:lan # https://<your-ip>:5173 for other devices on the network (self-signed cert; WebGPU needs HTTPS)
npm test        # inverse(forward(p)) ≈ p for every operation
npm run build
```

## How it works

- Every operation (drop, rake, stylus, stir, vortex, jiggle, wriggle, shift) is an invertible map. The compute
  shader `src/shaders/marble.wgsl` colors each pixel by walking it backward through a range of actions, the way
  pst-marble's `actions2rgb` does.
- The live tank state is a pair of oversampled `rgba16float` textures. Each gesture applies only its new actions
  on top of the previous state, so the cost per step stays the same however long the history gets.
- Live strokes resample the state every frame (bicubic, so it stays crisp). Each finished gesture is re-rendered
  in one pass on top of the latest exact render, and whenever you pause an exact, supersampled render of the
  whole log is refined in the background, a strip per frame, so the tank is always sharp without blocking input.
- The full action log drives undo/redo (with checkpoints of exact renders every 200 actions) and **Export PNG**.
- Units follow pst-marble: the tank is 1000 units across, so parameters from the `.tex` examples carry over.
  Several of those examples are ported as the built-in presets: JSON files in `presets/` (the Export preset
  format), loaded by `src/marble/presets.ts`. `presets/order.json` lists them in gallery order; every file there
  must be listed (`npm test` checks it).
- The panel keeps one **Paint** button that opens a menu of the drop patterns, shows each tool's main sliders
  with the rest (plus viscosity and seed) under **Advanced options**, and on portrait phones moves below a
  full-width tank. On desktop it is a drawer: the tab on its right edge closes it to give the tank more room,
  and the tools keep working while it is closed.
- The app opens on a gallery (`src/ui/gallery.ts`): **+** starts a blank tank with the tools, and each preset
  shows a preview rendered on the GPU from its own action log, apart from the document's.
- Picking a preset plays it back step by step (`src/marble/playback.ts`) with the tools hidden: drops land and
  spread one after another, then each rake, stir, vortex, … sweeps in with its tool drawn on the tank. Click the
  tank or press Esc to skip. The tank stays view only until the tools are opened: with the drawer tab on
  desktop, or **Show tools** at the bottom on phones.
  During playback, paint that drops pushed past the tank's edge is walked back through the log when a later step
  brings it back in, so every frame matches the final render. A shift made by hand does the same once it is
  released, so shifting back restores the paint that left the tank.
- **Export preset** (under Export, at the bottom of the panel) saves the tank as JSON (`src/marble/presetFile.ts`):
  the background and the action log as is, one action per line. **Import preset**, the last card on the gallery,
  plays such a file back like a built-in preset; a rake or stir made by hand, logged as many small increments,
  plays as one motion.
- **About** (in the gallery header, and **?** in the panel) opens the docs over the app (`src/ui/about.ts`):
  what marbling is, how the app renders it, how each tool works, the sources and code it builds on, and that
  the code was written with AI. The prose is `src/ui/about.html`; each tool's usage and settings are filled in
  from the tool itself, and its figure is rendered on the GPU from a small action log in `src/ui/examples.ts`.
  `npm test` checks that every tool has a section and an example.

## Credits

The marbling code is ported from **pst-marble** 1.6 (2019-05-10) by **Aubrey Jaffer**, **Jürgen Gilg** and
**Manuel Luque**. Jaffer wrote the marbling actions in PostScript (`dvips/pst-marble.pro`); Gilg and Luque made
them into a PSTricks package for LaTeX.

- Copyright (C) 2018-2019 Aubrey Jaffer
- License: [LaTeX Project Public License 1.3c](https://www.latex-project.org/lppl/lppl-1-3c/) or later
- Source: <https://ctan.org/pkg/pst-marble>. An unmodified copy is in `../tex/pst-marble`.
- Background: Jaffer's [Marbling](https://people.csail.mit.edu/jaffer/Marbling/) pages

This app is a modified port, not pst-marble itself. Please report problems with it to this project, not to the
pst-marble authors. Each ported file starts with a notice giving the authors, license and source, and each
ported function names the procedure it comes from:

| This app | pst-marble |
| --- | --- |
| `src/marble/actions.ts`: `drop`, `rake`, `stylus`, `stir`, `vortex`, `jiggle`, `wriggle`, `shift`, `tines`, `compass`, the `pst.*` argument order | `drop`, `rake`, `stylus`, `stir`, `vortex`, `jiggle`, `wriggle`, `shift`, `tines`, `cos-sin` |
| `src/marble/math.ts` `forward` | `spread`, `rake-deformation`, `stylus-deformation`, `stir-deformation`, `vortex-deformation`, `jiggle-deformation`, `wriggle-deformation`, `offset-deformation` |
| `src/marble/math.ts` `inverse`, `solvePhase`; `src/shaders/marble.wgsl` | `actions2rgb`, the deformations above run in reverse, `g_1` |
| `src/marble/patterns.ts` | `concentric-rings`, `serpentine-drops`, `line-drops`, `coil-drops`, `uniform-drops`, `normal-drops`, `random:normal2` |
| `src/marble/presets.ts` `PST_COLORS` | the default `colors` in `pst-marble.tex` |
| `presets/`: Bouquet, Contour, Curl, Eggcrate, Latte, Leaves, Moiré, Nautilus, Nonpareil, Rollers, Spanish wave, Wreath | `examples/*.tex` (Spanish wave is `Wave.tex`) |

Changes from the original:

- Rewritten in TypeScript, with the inverse maps also in WGSL for the GPU.
- Coordinates are stored in pst-marble's internal units (user units × 10⁻³), and compass angles are turned into
  direction vectors when an action is made.
- Every action has an explicit inverse. pst-marble instead rebuilds its actions with negated parameters when it
  renders in reverse. The jiggle and wriggle inverses iterate Newton's method to convergence where `g_1` takes
  one step, and their amplitudes are capped so the maps stay invertible.
- Drop edges are anti-aliased by pixel coverage. A stylus stroke is cut into at most 512 steps.
- Random patterns use mulberry32 instead of pst-marble's RC4, so a seed gives different drops. The line pattern
  takes two endpoints and a count where `line-drops` takes an angle and offsets, the grid adds row-major order
  and jitter, and the normal pattern takes standard deviations where `normal-drops` takes √8 times them.
- The ported presets leave out the shadings and sprays that some of the examples add.
- Not in pst-marble: several styli moving at once (`styli`), and everything outside the maps (the GPU engine,
  playback, tools and interface). pst-marble's `turn`, `wiggle`, shadings, sprays and paper shading are not
  ported.
