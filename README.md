> [!NOTE]
> This README was written by AI.

# Marbling

[![Publish to GitHub Pages](https://github.com/rupe5h/marbling/actions/workflows/pages.yml/badge.svg)](https://github.com/rupe5h/marbling/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Interactive paint marbling in the browser, built on WebGPU.

**[Try it live → rupe5h.github.io/marbling](https://rupe5h.github.io/marbling/)**

Drop paint on a virtual tank, then pull it into patterns with rakes, styli, stirs and vortices. The maps
are ported from [pst-marble](https://ctan.org/pkg/pst-marble) by Aubrey Jaffer, Jürgen Gilg and Manuel Luque
(see [Credits](#credits)).

## Features

- **Tools:** drop (single, or in concentric, line, coil, grid, uniform and normal patterns), rake,
  stylus, stir, vortex, jiggle, wriggle and shift
- **Gallery of presets.** Each one plays back step by step, so you can watch the pattern being made.
- **Always sharp.** Exact, supersampled renders refine in the background without blocking input.
- **Unlimited undo/redo** over the full action log
- **Export PNG**, and **export/import presets** as JSON
- **Built-in docs** (About / **?**) that explain what marbling is and how each tool works, with
  GPU-rendered examples
- Works on desktop and on phones

## Getting started

You need [Node.js](https://nodejs.org/) and a browser with
[WebGPU](https://caniuse.com/webgpu) (Chrome, Edge or Safari).

```sh
npm install
npm run dev     # http://localhost:5173
```

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run dev -- --mode lan` | Serve over HTTPS on your network so you can test on other devices (self-signed cert; WebGPU needs a secure context) |
| `npm test` | Run the tests, including `inverse(forward(p)) ≈ p` for every operation |
| `npm run typecheck` | Type-check without building |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build |

Every push to `main` is tested, built and deployed to GitHub Pages by
[`.github/workflows/pages.yml`](.github/workflows/pages.yml).

## How it works

- **Invertible maps.** Every operation is an invertible map. The compute shader
  [`src/shaders/marble.wgsl`](src/shaders/marble.wgsl) colors each pixel by walking it backward through the
  actions, the way pst-marble's `actions2rgb` does.
- **Incremental state.** The live tank is a pair of oversampled `rgba16float` textures. Each gesture
  applies only its new actions on top of the previous state, so a step costs the same no matter how long
  the history is.
- **Progressive refinement.** While you drag, the state is resampled every frame (bicubic, so it stays
  crisp). When you pause, an exact, supersampled render of the whole log is refined in the background, one
  strip per frame.
- **Action log.** The full log drives undo/redo (with a checkpoint of an exact render every 200 actions),
  playback and PNG export.
- **pst-marble units.** The tank is 1000 units across, as in pst-marble, so parameters from its `.tex`
  examples carry over unchanged.

### Project layout

```
src/
  gpu/engine.ts        WebGPU setup, render passes, textures
  shaders/             marble.wgsl (inverse maps), display.wgsl
  marble/
    actions.ts         action constructors (ported from pst-marble)
    math.ts            forward and inverse maps
    patterns.ts        drop patterns
    history.ts         action log, undo/redo, checkpoints
    playback.ts        step-by-step preset playback
    presets.ts         built-in presets loader
    presetFile.ts      preset JSON import/export
  tools/               paint and deform tools
  ui/                  gallery, panel, overlay, About page
presets/               built-in presets (JSON) and order.json
test/                  Vitest tests
```

### Presets

Built-in presets are JSON files in [`presets/`](presets), the same format that **Export preset** writes:
a background color and the action log, one action per line. To add one, export it from the app, drop the
file in `presets/` and list it in [`presets/order.json`](presets/order.json), which sets the gallery
order. `npm test` fails if a file is missing from `order.json`.

## Credits

The marbling code is ported from **[pst-marble](https://ctan.org/pkg/pst-marble)** 1.6 (2019-05-10) by
**Aubrey Jaffer**, **Jürgen Gilg** and **Manuel Luque**. Jaffer wrote the marbling actions in PostScript
(`dvips/pst-marble.pro`), and Gilg and Luque made them into a PSTricks package for LaTeX.

- Copyright (C) 2018-2019 Aubrey Jaffer
- License: [LaTeX Project Public License 1.3c](https://www.latex-project.org/lppl/lppl-1-3c/) or later
- Background: Jaffer's [Marbling](https://people.csail.mit.edu/jaffer/Marbling/) pages

This app is a modified port, not pst-marble itself. Please report problems with it
[here](https://github.com/rupe5h/marbling/issues), not to the pst-marble authors. Each ported file starts
with a notice giving the authors, license and source, and each ported function names the procedure it
comes from:

| This app | pst-marble |
| --- | --- |
| [`src/marble/actions.ts`](src/marble/actions.ts) | `drop`, `rake`, `stylus`, `stir`, `vortex`, `jiggle`, `wriggle`, `shift`, `tines`, `cos-sin` |
| [`src/marble/math.ts`](src/marble/math.ts) `forward` | `spread`, `rake-deformation`, `stylus-deformation`, `stir-deformation`, `vortex-deformation`, `jiggle-deformation`, `wriggle-deformation`, `offset-deformation` |
| [`src/marble/math.ts`](src/marble/math.ts) `inverse`, `solvePhase`; [`src/shaders/marble.wgsl`](src/shaders/marble.wgsl) | `actions2rgb`, the deformations above run in reverse, `g_1` |
| [`src/marble/patterns.ts`](src/marble/patterns.ts) | `concentric-rings`, `serpentine-drops`, `line-drops`, `coil-drops`, `uniform-drops`, `normal-drops`, `random:normal2` |
| [`src/marble/presets.ts`](src/marble/presets.ts) `PST_COLORS` | the default `colors` in `pst-marble.tex` |
| `presets/`: Bouquet, Curl, Eggcrate, Latte, Leaves, Nonpareil, Rollers, Spanish wave, Wreath | `examples/*.tex` (Spanish wave is `Wave.tex`) |

The other presets were made in this app.

<details>
<summary>Changes from the original</summary>

- Rewritten in TypeScript, with the inverse maps also in WGSL for the GPU.
- Coordinates are stored in pst-marble's internal units (user units × 10⁻³), and compass angles are
  turned into direction vectors when an action is made.
- Every action has an explicit inverse. pst-marble instead rebuilds its actions with negated parameters
  when it renders in reverse. The jiggle and wriggle inverses iterate Newton's method to convergence where
  `g_1` takes one step, and their amplitudes are capped so the maps stay invertible.
- Drop edges are anti-aliased by pixel coverage. A stylus stroke is cut into at most 512 steps.
- Random patterns use mulberry32 instead of pst-marble's RC4, so a given seed produces different drops.
  The line pattern takes two endpoints and a count where `line-drops` takes an angle and offsets. The grid
  adds row-major order and jitter, and the normal pattern takes standard deviations where `normal-drops`
  takes √8 times them.
- The ported presets leave out the shadings and sprays that some of the examples add.
- Not in pst-marble: several styli moving at once (`styli`), and everything outside the maps (the GPU
  engine, playback, tools and interface). pst-marble's `turn`, `wiggle`, shadings, sprays and paper
  shading are not ported.

</details>

## License

This project is licensed under the [MIT License](LICENSE). Files ported from pst-marble (see the table
above) remain under the [LaTeX Project Public License 1.3c](https://www.latex-project.org/lppl/lppl-1-3c/)
or later, as stated in their headers.
