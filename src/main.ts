import './style.css';
import { WebGPUSimulator } from './webgpu/simulator';

// Elements
const canvas = document.getElementById('gpu-canvas') as HTMLCanvasElement;
const banner = document.getElementById('no-webgpu-banner') as HTMLDivElement;

const fpsVal = document.getElementById('fps-val') as HTMLSpanElement;
const genVal = document.getElementById('gen-val') as HTMLSpanElement;
const cellsVal = document.getElementById('cells-val') as HTMLSpanElement;
const gpuVal = document.getElementById('gpu-val') as HTMLSpanElement;

const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const playIcon = document.getElementById('play-icon') as HTMLSpanElement;
const playText = document.getElementById('play-text') as HTMLSpanElement;
const btnStep = document.getElementById('btn-step') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;

const resolutionSelect = document.getElementById('resolution-select') as HTMLSelectElement;
const stepsSlider = document.getElementById('steps-per-frame') as HTMLInputElement;
const stepsVal = document.getElementById('steps-val') as HTMLSpanElement;
const speedSlider = document.getElementById('speed-limit') as HTMLInputElement;
const speedVal = document.getElementById('speed-val') as HTMLSpanElement;
const colorThemeSelect = document.getElementById('color-theme') as HTMLSelectElement;
const gridlinesCheckbox = document.getElementById('gridlines-checkbox') as HTMLInputElement;

const brushDrawBtn = document.getElementById('brush-draw') as HTMLButtonElement;
const brushEraseBtn = document.getElementById('brush-erase') as HTMLButtonElement;
const brushSizeSlider = document.getElementById('brush-size') as HTMLInputElement;
const brushVal = document.getElementById('brush-val') as HTMLSpanElement;

const btnTheory = document.getElementById('btn-theory') as HTMLButtonElement;
const theoryModal = document.getElementById('theory-modal') as HTMLDivElement;
const modalClose = document.getElementById('modal-close') as HTMLButtonElement;
const modalBackdrop = theoryModal.querySelector('.modal-backdrop') as HTMLDivElement;
const tabBtns = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
const tabPanes = document.querySelectorAll<HTMLElement>('.tab-pane');

// State variables
let simulator: WebGPUSimulator | null = null;
let isRunning = true;
let stepsPerFrame = 1;
let targetFps = 60;
let lastStepTime = 0;
let frameCount = 0;
let lastFpsUpdateTime = performance.now();

let isDrawing = false;
let brushMode: 'draw' | 'erase' = 'draw';
let brushRadius = 1;

function updateCanvasDimensions() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const displayWidth = Math.floor(rect.width * dpr);
  const displayHeight = Math.floor(rect.height * dpr);

  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
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
    colorScheme: parseInt(colorThemeSelect.value, 10),
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

  // Update GPU info
  const adapterInfo = simulator.getAdapterInfo();
  if (adapterInfo) {
    const name = (adapterInfo as any).device || (adapterInfo as any).architecture || adapterInfo.vendor || "WebGPU GPU";
    gpuVal.textContent = name;
  } else {
    gpuVal.textContent = "WebGPU Akcelerátor";
  }

  updateCellCounter();
  setupEventListeners();
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

  // FPS calculation
  frameCount++;
  const elapsedSinceFps = currentTime - lastFpsUpdateTime;
  if (elapsedSinceFps >= 500) {
    const fps = Math.round((frameCount * 1000) / elapsedSinceFps);
    fpsVal.textContent = fps.toString();
    frameCount = 0;
    lastFpsUpdateTime = currentTime;
  }

  if (isRunning) {
    const minInterval = 1000 / targetFps;
    const timeSinceLastStep = currentTime - lastStepTime;

    if (timeSinceLastStep >= minInterval) {
      simulator.stepAndRender(stepsPerFrame);
      lastStepTime = currentTime - (timeSinceLastStep % minInterval);
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
  // Play / Pause
  btnPlay.addEventListener('click', togglePlay);

  // Keyboard shortcut Spacebar
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      togglePlay();
    }
  });

  // Step
  btnStep.addEventListener('click', () => {
    if (!simulator) return;
    simulator.stepAndRender(1);
    genVal.textContent = simulator.generation.toLocaleString('sk-SK');
  });

  // Clear
  btnClear.addEventListener('click', () => {
    if (!simulator) return;
    simulator.clear();
    genVal.textContent = '0';
    if (!isRunning) simulator.renderOnly();
  });

  // Presets
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetKey = btn.dataset.preset;
      if (presetKey && simulator) {
        simulator.loadPreset(presetKey);
        genVal.textContent = '0';
        if (!isRunning) simulator.renderOnly();
      }
    });
  });

  // Actions (Randomize)
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (!simulator) return;
      if (action === 'random-25') {
        simulator.randomize(0.25);
      } else if (action === 'random-50') {
        simulator.randomize(0.50);
      }
      genVal.textContent = '0';
      if (!isRunning) simulator.renderOnly();
    });
  });

  // Resolution selector
  resolutionSelect.addEventListener('change', () => {
    if (!simulator) return;
    const res = parseInt(resolutionSelect.value, 10);
    simulator.setGridResolution(res, res);
    updateCellCounter();
    genVal.textContent = '0';
    if (!isRunning) simulator.renderOnly();
  });

  // Substeps
  stepsSlider.addEventListener('input', () => {
    stepsPerFrame = parseInt(stepsSlider.value, 10);
    stepsVal.textContent = `${stepsPerFrame}×`;
  });

  // Target FPS / Speed
  speedSlider.addEventListener('input', () => {
    targetFps = parseInt(speedSlider.value, 10);
    speedVal.textContent = targetFps.toString();
  });

  // Color theme
  colorThemeSelect.addEventListener('change', () => {
    if (!simulator) return;
    simulator.setColorScheme(parseInt(colorThemeSelect.value, 10));
    if (!isRunning) simulator.renderOnly();
  });

  // Grid lines
  gridlinesCheckbox.addEventListener('change', () => {
    if (!simulator) return;
    simulator.setGridLines(gridlinesCheckbox.checked);
    if (!isRunning) simulator.renderOnly();
  });

  // Brush controls
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

  // Mouse Painting
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

  // Theory Modal
  btnTheory.addEventListener('click', () => {
    theoryModal.classList.remove('hidden');
  });

  modalClose.addEventListener('click', () => {
    theoryModal.classList.add('hidden');
  });

  modalBackdrop.addEventListener('click', () => {
    theoryModal.classList.add('hidden');
  });

  // Tabs
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;
      if (!targetId) return;

      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const pane = document.getElementById(targetId);
      if (pane) pane.classList.add('active');
    });
  });
}

// Start
window.addEventListener('DOMContentLoaded', startApp);
