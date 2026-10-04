// The marbling document: the exact action log, grouped into undoable
// gestures, kept in sync with the GPU state. All GPU work runs through a
// serial queue so long (tiled) renders and live strokes never interleave.
//
// Live strokes resample the previous state every frame, which slowly blurs
// it. To keep the tank sharp, an exact render of the whole log is refined in
// the background whenever the user pauses, and each finished gesture is
// re-rendered in one pass on top of the latest exact render.

import type { Action, RGB } from './actions';
import type { Engine } from '../gpu/engine';

const CHECKPOINT_EVERY = 200;
const MAX_CHECKPOINTS = 8;
/** Renders costlier than this report progress and block input. */
const LONG_JOB = 2e9;
/** Pause after the last edit before the background refine starts. */
const REFINE_IDLE_MS = 250;
const REFINE_SAMPLES = 2;
/** GPU work spent on the background refine per frame. */
const REFINE_WORK_PER_FRAME = 2e8;
/** The refine only shows progress once it has run this long. */
const REFINE_QUIET_MS = 500;
/** Largest re-render of finished gestures on top of the exact render. */
const SETTLE_BUDGET = 2e9;

interface Checkpoint {
  index: number;
  tex: GPUTexture;
}

/** A background exact render of actions [0, index) into the spare texture. */
interface Refine {
  index: number;
  row: number;
  started: number;
  inFlight: boolean;
  shown: boolean;
}

export class MarbleDoc {
  actions: Action[] = [];
  /** Start index of each gesture in actions. */
  private groups: number[] = [];
  private redoStack: Action[][] = [];
  /** Copies of exact renders, oldest first. */
  private checkpoints: Checkpoint[] = [];
  private queue: Promise<void> = Promise.resolve();
  private longJobs = 0;
  private wantPreview: Action[] | null | undefined;
  /** exactTex holds an exact render of actions [0, exactIndex); -1 if invalid. */
  private exactTex: GPUTexture;
  private exactIndex = -1;
  /** Render target of the refine; swapped with exactTex when it completes. */
  private spare: GPUTexture;
  private refine: Refine | null = null;
  /**
   * Resample passes the live state has had since it was a copy of an exact
   * render. A plain render from scratch counts as one: it isn't supersampled.
   */
  private passes = 0;
  /** Bumped whenever the log is truncated, so stale queued jobs can bail. */
  private epoch = 0;
  private lastEdit = 0;

  /**
   * Render paint carried in from beyond the tank exactly while editing,
   * rather than waiting for the background refine. Too costly on long logs
   * for everyday edits; preset playback turns it on.
   */
  fillEdges = false;

  /** Called with a label and fraction while long renders run; null when idle. */
  onProgress: (label: string | null, fraction: number) => void = () => {};
  onChange: () => void = () => {};

  constructor(private engine: Engine) {
    this.exactTex = engine.makeStateTexture('exact');
    this.spare = engine.makeStateTexture('refine');
    this.enqueue(() => this.engine.runBatch(0, 0, null, this.engine.current));
  }

