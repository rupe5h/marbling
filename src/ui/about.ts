// Docs overlay: what marbling is, how the app does it, how each tool works and where it all comes
// from. The prose is static (about.html); how to use each tool and its settings come from the tools
// themselves, so they can't drift from the panel.

import type { Action, RGB } from '../marble/actions';
import type { Tool } from '../tools/types';
import html from './about.html?raw';
import { EXAMPLES } from './examples';
import { el } from './panel';

/** Renders an action log over a background; resolves to an image URL. */
export type Renderer = (background: RGB, actions: Action[]) => Promise<string>;

export class About {
  private render: Renderer | null = null;
  private rendered = false;
  /** One per figure in the docs, keyed by tool id; filled in when first shown. */
  private images: [string, HTMLImageElement][] = [];

  constructor(
    private root: HTMLElement,
    tools: Tool[],
  ) {
    root.innerHTML = html;
    root.querySelector('.close')!.addEventListener('click', () => this.hide());
    // The contents links scroll the overlay rather than set the page's hash.
    for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        root.querySelector(a.hash)?.scrollIntoView({ behavior: 'smooth' });
      });
    }
    for (const t of tools) {
      const section = root.querySelector(`[data-tool="${t.id}"]`);
      if (!section) continue;
      const settings = t.params.map((p) =>
        el('li', {}, p.label, ...(p.advanced ? [el('span', { className: 'adv', textContent: 'advanced' })] : [])),
      );
      section.append(
        el('p', { className: 'use' }, el('strong', { textContent: 'How to use: ' }), t.hint),
        el('p', { className: 'use' }, el('strong', { textContent: 'Settings:' })),
        el('ul', { className: 'settings' }, ...settings),
      );
    }
    for (const f of root.querySelectorAll<HTMLElement>('figure[data-example]')) {
      const img = el('img', { alt: f.querySelector('figcaption')?.textContent ?? '' });
      img.addEventListener('load', () => img.classList.add('loaded'));
      f.prepend(img);
      this.images.push([f.dataset.example!, img]);
    }
    for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  /** Sets how the tool examples are drawn; without one (no WebGPU) the docs leave them out. */
  setRenderer(render: Renderer) {
    this.render = render;
    this.root.classList.add('can-render');
    if (this.isOpen) this.renderExamples();
  }

  show() {
    this.root.classList.add('open');
    this.renderExamples();
  }

  hide() {
    this.root.classList.remove('open');
  }

  /** Draws the examples one after another, the first time the docs are open with a renderer. */
  private renderExamples() {
    if (this.rendered || !this.render) return;
    this.rendered = true;
    const render = this.render;
    void (async () => {
      for (const [id, img] of this.images) {
        const ex = EXAMPLES[id];
        if (ex) img.src = await render(ex.background, ex.actions);
      }
    })().catch((err) => console.error('Could not render the docs examples:', err));
  }
}
