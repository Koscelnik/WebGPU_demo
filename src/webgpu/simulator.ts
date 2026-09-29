import computeShaderSource from '../shaders/compute.wgsl?raw';
import renderShaderSource from '../shaders/render.wgsl?raw';

export interface SimulatorOptions {
  canvas: HTMLCanvasElement;
  width?: number;
  height?: number;
  showGrid?: boolean;
}

export class WebGPUSimulator {
  private canvas: HTMLCanvasElement;
  private adapter!: GPUAdapter;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;

  public width: number;
  public height: number;
  public showGrid: boolean;
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

  constructor(options: SimulatorOptions) {
    this.canvas = options.canvas;
    this.width = options.width ?? 512;
    this.height = options.height ?? 512;
    this.showGrid = options.showGrid ?? true;
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
      throw new Error("Nepodarilo sa získať WebGPU Adapter.");
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

    this.initPipelines();
    this.initBuffers();
    this.randomize(0.2);
  }

  public async getAdapterDescription(): Promise<string> {
    if (!this.adapter) return "Neznáme GPU";
    if ('info' in this.adapter && (this.adapter as any).info) {
      const info = (this.adapter as any).info;
      return info.description || info.device || info.architecture || info.vendor || "WebGPU GPU";
    }
    if ('requestAdapterInfo' in this.adapter) {
      try {
        const info = await (this.adapter as any).requestAdapterInfo();
        return info.description || info.device || info.architecture || info.vendor || "WebGPU GPU";
      } catch {
        // fallback
      }
    }
    return "WebGPU Akcelerátor";
  }

