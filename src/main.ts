import './style.css';
import { UnifiedSimulator, SimulationMode } from './webgpu/unified_simulator';
import { PixelType, Rule, ANY, DEFAULT_TYPES, DEFAULT_RULES, MAX_TYPES } from './webgpu/defaults';

/* ═══════════════════════ DOM Elements ═══════════════════ */
const canvas         = document.getElementById('gpu-canvas')           as HTMLCanvasElement;
const banner         = document.getElementById('no-webgpu-banner')     as HTMLDivElement;

const fpsVal         = document.getElementById('fps-val')              as HTMLSpanElement;
const spsVal         = document.getElementById('sps-val')              as HTMLSpanElement;
const genVal         = document.getElementById('gen-val')              as HTMLSpanElement;
const cellsVal       = document.getElementById('cells-val')            as HTMLSpanElement;
const modeVal        = document.getElementById('mode-val')             as HTMLSpanElement;
const gpuVal         = document.getElementById('gpu-val')              as HTMLSpanElement;

const modeGolBtn     = document.getElementById('mode-gol')             as HTMLButtonElement;
const modeSandBtn    = document.getElementById('mode-sand')            as HTMLButtonElement;

const btnPlay        = document.getElementById('btn-play')             as HTMLButtonElement;
const playIcon       = document.getElementById('play-icon')            as HTMLSpanElement;
const playText       = document.getElementById('play-text')            as HTMLSpanElement;
const btnStep        = document.getElementById('btn-step')             as HTMLButtonElement;
const btnRandom      = document.getElementById('btn-random')           as HTMLButtonElement;
const btnClear       = document.getElementById('btn-clear')            as HTMLButtonElement;

const resolutionSelect = document.getElementById('resolution-select')  as HTMLSelectElement;
const speedSlider    = document.getElementById('speed-limit')          as HTMLInputElement;
const speedVal       = document.getElementById('speed-val')            as HTMLSpanElement;
const substepsRow    = document.getElementById('substeps-row')         as HTMLDivElement;
const stepsSlider    = document.getElementById('steps-per-frame')      as HTMLInputElement;
const stepsVal       = document.getElementById('steps-val')            as HTMLSpanElement;
const gridToggle     = document.getElementById('grid-toggle')          as HTMLInputElement;

// GoL-specific elements
const golSection     = document.getElementById('gol-controls')         as HTMLElement;
const golBrushDraw   = document.getElementById('gol-brush-draw')       as HTMLButtonElement;
const golBrushErase  = document.getElementById('gol-brush-erase')      as HTMLButtonElement;
const golBrushSlider = document.getElementById('gol-brush-size')       as HTMLInputElement;
const golBrushVal    = document.getElementById('gol-brush-val')        as HTMLSpanElement;

// Sand-specific elements
const sandTypesSec   = document.getElementById('sand-types-section')   as HTMLElement;
const sandBrushSec   = document.getElementById('sand-brush-section')   as HTMLElement;
const sandRulesSec   = document.getElementById('sand-rules-section')   as HTMLElement;

const typeListEl     = document.getElementById('type-list')            as HTMLDivElement;
const btnAddType     = document.getElementById('btn-add-type')         as HTMLButtonElement;
const brushPaletteEl = document.getElementById('brush-palette')        as HTMLDivElement;
const sandBrushSlider= document.getElementById('sand-brush-size')      as HTMLInputElement;
const sandBrushVal   = document.getElementById('sand-brush-val')       as HTMLSpanElement;

const ruleListEl     = document.getElementById('rule-list')            as HTMLDivElement;
const btnAddRule     = document.getElementById('btn-add-rule')         as HTMLButtonElement;
const cellPickerEl   = document.getElementById('cell-picker')          as HTMLDivElement;

/* ═══════════════════════ App State ══════════════════════ */
let simulator: UnifiedSimulator | null = null;
let currentMode: SimulationMode = 'gol';

// Independent play/pause state for each mode!
let golRunning  = true;
let sandRunning = true;

let targetSpeed     = 60; // steps per second
let stepsPerFrame   = 1;
let accumulatedTime = 0;
let lastFrameTime   = performance.now();

let renderFrameCount     = 0;
let simStepsCount        = 0;
let lastMetricsUpdateTime= performance.now();

// Drawing state
let isDrawing = false;
let lastPointerPos: { u: number; v: number } | null = null;

// GoL brush state
let golBrushMode: 'draw' | 'erase' = 'draw';
let golBrushRadius = 2;

