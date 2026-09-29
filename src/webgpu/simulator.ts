import computeShaderSource from '../shaders/compute.wgsl?raw';
import renderShaderSource from '../shaders/render.wgsl?raw';
import { PRESETS, Preset } from './presets';

export interface SimulatorOptions {
  canvas: HTMLCanvasElement;
  width?: number;
  height?: number;
  colorScheme?: number;
  gridLines?: boolean;
}

export class WebGPUSimulator {
  private canvas: HTMLCanvasElement;
  private adapter!: GPUAdapter;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;

  public width: number;
  public height: number;
  public colorScheme: number;
  public gridLines: boolean;
  public generation: number = 0;

  // Explicit Memory Buffers
  private cellBufferA!: GPUBuffer;
  private cellBufferB!: GPUBuffer;
  private computeUniformBuffer!: GPUBuffer;
  private renderUniformBuffer!: GPUBuffer;

  // Pipeline State Objects (PSO)
  private computePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;

  // Bind Groups for ping-ponging
  private computeBindGroupA!: GPUBindGroup; // In: A -> Out: B
  private computeBindGroupB!: GPUBindGroup; // In: B -> Out: A
  private renderBindGroupA!: GPUBindGroup;
  private renderBindGroupB!: GPUBindGroup;

  // Ping-pong state tracker: 0 means A has current state, 1 means B has current state
  private activeBufferIndex: number = 0;

  // CPU staging array for quick updates / reads
  private cpuGrid!: Uint32Array;

  constructor(options: SimulatorOptions) {
    this.canvas = options.canvas;
    this.width = options.width ?? 512;
    this.height = options.height ?? 512;
    this.colorScheme = options.colorScheme ?? 0;
    this.gridLines = options.gridLines ?? false;
  }

  public static isSupported(): boolean {
    return 'gpu' in navigator && !!navigator.gpu;
  }

  public async init(): Promise<void> {
    if (!WebGPUSimulator.isSupported()) {
      throw new Error("WebGPU nie je podporované v tomto prehliadači.");
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    });

    if (!adapter) {
      throw new Error("Nepodarilo sa získať WebGPU Adapter (GPU akcelerátor).");
    }
    this.adapter = adapter;

    this.device = await adapter.requestDevice({
      label: "GameOfLife-Device"
    });

