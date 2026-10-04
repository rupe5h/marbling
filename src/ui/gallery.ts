// Landing page: a blank tank, a preview of every preset, then a preset file
// to import, in a grid.

import type { PresetData } from '../marble/presetFile';
import { el } from './panel';

export interface GalleryHandlers {
  blank(): void;
  preset(p: PresetData): void;
  /** A preset file the user picked. */
  import(file: File): void;
  /** Returns to the tank as it was; offered only when there is one behind. */
  back(): void;
  /** Opens the docs. */
  about(): void;
}

export class Gallery {
  private thumbs: HTMLImageElement[];
  private backBtn = el('button', { className: 'back', textContent: '← Back to tank' });
  private error = el('p', { className: 'error', hidden: true });

  constructor(
    private root: HTMLElement,
    presets: PresetData[],
    h: GalleryHandlers,
  ) {
    const card = (thumb: HTMLElement, label: string, onClick: () => void, className = 'card') => {
      const b = el('button', { className }, thumb, el('span', { textContent: label }));
      b.addEventListener('click', onClick);
      return b;
    };
    this.thumbs = presets.map(() => {
      const img = el('img', { alt: '' });
      img.addEventListener('load', () => img.classList.add('loaded'));
      return img;
    });
    this.backBtn.addEventListener('click', () => h.back());
    const aboutBtn = el('button', { className: 'about', textContent: 'About marbling' });
    aboutBtn.addEventListener('click', () => h.about());
    const file = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      // Cleared so that picking the same file again still fires change.
      file.value = '';
      if (f) h.import(f);
    });
    root.append(
      el(
        'div',
        { className: 'inner' },
        el('header', {}, el('h1', { textContent: 'Marbling' }), aboutBtn, this.backBtn),
        el('p', { className: 'lede', textContent: 'Start from a blank tank, or pick a pattern to watch it being made.' }),
        this.error,
        el(
          'div',
          { className: 'grid' },
          card(el('div', { className: 'thumb', textContent: '+' }), 'Blank canvas', () => h.blank(), 'card blank'),
          ...presets.map((p, i) => card(el('div', { className: 'thumb' }, this.thumbs[i]), p.name, () => h.preset(p))),
          card(el('div', { className: 'thumb', textContent: '⤒' }), 'Import preset', () => {
            this.showError(null);
            file.click();
          }, 'card blank'),
        ),
      ),
      file,
    );
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  setThumbnail(i: number, url: string) {
    this.thumbs[i].src = url;
  }

  /** Shows why an import failed; null hides it. */
  showError(msg: string | null) {
    this.error.textContent = msg ?? '';
    this.error.hidden = !msg;
  }

  show(canGoBack: boolean) {
    this.backBtn.hidden = !canGoBack;
    this.showError(null);
    this.root.classList.add('open');
  }

  hide() {
    this.root.classList.remove('open');
  }
}
