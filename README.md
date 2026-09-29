# WebGPU Compute Demo: Cellular Automata

Tento projekt predstavuje modernú implementáciu celulárneho automatu počítaného plne paralelne priamo na grafickej karte prostredníctvom nového webového štandardu **WebGPU** a jazyka **WGSL (WebGPU Shading Language)**.

## 💻 Lokálne spustenie a inštalácia

### Požiadavky
- **Node.js** (verzia 18 alebo novšia)
- **Prehliadač s podporou WebGPU**:
  - Google Chrome 113+ alebo Microsoft Edge 113+
  - Safari 18+ (macOS Sonoma / iOS 18)
  - Firefox Nightly (s povoleným príznakom `dom.webgpu.enabled` v `about:config`)

### Inštalácia závislostí
```bash
npm install
```

### Spustenie vývojového servera
```bash
npm run dev
```
Aplikácia sa spustí na adrese `http://localhost:5173/`.

### Zostavenie produkčného balíčka (Build)
```bash
npm run build
```
Vytvorí optimalizované produkčné súbory v priečinku `dist/`.

---

## 📁 Štruktúra projektu

```
├── index.html              # HTML rozhranie s plátnom a ovládacím panelom
├── package.json            # Závislosti projektu (Vite, TypeScript, WebGPU types)
├── tsconfig.json           # Konfigurácia TypeScriptu
├── README.md               # Dokumentácia projektu
└── src/
    ├── main.ts             # Vstupný bod aplikácie, obsluha udalostí a render slučka
    ├── style.css           # Štýly používateľského rozhrania
    ├── vite-env.d.ts       # Typové deklarácie pre WGSL a Vite
    ├── shaders/
    │   ├── compute.wgsl    # WebGPU Compute shader pre Game of Life (B3/S23)
    │   └── render.wgsl     # WebGPU Render shader s fullscreen trojuholníkom
    └── webgpu/
        └── simulator.ts    # Jadro simulátora (správa bufferov, PSOs a pipelines)
```

---

## 👤 Autor a Git repozitár

- **Git Repozitár:** [https://github.com/Koscelnik/WebGPU_demo.git](https://github.com/Koscelnik/WebGPU_demo.git)
- Vypracované pre tému: **WebGPU – Analýza moderného rozhrania a implementácia bunkového automatu**