  private initPipelines(): void {
    const computeShaderModule = this.device.createShaderModule({
      label: "Compute-Module",
      code: computeShaderSource
    });

    this.computePipeline = this.device.createComputePipeline({
      label: "Compute-Pipeline",
      layout: 'auto',
      compute: {
        module: computeShaderModule,
        entryPoint: 'main'
      }
    });

    const renderShaderModule = this.device.createShaderModule({
      label: "Render-Module",
      code: renderShaderSource
    });

    this.renderPipeline = this.device.createRenderPipeline({
      label: "Render-Pipeline",
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

    if (this.cellBufferA) this.cellBufferA.destroy();
    if (this.cellBufferB) this.cellBufferB.destroy();
    if (this.computeUniformBuffer) this.computeUniformBuffer.destroy();
    if (this.renderUniformBuffer) this.renderUniformBuffer.destroy();

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

    this.computeUniformBuffer = this.device.createBuffer({
      label: "Compute-Uniform",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.renderUniformBuffer = this.device.createBuffer({
      label: "Render-Uniform",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.updateUniforms();

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

  public updateUniforms(): void {
    const computeData = new Uint32Array([this.width, this.height, 0, 0]);
    this.device.queue.writeBuffer(this.computeUniformBuffer, 0, computeData as unknown as BufferSource);

    // Mixed u32 and f32 uniform buffer matching RenderParams in render.wgsl
    const renderBuffer = new ArrayBuffer(16);
    const u32View = new Uint32Array(renderBuffer);
    const f32View = new Float32Array(renderBuffer);

    u32View[0] = this.width;
    u32View[1] = this.height;
    f32View[2] = this.canvas.width;
    u32View[3] = this.showGrid ? 1 : 0;

    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, renderBuffer as unknown as BufferSource);
  }

  public setShowGrid(enabled: boolean): void {
    this.showGrid = enabled;
    this.updateUniforms();
  }

  public updateCanvasSize(): void {
    this.updateUniforms();
  }

  public setGridResolution(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.generation = 0;
    this.initBuffers();
    this.randomize(0.2);
  }

  public clear(): void {
    const totalCells = this.width * this.height;
    const zeroData = new Uint32Array(totalCells);
    this.device.queue.writeBuffer(this.cellBufferA, 0, zeroData as unknown as BufferSource);
    this.device.queue.writeBuffer(this.cellBufferB, 0, zeroData as unknown as BufferSource);
    this.generation = 0;
  }

  public randomize(density: number = 0.25): void {
    const totalCells = this.width * this.height;
    const randData = new Uint32Array(totalCells);
    for (let i = 0; i < totalCells; i++) {
      randData[i] = Math.random() < density ? 1 : 0;
    }
    this.device.queue.writeBuffer(this.cellBufferA, 0, randData as unknown as BufferSource);
    this.device.queue.writeBuffer(this.cellBufferB, 0, randData as unknown as BufferSource);
    this.generation = 0;
  }

  /**
   * Directly updates only the painted cells in the active GPU buffer
   * without overwriting or resetting the rest of the simulation!
   */
  public paintCellsNormalized(u: number, v: number, radius: number = 1, alive: boolean = true): void {
    const centerX = Math.floor(u * this.width);
    const centerY = Math.floor(v * this.height);
    const targetBuffer = this.activeBufferIndex === 0 ? this.cellBufferA : this.cellBufferB;
    const fillVal = alive ? 1 : 0;

    for (let dy = -radius; dy <= radius; dy++) {
      const y = centerY + dy;
      if (y < 0 || y >= this.height) continue;

      const dxLimit = Math.floor(Math.sqrt(Math.max(0, radius * radius - dy * dy)));
      const minX = Math.max(0, centerX - dxLimit);
      const maxX = Math.min(this.width - 1, centerX + dxLimit);
      const spanWidth = maxX - minX + 1;
      if (spanWidth <= 0) continue;

      const rowData = new Uint32Array(spanWidth);
      if (fillVal === 1) {
        rowData.fill(1);
      }

      const byteOffset = (y * this.width + minX) * Uint32Array.BYTES_PER_ELEMENT;
      this.device.queue.writeBuffer(targetBuffer, byteOffset, rowData as unknown as BufferSource);
    }
  }

  public step(commandEncoder?: GPUCommandEncoder): GPUCommandEncoder {
    const encoder = commandEncoder ?? this.device.createCommandEncoder({
      label: "GameOfLife-Step-Encoder"
    });

    const computePass = encoder.beginComputePass({
      label: `ComputePass-Gen-${this.generation}`
    });

    computePass.setPipeline(this.computePipeline);

    if (this.activeBufferIndex === 0) {
      computePass.setBindGroup(0, this.computeBindGroupA);
      this.activeBufferIndex = 1;
    } else {
      computePass.setBindGroup(0, this.computeBindGroupB);
      this.activeBufferIndex = 0;
    }

    const workgroupsX = Math.ceil(this.width / 16);
    const workgroupsY = Math.ceil(this.height / 16);
    computePass.dispatchWorkgroups(workgroupsX, workgroupsY);

    computePass.end();
    this.generation++;

    if (!commandEncoder) {
      this.device.queue.submit([encoder.finish()]);
    }

    return encoder;
  }

  public stepAndRender(stepsCount: number = 1): void {
    const commandEncoder = this.device.createCommandEncoder({
      label: "Frame-Command-Encoder"
    });

    for (let i = 0; i < stepsCount; i++) {
      this.step(commandEncoder);
    }

    const currentTexture = this.context.getCurrentTexture();
    const renderPass = commandEncoder.beginRenderPass({
      label: "RenderPass",
      colorAttachments: [{
        view: currentTexture.createView(),
        clearValue: { r: 0.03, g: 0.04, b: 0.07, a: 1.0 },
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

  public renderOnly(): void {
    const commandEncoder = this.device.createCommandEncoder({
      label: "Render-Only-Encoder"
    });

    const currentTexture = this.context.getCurrentTexture();
    const renderPass = commandEncoder.beginRenderPass({
      label: "RenderPass-Only",
      colorAttachments: [{
        view: currentTexture.createView(),
        clearValue: { r: 0.03, g: 0.04, b: 0.07, a: 1.0 },
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
