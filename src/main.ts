import './style.css';
import { WebGPUSimulator } from './webgpu/simulator';

// Elements
const canvas = document.getElementById('gpu-canvas') as HTMLCanvasElement;
const banner = document.getElementById('no-webgpu-banner') as HTMLDivElement;

const fpsVal = document.getElementById('fps-val') as HTMLSpanElement;
const spsVal = document.getElementById('sps-val') as HTMLSpanElement;
const genVal = document.getElementById('gen-val') as HTMLSpanElement;
const cellsVal = document.getElementById('cells-val') as HTMLSpanElement;
const gpuVal = document.getElementById('gpu-val') as HTMLSpanElement;

const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const playIcon = document.getElementById('play-icon') as HTMLSpanElement;
const playText = document.getElementById('play-text') as HTMLSpanElement;
const btnStep = document.getElementById('btn-step') as HTMLButtonElement;
const btnRandom = document.getElementById('btn-random') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;

const resolutionSelect = document.getElementById('resolution-select') as HTMLSelectElement;
const stepsSlider = document.getElementById('steps-per-frame') as HTMLInputElement;
const stepsVal = document.getElementById('steps-val') as HTMLSpanElement;
const speedSlider = document.getElementById('speed-limit') as HTMLInputElement;
const speedVal = document.getElementById('speed-val') as HTMLSpanElement;
const gridlinesCheckbox = document.getElementById('gridlines-checkbox') as HTMLInputElement;

const brushDrawBtn = document.getElementById('brush-draw') as HTMLButtonElement;
const brushEraseBtn = document.getElementById('brush-erase') as HTMLButtonElement;
const brushSizeSlider = document.getElementById('brush-size') as HTMLInputElement;
const brushVal = document.getElementById('brush-val') as HTMLSpanElement;

// State variables
let simulator: WebGPUSimulator | null = null;
let isRunning = true;
let stepsPerFrame = 1;
let targetSpeed = 60; // steps per second (10 to 240)
let accumulatedTime = 0;
let lastFrameTime = performance.now();

let renderFrameCount = 0;
let simStepsCount = 0;
let lastMetricsUpdateTime = performance.now();

let isDrawing = false;
let brushMode: 'draw' | 'erase' = 'draw';
let brushRadius = 1;

function updateCanvasDimensions() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  // Ensure square canvas pixel buffer matching square display
  const size = Math.min(rect.width, rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelSize = Math.max(128, Math.floor(size * dpr));

  if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
    canvas.width = pixelSize;
    canvas.height = pixelSize;
    if (simulator && !isRunning) {
      simulator.renderOnly();
    }
  }
}

async function startApp() {
  if (!WebGPUSimulator.isSupported()) {
    banner.classList.remove('hidden');
    gpuVal.textContent = "WebGPU nedostupné";
    return;
  }

  updateCanvasDimensions();
  window.addEventListener('resize', updateCanvasDimensions);

  const initialRes = parseInt(resolutionSelect.value, 10);

  simulator = new WebGPUSimulator({
    canvas,
    width: initialRes,
    height: initialRes,
    gridLines: gridlinesCheckbox.checked
  });

  try {
    await simulator.init();
  } catch (err: any) {
    banner.classList.remove('hidden');
    const p = banner.querySelector('p');
    if (p) p.textContent = `Chyba pri štarte WebGPU: ${err.message}`;
    return;
  }

  const adapterInfo = simulator.getAdapterInfo();
  if (adapterInfo) {
    const name = (adapterInfo as any).device || (adapterInfo as any).architecture || adapterInfo.vendor || "WebGPU GPU";
    gpuVal.textContent = name;
  } else {
    gpuVal.textContent = "WebGPU Akcelerátor";
  }

  updateCellCounter();
  setupEventListeners();
  lastFrameTime = performance.now();
  requestAnimationFrame(loop);
}

function updateCellCounter() {
  if (!simulator) return;
  const count = simulator.width * simulator.height;
  cellsVal.textContent = count.toLocaleString('sk-SK');
}

