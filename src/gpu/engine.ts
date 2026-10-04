// WebGPU engine: action storage buffers, ping-pong state textures, the
// backward-walker compute pass and the display pass.

import marbleWGSL from '../shaders/marble.wgsl?raw';
import displayWGSL from '../shaders/display.wgsl?raw';
import { type Action, type RGB, pack, packedSize } from '../marble/actions';

const STATE_FORMAT: GPUTextureFormat = 'rgba16float';
const EXPORT_FORMAT: GPUTextureFormat = 'rgba8unorm';
// Upper bound on (actions x pixels x samples) per submit, to keep each GPU
// submission short enough not to stall the page or trip watchdogs.
const WORK_PER_SUBMIT = 4e8;

export class UnsupportedError extends Error {}

/** Growable CPU mirror of packed actions, uploaded to GPU storage buffers. */
export class ActionStore {
  data = new Float32Array(1 << 16);
  offsets = new Uint32Array(1 << 12);
  floats = 0;
  count = 0;
  dataBuf!: GPUBuffer;
  offBuf!: GPUBuffer;

  constructor(private device: GPUDevice) {
    this.allocGPU();
  }

  private allocGPU() {
    // Old buffers are left to the GC rather than destroyed: work already
    // submitted may still reference them.
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    this.dataBuf = this.device.createBuffer({ size: this.data.byteLength, usage });
    this.offBuf = this.device.createBuffer({ size: this.offsets.byteLength, usage });
    this.device.queue.writeBuffer(this.dataBuf, 0, this.data, 0, this.floats);
    this.device.queue.writeBuffer(this.offBuf, 0, this.offsets, 0, this.count);
  }

  private reserve(floats: number, count: number) {
    let grow = false;
    if (floats > this.data.length) {
      let n = this.data.length;
      while (n < floats) n *= 2;
      const d = new Float32Array(n);
      d.set(this.data.subarray(0, this.floats));
      this.data = d;
      grow = true;
    }
    if (count > this.offsets.length) {
      let n = this.offsets.length;
      while (n < count) n *= 2;
      const o = new Uint32Array(n);
      o.set(this.offsets.subarray(0, this.count));
      this.offsets = o;
      grow = true;
    }
    if (grow) this.allocGPU();
  }

  /**
   * Packs actions after the committed ones and uploads them. If commit is
   * false they are staged only (for previews) and will be overwritten.
   * Returns the index range they occupy.
   */
  write(actions: Action[], commit: boolean): [number, number] {
    const need = actions.reduce((s, a) => s + packedSize(a), 0);
    this.reserve(this.floats + need, this.count + actions.length);
    let at = this.floats;
    const f0 = at;
    const i0 = this.count;
    actions.forEach((a, k) => {
      this.offsets[i0 + k] = at;
      at = pack(a, this.data, at);
    });
    const q = this.device.queue;
    q.writeBuffer(this.dataBuf, f0 * 4, this.data, f0, at - f0);
    q.writeBuffer(this.offBuf, i0 * 4, this.offsets, i0, actions.length);
    if (commit) {
      this.floats = at;
      this.count += actions.length;
    }
    return [i0, i0 + actions.length];
  }

  truncate(count: number) {
    if (count >= this.count) return;
    this.floats = count === 0 ? 0 : this.offsets[count];
    this.count = count;
  }
}

export interface RowOptions {
  /**
   * Where actions [lo, hi) carry paint in from beyond the tank, find it by
   * walking [0, lo) (src holds only the tank). Exact, but such pixels cost
   * up to the whole log.
   */
  fillEdges?: boolean;
  /** Actions to render, if not the document's (preset thumbnails). */
  store?: ActionStore;
  background?: RGB;
}

export interface BatchOptions extends RowOptions {
  samples?: number;
  onProgress?: (fraction: number) => void;
}

export class Engine {
  readonly size: number;
  readonly store: ActionStore;
  background: RGB = [1, 1, 1];
  /** state[cur] holds the committed tank; state[1-cur] is scratch. */
  state: GPUTexture[];
  cur = 0;
  readonly previewTex: GPUTexture;
  showPreview = false;

