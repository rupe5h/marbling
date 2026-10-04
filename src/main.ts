import { Engine, UnsupportedError } from './gpu/engine';
import type { Action, RGB, Vec2 } from './marble/actions';
import { MarbleDoc } from './marble/history';
import { Playback } from './marble/playback';
import { exportPreset, importPreset } from './marble/presetFile';
import { PRESETS, PST_COLORS } from './marble/presets';
import { deformTools } from './tools/deform';
import { paintTools } from './tools/paint';
import type { Tool, ToolContext } from './tools/types';
import { About } from './ui/about';
import { Gallery } from './ui/gallery';
import { Overlay } from './ui/overlay';
import { COMPACT_QUERY, Panel, type PanelState } from './ui/panel';

const STATE_SIZE = 2048;
/** Size of the preset previews in the gallery. */
const THUMB_SIZE = 640;
/** Size of the tool examples in the docs. */
const EXAMPLE_SIZE = 480;
/** Width of the desktop drawer tab (#drawer-toggle in style.css). */
const TAB_WIDTH = 24;

const gpuCanvas = document.querySelector<HTMLCanvasElement>('#gpu')!;
const overlayCanvas = document.querySelector<HTMLCanvasElement>('#overlay')!;
const tank = document.querySelector<HTMLDivElement>('#tank')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const caption = document.querySelector<HTMLDivElement>('#caption')!;
const showToolsBtn = document.querySelector<HTMLButtonElement>('#show-tools')!;
const toGalleryBtn = document.querySelector<HTMLButtonElement>('#to-gallery')!;
const drawerBtn = document.querySelector<HTMLButtonElement>('#drawer-toggle')!;

