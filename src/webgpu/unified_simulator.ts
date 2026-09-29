import golComputeSrc from '../shaders/gol_compute.wgsl?raw';
import golRenderSrc  from '../shaders/gol_render.wgsl?raw';
import sandComputeSrc from '../shaders/sand_compute.wgsl?raw';
import sandRenderSrc  from '../shaders/sand_render.wgsl?raw';
import { PixelType, Rule, MAX_RULES, ANY, createDefaultScene } from './defaults';

export type SimulationMode = 'gol' | 'sand';

export interface UnifiedSimulatorOptions {
  canvas: HTMLCanvasElement;
  width?: number;
  height?: number;
  showGrid?: boolean;
}

export class UnifiedSimulator {
  public canvas: HTMLCanvasElement;
  public width: number;
  public height: number;
  public showGrid: boolean;
  public mode: SimulationMode = 'gol';

  // Independent generations for each mode
  public golGeneration: number = 0;
  public sandGeneration: number = 0;

  get generation(): number {
    return this.mode === 'gol' ? this.golGeneration : this.sandGeneration;
  }

  // Single WebGPU context & device
  private adapter!: GPUAdapter;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;

  // Separate buffers for GoL and Sand so states are completely preserved!
  private golBufA!: GPUBuffer;
  private golBufB!: GPUBuffer;
  private golActiveIdx: number = 0;

  private sandBufA!: GPUBuffer;
  private sandBufB!: GPUBuffer;
  private sandActiveIdx: number = 0;

  // Uniform Buffers & Pre-allocated TypedArrays to avoid GC & CPU churn
  private golComputeUniformBuf!: GPUBuffer;
  private golRenderUniformBuf!:  GPUBuffer;
  private sandComputeUniformBuf!: GPUBuffer;
  private sandRenderUniformBuf!:  GPUBuffer;
  private sandRulesBuf!:          GPUBuffer;
  private paletteTex!:            GPUTexture;

  private golUniformData = new Uint32Array(4);
  private renderUniformBuffer = new ArrayBuffer(16);
  private renderU32 = new Uint32Array(this.renderUniformBuffer);
  private renderF32 = new Float32Array(this.renderUniformBuffer);
  private sandComputeUniformData = new Uint32Array(4);

  // Pipelines
  private golComputePipeline!: GPUComputePipeline;
  private golRenderPipeline!:  GPURenderPipeline;
  private sandComputePipeline!: GPUComputePipeline;
  private sandRenderPipeline!:  GPURenderPipeline;

  // Bind Groups
  private golCompBgA!: GPUBindGroup;
  private golCompBgB!: GPUBindGroup;
  private golRendBgA!: GPUBindGroup;
  private golRendBgB!: GPUBindGroup;

  private sandCompBgA!: GPUBindGroup;
  private sandCompBgB!: GPUBindGroup;
  private sandRendBgA!: GPUBindGroup;
  private sandRendBgB!: GPUBindGroup;

  // Sand rules & types
  private sandTypes: PixelType[] = [];
  private sandRules: Rule[] = [];
  private seed: number = 1;

  constructor(opts: UnifiedSimulatorOptions) {
    this.canvas   = opts.canvas;
    this.width    = opts.width  ?? 256;
    this.height   = opts.height ?? 256;
    this.showGrid = opts.showGrid ?? true;
  }

  static isSupported(): boolean {
    return 'gpu' in navigator && !!navigator.gpu;
  }