function loop(currentTime: number) {
  requestAnimationFrame(loop);

  if (!simulator) return;

  const delta = Math.min(currentTime - lastFrameTime, 100);
  lastFrameTime = currentTime;

  renderFrameCount++;

  // Performance metrics update every 500ms
  const elapsedMetrics = currentTime - lastMetricsUpdateTime;
  if (elapsedMetrics >= 500) {
    const fps = Math.round((renderFrameCount * 1000) / elapsedMetrics);
    const sps = Math.round((simStepsCount * 1000) / elapsedMetrics);
    fpsVal.textContent = fps.toString();
    spsVal.textContent = sps.toString();
    renderFrameCount = 0;
    simStepsCount = 0;
    lastMetricsUpdateTime = currentTime;
  }

  if (isRunning) {
    const stepInterval = 1000 / targetSpeed;
    accumulatedTime += delta;

    let stepsToExecute = 0;
    while (accumulatedTime >= stepInterval) {
      stepsToExecute += stepsPerFrame;
      accumulatedTime -= stepInterval;
      if (stepsToExecute >= 40) break; // clamp to prevent death spiral on tab switch
    }

    if (stepsToExecute > 0) {
      simulator.stepAndRender(stepsToExecute);
      simStepsCount += stepsToExecute;
      genVal.textContent = simulator.generation.toLocaleString('sk-SK');
    }
  }
}

function togglePlay() {
  isRunning = !isRunning;
  if (isRunning) {
    btnPlay.classList.add('running');
    playIcon.textContent = '⏸';
    playText.textContent = 'Pozastaviť';
    lastFrameTime = performance.now();
    accumulatedTime = 0;
  } else {
    btnPlay.classList.remove('running');
    playIcon.textContent = '▶';
    playText.textContent = 'Spustiť';
  }
}

function paintAtMouseEvent(e: MouseEvent) {
  if (!simulator) return;
  const rect = canvas.getBoundingClientRect();
  const u = (e.clientX - rect.left) / rect.width;
  const v = (e.clientY - rect.top) / rect.height;

  if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
    simulator.setCellAtNormalized(u, v, brushRadius, brushMode === 'draw');
    if (!isRunning) {
      simulator.renderOnly();
    }
  }
}

function setupEventListeners() {
  btnPlay.addEventListener('click', togglePlay);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      togglePlay();
    }
  });

  btnStep.addEventListener('click', () => {
    if (!simulator) return;
    simulator.stepAndRender(1);
    simStepsCount++;
    genVal.textContent = simulator.generation.toLocaleString('sk-SK');
  });

  btnRandom.addEventListener('click', () => {
    if (!simulator) return;
    simulator.randomize(0.25);
    genVal.textContent = '0';
    if (!isRunning) simulator.renderOnly();
  });

  btnClear.addEventListener('click', () => {
    if (!simulator) return;
    simulator.clear();
    genVal.textContent = '0';
    if (!isRunning) simulator.renderOnly();
  });

  resolutionSelect.addEventListener('change', () => {
    if (!simulator) return;
    const res = parseInt(resolutionSelect.value, 10);
    simulator.setGridResolution(res, res);
    updateCellCounter();
    genVal.textContent = '0';
    if (!isRunning) simulator.renderOnly();
  });

  stepsSlider.addEventListener('input', () => {
    stepsPerFrame = parseInt(stepsSlider.value, 10);
    stepsVal.textContent = `${stepsPerFrame}×`;
  });

  speedSlider.addEventListener('input', () => {
    targetSpeed = parseInt(speedSlider.value, 10);
    speedVal.textContent = targetSpeed.toString();
  });

  gridlinesCheckbox.addEventListener('change', () => {
    if (!simulator) return;
    simulator.setGridLines(gridlinesCheckbox.checked);
    if (!isRunning) simulator.renderOnly();
  });

  brushDrawBtn.addEventListener('click', () => {
    brushMode = 'draw';
    brushDrawBtn.classList.add('active');
    brushEraseBtn.classList.remove('active');
  });

  brushEraseBtn.addEventListener('click', () => {
    brushMode = 'erase';
    brushEraseBtn.classList.add('active');
    brushDrawBtn.classList.remove('active');
  });

  brushSizeSlider.addEventListener('input', () => {
    brushRadius = parseInt(brushSizeSlider.value, 10);
    brushVal.textContent = `${brushRadius} px`;
  });

  canvas.addEventListener('pointerdown', (e) => {
    isDrawing = true;
    paintAtMouseEvent(e);
  });

  window.addEventListener('pointermove', (e) => {
    if (isDrawing) {
      paintAtMouseEvent(e);
    }
  });

  window.addEventListener('pointerup', () => {
    isDrawing = false;
  });
}

window.addEventListener('DOMContentLoaded', startApp);