async function start() {
  const tools: Tool[] = [...paintTools(), ...deformTools()];
  // Made before the engine so that the docs open even without WebGPU.
  const about = new About(document.querySelector('#about')!, tools);

  let engine: Engine;
  try {
    engine = await Engine.create(gpuCanvas, STATE_SIZE);
  } catch (err) {
    const msg = err instanceof UnsupportedError ? err.message : `Could not start WebGPU: ${err}`;
    stage.innerHTML = `<div class="unsupported"><h2>WebGPU needed</h2><p>${msg}</p>
      <p>Try a recent Chrome, Edge or Safari.</p><button>About this project</button></div>`;
    stage.querySelector('button')!.addEventListener('click', () => about.show());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') about.hide();
    });
    return;
  }

  const doc = new MarbleDoc(engine);
  const player = new Playback(doc);
  const overlay = new Overlay(overlayCanvas);

  const state: PanelState = {
    palette: PST_COLORS.map((c) => [...c] as RGB),
    active: 0,
    background: [1, 1, 1],
    visc: 1000,
    seed: 1,
    tool: tools[0],
  };

  let panel!: Panel;
  const ctx: ToolContext = {
    commit: (a) => doc.commit(a),
    preview: (a) => doc.preview(a),
    beginGroup: () => doc.beginGroup(),
    endGroup: () => doc.endGroup(),
    colors: () => state.palette,
    activeColor: () => state.palette[state.active],
    advanceColor: () => {
      state.active = (state.active + 1) % state.palette.length;
      panel.renderSwatches();
    },
    visc: () => state.visc,
    seed: () => state.seed,
    nextSeed: () => {
      state.seed++;
      panel.setSeed(state.seed);
    },
  };

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Playback runs as an open gesture: finish it before anything else edits the log.
  const undo = () => {
    player.finish();
    doc.undo();
  };
  const redo = () => {
    player.finish();
    doc.redo();
  };

  // The tools are hidden while a preset plays, and the tank stays view only until the user opens
  // them. After that, closing the desktop drawer only makes room: the tools keep working.
  const showTools = (show: boolean) => {
    document.body.classList.toggle('tools-hidden', !show);
    if (show) document.body.classList.remove('view-only');
    drawerBtn.ariaExpanded = String(show);
    drawerBtn.title = drawerBtn.ariaLabel = show ? 'Hide tools' : 'Show tools';
  };
  const canEdit = () => !document.body.classList.contains('view-only');

  // The gallery is the landing page. Opened again later, it can go back to the tank.
  let started = false;
  /** Name of the preset or file the tank started from, for Export preset. */
  let presetName = 'Untitled';
  const openGallery = () => {
    player.finish();
    gallery.show(started);
  };
  const enter = (tools: boolean) => {
    started = true;
    gallery.hide();
    document.body.classList.toggle('view-only', !tools);
    showTools(tools);
  };
  const openAbout = () => {
    player.finish();
    about.show();
  };
  const play = (name: string, background: RGB, actions: Action[]) => {
    enter(false);
    presetName = name;
    state.background = background;
    engine.background = background;
    panel.setBackground(background);
    player.play(name, actions);
  };
  const gallery = new Gallery(document.querySelector('#gallery')!, PRESETS, {
    blank: () => {
      enter(true);
      presetName = 'Untitled';
      player.stop();
      doc.clear();
    },
    preset: (p) => play(p.name, p.background, p.actions),
    import: async (file) => {
      try {
        const p = importPreset(await file.text(), file.name.replace(/\.json$/i, ''));
        play(p.name, p.background, p.actions);
      } catch (err) {
        gallery.showError(`Could not import ${file.name}: ${err instanceof Error ? err.message : err}`);
      }
    },
    back: () => gallery.hide(),
    about: openAbout,
  });
  gallery.show(false);
  showToolsBtn.addEventListener('click', () => showTools(true));
  drawerBtn.addEventListener('click', () => showTools(document.body.classList.contains('tools-hidden')));
  toGalleryBtn.addEventListener('click', openGallery);

  // Renders an action log apart from the document's, for the gallery previews and the docs' examples.
  const preview = async (size: number, background: RGB, actions: Action[]) => {
    const blob = await engine.exportPNG(size, { samples: 2, store: engine.makeStore(actions), background });
    return URL.createObjectURL(blob);
  };
  about.setRenderer((background, actions) => preview(EXAMPLE_SIZE, background, actions));

  // Preview each preset for the gallery, one after another.
  void (async () => {
    for (const [i, p] of PRESETS.entries()) gallery.setThumbnail(i, await preview(THUMB_SIZE, p.background, p.actions));
  })().catch((err) => console.error('Could not render preset previews:', err));

  panel = new Panel(document.querySelector('#panel')!, state, tools, {
    toolChanged: () => {},
    backgroundChanged: (c) => {
      state.background = c;
      doc.setBackground(c);
    },
    undo,
    redo,
    clear: () => {
      player.stop();
      doc.clear();
    },
    exportPNG: async (size) => {
      player.finish();
      download(await doc.exportPNG(size), `marbling-${Date.now()}.png`);
    },
    exportPreset: () => {
      player.finish();
      const json = exportPreset({ name: presetName, background: state.background, actions: doc.actions });
      download(new Blob([json], { type: 'application/json' }), `marbling-${Date.now()}.json`);
    },
    openGallery,
    openAbout,
  });

  doc.onChange = () => panel.setHistory(doc.canUndo, doc.canRedo);
  doc.onProgress = (label, f) => {
    status.textContent = label ? `${label}… ${Math.round(f * 100)}%` : '';
    status.classList.toggle('visible', !!label);
  };
  doc.onChange();
  player.onStep = (text) => {
    if (text) caption.firstElementChild!.textContent = text;
    caption.classList.toggle('visible', !!text);
    document.body.classList.toggle('playing', !!text);
  };

  // Layout: the tank is the largest square that fits the stage, with a thinner margin on small screens.
  // On desktop it also leaves room on each side for the drawer tab.
  const compact = window.matchMedia(COMPACT_QUERY);
  const layout = () => {
    const margin = compact.matches ? 8 : 32;
    const tab = compact.matches ? 0 : TAB_WIDTH;
    const size = Math.max(200, Math.floor(Math.min(stage.clientWidth - 2 * tab, stage.clientHeight) - margin));
    tank.style.width = tank.style.height = `${size}px`;
    const dpr = window.devicePixelRatio || 1;
    gpuCanvas.width = gpuCanvas.height = Math.round(size * dpr);
    overlay.resize(size);
  };
  new ResizeObserver(layout).observe(stage);
  layout();

  // Pointer input
  const toWorld = (e: PointerEvent): Vec2 => {
    const r = overlayCanvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width - 0.5, 0.5 - (e.clientY - r.top) / r.height];
  };
  let pressed = false;
  overlayCanvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // A click during playback skips to the end.
    if (player.playing) {
      player.finish();
      return;
    }
    if (doc.isBusy || !canEdit()) return;
    overlayCanvas.setPointerCapture(e.pointerId);
    pressed = true;
    state.tool.down(toWorld(e), ctx, e);
  });
  overlayCanvas.addEventListener('pointermove', (e) => {
    const p = toWorld(e);
    if (pressed) {
      for (const ce of e.getCoalescedEvents?.() ?? [e]) state.tool.move(toWorld(ce), ctx, ce);
    } else {
      state.tool.hover(p);
    }
  });
  const release = (e: PointerEvent) => {
    if (!pressed) return;
    pressed = false;
    state.tool.up(toWorld(e), ctx, e);
  };
  overlayCanvas.addEventListener('pointerup', release);
  overlayCanvas.addEventListener('pointercancel', release);
  overlayCanvas.addEventListener('pointerleave', () => {
    if (!pressed) state.tool.hover(null);
  });

  window.addEventListener('keydown', (e) => {
    if (about.isOpen) {
      if (e.key === 'Escape') {
        about.hide();
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Escape' && player.playing) {
      player.finish();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && gallery.isOpen && started) {
      gallery.hide();
      e.preventDefault();
      return;
    }
    if (gallery.isOpen || !canEdit()) return;
    if (!(e.metaKey || e.ctrlKey) || (e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) undo();
    else if ((k === 'z' && e.shiftKey) || k === 'y') redo();
    else return;
    e.preventDefault();
  });

  const frame = () => {
    const now = performance.now();
    player.tick(now);
    doc.flush();
    doc.tick(now, pressed || player.playing);
    engine.present();
    overlay.clear();
    if (player.playing) player.draw(overlay);
    else if (canEdit()) state.tool.draw(overlay, ctx);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void start();