// Sand brush state
let sandTypes: PixelType[] = structuredClone(DEFAULT_TYPES);
let sandRules: Rule[]      = structuredClone(DEFAULT_RULES);
let sandActiveTypeIdx      = 1; // Default to Sand (index 1), NEVER void (index 0)!
let sandBrushRadius        = 4;

function isCurrentModeRunning(): boolean {
  return currentMode === 'gol' ? golRunning : sandRunning;
}

function updatePlayButtonUI() {
  const running = isCurrentModeRunning();
  if (running) {
    btnPlay.classList.add('running');
    playIcon.textContent = '⏸';
    playText.textContent = 'Pozastaviť';
  } else {
    btnPlay.classList.remove('running');
    playIcon.textContent = '▶';
    playText.textContent = 'Spustiť';
  }
}

/* ═══════════════════════ Canvas Dimension Sync ═══════════ */
function updateCanvasDimensions() {
  if (!canvas || !simulator) return;
  const rect = canvas.getBoundingClientRect();
  const size = Math.min(rect.width, rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelSize = Math.max(128, Math.round(size * dpr));

  if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
    canvas.width = pixelSize;
    canvas.height = pixelSize;
    simulator.updateCanvasSize();
    if (!isCurrentModeRunning()) {
      simulator.renderOnly();
    }
  }
}

/* ═══════════════════════ Mode Switching ═════════════════ */
function switchMode(newMode: SimulationMode) {
  if (!simulator || currentMode === newMode) return;
  currentMode = newMode;

  // Update tabs
  modeGolBtn.classList.toggle('active', newMode === 'gol');
  modeSandBtn.classList.toggle('active', newMode === 'sand');
  modeGolBtn.setAttribute('aria-selected', newMode === 'gol' ? 'true' : 'false');
  modeSandBtn.setAttribute('aria-selected', newMode === 'sand' ? 'true' : 'false');

  // Update HUD
  modeVal.textContent = newMode === 'gol' ? 'Game of Life' : 'Piesok (Sand)';

  // Toggle visibility of panels
  if (newMode === 'gol') {
    golSection.classList.remove('hidden');
    substepsRow.classList.remove('hidden');
    sandTypesSec.classList.add('hidden');
    sandBrushSec.classList.add('hidden');
    sandRulesSec.classList.add('hidden');
  } else {
    golSection.classList.add('hidden');
    substepsRow.classList.add('hidden');
    sandTypesSec.classList.remove('hidden');
    sandBrushSec.classList.remove('hidden');
    sandRulesSec.classList.remove('hidden');
  }

  // Switch simulation mode directly on the same GPU device!
  // Both simulations retain their exact buffers and generations!
  simulator.setMode(newMode);
  updatePlayButtonUI();
  updateCellCounter();
  genVal.textContent = simulator.generation.toString();
  accumulatedTime = 0;
  lastFrameTime = performance.now();
}

function updateCellCounter() {
  if (!simulator) return;
  const count = simulator.width * simulator.height;
  cellsVal.textContent = count.toLocaleString('sk-SK');
}

/* ═══════════════════════ Optimized Animation Loop ════════ */
function loop(currentTime: number) {
  requestAnimationFrame(loop);
  if (!simulator) return;

  const delta = Math.min(currentTime - lastFrameTime, 100);
  lastFrameTime = currentTime;
  renderFrameCount++;

  // Throttled metrics update (twice per second):
  // Keeps CPU low by avoiding constant DOM layout thrashing and string allocations!
  const elapsedMetrics = currentTime - lastMetricsUpdateTime;
  if (elapsedMetrics >= 500) {
    const fps = Math.round((renderFrameCount * 1000) / elapsedMetrics);
    const sps = Math.round((simStepsCount * 1000) / elapsedMetrics);
    fpsVal.textContent = fps.toString();
    spsVal.textContent = sps.toString();
    genVal.textContent = simulator.generation.toString();
    renderFrameCount = 0;
    simStepsCount = 0;
    lastMetricsUpdateTime = currentTime;
  }

  // 1. Process queued stroke points once per frame
  if (pendingStrokePoints.length > 0) {
    simulator.paintStrokeBatch(pendingStrokePoints);
    pendingStrokePoints.length = 0;
    if (!isCurrentModeRunning()) {
      simulator.renderOnly();
    }
  }

  const running = isCurrentModeRunning();
  if (running) {
    const stepInterval = 1000 / targetSpeed;
    accumulatedTime += delta;

    // Prevent accumulator death spiral
    if (accumulatedTime > 100) {
      accumulatedTime = 100;
    }

    const stepsToRun = currentMode === 'gol' ? stepsPerFrame : 1;
    let stepsToExecute = 0;
    while (accumulatedTime >= stepInterval) {
      stepsToExecute += stepsToRun;
      accumulatedTime -= stepInterval;
      if (stepsToExecute >= 4) break; // Cap max steps per frame
    }

    if (stepsToExecute > 0) {
      simulator.stepAndRender(stepsToExecute);
      simStepsCount += stepsToExecute;
    }
  }
}