  async init(types: PixelType[], rules: Rule[]): Promise<void> {
    this.sandTypes = types;
    this.sandRules = rules;

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('Nepodarilo sa získať WebGPU Adapter.');
    this.adapter = adapter;
    this.device  = await adapter.requestDevice({ label: 'UnifiedSimulator-Device' });
    this.device.addEventListener('uncapturederror', (event: any) => {
      console.error('WebGPU Uncaptured Error:', event.error?.message || event.error);
    });

    const ctx = this.canvas.getContext('webgpu');
    if (!ctx) throw new Error('WebGPU canvas context zlyhalo.');
    this.context = ctx;
    this.format  = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque'
    });

    await this._createPipelines();
    this._createBuffers();
    this.uploadSandTypeColors();
    this.uploadSandRules();

    // Initialize both modes with interesting content
    this.randomizeGoL(0.2);
    this.loadSandDefaultScene();
  }

  async getAdapterDescription(): Promise<string> {
    if (!this.adapter) return 'Neznáme GPU';
    const a = this.adapter as any;
    if (a.info) return a.info.description || a.info.device || a.info.architecture || a.info.vendor || 'WebGPU GPU';
    if (a.requestAdapterInfo) {
      try {
        const i = await a.requestAdapterInfo();
        return i.description || i.device || i.architecture || i.vendor || 'WebGPU GPU';
      } catch {
        // fallback
      }
    }
    return 'WebGPU Akcelerátor';
  }

  private async _createPipelines(): Promise<void> {
    // 1. Game of Life Pipelines
    const golCompMod = this.device.createShaderModule({ label: 'gol-compute', code: golComputeSrc });
    this.golComputePipeline = await this.device.createComputePipelineAsync({
      label: 'gol-compute-pipe', layout: 'auto',
      compute: { module: golCompMod, entryPoint: 'main' }
    });

    const golRendMod = this.device.createShaderModule({ label: 'gol-render', code: golRenderSrc });
    this.golRenderPipeline = await this.device.createRenderPipelineAsync({
      label: 'gol-render-pipe', layout: 'auto',
      vertex:   { module: golRendMod, entryPoint: 'vs_main' },
      fragment: { module: golRendMod, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' }
    });

    // 2. Sand Automata Pipelines
    const sandCompMod = this.device.createShaderModule({ label: 'sand-compute', code: sandComputeSrc });
    this.sandComputePipeline = await this.device.createComputePipelineAsync({
      label: 'sand-compute-pipe', layout: 'auto',
      compute: { module: sandCompMod, entryPoint: 'main' }
    });

    const sandRendMod = this.device.createShaderModule({ label: 'sand-render', code: sandRenderSrc });
    try {
      this.sandRenderPipeline = await this.device.createRenderPipelineAsync({
        label: 'sand-render-pipe', layout: 'auto',
        vertex:   { module: sandRendMod, entryPoint: 'vs_main' },
        fragment: { module: sandRendMod, entryPoint: 'fs_main', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' }
      });
    } catch (err: any) {
      const info = await sandRendMod.getCompilationInfo();
      console.error('Sand Render Pipeline Creation Failed:', err);
      for (const msg of info.messages) {
        console.error(`WGSL error at line ${msg.lineNum}:${msg.linePos}: ${msg.message}`);
      }
      throw err;
    }
  }

  private _createBuffers(): void {
    const totalCells = this.width * this.height;
    const cellBytes = totalCells * 4;

    for (const b of [
      this.golBufA, this.golBufB,
      this.sandBufA, this.sandBufB,
      this.golComputeUniformBuf, this.golRenderUniformBuf,
      this.sandComputeUniformBuf, this.sandRenderUniformBuf,
      this.sandRulesBuf
    ]) {
      if (b) b.destroy();
    }

    const SU = GPUBufferUsage;

    // Separate storage buffers for GoL and Sand
    this.golBufA = this.device.createBuffer({
      label: 'gol-A', size: cellBytes,
      usage: SU.STORAGE | SU.COPY_DST | SU.COPY_SRC
    });
    this.golBufB = this.device.createBuffer({
      label: 'gol-B', size: cellBytes,
      usage: SU.STORAGE | SU.COPY_DST | SU.COPY_SRC
    });

    this.sandBufA = this.device.createBuffer({
      label: 'sand-A', size: cellBytes,
      usage: SU.STORAGE | SU.COPY_DST | SU.COPY_SRC
    });
    this.sandBufB = this.device.createBuffer({
      label: 'sand-B', size: cellBytes,
      usage: SU.STORAGE | SU.COPY_DST | SU.COPY_SRC
    });

    // Uniform Buffers
    this.golComputeUniformBuf = this.device.createBuffer({
      label: 'gol-comp-uni', size: 16, usage: SU.UNIFORM | SU.COPY_DST
    });
    this.golRenderUniformBuf = this.device.createBuffer({
      label: 'gol-rend-uni', size: 16, usage: SU.UNIFORM | SU.COPY_DST
    });
    this.sandComputeUniformBuf = this.device.createBuffer({
      label: 'sand-comp-uni', size: 16, usage: SU.UNIFORM | SU.COPY_DST
    });
    this.sandRenderUniformBuf = this.device.createBuffer({
      label: 'sand-rend-uni', size: 16, usage: SU.UNIFORM | SU.COPY_DST
    });

    // Rules
    this.sandRulesBuf = this.device.createBuffer({
      label: 'sand-rules', size: MAX_RULES * 18 * 4, usage: SU.STORAGE | SU.COPY_DST
    });

    // Palette texture (100% consistent custom colors)
    if (this.paletteTex) this.paletteTex.destroy();
    this.paletteTex = this.device.createTexture({
      label: 'palette-texture',
      size: [64, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });

    this._updateStaticUniforms();
    this._createBindGroups();
    this.golActiveIdx = 0;
    this.sandActiveIdx = 0;
  }

  private _createBindGroups(): void {
    // Game of Life Bind Groups
    const gcLayout = this.golComputePipeline.getBindGroupLayout(0);
    this.golCompBgA = this.device.createBindGroup({
      label: 'gol-comp-A->B', layout: gcLayout, entries: [
        { binding: 0, resource: { buffer: this.golComputeUniformBuf } },
        { binding: 1, resource: { buffer: this.golBufA } },
        { binding: 2, resource: { buffer: this.golBufB } }
      ]
    });
    this.golCompBgB = this.device.createBindGroup({
      label: 'gol-comp-B->A', layout: gcLayout, entries: [
        { binding: 0, resource: { buffer: this.golComputeUniformBuf } },
        { binding: 1, resource: { buffer: this.golBufB } },
        { binding: 2, resource: { buffer: this.golBufA } }
      ]
    });

    const grLayout = this.golRenderPipeline.getBindGroupLayout(0);
    this.golRendBgA = this.device.createBindGroup({
      label: 'gol-rend-A', layout: grLayout, entries: [
        { binding: 0, resource: { buffer: this.golRenderUniformBuf } },
        { binding: 1, resource: { buffer: this.golBufA } }
      ]
    });
    this.golRendBgB = this.device.createBindGroup({
      label: 'gol-rend-B', layout: grLayout, entries: [
        { binding: 0, resource: { buffer: this.golRenderUniformBuf } },
        { binding: 1, resource: { buffer: this.golBufB } }
      ]
    });

    // Sand Automata Bind Groups
    const scLayout = this.sandComputePipeline.getBindGroupLayout(0);
    this.sandCompBgA = this.device.createBindGroup({
      label: 'sand-comp-A->B', layout: scLayout, entries: [
        { binding: 0, resource: { buffer: this.sandComputeUniformBuf } },
        { binding: 1, resource: { buffer: this.sandBufA } },
        { binding: 2, resource: { buffer: this.sandBufB } },
        { binding: 3, resource: { buffer: this.sandRulesBuf } }
      ]
    });
    this.sandCompBgB = this.device.createBindGroup({
      label: 'sand-comp-B->A', layout: scLayout, entries: [
        { binding: 0, resource: { buffer: this.sandComputeUniformBuf } },
        { binding: 1, resource: { buffer: this.sandBufB } },
        { binding: 2, resource: { buffer: this.sandBufA } },
        { binding: 3, resource: { buffer: this.sandRulesBuf } }
      ]
    });

    const srLayout = this.sandRenderPipeline.getBindGroupLayout(0);
    this.sandRendBgA = this.device.createBindGroup({
      label: 'sand-rend-A', layout: srLayout, entries: [
        { binding: 0, resource: { buffer: this.sandRenderUniformBuf } },
        { binding: 1, resource: { buffer: this.sandBufA } },
        { binding: 2, resource: this.paletteTex.createView() }
      ]
    });
    this.sandRendBgB = this.device.createBindGroup({
      label: 'sand-rend-B', layout: srLayout, entries: [
        { binding: 0, resource: { buffer: this.sandRenderUniformBuf } },
        { binding: 1, resource: { buffer: this.sandBufB } },
        { binding: 2, resource: this.paletteTex.createView() }
      ]
    });
  }

  private _updateStaticUniforms(): void {
    // GoL Compute uniform
    this.golUniformData[0] = this.width;
    this.golUniformData[1] = this.height;
    this.device.queue.writeBuffer(this.golComputeUniformBuf, 0, this.golUniformData as unknown as BufferSource);

    // Shared Render uniform
    this.renderU32[0] = this.width;
    this.renderU32[1] = this.height;
    this.renderF32[2] = this.canvas.width;
    this.renderU32[3] = this.showGrid ? 1 : 0;
    this.device.queue.writeBuffer(this.golRenderUniformBuf, 0, this.renderUniformBuffer as unknown as BufferSource);
    this.device.queue.writeBuffer(this.sandRenderUniformBuf, 0, this.renderUniformBuffer as unknown as BufferSource);

    // Sand Compute uniform
    this.sandComputeUniformData[0] = this.width;
    this.sandComputeUniformData[1] = this.height;
    this.sandComputeUniformData[2] = this.sandRules.length;
    this.sandComputeUniformData[3] = this.seed;
    this.device.queue.writeBuffer(this.sandComputeUniformBuf, 0, this.sandComputeUniformData as unknown as BufferSource);
  }

  public uploadSandTypeColors(): void {
    if (!this.paletteTex) return;
    const data = new Uint8Array(64 * 4);
    for (let i = 0; i < this.sandTypes.length && i < 64; i++) {
      const [r, g, b] = this.sandTypes[i].color;
      const off = i * 4;
      data[off]     = r;
      data[off + 1] = g;
      data[off + 2] = b;
      data[off + 3] = 255;
    }
    this.device.queue.writeTexture(
      { texture: this.paletteTex },
      data,
      { bytesPerRow: 256 },
      [64, 1, 1]
    );
  }

  public uploadSandRules(): void {
    const data = new Uint32Array(MAX_RULES * 18);
    for (let r = 0; r < this.sandRules.length && r < MAX_RULES; r++) {
      const base = r * 18;
      for (let i = 0; i < 9; i++) data[base + i]     = this.sandRules[r].input[i]  ?? ANY;
      for (let i = 0; i < 9; i++) data[base + 9 + i]  = this.sandRules[r].output[i] ?? ANY;
    }
    this.device.queue.writeBuffer(this.sandRulesBuf, 0, data as unknown as BufferSource);

    this.sandComputeUniformData[2] = this.sandRules.length;
    this.device.queue.writeBuffer(this.sandComputeUniformBuf, 8, new Uint32Array([this.sandRules.length]) as unknown as BufferSource);
  }

  public setMode(newMode: SimulationMode): void {
    if (this.mode === newMode) return;
    this.mode = newMode;
    // Both simulations retain their exact state in their own buffers!
    this.renderOnly();
  }

  public setGridResolution(w: number, h: number): void {
    if (this.width === w && this.height === h) return;
    this.width = w;
    this.height = h;
    this.golGeneration = 0;
    this.sandGeneration = 0;
    this._createBuffers();
    this.uploadSandTypeColors();
    this.uploadSandRules();
    this.randomizeGoL(0.2);
    this.loadSandDefaultScene();
  }

  public setShowGrid(enabled: boolean): void {
    this.showGrid = enabled;
    this.renderU32[3] = enabled ? 1 : 0;
    this.device.queue.writeBuffer(this.golRenderUniformBuf, 12, new Uint32Array([enabled ? 1 : 0]) as unknown as BufferSource);
    this.device.queue.writeBuffer(this.sandRenderUniformBuf, 12, new Uint32Array([enabled ? 1 : 0]) as unknown as BufferSource);
  }

  public updateCanvasSize(): void {
    this.renderF32[2] = this.canvas.width;
    this.device.queue.writeBuffer(this.golRenderUniformBuf, 8, new Float32Array([this.canvas.width]) as unknown as BufferSource);
    this.device.queue.writeBuffer(this.sandRenderUniformBuf, 8, new Float32Array([this.canvas.width]) as unknown as BufferSource);
  }

  // --- Grid Operations ---
  public clear(): void {
    const total = this.width * this.height;
    const zeros = new Uint32Array(total);
    if (this.mode === 'gol') {
      this.device.queue.writeBuffer(this.golBufA, 0, zeros as unknown as BufferSource);
      this.device.queue.writeBuffer(this.golBufB, 0, zeros as unknown as BufferSource);
      this.golGeneration = 0;
    } else {
      this.device.queue.writeBuffer(this.sandBufA, 0, zeros as unknown as BufferSource);
      this.device.queue.writeBuffer(this.sandBufB, 0, zeros as unknown as BufferSource);
      this.sandGeneration = 0;
    }
  }

  public randomizeGoL(density: number = 0.25): void {
    const total = this.width * this.height;
    const data = new Uint32Array(total);
    for (let i = 0; i < total; i++) {
      data[i] = Math.random() < density ? 1 : 0;
    }
    this.device.queue.writeBuffer(this.golBufA, 0, data as unknown as BufferSource);
    this.device.queue.writeBuffer(this.golBufB, 0, data as unknown as BufferSource);
    this.golGeneration = 0;
  }

  public randomizeSand(density: number = 0.2): void {
    const total = this.width * this.height;
    const data = new Uint32Array(total);
    const validTypes = this.sandTypes.map((_, i) => i).filter(i => i > 0);
    if (validTypes.length === 0) return;

    for (let i = 0; i < total; i++) {
      data[i] = Math.random() < density
        ? validTypes[Math.floor(Math.random() * validTypes.length)]
        : 0;
    }
    this.device.queue.writeBuffer(this.sandBufA, 0, data as unknown as BufferSource);
    this.device.queue.writeBuffer(this.sandBufB, 0, data as unknown as BufferSource);
    this.sandGeneration = 0;
  }

  public loadSandDefaultScene(): void {
    const data = createDefaultScene(this.width, this.height);
    this.device.queue.writeBuffer(this.sandBufA, 0, data as unknown as BufferSource);
    this.device.queue.writeBuffer(this.sandBufB, 0, data as unknown as BufferSource);
    this.sandGeneration = 0;
  }

  /**
   * Dual-buffer synchronous paint: writes to BOTH buffers of active mode!
   */
  public paintCells(u: number, v: number, radius: number, value: number): void {
    const cx = Math.floor(u * this.width);
    const cy = Math.floor(v * this.height);
    const isGol = this.mode === 'gol';
    const bufA = isGol ? this.golBufA : this.sandBufA;
    const bufB = isGol ? this.golBufB : this.sandBufB;

    for (let dy = -radius; dy <= radius; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= this.height) continue;
      const dxLimit = Math.floor(Math.sqrt(Math.max(0, radius * radius - dy * dy)));
      const minX = Math.max(0, cx - dxLimit);
      const maxX = Math.min(this.width - 1, cx + dxLimit);
      const span = maxX - minX + 1;
      if (span <= 0) continue;

      const row = new Uint32Array(span).fill(value);
      const byteOff = (y * this.width + minX) * 4;

      this.device.queue.writeBuffer(bufA, byteOff, row as unknown as BufferSource);
      this.device.queue.writeBuffer(bufB, byteOff, row as unknown as BufferSource);
    }
  }

  /**
   * Coalesced batch paint: combines all points in a frame into minimal row writes!
   */
  public paintStrokeBatch(points: Array<{ u: number; v: number; radius: number; value: number }>): void {
    if (points.length === 0) return;
    const isGol = this.mode === 'gol';
    const bufA = isGol ? this.golBufA : this.sandBufA;
    const bufB = isGol ? this.golBufB : this.sandBufB;

    const rowRanges = new Map<number, [number, number]>();
    const val = points[0].value;

    for (const pt of points) {
      const cx = Math.floor(pt.u * this.width);
      const cy = Math.floor(pt.v * this.height);
      const r = pt.radius;
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= this.height) continue;
        const dxLimit = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
        const minX = Math.max(0, cx - dxLimit);
        const maxX = Math.min(this.width - 1, cx + dxLimit);
        if (minX > maxX) continue;

        const existing = rowRanges.get(y);
        if (existing) {
          existing[0] = Math.min(existing[0], minX);
          existing[1] = Math.max(existing[1], maxX);
        } else {
          rowRanges.set(y, [minX, maxX]);
        }
      }
    }

    for (const [y, [minX, maxX]] of rowRanges.entries()) {
      const span = maxX - minX + 1;
      if (span <= 0) continue;
      const row = new Uint32Array(span).fill(val);
      const byteOff = (y * this.width + minX) * 4;
      this.device.queue.writeBuffer(bufA, byteOff, row as unknown as BufferSource);
      this.device.queue.writeBuffer(bufB, byteOff, row as unknown as BufferSource);
    }
  }

  public step(enc: GPUCommandEncoder): void {
    const isGol = this.mode === 'gol';
    const pipeline = isGol ? this.golComputePipeline : this.sandComputePipeline;

    let bindGroup: GPUBindGroup;
    if (isGol) {
      bindGroup = this.golActiveIdx === 0 ? this.golCompBgA : this.golCompBgB;
      this.golActiveIdx ^= 1;
      this.golGeneration++;
    } else {
      bindGroup = this.sandActiveIdx === 0 ? this.sandCompBgA : this.sandCompBgB;
      this.sandActiveIdx ^= 1;
      this.sandGeneration++;

      // Advance seed for stochastic rule selection
      this.seed = (this.seed + 1) & 0x7FFFFFFF;
      this.device.queue.writeBuffer(this.sandComputeUniformBuf, 12, new Uint32Array([this.seed]) as unknown as BufferSource);
    }

    const pass = enc.beginComputePass({ label: `compute-${this.mode}` });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.width / 16), Math.ceil(this.height / 16));
    pass.end();
  }

  public stepAndRender(steps = 1): void {
    const enc = this.device.createCommandEncoder({ label: 'frame-encoder' });
    for (let i = 0; i < steps; i++) {
      this.step(enc);
    }
    this._renderPass(enc);
    this.device.queue.submit([enc.finish()]);
  }

  public renderOnly(): void {
    const enc = this.device.createCommandEncoder({ label: 'render-only-encoder' });
    this._renderPass(enc);
    this.device.queue.submit([enc.finish()]);
  }

  private _renderPass(enc: GPUCommandEncoder): void {
    const isGol = this.mode === 'gol';
    const pipeline = isGol ? this.golRenderPipeline : this.sandRenderPipeline;

    let bindGroup: GPUBindGroup;
    if (isGol) {
      bindGroup = this.golActiveIdx === 0 ? this.golRendBgA : this.golRendBgB;
    } else {
      bindGroup = this.sandActiveIdx === 0 ? this.sandRendBgA : this.sandRendBgB;
    }

    const pass = enc.beginRenderPass({
      label: 'render-pass',
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.027, g: 0.035, b: 0.055, a: 1.0 },
        loadOp: 'clear', storeOp: 'store'
      }]
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  }
}
