// Side panel: palette, tool picker, tool parameters and document actions.

import type { RGB } from '../marble/actions';
import type { ParamDef, Tool } from '../tools/types';

export const toHex = (c: RGB) =>
  '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;

/** Narrow portrait screens, where the panel sits below the tank. Keep in sync with style.css. */
export const COMPACT_QUERY = '(orientation: portrait) and (max-width: 820px)';

export interface PanelState {
  palette: RGB[];
  active: number;
  background: RGB;
  visc: number;
  seed: number;
  tool: Tool;
}

export interface PanelHandlers {
  toolChanged(t: Tool): void;
  backgroundChanged(c: RGB): void;
  undo(): void;
  redo(): void;
  clear(): void;
  exportPNG(size: number): void;
  exportPreset(): void;
  openGallery(): void;
  openAbout(): void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

function section(title: string, ...children: Node[]) {
  return el('section', {}, el('h2', { textContent: title }), ...children);
}

function slider(def: ParamDef, value: number, onInput: (v: number) => void) {
  if (def.toggle) {
    const box = el('input', { type: 'checkbox', checked: !!value });
    box.addEventListener('change', () => onInput(box.checked ? 1 : 0));
    return el('label', { className: 'toggle' }, box, def.label);
  }
  const out = el('output', { textContent: String(value) });
  const input = el('input', {
    type: 'range',
    min: String(def.min),
    max: String(def.max),
    step: String(def.step),
    value: String(value),
  });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = String(v);
    onInput(v);
  });
  return el('label', { className: 'param' }, el('span', { textContent: def.label }), input, out);
}


export class Panel {
  private swatches = el('div', { className: 'swatches' });
  private params = el('div', { className: 'params' });
  private advParams = el('div', { className: 'params' });
  private hint = el('p', { className: 'hint' });
  private toolButtons = new Map<string, HTMLButtonElement>();
  private paintBtn = el('button', { className: 'paint' });
  private paintMenu = el('div', { className: 'menu', popover: 'auto' });
  /** Paint tool the Paint button returns to. */
  private lastPaint: Tool;
  private undoBtn = el(
    'button',
    { title: 'Undo (Ctrl/Cmd+Z)', ariaLabel: 'Undo' },
    el('span', { className: 'glyph', textContent: '↶' }),
    el('span', { className: 'label', textContent: 'Undo' }),
  );
  private redoBtn = el(
    'button',
    { title: 'Redo (Ctrl/Cmd+Shift+Z)', ariaLabel: 'Redo' },
    el('span', { className: 'glyph', textContent: '↷' }),
    el('span', { className: 'label', textContent: 'Redo' }),
  );
  private clearBtn = el('button', { textContent: 'Clear', title: "Empty the tank (can't be undone)" });
  /** Asks before Clear goes ahead. */
  private clearMenu = el('div', { className: 'menu confirm', popover: 'auto' });
  private seedInput = el('input', { type: 'number', min: '0', step: '1' });
  private activeColor = el('input', { type: 'color' });
  private bgColor = el('input', { type: 'color' });