/* ═══════════════════════ Play / Pause ═══════════════════ */
function pauseSimulation() {
  if (currentMode === 'gol') {
    golRunning = false;
  } else {
    sandRunning = false;
  }
  updatePlayButtonUI();
}

function togglePlay() {
  if (currentMode === 'gol') {
    golRunning = !golRunning;
  } else {
    sandRunning = !sandRunning;
  }
  updatePlayButtonUI();
  if (isCurrentModeRunning()) {
    lastFrameTime = performance.now();
    accumulatedTime = 0;
  }
}

/* ═══════════════════════ Drawing System ═════════════════ */
const pendingStrokePoints: Array<{ u: number; v: number; radius: number; value: number }> = [];

function getActiveBrushParams(): { radius: number; value: number } {
  if (currentMode === 'gol') {
    return {
      radius: golBrushRadius,
      value: golBrushMode === 'draw' ? 1 : 0
    };
  } else {
    return {
      radius: sandBrushRadius,
      value: sandActiveTypeIdx
    };
  }
}

function queuePointerPaint(e: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const u = (e.clientX - rect.left) / rect.width;
  const v = (e.clientY - rect.top) / rect.height;

  if (u < 0 || u > 1 || v < 0 || v > 1) {
    lastPointerPos = null;
    return;
  }

  const { radius, value } = getActiveBrushParams();

  if (lastPointerPos) {
    const dist = Math.hypot(u - lastPointerPos.u, v - lastPointerPos.v);
    const maxDim = simulator ? Math.max(simulator.width, simulator.height) : 256;
    const steps = Math.max(1, Math.min(60, Math.ceil(dist * maxDim)));
    for (let i = 1; i <= steps; i++) {
      const interpU = lastPointerPos.u + (u - lastPointerPos.u) * (i / steps);
      const interpV = lastPointerPos.v + (v - lastPointerPos.v) * (i / steps);
      pendingStrokePoints.push({ u: interpU, v: interpV, radius, value });
    }
  } else {
    pendingStrokePoints.push({ u, v, radius, value });
  }

  lastPointerPos = { u, v };
}

/* ═══════════════════════ Sand Mode: Types UI ════════════ */
function renderSandTypeList() {
  typeListEl.innerHTML = '';
  sandTypes.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'type-entry';

    const idx = document.createElement('span');
    idx.className = 'type-idx';
    idx.textContent = `${i}`;

    const swatch = document.createElement('div');
    swatch.className = 'type-swatch';
    swatch.style.background = rgbStr(t.color);
    swatch.title = 'Zmeniť farbu';

    const colorInp = document.createElement('input');
    colorInp.type = 'color';
    colorInp.value = rgbHex(t.color);
    colorInp.addEventListener('input', () => {
      t.color = hexRgb(colorInp.value);
      swatch.style.background = rgbStr(t.color);
      simulator?.uploadSandTypeColors();
      renderSandBrushPalette();
      renderSandRuleList();
      if (!isCurrentModeRunning()) simulator?.renderOnly();
    });
    swatch.addEventListener('click', () => colorInp.click());

    const name = document.createElement('input');
    name.className = 'type-name';
    name.value = t.name;
    name.addEventListener('change', () => {
      t.name = name.value.trim() || `typ${i}`;
      renderSandBrushPalette();
      renderSandRuleList();
    });

    const del = document.createElement('button');
    del.className = 'type-del';
    del.textContent = '×';
    del.title = 'Odstrániť typ';
    if (i === 0) del.style.visibility = 'hidden'; // void cannot be deleted
    del.addEventListener('click', () => removeSandType(i));

    row.append(idx, swatch, colorInp, name, del);
    typeListEl.appendChild(row);
  });
}