    const context = this.canvas.getContext('webgpu');
    if (!context) {
      throw new Error("Nepodarilo sa inicializovať WebGPU canvas context.");
    }
    this.context = context;

    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque'
    });

    // Create Pipeline State Objects (PSOs)
    this.initPipelines();

    // Create Buffers & Bind Groups
    this.initBuffers();

    // Fill with initial random pattern
    this.randomize(0.2);
  }

  public getAdapterInfo(): GPUAdapterInfo | null {
    return (this.adapter as any)?.info ?? null;
  }

  private initPipelines(): void {
    // 1. Compute Pipeline State Object
    const computeShaderModule = this.device.createShaderModule({
      label: "Compute-Module-GameOfLife",
      code: computeShaderSource
    });

    this.computePipeline = this.device.createComputePipeline({
      label: "Compute-Pipeline-GameOfLife",
      layout: 'auto',
      compute: {
        module: computeShaderModule,
        entryPoint: 'main'
      }
    });

    // 2. Render Pipeline State Object
    const renderShaderModule = this.device.createShaderModule({
      label: "Render-Module-GameOfLife",
      code: renderShaderSource
    });

    this.renderPipeline = this.device.createRenderPipeline({
      label: "Render-Pipeline-GameOfLife",
      layout: 'auto',
      vertex: {
        module: renderShaderModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: renderShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });
  }

  private initBuffers(): void {
    const totalCells = this.width * this.height;
    const bufferSize = totalCells * Uint32Array.BYTES_PER_ELEMENT;

    this.cpuGrid = new Uint32Array(totalCells);

    // Destroy existing buffers if resizing
    if (this.cellBufferA) this.cellBufferA.destroy();
    if (this.cellBufferB) this.cellBufferB.destroy();
    if (this.computeUniformBuffer) this.computeUniformBuffer.destroy();
    if (this.renderUniformBuffer) this.renderUniformBuffer.destroy();

    // Explicit Storage Buffers (A and B for ping-pong computation)
    this.cellBufferA = this.device.createBuffer({
      label: "Cell-Buffer-A",
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    this.cellBufferB = this.device.createBuffer({
      label: "Cell-Buffer-B",
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    // Uniform Buffers (padded to 16 bytes minimum per WebGPU standard)
    this.computeUniformBuffer = this.device.createBuffer({
      label: "Compute-Uniform-Buffer",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.renderUniformBuffer = this.device.createBuffer({
      label: "Render-Uniform-Buffer",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.updateUniforms();

    // Create Bind Groups matching auto-layouts of pipelines
    const computeLayout = this.computePipeline.getBindGroupLayout(0);
    this.computeBindGroupA = this.device.createBindGroup({
      label: "Compute-BindGroup-AtoB",
      layout: computeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.cellBufferA } },
        { binding: 2, resource: { buffer: this.cellBufferB } }
      ]
    });

    this.computeBindGroupB = this.device.createBindGroup({
      label: "Compute-BindGroup-BtoA",
      layout: computeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.cellBufferB } },
        { binding: 2, resource: { buffer: this.cellBufferA } }
      ]
    });

    const renderLayout = this.renderPipeline.getBindGroupLayout(0);
    this.renderBindGroupA = this.device.createBindGroup({
      label: "Render-BindGroup-A",
      layout: renderLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer } },
        { binding: 1, resource: { buffer: this.cellBufferA } }
      ]
    });

    this.renderBindGroupB = this.device.createBindGroup({
      label: "Render-BindGroup-B",
      layout: renderLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer } },
        { binding: 1, resource: { buffer: this.cellBufferB } }
      ]
    });

    this.activeBufferIndex = 0;
  }

  private updateUniforms(): void {
    // Compute uniforms: width (u32), height (u32)
    const computeData = new Uint32Array([this.width, this.height, 0, 0]);
    this.device.queue.writeBuffer(this.computeUniformBuffer, 0, computeData as unknown as BufferSource);

    // Render uniforms: width, height, colorScheme, gridLines
    const renderData = new Uint32Array([
      this.width,
      this.height,
      this.colorScheme,
      this.gridLines ? 1 : 0
    ]);
    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, renderData as unknown as BufferSource);
  }

  public setGridResolution(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.generation = 0;
    this.initBuffers();
    this.randomize(0.2);
  }

  public setColorScheme(schemeIndex: number): void {
    this.colorScheme = schemeIndex;
    this.updateUniforms();
  }

  public setGridLines(enabled: boolean): void {
    this.gridLines = enabled;
    this.updateUniforms();
  }

  public uploadCpuGridToGpu(): void {
    const targetBuffer = this.activeBufferIndex === 0 ? this.cellBufferA : this.cellBufferB;
    this.device.queue.writeBuffer(targetBuffer, 0, this.cpuGrid as unknown as BufferSource);
  }

  public clear(): void {
    this.cpuGrid.fill(0);
    this.uploadCpuGridToGpu();
    this.generation = 0;
  }

  public randomize(density: number = 0.25): void {
    const total = this.width * this.height;
    for (let i = 0; i < total; i++) {
      this.cpuGrid[i] = Math.random() < density ? 1 : 0;
    }
    this.uploadCpuGridToGpu();
    this.generation = 0;
  }

  public loadPreset(key: string): void {
    const preset: Preset | undefined = PRESETS[key];
    if (!preset) return;

    this.clear();

    const startX = Math.floor((this.width - preset.width) / 2);
    const startY = Math.floor((this.height - preset.height) / 2);

    for (const [r, c] of preset.pattern) {
      const targetX = startX + c;
      const targetY = startY + r;
      if (targetX >= 0 && targetX < this.width && targetY >= 0 && targetY < this.height) {
        this.cpuGrid[targetY * this.width + targetX] = 1;
      }
    }

    this.uploadCpuGridToGpu();
  }

  public setCellAtNormalized(u: number, v: number, radius: number = 1, alive: boolean = true): void {
    const centerX = Math.floor(u * this.width);
    const centerY = Math.floor(v * this.height);

    let changed = false;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const x = (centerX + dx + this.width) % this.width;
          const y = (centerY + dy + this.height) % this.height;
          const index = y * this.width + x;
          const newVal = alive ? 1 : 0;
          if (this.cpuGrid[index] !== newVal) {
            this.cpuGrid[index] = newVal;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      this.uploadCpuGridToGpu();
    }
  }

  /**
   * Dispatches the Compute Shader to advance simulation by 1 generation
   */
  public step(commandEncoder?: GPUCommandEncoder): GPUCommandEncoder {
    const encoder = commandEncoder ?? this.device.createCommandEncoder({
      label: "GameOfLife-Step-Encoder"
    });

    const computePass = encoder.beginComputePass({
      label: `ComputePass-Gen-${this.generation}`
    });

    computePass.setPipeline(this.computePipeline);

    // Swap bind groups for ping-pong execution
    if (this.activeBufferIndex === 0) {
      computePass.setBindGroup(0, this.computeBindGroupA); // reads A, writes B
      this.activeBufferIndex = 1;
    } else {
      computePass.setBindGroup(0, this.computeBindGroupB); // reads B, writes A
      this.activeBufferIndex = 0;
    }

    // Workgroup dimensions (16x16 threads per workgroup)
    const workgroupsX = Math.ceil(this.width / 16);
    const workgroupsY = Math.ceil(this.height / 16);
    computePass.dispatchWorkgroups(workgroupsX, workgroupsY);

    computePass.end();

    this.generation++;

    // If encoder was locally created, submit it
    if (!commandEncoder) {
      this.device.queue.submit([encoder.finish()]);
    }

    return encoder;
  }

  /**
   * Executes compute steps followed by rendering within a single GPU command buffer
   */
  public stepAndRender(stepsCount: number = 1): void {
    const commandEncoder = this.device.createCommandEncoder({
      label: "Frame-Command-Encoder"
    });

    // Run compute steps
    for (let i = 0; i < stepsCount; i++) {
      this.step(commandEncoder);
    }

    // Render pass
    const currentTexture = this.context.getCurrentTexture();
    const renderPass = commandEncoder.beginRenderPass({
      label: "RenderPass-GameOfLife",
      colorAttachments: [{
        view: currentTexture.createView(),
        clearValue: { r: 0.04, g: 0.05, b: 0.08, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });

    renderPass.setPipeline(this.renderPipeline);
    // Bind group matching current output buffer
    const currentRenderBindGroup = this.activeBufferIndex === 0 ? this.renderBindGroupA : this.renderBindGroupB;
    renderPass.setBindGroup(0, currentRenderBindGroup);
    renderPass.draw(3, 1, 0, 0); // Fullscreen triangle
    renderPass.end();

    // Synchronously submit recorded command buffer to GPU queue
    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Simple render without advancing generation
   */
  public renderOnly(): void {
    const commandEncoder = this.device.createCommandEncoder({
      label: "Render-Only-Encoder"
    });

    const currentTexture = this.context.getCurrentTexture();
    const renderPass = commandEncoder.beginRenderPass({
      label: "RenderPass-Only",
      colorAttachments: [{
        view: currentTexture.createView(),
        clearValue: { r: 0.04, g: 0.05, b: 0.08, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });

    renderPass.setPipeline(this.renderPipeline);
    const currentRenderBindGroup = this.activeBufferIndex === 0 ? this.renderBindGroupA : this.renderBindGroupB;
    renderPass.setBindGroup(0, currentRenderBindGroup);
    renderPass.draw(3, 1, 0, 0);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }
}
