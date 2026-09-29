# WebGPU Compute Demo: Conway's Game of Life & Architektonická analýza

Tento projekt predstavuje modernú implementáciu celulárneho automatu (**Conway's Game of Life**) počítaného plne paralelne priamo na grafickej karte prostredníctvom nového webového štandardu **WebGPU** a jazyka **WGSL (WebGPU Shading Language)**. Súčasťou projektu je aj detailná teoretická a architektonická analýza porovnávajúca WebGPU s jeho predchodcom WebGL.

---

## 🚀 Živé demo & Funkcionalita

- **100% GPU Compute:** Každá bunka mriežky je simulovaná ako samostatné paralelné GPU vlákno v Compute Shaderi.
- **Škálovateľnosť až do 4.2 milióna buniek:** Možnosť prepínania rozlíšenia od $128 \times 128$ (16k) až po $2048 \times 2048$ (4,194,304 buniek) pri 60+ FPS.
- **Dvojitý Storage Buffer (Ping-Ponging):** Bezpečný paralelný zápis a čítanie stavu bez dátových kolízií (data races).
- **Interaktívne kreslenie myšou:** Priame kreslenie živých buniek alebo gumovanie v reálnom čase s nastaviteľnou veľkosťou štetca.
- **Presety a vzory:**
  - *Gosper Glider Gun* (prvý objavený generátor klzákov)
  - *Pulsar* (symetrický oscilátor s periódou 3)
  - *Pentadecathlon* (veľký oscilátor s periódou 15)
  - *Acorn* (methuselah vzor žijúci vyše 5200 generácií)
  - *Ľahká vesmírna loď (LWSS)*
  - *Náhodné rozloženia (25%, 50%)*
- **Vizuálne farebné palety & Stopovanie veku:** Bunky v shaderi zaznamenávajú svoj vek, čo umožňuje dynamické farebné prechody (Cyberpunk Cyan, Solar Sunset, Electric Violet, Matrix Green).
- **Nastaviteľné parametre simulácie:** Počet výpočtov za snímku (Substeps 1× – 20×), regulácia FPS, mriežka pre detailné zobrazenie.
- **Vstavaný teoretický panel:** Interaktívny prehľad teórie priamo v používateľskom rozhraní.

---

## 📚 Teoretická časť: Analýza WebGPU a porovnanie s WebGL

WebGPU je moderné nízkoúrovňové programovacie rozhranie (API) pre web vyvíjané konzorciom **W3C** v spolupráci so spoločnosťami Apple, Google, Mozilla a Microsoft. Na rozdiel od WebGL (ktoré bolo odvodené od mobilného OpenGL ES 2.0 / 3.0 z roku 2007) WebGPU od základov reflektuje modernú hardvérovú architektúru GPU a priamo mapuje natívne nízkoúrovňové rozhrania:
- **Vulkan** (Linux, Android, Windows)
- **Metal** (macOS, iOS)
- **DirectX 12** (Windows)

### 1. Explicitné pamäťové buffery (Explicit Memory Buffers)
Vo WebGL spravoval alokáciu a pohyb pamäte ovládač grafickej karty pomocou nepriamych hintov (`gl.STATIC_DRAW`, `gl.DYNAMIC_DRAW`). Programátor nemal kontrolu nad tým, kde sa pamäť nachádza a kedy dochádza k synchronizácii.

Vo WebGPU je správa pamäte **prísne explicitná**:
- Pri vytváraní každého `GPUBuffer` je nutné presne definovať jeho príznaky použitia (`usage`):
  ```typescript
  const cellBuffer = device.createBuffer({
    size: totalCells * Uint32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  ```
- **Storage Buffers (`GPUBufferUsage.STORAGE`):** Umožňujú čítanie aj zápis štruktúrovaných polí priamo v shaderoch.
- **Uniform Buffers (`GPUBufferUsage.UNIFORM`):** Rýchla pamäť s prísnym 16-bajtovým zarovnaním pre globálne konštanty.
- **CPU-GPU prenosy:** Zápis z CPU prebieha riadene cez `device.queue.writeBuffer()` alebo mapovacie fázy (`mapAsync`), čím sa eliminuje nepredvídateľné blokovanie hlavného vlákna prehliadača.

### 2. Pipeline State Objects (PSO)
WebGL funguje ako **globálny mutovateľný stavový automat (State Machine)**. Pred každým vykreslením sa stav GPU menil sériou volaní:
```javascript
// WebGL (pomalé, ovládač musí validovať celkový stav pri každom draw calli):
gl.useProgram(program);
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.enable(gl.BLEND);
gl.drawArrays(gl.TRIANGLES, 0, count);
```
Tento prístup spôsoboval obrovskú réžiu na strane CPU (driver overhead) a nepredvídateľné záseky snímok (stuttering).

WebGPU nahrádza tento model nemennými objektmi **Pipeline State Objects (PSO)**:
```typescript
// WebGPU: Kompletný stav vrátane shaderov, layoutov a blendovania sa zostaví vopred:
const renderPipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex: { module: shaderModule, entryPoint: 'vs_main' },
  fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format }] },
  primitive: { topology: 'triangle-list' }
});
```
Ovládač grafickej karty skompiluje a optimalizuje celú pipeline vopred priamo do strojového kódu GPU. Počas samotného renderovacieho cyklu stačí zavolať `pass.setPipeline(pipeline)`, čo má takmer nulovú réžiu na CPU.

### 3. Synchronizácia a Command Encodery
Vo WebGL sa príkazy odosielali grafickej karte okamžite (Immediate Mode Execution). WebGPU využíva model **záznamu príkazov a ich dávkového odoslania (Command Recording & Batch Submission)**:
1. **`GPUCommandEncoder`:** Slúži ako odľahčený záznamník grafických a výpočtových operácií do vyrovnávacej pamäte na CPU.
2. **Pass Encodery:** Príkazy sa štruktúrujú do logických priechodov:
   - `beginComputePass()` – výpočet novej generácie automatu.
   - `beginRenderPass()` – vykreslenie stavu na obrazovku.
3. **Synchronizačné bariéry a Hazard Tracking:** WebGPU automaticky monitoruje dátové závislosti medzi priechodmi v rámci jedného `commandBuffer`.
4. **Dávkové odoslanie cez frontu (`GPUQueue`):**
   ```typescript
   const commandBuffer = encoder.finish();
   device.queue.submit([commandBuffer]);
   ```
Tento model umožňuje nahrávať príkazy paralelne vo viacerých Web Workeroch bez blokovania GPU.

### 4. Priama podpora Compute Shaderov v prehliadači
V ére WebGL 1.0 a 2.0 **Compute Shadery vôbec neexistovali**. Ak chcel vývojár vykonať všeobecné výpočty na GPU (GPGPU), musel použiť obchádzku:
- Dáta zakódovať do farieb RGBA pixelov off-screen textúry.
- Vykresliť 2D obdĺžnik cez celú obrazovku pomocou dvoch trojuholníkov.
- Výpočet vykonať vo Fragment Shaderi a výsledok zapísať do Framebufferu.

WebGPU prináša natívne **Compute Shadery** v jazyku **WGSL**:
- Podpora pre ľubovoľné lineárne pamäťové buffery.
- Organizácia vlákien do pracovných skupín (**Workgroups**) prostredníctvom `@workgroup_size(X, Y, Z)`. V našom deme spracováva každá pracovná skupina blok $16 \times 16 = 256$ buniek.
- Prístup k zdieľanej pamäti skupiny (`var<workgroup>`), atomickým operáciám a bitovým posunom.

---

## 📊 Porovnávacia tabuľka: WebGPU vs. WebGL 2.0

| Parameter | WebGL 2.0 (OpenGL ES 3.0) | WebGPU (Modern Graphics Standard) |
| :--- | :--- | :--- |
| **Podkladové natívne API** | OpenGL / OpenGL ES | DirectX 12, Vulkan, Metal |
| **GPGPU Compute Shadery** | ❌ Nie (nutné simulovať cez fragment shader) | ✅ Plná natívna podpora (`@compute`) |
| **Správa stavu** | Globálny mutovateľný stavový automat | Nemenné objekty `GPUPipeline` (PSO) |
| **Správa pamäte** | Implicitná, riadená ovládačom | Explicitná cez `GPUBuffer` a usage flags |
| **Jazyk shaderov** | GLSL ES | WGSL (WebGPU Shading Language) |
| **Práca s príkazmi** | Immediate execution (okamžité odosielanie) | Command Recording & Batch Submission |
| **Viacvláknovosť** | Iba jedno hlavné vlákno | Záznam príkazov v paralelných Web Workeroch |
| **CPU Overhead ovládača** | Vysoký (validácia stavu pri každom calle) | Minimálny (predkompilácia pred behom) |

---

## 🛠️ Praktická časť: Implementácia v tomto projekte

### Architektúra Conway's Game of Life na WebGPU

1. **Storage Buffery:**
   - `cellBufferA` a `cellBufferB` (Ping-Pong).
   - V generácii $N$ Compute shader číta stav z `Buffer A` a zapisuje novú generáciu do `Buffer B`.
   - V generácii $N+1$ sa poradie vymení (`Buffer B` číta, `Buffer A` zapisuje).
2. **Compute Shader (`src/shaders/compute.wgsl`):**
   - Využíva `@workgroup_size(16, 16)`.
   - Toroidálne okrajové podmienky (svet sa zavinie do prstenca na hranách).
   - Implementácia pravidiel B3/S23:
     - Živá bunka s 2 alebo 3 živými susedmi prežíva (a zvyšuje sa jej vek pre farebné efekty).
     - Mŕtva bunka s presne 3 živými susedmi ožíva.
     - Všetky ostatné bunky umierajú na podľudnenie alebo preľudnenie.
3. **Render Shader (`src/shaders/render.wgsl`):**
   - Vykresľovanie pomocou jediného **Fullscreen trojuholníka** (`vertex_index: u32`), čím odpadá akákoľvek réžia na vertex buffery alebo index buffery.
   - Fragment shader priamo číta `var<storage, read> cellState` a mapuje vek bunky na zvolenú farebnú paletu v reálnom čase.

---

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
├── index.html              # Hlavná HTML štruktúra, HUD a teoretický modál
├── package.json            # Závislosti projektu (Vite, TypeScript, WebGPU types)
├── tsconfig.json           # Konfigurácia TypeScriptu
├── README.md               # Dokumentácia a teoretický rozbor
└── src/
    ├── main.ts             # Vstupný bod aplikácie, obsluha udalostí a render slučka
    ├── style.css           # Glassmorphic dizajn a štýly používateľského rozhrania
    ├── vite-env.d.ts       # Typové deklarácie pre WGSL a Vite
    ├── shaders/
    │   ├── compute.wgsl    # WebGPU Compute shader pre Game of Life (B3/S23)
    │   └── render.wgsl     # WebGPU Render shader s fullscreen trojuholníkom
    └── webgpu/
        ├── presets.ts      # Vstavané vzory (Gosper Gun, Pulsar, Acorn, atď.)
        └── simulator.ts    # Jadro simulátora (správa bufferov, PSOs a pipelines)
```

---

## 👤 Autor a Git repozitár

- **Git Repozitár:** [https://github.com/Koscelnik/WebGPU_demo.git](https://github.com/Koscelnik/WebGPU_demo.git)
- Vypracované pre tému: **WebGPU – Analýza moderného rozhrania a implementácia bunkového automatu**
