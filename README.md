# WebGPU Cellular Automata Sandbox

Paralelné celulárne automaty počítané priamo na GPU pomocou **WebGPU** a compute shaderov v **WGSL**.

## 🚀 Funkcie

- **Game of Life:** Klasický Conwayov celulárny automat s toroidnou mriežkou a vekovým farbením buniek.
- **Piesok (Sand Automata):** Simulácia sypkého piesku a pevných prekážok s podporou vlastných 3×3 maticových pravidiel a dynamickej farebnej palety.
- **GPU akcelerácia:** Paralelný výpočet v compute passoch s vysokou snímkovou frekvenciou (až do 240 krokov/s).
- **Interaktívne kreslenie:** Kreslenie štetcom priamo na mriežku s plynulým dávkovaním zápisov do pamäte GPU.

## 💻 Spustenie projektu

### Požiadavky
- **Node.js** (18+)
- **Prehliadač s podporou WebGPU** (Chrome 113+, Edge 113+, Safari 18+)

```bash
# Inštalácia závislostí
npm install

# Spustenie vývojového servera (http://localhost:5173/)
npm run dev

# Zostavenie produkčného balíčka
npm run build
```

## 📁 Štruktúra

```
├── index.html                  # UI rozhranie, canvas a ovládací panel
├── src/
│   ├── main.ts                 # Obsluha UI, kreslenia a animačná slučka
│   ├── style.css               # Štýly rozhrania
│   ├── shaders/
│   │   ├── gol_compute.wgsl    # Compute shader pre Game of Life
│   │   ├── gol_render.wgsl     # Render shader pre Game of Life
│   │   ├── sand_compute.wgsl   # Compute shader pre 3×3 maticové pravidlá
│   │   └── sand_render.wgsl    # Render shader s paletovou textúrou
│   └── webgpu/
│       ├── defaults.ts         # Predvolené typy (piesok, stena) a pravidlá
│       └── unified_simulator.ts# Jednotný GPU manažér pre oba módy
```

## 🔗 Repozitár

[https://github.com/Koscelnik/WebGPU_demo.git](https://github.com/Koscelnik/WebGPU_demo.git)