function addSandType() {
  if (sandTypes.length >= MAX_TYPES) return;
  const hue = (sandTypes.length * 53) % 360;
  const [r, g, b] = hslToRgb(hue, 75, 55);
  sandTypes.push({ name: `materiál${sandTypes.length}`, color: [r, g, b] });
  onSandTypesChanged();
}

function removeSandType(idx: number) {
  if (idx <= 0 || idx >= sandTypes.length) return;
  sandTypes.splice(idx, 1);
  const removedBit = 1 << idx;
  for (const rule of sandRules) {
    for (let p = 0; p < 9; p++) {
      rule.input[p]  = shiftMask(rule.input[p],  idx, removedBit);
      rule.output[p] = shiftMask(rule.output[p], idx, removedBit);
    }
  }
  if (sandActiveTypeIdx >= sandTypes.length) {
    sandActiveTypeIdx = 1;
  }
  onSandTypesChanged();
}

function shiftMask(mask: number, idx: number, removedBit: number): number {
  if (mask === ANY) return ANY;
  mask = mask & ~removedBit;
  const lo = mask & ((1 << idx) - 1);
  const hi = (mask >>> (idx + 1)) << idx;
  return (lo | hi) || 0;
}

function onSandTypesChanged() {
  simulator?.uploadSandTypeColors();
  simulator?.uploadSandRules();
  renderSandTypeList();
  renderSandBrushPalette();
  renderSandRuleList();
  if (!isCurrentModeRunning()) simulator?.renderOnly();
}

/* ═══════════════════════ Sand Mode: Brush Palette ═══════ */
function renderSandBrushPalette() {
  brushPaletteEl.innerHTML = '';
  sandTypes.forEach((t, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'brush-swatch-wrapper';

    const sw = document.createElement('div');
    sw.className = 'brush-swatch' + (i === sandActiveTypeIdx ? ' active' : '');
    sw.style.background = rgbStr(t.color);
    sw.title = `${t.name} (index ${i})`;
    sw.addEventListener('click', () => {
      sandActiveTypeIdx = i;
      renderSandBrushPalette();
    });

    const lbl = document.createElement('span');
    lbl.className = 'brush-swatch-label';
    lbl.textContent = i === 0 ? 'guma' : t.name;

    wrapper.append(sw, lbl);
    brushPaletteEl.appendChild(wrapper);
  });
}

/* ═══════════════════════ Sand Mode: Rules UI ════════════ */
function renderSandRuleList() {
  ruleListEl.innerHTML = '';
  sandRules.forEach((rule, ri) => {
    const card = document.createElement('div');
    card.className = 'rule-card';

    const hdr = document.createElement('div');
    hdr.className = 'rule-header';
    const nameInp = document.createElement('input');
    nameInp.className = 'rule-name';
    nameInp.value = rule.name;
    nameInp.addEventListener('change', () => { rule.name = nameInp.value; });
    const del = document.createElement('button');
    del.className = 'rule-del';
    del.textContent = '×';
    del.title = 'Odstrániť pravidlo';
    del.addEventListener('click', () => {
      sandRules.splice(ri, 1);
      onSandRulesChanged();
    });
    hdr.append(nameInp, del);

    const body = document.createElement('div');
    body.className = 'rule-body';
    body.appendChild(makeRuleGrid(rule.input, 'input'));
    const arrow = document.createElement('span');
    arrow.className = 'rule-arrow';
    arrow.textContent = '→';
    body.appendChild(arrow);
    body.appendChild(makeRuleGrid(rule.output, 'output'));

    card.append(hdr, body);
    ruleListEl.appendChild(card);
  });
}

function makeRuleGrid(cells: number[], side: 'input' | 'output'): HTMLDivElement {
  const grid = document.createElement('div');
  grid.className = 'rule-grid';
  for (let p = 0; p < 9; p++) {
    const cell = document.createElement('div');
    cell.className = 'rule-cell';
    styleCellFromMask(cell, cells[p]);
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      openCellPicker(cell, cells, p, side);
    });
    grid.appendChild(cell);
  }
  return grid;
}

function styleCellFromMask(el: HTMLElement, mask: number) {
  el.classList.remove('any-cell', 'multi-cell');
  el.style.background = '';
  el.textContent = '';

  if (mask === ANY) {
    el.classList.add('any-cell');
    el.textContent = '✱';
    return;
  }

  const setBits: number[] = [];
  for (let i = 0; i < sandTypes.length; i++) {
    if (mask & (1 << i)) setBits.push(i);
  }

  if (setBits.length === 0) {
    el.classList.add('any-cell');
    el.textContent = '∅';
  } else if (setBits.length === 1) {
    el.style.background = rgbStr(sandTypes[setBits[0]].color);
  } else {
    el.style.background = rgbStr(sandTypes[setBits[0]].color);
    el.classList.add('multi-cell');
    el.textContent = `${setBits.length}`;
  }
}