  constructor(
    root: HTMLElement,
    private s: PanelState,
    tools: Tool[],
    private h: PanelHandlers,
  ) {
    // Palette
    this.activeColor.addEventListener('input', () => {
      this.s.palette[this.s.active] = fromHex(this.activeColor.value);
      this.renderSwatches();
    });
    const add = el('button', { textContent: '+', title: 'Add a color' });
    add.addEventListener('click', () => {
      this.s.palette.push([...this.s.palette[this.s.active]] as RGB);
      this.s.active = this.s.palette.length - 1;
      this.renderSwatches();
    });
    const remove = el('button', { textContent: '−', title: 'Remove the selected color' });
    remove.addEventListener('click', () => {
      if (this.s.palette.length <= 1) return;
      this.s.palette.splice(this.s.active, 1);
      this.s.active = Math.min(this.s.active, this.s.palette.length - 1);
      this.renderSwatches();
    });
    const bg = this.bgColor;
    this.setBackground(this.s.background);
    bg.addEventListener('change', () => h.backgroundChanged(fromHex(bg.value)));
    const paletteSection = section(
      'Colors',
      this.swatches,
      el('div', { className: 'row' }, el('span', { textContent: 'Selected' }), this.activeColor, add, remove),
      el('div', { className: 'row' }, el('span', { textContent: 'Background' }), bg),
      el('p', { className: 'note', textContent: 'Patterns cycle through all colors in order, or use only the selected color when Cycle colors is off.' }),
    );

    // Tools. The paint tools share one button, which opens a menu of them.
    const toolButton = (t: Tool, onClick: () => void) => {
      const b = el('button', { textContent: t.label });
      b.addEventListener('click', onClick);
      this.toolButtons.set(t.id, b);
      return b;
    };
    const paints = tools.filter((t) => t.group === 'paint');
    this.lastPaint = paints[0];
    for (const t of paints) {
      const b = toolButton(t, () => {
        this.selectTool(t);
        this.paintMenu.hidePopover();
      });
      b.title = t.hint;
      this.paintMenu.append(b);
    }
    this.paintBtn.popoverTargetElement = this.paintMenu;
    this.paintMenu.addEventListener('beforetoggle', (e) => {
      if ((e as ToggleEvent).newState !== 'open') return;
      if (this.s.tool.group !== 'paint') this.selectTool(this.lastPaint);
      this.placeMenu(this.paintMenu, this.paintBtn);
    });
    // Menus are placed once when they open, so close them rather than let them drift.
    const closeMenus = () => {
      for (const m of [this.paintMenu, this.clearMenu]) if (m.matches(':popover-open')) m.hidePopover();
    };
    root.addEventListener('scroll', closeMenus);
    window.addEventListener('resize', closeMenus);
    const toolGrid = el(
      'div',
      { className: 'tools' },
      this.paintBtn,
      ...tools.filter((t) => t.group === 'tool').map((t) => toolButton(t, () => this.selectTool(t))),
    );

    // Advanced options: the tool's secondary parameters and the tank settings, collapsed by default.
    const visc = slider(
      { key: 'visc', label: 'Viscosity', min: 100, max: 5000, step: 50, value: s.visc },
      s.visc,
      (v) => (this.s.visc = v),
    );
    this.seedInput.value = String(s.seed);
    this.seedInput.addEventListener('change', () => (this.s.seed = Number(this.seedInput.value) | 0));
    const advanced = el(
      'div',
      { className: 'advanced', hidden: true },
      this.advParams,
      visc,
      el('label', { className: 'param' }, el('span', { textContent: 'Random seed' }), this.seedInput),
    );
    const advBtn = el('button', { className: 'disclosure', textContent: 'Advanced options', ariaExpanded: 'false' });
    advBtn.addEventListener('click', () => {
      advanced.hidden = !advanced.hidden;
      advBtn.ariaExpanded = String(!advanced.hidden);
    });

    // Document actions
    this.undoBtn.addEventListener('click', () => h.undo());
    this.redoBtn.addEventListener('click', () => h.redo());
    // Clear can't be undone, so it asks first. Cancel takes the focus, so Enter doesn't clear by accident.
    const cancel = el('button', { textContent: 'Cancel', autofocus: true });
    cancel.addEventListener('click', () => this.clearMenu.hidePopover());
    const confirmClear = el('button', { className: 'danger', textContent: 'Clear tank' });
    confirmClear.addEventListener('click', () => {
      this.clearMenu.hidePopover();
      h.clear();
    });
    this.clearMenu.append(el('p', { textContent: "Clear the tank? This can't be undone." }), cancel, confirmClear);
    this.clearBtn.popoverTargetElement = this.clearMenu;
    const size = el(
      'select',
      { title: 'PNG size in pixels' },
      ...[1024, 2048, 4096].map((n) => el('option', { value: String(n), textContent: `${n} × ${n} px` })),
    );
    size.value = '2048';
    const exp = el('button', { className: 'primary', textContent: 'Export PNG' });
    exp.addEventListener('click', () => h.exportPNG(Number(size.value)));
    const preset = el('button', { textContent: 'Export preset', title: 'Save the tank as a JSON preset' });
    preset.addEventListener('click', () => h.exportPreset());
    const gallery = el('button', { textContent: 'Presets', title: 'Back to the gallery' });
    gallery.addEventListener('click', () => h.openGallery());
    const about = el('button', { className: 'icon', textContent: '?', title: 'About marbling', ariaLabel: 'About marbling' });
    about.addEventListener('click', () => h.openAbout());

    const head = el(
      'div',
      { className: 'head' },
      el('h1', { textContent: 'Marbling' }),
      el('div', { className: 'actions' }, gallery, about),
      el('div', { className: 'history' }, this.undoBtn, this.redoBtn, this.clearBtn),
    );
    // Against the whole header rather than the Clear button, which is too narrow to hold it.
    this.clearMenu.addEventListener('beforetoggle', (e) => {
      if ((e as ToggleEvent).newState === 'open') this.placeMenu(this.clearMenu, head);
    });

    root.append(
      head,
      paletteSection,
      section('Tools', toolGrid),
      section('Options', this.hint, this.params, advBtn, advanced),
      el('section', { className: 'export' }, el('h2', { textContent: 'Export' }), el('div', { className: 'row' }, size, preset), exp),
      this.paintMenu,
      this.clearMenu,
    );
    this.renderSwatches();
    this.selectTool(s.tool);
  }

