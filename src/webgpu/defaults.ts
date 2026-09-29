export interface PixelType {
  name: string;
  color: [number, number, number]; // RGB 0-255
}

export interface Rule {
  name: string;
  input:  number[];  // 9 u32 bitmasks (row-major TL..BR)
  output: number[];  // 9 u32 bitmasks (0xFFFFFFFF = any -> keep)
}

export const ANY = 0xFFFFFFFF;
export const MAX_TYPES = 32;
export const MAX_RULES = 128;

export function bit(index: number): number {
  return 1 << index;
}

export function bits(...indices: number[]): number {
  return indices.reduce((m, i) => m | (1 << i), 0);
}

export function notBits(...indices: number[]): number {
  let m = ANY;
  for (const i of indices) m &= ~(1 << i);
  return m;
}

export const DEFAULT_TYPES: PixelType[] = [
  { name: 'void',  color: [7,   9,   14]  },  // 0 - black void (#07090e)
  { name: 'sand',  color: [240, 196, 76]  },  // 1 - warm yellow sand (#f0c44c)
  { name: 'wall',  color: [140, 150, 165] },  // 2 - solid gray wall (#8c96a5)
];

const V  = bit(0);     // void
const S  = bit(1);     // sand
const NV = notBits(0); // non-void (solid / anything)

export const DEFAULT_RULES: Rule[] = [
  // --- Sand Rules ---
  {
    name: 'Piesok padá ↓',
    input:  [ANY,ANY,ANY,  ANY,S,ANY,  ANY,V,ANY],
    output: [ANY,ANY,ANY,  ANY,V,ANY,  ANY,S,ANY],
  },
  {
    name: 'Piesok kĺže ↙',
    input:  [ANY,ANY,ANY,  ANY,S,ANY,  V,NV,ANY],
    output: [ANY,ANY,ANY,  ANY,V,ANY,  S,ANY,ANY],
  },
  {
    name: 'Piesok kĺže ↘',
    input:  [ANY,ANY,ANY,  ANY,S,ANY,  ANY,NV,V],
    output: [ANY,ANY,ANY,  ANY,V,ANY,  ANY,ANY,S],
  },
];

/**
 * Creates default scene: only sand and wall!
 */
export function createDefaultScene(width: number, height: number): Uint32Array {
  const grid = new Uint32Array(width * height);

  // Sand reservoir at the top center
  const sandW = Math.floor(width * 0.45);
  const sandH = Math.floor(height * 0.16);
  const sandX0 = Math.floor((width - sandW) / 2);
  const sandY0 = Math.floor(height * 0.05);

  for (let y = sandY0; y < sandY0 + sandH; y++) {
    for (let x = sandX0; x < sandX0 + sandW; x++) {
      if (Math.random() < 0.88) {
        grid[y * width + x] = 1; // Sand
      }
    }
  }

  // Upper funnel/platform (wall) sloping down-right
  const platY1 = Math.floor(height * 0.35);
  const platLen1 = Math.floor(width * 0.38);
  for (let i = 0; i < platLen1; i++) {
    const x = Math.floor(width * 0.12) + i;
    const y = platY1 + Math.floor(i * 0.42);
    if (x < width && y < height) {
      grid[y * width + x] = 2; // Wall
      if (y + 1 < height) grid[(y + 1) * width + x] = 2;
    }
  }

  // Lower funnel/platform (wall) sloping down-left
  const platY2 = Math.floor(height * 0.58);
  for (let i = 0; i < platLen1; i++) {
    const x = Math.floor(width * 0.88) - i;
    const y = platY2 + Math.floor(i * 0.38);
    if (x >= 0 && x < width && y < height) {
      grid[y * width + x] = 2; // Wall
      if (y + 1 < height) grid[(y + 1) * width + x] = 2;
    }
  }

  // Bottom catch platform
  const platY3 = Math.floor(height * 0.85);
  const platLen3 = Math.floor(width * 0.5);
  const platX3 = Math.floor((width - platLen3) / 2);
  for (let i = 0; i < platLen3; i++) {
    const x = platX3 + i;
    if (x < width && platY3 < height) {
      grid[platY3 * width + x] = 2; // Wall
      if (platY3 + 1 < height) grid[(platY3 + 1) * width + x] = 2;
    }
  }

  return grid;
}