/* ═══════════════════════ Cell Picker Popup ══════════════ */
let pickerTarget: { cells: number[]; pos: number; side: 'input' | 'output' } | null = null;

function openCellPicker(anchor: HTMLElement, cells: number[], pos: number, side: 'input' | 'output') {
  pickerTarget = { cells, pos, side };
  const mask = cells[pos];

  cellPickerEl.innerHTML = '';

  // 'Any' toggle option
  const anyItem = mkPickerItem('✱', 'any (čokoľvek)', mask === ANY, () => {
    cells[pos] = cells[pos] === ANY ? 0 : ANY;
    onSandRulesChanged();
    openCellPicker(anchor, cells, pos, side);
  });
  cellPickerEl.appendChild(anyItem);

  const div = document.createElement('div');
  div.className = 'picker-divider';
  cellPickerEl.appendChild(div);

  // Per-type toggle options
  sandTypes.forEach((t, i) => {
    const selected = mask !== ANY && (mask & (1 << i)) !== 0;
    const item = mkPickerItem(rgbStr(t.color), `${t.name} (${i})`, selected, () => {
      if (cells[pos] === ANY) cells[pos] = 0;
      cells[pos] ^= (1 << i);
      onSandRulesChanged();
      openCellPicker(anchor, cells, pos, side);
    }, true);
    cellPickerEl.appendChild(item);
  });

  const rect = anchor.getBoundingClientRect();
  cellPickerEl.style.left = `${rect.right + 6}px`;
  cellPickerEl.style.top  = `${rect.top}px`;
  cellPickerEl.classList.remove('hidden');

  requestAnimationFrame(() => {
    const pr = cellPickerEl.getBoundingClientRect();
    if (pr.right > window.innerWidth) cellPickerEl.style.left = `${rect.left - pr.width - 6}px`;
    if (pr.bottom > window.innerHeight) cellPickerEl.style.top = `${window.innerHeight - pr.height - 8}px`;
  });
}

function mkPickerItem(colorOrSym: string, label: string, selected: boolean, onClick: () => void, isSwatch = false): HTMLDivElement {
  const item = document.createElement('div');
  item.className = 'picker-item' + (selected ? ' selected' : '');

  const check = document.createElement('span');
  check.className = 'picker-check';
  check.textContent = selected ? '✓' : '';

  if (isSwatch) {
    const sw = document.createElement('div');
    sw.className = 'picker-swatch';
    sw.style.background = colorOrSym;
    item.append(check, sw);
  } else {
    const sym = document.createElement('span');
    sym.className = 'picker-swatch';
    sym.textContent = colorOrSym;
    sym.style.textAlign = 'center';
    sym.style.lineHeight = '16px';
    sym.style.fontSize = '0.7rem';
    sym.style.border = 'none';
    item.append(check, sym);
  }

  const lbl = document.createElement('span');
  lbl.className = 'picker-label';
  lbl.textContent = label;
  item.appendChild(lbl);
  item.addEventListener('click', onClick);
  return item;
}

function closePicker() {
  cellPickerEl.classList.add('hidden');
  pickerTarget = null;
}

document.addEventListener('click', (e) => {
  if (pickerTarget && !cellPickerEl.contains(e.target as Node)) {
    closePicker();
  }
});

function addSandRule() {
  sandRules.push({
    name: `Pravidlo ${sandRules.length + 1}`,
    input:  [ANY, ANY, ANY, ANY, ANY, ANY, ANY, ANY, ANY],
    output: [ANY, ANY, ANY, ANY, ANY, ANY, ANY, ANY, ANY],
  });
  onSandRulesChanged();
}

function onSandRulesChanged() {
  simulator?.uploadSandRules();
  renderSandRuleList();
}