  selectTool(t: Tool) {
    this.s.tool = t;
    if (t.group === 'paint') this.lastPaint = t;
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', id === t.id);
    this.paintBtn.classList.toggle('active', t.group === 'paint');
    this.paintBtn.replaceChildren(
      el('span', { textContent: `Paint · ${this.lastPaint.label}` }),
      el('span', { className: 'caret', textContent: '▾' }),
    );
    this.hint.textContent = t.hint;
    const sliders = (advanced: boolean) =>
      t.params
        .filter((p) => !!p.advanced === advanced)
        .map((p) => slider(p, t.values[p.key], (v) => (t.values[p.key] = v)));
    this.params.replaceChildren(...sliders(false));
    this.advParams.replaceChildren(...sliders(true));
    this.h.toolChanged(t);
  }

  /** Puts a menu against an element, as wide as it, on whichever side has more room. */
  private placeMenu(menu: HTMLElement, anchor: HTMLElement) {
    const r = anchor.getBoundingClientRect();
    const gap = 4;
    const below = window.innerHeight - r.bottom - gap;
    const above = r.top - gap;
    const m = menu.style;
    m.left = `${r.left}px`;
    m.width = `${r.width}px`;
    m.top = below >= above ? `${r.bottom + gap}px` : '';
    m.bottom = below >= above ? '' : `${window.innerHeight - r.top + gap}px`;
    m.maxHeight = `${Math.max(below, above) - 8}px`;
  }

  renderSwatches() {
    this.swatches.replaceChildren(
      ...this.s.palette.map((c, i) => {
        const b = el('button', { className: 'swatch' + (i === this.s.active ? ' active' : ''), title: toHex(c) });
        b.style.background = toHex(c);
        b.addEventListener('click', () => {
          this.s.active = i;
          this.renderSwatches();
        });
        return b;
      }),
    );
    this.activeColor.value = toHex(this.s.palette[this.s.active]);
  }

  setBackground(c: RGB) {
    this.bgColor.value = toHex(c);
  }

  setSeed(seed: number) {
    this.seedInput.value = String(seed);
  }

  setHistory(canUndo: boolean, canRedo: boolean) {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
    // Nothing to lose on an empty tank.
    this.clearBtn.disabled = !canUndo && !canRedo;
  }
}