  /** True while a long (progress-reporting) render is running. */
  get isBusy() {
    return this.longJobs > 0;
  }
  get canUndo() {
    return this.groups.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  private enqueue(job: () => Promise<void> | void, label?: string) {
    if (label) this.longJobs++;
    this.queue = this.queue
      .then(async () => {
        if (label) this.onProgress(label, 0);
        await job();
      })
      .catch((err) => console.error(err))
      .finally(() => {
        if (label) {
          this.longJobs--;
          this.onProgress(null, 1);
        }
        this.onChange();
      });
    return this.queue;
  }

  private progress(label: string) {
    return (f: number) => this.onProgress(label, f);
  }

  private touch() {
    this.lastEdit = performance.now();
  }

  /**
   * Whether to render actions [lo, hi) with paint carried in from beyond the
   * tank. Besides playback, always for a shift: it uncovers a whole edge, and
   * as one action per gesture it is affordable. Its drag preview stays cheap.
   */
  private fillsEdges(lo: number, hi: number) {
    return this.fillEdges || this.actions.slice(lo, hi).some((a) => a.kind === 'shift');
  }

  beginGroup() {
    this.groups.push(this.actions.length);
    this.redoStack = [];
    this.touch();
  }

  endGroup() {
    const start = this.groups[this.groups.length - 1];
    if (start === this.actions.length) this.groups.pop();
    this.flush();
    this.settle();
    this.onChange();
  }

  /** Appends actions to the open group; they reach the GPU on flush(). */
  commit(actions: Action[]) {
    this.actions.push(...actions);
    this.touch();
  }

  preview(actions: Action[] | null) {
    this.wantPreview = actions;
    this.touch();
  }

  /** Sends pending commits and the latest preview to the GPU. Call once per frame. */
  flush() {
    const lo = this.engine.store.count;
    const hi = this.actions.length;
    if (hi > lo) {
      this.engine.store.write(this.actions.slice(lo), true);
      const label = this.engine.work(hi - lo) > LONG_JOB ? 'Dropping paint' : undefined;
      const epoch = this.epoch;
      const fillEdges = this.fillsEdges(lo, hi);
      this.enqueue(async () => {
        const e = this.engine;
        // A later rebuild replaces the state, and these actions may be gone.
        if (epoch !== this.epoch) return;
        const onProgress = label ? this.progress(label) : undefined;
        await e.runBatch(lo, hi, e.current, e.state[1 - e.cur], { onProgress, fillEdges });
        e.cur = 1 - e.cur;
        this.passes++;
      }, label);
    }
    if (this.wantPreview !== undefined) {
      const p = this.wantPreview;
      const fillEdges = this.fillEdges;
      this.wantPreview = undefined;
      this.enqueue(() => this.engine.preview(p, fillEdges));
    }
  }

  /**
   * Re-renders everything after the exact render in one pass, so the live
   * state is at most one resample away from exact.
   */
  private settle() {
    // Jobs queued so far cover exactly the actions written to the store.
    const n = this.engine.store.count;
    const epoch = this.epoch;
    this.enqueue(async () => {
      const e = this.engine;
      const from = this.exactIndex;
      if (epoch !== this.epoch || from < 0 || from > n) return;
      if (from === n) {
        if (this.passes === 0) return;
        e.copy(this.exactTex, e.current);
        this.passes = 0;
        return;
      }
      if (this.passes <= 1 || e.work(n - from) > SETTLE_BUDGET) return;
      await e.runBatch(from, n, this.exactTex, e.state[1 - e.cur], { fillEdges: this.fillsEdges(from, n) });
      e.cur = 1 - e.cur;
      this.passes = 1;
    });
  }

  /**
   * Drives the background refine: after a pause, renders the whole log
   * exactly, one strip per frame, then settles the live state onto it.
   * Strips pause while the user interacts. Call once per frame.
   */
  tick(now: number, interacting: boolean) {
    if (interacting) return;
    const n = this.engine.store.count;
    if (!this.refine) {
      if (this.exactIndex === n || this.isBusy || now - this.lastEdit < REFINE_IDLE_MS) return;
      this.refine = { index: n, row: 0, started: now, inFlight: false, shown: false };
    }
    const r = this.refine;
    if (r.inFlight) return;
    r.inFlight = true;
    this.enqueue(async () => {
      const e = this.engine;
      if (this.refine !== r) return;
      const rows = Math.min(e.rowsFor(0, r.index, this.spare, REFINE_SAMPLES, REFINE_WORK_PER_FRAME), e.size - r.row);
      e.runRows(0, r.index, null, this.spare, REFINE_SAMPLES, r.row, rows);
      await e.device.queue.onSubmittedWorkDone();
      if (this.refine !== r) return;
      r.inFlight = false;
      r.row += rows;
      if (!r.shown && performance.now() - r.started > REFINE_QUIET_MS) r.shown = true;
      if (r.row < e.size) {
        if (r.shown) this.onProgress('Sharpening', r.row / e.size);
        return;
      }
      this.cancelRefine();
      [this.exactTex, this.spare] = [this.spare, this.exactTex];
      this.exactIndex = r.index;
      const last = this.checkpoints.length ? this.checkpoints[this.checkpoints.length - 1].index : 0;
      if (r.index - last >= CHECKPOINT_EVERY) {
        const tex = this.checkpoints.length >= MAX_CHECKPOINTS ? this.checkpoints.shift()!.tex : e.makeCheckpointTexture();
        e.copy(this.exactTex, tex);
        this.checkpoints.push({ index: r.index, tex });
      }
      this.settle();
    });
  }

  private cancelRefine() {
    if (this.refine?.shown) this.onProgress(null, 1);
    this.refine = null;
  }

  private dropCheckpointsAfter(index: number) {
    const gone = this.checkpoints.filter((c) => c.index > index);
    this.checkpoints = this.checkpoints.filter((c) => c.index <= index);
    // Destroy via the queue: an earlier queued rebuild may still read them.
    if (gone.length) this.enqueue(() => gone.forEach((c) => c.tex.destroy()));
  }

  /** Re-renders the state for actions [0, n) from the newest exact render. */
  private rebuild(n: number, label: string) {
    this.epoch++;
    this.touch();
    this.engine.store.truncate(n);
    if (this.refine && this.refine.index > n) this.cancelRefine();
    if (this.exactIndex > n) this.exactIndex = -1;
    this.dropCheckpointsAfter(n);
    // The exact render is never older than the newest checkpoint while valid.
    const base = (): Checkpoint | undefined =>
      this.exactIndex >= 0 ? { index: this.exactIndex, tex: this.exactTex } : this.checkpoints[this.checkpoints.length - 1];
    const heavy = this.engine.work(n - (base()?.index ?? 0)) > LONG_JOB;
    const epoch = this.epoch;
    this.enqueue(
      async () => {
        const e = this.engine;
        if (epoch !== this.epoch) return;
        // A refine may have finished since this was queued, so pick the base now.
        const b = base();
        const dst = e.state[1 - e.cur];
        if (b && b.index === n) {
          e.copy(b.tex, dst);
          this.passes = 0;
        } else {
          const from = b?.index ?? 0;
          await e.runBatch(from, n, b?.tex ?? null, dst, { onProgress: this.progress(label), fillEdges: this.fillsEdges(from, n) });
          this.passes = 1;
        }
        e.cur = 1 - e.cur;
        e.showPreview = false;
      },
      heavy ? label : undefined,
    );
  }

  undo() {
    if (!this.canUndo) return;
    const start = this.groups.pop()!;
    this.redoStack.push(this.actions.splice(start));
    this.rebuild(start, 'Undoing');
    this.onChange();
  }

  redo() {
    const g = this.redoStack.pop();
    if (!g) return;
    this.groups.push(this.actions.length);
    this.actions.push(...g);
    this.touch();
    this.flush();
    this.settle();
    this.onChange();
  }

  setBackground(rgb: RGB) {
    this.engine.background = rgb;
    this.exactIndex = -1;
    this.cancelRefine();
    this.dropCheckpointsAfter(-1);
    this.rebuild(this.actions.length, 'Repainting');
  }

  clear() {
    this.actions = [];
    this.groups = [];
    this.redoStack = [];
    // The background may change along with a clear (presets set it first).
    this.exactIndex = -1;
    this.cancelRefine();
    this.preview(null);
    this.rebuild(0, 'Clearing');
    this.flush();
    this.onChange();
  }

  exportPNG(size: number): Promise<Blob> {
    let blob!: Blob;
    return this.enqueue(async () => {
      blob = await this.engine.exportPNG(size, { samples: 3, onProgress: this.progress('Exporting') });
    }, 'Exporting').then(() => blob);
  }
}