/* ═══════════════════════ Setup Events ═══════════════════ */
function setupEventListeners() {
  modeGolBtn.addEventListener('click', () => switchMode('gol'));
  modeSandBtn.addEventListener('click', () => switchMode('sand'));

  btnPlay.addEventListener('click', togglePlay);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
      e.preventDefault();
      togglePlay();
    }
  });

  btnStep.addEventListener('click', () => {
    if (!simulator) return;
    simulator.stepAndRender(1);
    simStepsCount++;
    genVal.textContent = simulator.generation.toString();
  });

  btnRandom.addEventListener('click', () => {
    if (!simulator) return;
    if (currentMode === 'gol') {
      simulator.randomizeGoL(0.25);
    } else {
      simulator.randomizeSand(0.2);
    }
    genVal.textContent = '0';
    simulator.renderOnly();
  });

  btnClear.addEventListener('click', () => {
    if (!simulator) return;
    simulator.clear();
    genVal.textContent = '0';
    simulator.renderOnly();
  });

  resolutionSelect.addEventListener('change', () => {
    const res = parseInt(resolutionSelect.value, 10);
    if (simulator) {
      simulator.setGridResolution(res, res);
      updateCellCounter();
      genVal.textContent = '0';
      if (!isCurrentModeRunning()) simulator.renderOnly();
    }
  });

  speedSlider.addEventListener('input', () => {
    targetSpeed = parseInt(speedSlider.value, 10);
    speedVal.textContent = targetSpeed.toString();
  });

  stepsSlider.addEventListener('input', () => {
    stepsPerFrame = parseInt(stepsSlider.value, 10);
    stepsVal.textContent = `${stepsPerFrame}×`;
  });

  gridToggle.addEventListener('change', () => {
    if (!simulator) return;
    simulator.setShowGrid(gridToggle.checked);
    if (!isCurrentModeRunning()) simulator.renderOnly();
  });

  // GoL brush
  golBrushDraw.addEventListener('click', () => {
    golBrushMode = 'draw';
    golBrushDraw.classList.add('active');
    golBrushErase.classList.remove('active');
  });

  golBrushErase.addEventListener('click', () => {
    golBrushMode = 'erase';
    golBrushErase.classList.add('active');
    golBrushDraw.classList.remove('active');
  });

  golBrushSlider.addEventListener('input', () => {
    golBrushRadius = parseInt(golBrushSlider.value, 10);
    golBrushVal.textContent = `${golBrushRadius} px`;
  });

  // Sand brush & rules
  sandBrushSlider.addEventListener('input', () => {
    sandBrushRadius = parseInt(sandBrushSlider.value, 10);
    sandBrushVal.textContent = `${sandBrushRadius} px`;
  });

  btnAddType.addEventListener('click', addSandType);
  btnAddRule.addEventListener('click', addSandRule);

  // Pointer / Drawing events
  canvas.addEventListener('pointerdown', (e) => {
    isDrawing = true;
    pauseSimulation();
    lastPointerPos = null;
    queuePointerPaint(e);
  });

  window.addEventListener('pointermove', (e) => {
    if (isDrawing) {
      queuePointerPaint(e);
    }
  });

  window.addEventListener('pointerup', () => {
    isDrawing = false;
    lastPointerPos = null;
  });

  window.addEventListener('pointercancel', () => {
    isDrawing = false;
    lastPointerPos = null;
  });
}

/* ═══════════════════════ Helper Functions ═══════════════ */
function rgbStr(c: [number, number, number]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function rgbHex(c: [number, number, number]): string {
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/* ═══════════════════════ Application Boot ═══════════════ */
async function startApp() {
  if (!UnifiedSimulator.isSupported()) {
    banner.classList.remove('hidden');
    gpuVal.textContent = "WebGPU nedostupné";
    return;
  }

  const res = parseInt(resolutionSelect.value, 10);
  const showGrid = gridToggle ? gridToggle.checked : true;

  simulator = new UnifiedSimulator({ canvas, width: res, height: res, showGrid });

  try {
    await simulator.init(sandTypes, sandRules);
  } catch (err: any) {
    banner.classList.remove('hidden');
    const p = banner.querySelector('p');
    if (p) p.textContent = `Chyba pri štarte WebGPU: ${err.message}`;
    return;
  }

  updateCanvasDimensions();
  window.addEventListener('resize', updateCanvasDimensions);

  const gpuName = await simulator.getAdapterDescription();
  gpuVal.textContent = gpuName || "WebGPU GPU";

  renderSandTypeList();
  renderSandBrushPalette();
  renderSandRuleList();

  setupEventListeners();
  updatePlayButtonUI();
  updateCellCounter();

  lastFrameTime = performance.now();
  requestAnimationFrame(loop);
}

window.addEventListener('DOMContentLoaded', startApp);