  private uniform: GPUBuffer;
  private sampler: GPUSampler;
  private dummy: GPUTexture;
  private statePipe: GPUComputePipeline;
  private exportPipe: GPUComputePipeline;
  private displayPipe: GPURenderPipeline;

  private constructor(
    readonly device: GPUDevice,
    private context: GPUCanvasContext,
    size: number,
  ) {
    this.size = size;
    this.store = new ActionStore(device);
    this.state = [this.makeStateTexture('stateA'), this.makeStateTexture('stateB')];
    this.previewTex = this.makeStateTexture('preview');
    this.dummy = device.createTexture({
      size: [1, 1],
      format: STATE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
    this.uniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    const computePipe = (format: GPUTextureFormat) =>
      device.createComputePipeline({
        layout: 'auto',
        compute: {
          module: device.createShaderModule({ code: marbleWGSL.replace('DST_FORMAT', format) }),
          entryPoint: 'main',
        },
      });
    this.statePipe = computePipe(STATE_FORMAT);
    this.exportPipe = computePipe(EXPORT_FORMAT);
    const displayModule = device.createShaderModule({ code: displayWGSL });
    this.displayPipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: displayModule, entryPoint: 'vs' },
      fragment: {
        module: displayModule,
        entryPoint: 'fs',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
      },
    });
  }

  static async create(canvas: HTMLCanvasElement, requestedSize: number): Promise<Engine> {
    if (!('gpu' in navigator)) throw new UnsupportedError('WebGPU is not available in this browser.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new UnsupportedError('No WebGPU adapter found.');
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    device.lost.then((info) => console.error('WebGPU device lost:', info.message));
    const context = canvas.getContext('webgpu');
    if (!context) throw new UnsupportedError('Could not create a WebGPU canvas context.');
    context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
    const size = Math.min(requestedSize, device.limits.maxTextureDimension2D);
    return new Engine(device, context, size);
  }

  /** A log of its own for actions, apart from the document's. */
  makeStore(actions: Action[]): ActionStore {
    const store = new ActionStore(this.device);
    store.write(actions, true);
    return store;
  }

  get current(): GPUTexture {
    return this.state[this.cur];
  }

  private writeParams(
    dst: GPUTexture,
    src: GPUTexture | null,
    lo: number,
    hi: number,
    samples: number,
    originY: number,
    fillEdges: boolean,
    background: RGB,
  ) {
    const buf = new ArrayBuffer(64);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    f.set([...background, 1], 0);
    f[4] = dst.width;
    f[5] = dst.height;
    u[6] = 0;
    u[7] = originY;
    f[8] = src ? src.width : 1;
    f[9] = src ? src.height : 1;
    u[10] = lo;
    u[11] = hi;
    u[12] = src ? 1 : 0;
    u[13] = samples;
    u[14] = src && fillEdges ? 1 : 0;
    this.device.queue.writeBuffer(this.uniform, 0, buf);
  }

  /** GPU work to render a span of actions over the whole state, in the units of WORK_PER_SUBMIT. */
  work(actions: number, samples = 1): number {
    return (actions + 1) * this.size ** 2 * samples * samples;
  }

  /** Rows of dst that fit in the given work budget, in multiples of 8. */
  rowsFor(lo: number, hi: number, dst: GPUTexture, samples: number, budget: number): number {
    const costPerRow = (hi - lo + 1) * dst.width * samples * samples;
    return Math.max(8, Math.min(dst.height, Math.floor(budget / costPerRow / 8) * 8));
  }

  /**
   * Renders rows [y0, y0 + rows) of dst = (actions [lo, hi) applied to src),
   * where src = null means an empty tank. Submits one dispatch.
   */
  runRows(
    lo: number,
    hi: number,
    src: GPUTexture | null,
    dst: GPUTexture,
    samples: number,
    y0: number,
    rows: number,
    { fillEdges = false, store = this.store, background = this.background }: RowOptions = {},
  ) {
    const pipe = dst.format === EXPORT_FORMAT ? this.exportPipe : this.statePipe;
    const bind = this.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: store.dataBuf } },
        { binding: 2, resource: { buffer: store.offBuf } },
        { binding: 3, resource: (src ?? this.dummy).createView() },
        { binding: 5, resource: dst.createView() },
      ],
    });
    this.writeParams(dst, src, lo, hi, samples, y0, fillEdges, background);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(dst.width / 8), Math.ceil(rows / 8));
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /**
   * Renders dst = (actions [lo, hi) applied to src), where src = null means
   * an empty tank. Large jobs are split into horizontal strips across
   * several submits; the promise resolves once all are queued and done.
   */
  async runBatch(lo: number, hi: number, src: GPUTexture | null, dst: GPUTexture, opts: BatchOptions = {}) {
    const samples = opts.samples ?? 1;
    const strip = this.rowsFor(lo, hi, dst, samples, WORK_PER_SUBMIT);
    for (let y = 0; y < dst.height; y += strip) {
      const rows = Math.min(strip, dst.height - y);
      this.runRows(lo, hi, src, dst, samples, y, rows, opts);
      if (strip < dst.height) {
        await this.device.queue.onSubmittedWorkDone();
        opts.onProgress?.(Math.min(1, (y + rows) / dst.height));
      }
    }
  }

  /** Applies already-committed actions [lo, hi) on top of the current state. */
  applyCommitted(lo: number, hi: number): Promise<void> {
    const src = this.current;
    const dst = this.state[1 - this.cur];
    this.cur = 1 - this.cur;
    return this.runBatch(lo, hi, src, dst);
  }

  /** Renders a non-committed preview of actions over the current state. */
  preview(actions: Action[] | null, fillEdges = false) {
    if (!actions || actions.length === 0) {
      this.showPreview = false;
      return;
    }
    const [lo, hi] = this.store.write(actions, false);
    void this.runBatch(lo, hi, this.current, this.previewTex, { fillEdges });
    this.showPreview = true;
  }

  copy(src: GPUTexture, dst: GPUTexture) {
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToTexture({ texture: src }, { texture: dst }, [src.width, src.height]);
    this.device.queue.submit([enc.finish()]);
  }

  /** A texture that can hold the tank state and be rendered into or from. */
  makeStateTexture(label: string): GPUTexture {
    return this.device.createTexture({
      label,
      size: [this.size, this.size],
      format: STATE_FORMAT,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    });
  }

  makeCheckpointTexture(): GPUTexture {
    return this.device.createTexture({
      size: [this.size, this.size],
      format: STATE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });
  }

  present() {
    const tex = this.showPreview ? this.previewTex : this.current;
    const bind = this.device.createBindGroup({
      layout: this.displayPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: tex.createView() },
        { binding: 1, resource: this.sampler },
      ],
    });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        { view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
      ],
    });
    pass.setPipeline(this.displayPipe);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /**
   * Exact render of all committed actions at the given size, as PNG. Renders
   * opts.store over opts.background instead, if given.
   */
  async exportPNG(size: number, opts: BatchOptions = {}): Promise<Blob> {
    size = Math.min(size, this.device.limits.maxTextureDimension2D);
    const tex = this.device.createTexture({
      size: [size, size],
      format: EXPORT_FORMAT,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    await this.runBatch(0, (opts.store ?? this.store).count, null, tex, opts);
    const bytesPerRow = Math.ceil((size * 4) / 256) * 256;
    const buf = this.device.createBuffer({
      size: bytesPerRow * size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, [size, size]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      pixels.set(src.subarray(y * bytesPerRow, y * bytesPerRow + size * 4), y * size * 4);
    }
    buf.unmap();
    buf.destroy();
    tex.destroy();
    const canvas = new OffscreenCanvas(size, size);
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, size, size), 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
  }
}
