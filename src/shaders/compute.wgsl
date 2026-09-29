struct SimulationParams {
  width: u32,
  height: u32,
};

@group(0) @binding(0) var<uniform> params: SimulationParams;
@group(0) @binding(1) var<storage, read> inputState: array<u32>;
@group(0) @binding(2) var<storage, read_write> outputState: array<u32>;

fn getCellIndex(x: u32, y: u32) -> u32 {
  return y * params.width + x;
}

fn getCell(x: i32, y: i32) -> u32 {
  let w = i32(params.width);
  let h = i32(params.height);
  // Toroidal wrap-around boundaries
  let wrappedX = u32((x % w + w) % w);
  let wrappedY = u32((y % h + h) % h);
  return inputState[getCellIndex(wrappedX, wrappedY)];
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let x = id.x;
  let y = id.y;

  // Boundary check when grid dimensions are not multiples of 16
  if (x >= params.width || y >= params.height) {
    return;
  }

  let ix = i32(x);
  let iy = i32(y);

  // Sum 8 neighbors
  var liveNeighbors = 0u;
  liveNeighbors += select(0u, 1u, getCell(ix - 1, iy - 1) > 0u);
  liveNeighbors += select(0u, 1u, getCell(ix    , iy - 1) > 0u);
  liveNeighbors += select(0u, 1u, getCell(ix + 1, iy - 1) > 0u);
  liveNeighbors += select(0u, 1u, getCell(ix - 1, iy    ) > 0u);
  liveNeighbors += select(0u, 1u, getCell(ix + 1, iy    ) > 0u);
  liveNeighbors += select(0u, 1u, getCell(ix - 1, iy + 1) > 0u);
  liveNeighbors += select(0u, 1u, getCell(ix    , iy + 1) > 0u);
  liveNeighbors += select(0u, 1u, getCell(ix + 1, iy + 1) > 0u);

  let currentIndex = getCellIndex(x, y);
  let currentState = inputState[currentIndex];

  var nextState = 0u;
  if (currentState > 0u) {
    // Survival rule: cell survives if it has 2 or 3 neighbors
    if (liveNeighbors == 2u || liveNeighbors == 3u) {
      nextState = min(currentState + 1u, 255u); // Track age for visual coloring
    } else {
      nextState = 0u; // Death by underpopulation (<2) or overpopulation (>3)
    }
  } else {
    // Reproduction rule: dead cell becomes alive if exactly 3 neighbors
    if (liveNeighbors == 3u) {
      nextState = 1u;
    } else {
      nextState = 0u;
    }
  }

  outputState[currentIndex] = nextState;
}
