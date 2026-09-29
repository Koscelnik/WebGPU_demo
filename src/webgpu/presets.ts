export interface Preset {
  name: string;
  description: string;
  width: number;
  height: number;
  pattern: number[][]; // [row, col] relative offsets from center
}

export const PRESETS: Record<string, Preset> = {
  gosperGun: {
    name: "Gosper Glider Gun",
    description: "Prvý známy oscilátor produkujúci nekonečné množstvo klzákov (gliders).",
    width: 36,
    height: 9,
    pattern: [
      [4, 0], [4, 1], [5, 0], [5, 1], // Left square
      [2, 12], [2, 13], [3, 11], [4, 10], [5, 10], [6, 10], [7, 11], [8, 12], [8, 13],
      [5, 14], [3, 15], [7, 15], [4, 16], [5, 16], [6, 16], [5, 17],
      [2, 20], [3, 20], [4, 20], [2, 21], [3, 21], [4, 21], [1, 22], [5, 22],
      [0, 24], [1, 24], [5, 24], [6, 24],
      [2, 34], [3, 34], [2, 35], [3, 35] // Right square
    ]
  },
  pulsar: {
    name: "Pulsar",
    description: "Periodický oscilátor periódy 3 s vysokým stupňom symetrie.",
    width: 13,
    height: 13,
    pattern: [
      // Row offsets around center (6, 6)
      [1, 3], [1, 4], [1, 5], [1, 9], [1, 10], [1, 11],
      [3, 1], [3, 6], [3, 8], [3, 13],
      [4, 1], [4, 6], [4, 8], [4, 13],
      [5, 1], [5, 6], [5, 8], [5, 13],
      [6, 3], [6, 4], [6, 5], [6, 9], [6, 10], [6, 11],
      [8, 3], [8, 4], [8, 5], [8, 9], [8, 10], [8, 11],
      [9, 1], [9, 6], [9, 8], [9, 13],
      [10, 1], [10, 6], [10, 8], [10, 13],
      [11, 1], [11, 6], [11, 8], [11, 13],
      [13, 3], [13, 4], [13, 5], [13, 9], [13, 10], [13, 11]
    ]
  },
  pentadecathlon: {
    name: "Pentadecathlon",
    description: "Veľký oscilátor s periódou 15.",
    width: 10,
    height: 3,
    pattern: [
      [1, 0], [1, 1], [0, 2], [2, 2], [1, 3], [1, 4], [1, 5], [1, 6], [0, 7], [2, 7], [1, 8], [1, 9]
    ]
  },
  acorn: {
    name: "Acorn (Žaluď)",
    description: "Malý vzor (7 buniek), ktorý evolvuje vyše 5200 generácií a vygeneruje 13 klzákov.",
    width: 7,
    height: 3,
    pattern: [
      [0, 1], [1, 3], [2, 0], [2, 1], [2, 4], [2, 5], [2, 6]
    ]
  },
  lwss: {
    name: "Ľahká vesmírna loď (LWSS)",
    description: "Vesmírna loď (Spaceship) pohybujúca sa ortogonálne rýchlosťou c/2.",
    width: 5,
    height: 4,
    pattern: [
      [0, 1], [0, 4], [1, 0], [2, 0], [2, 4], [3, 0], [3, 1], [3, 2], [3, 3]
    ]
  }
};
