struct SimulationParams {
  gridWidth:  u32,
  gridHeight: u32,
};

@group(0) @binding(0) var<uniform> params: SimulationParams;
@group(0) @binding(1) var<storage, read>  currentCells: array<u32>;
@group(0) @binding(2) var<storage, read_write> nextCells: array<u32>;

fn getCellState(x: i32, y: i32) -> u32 {
  let w = i32(params.gridWidth);
  let h = i32(params.gridHeight);
  let wrappedX = ((x % w) + w) % w;
  let wrappedY = ((y % h) + h) % h;
  let idx = u32(wrappedY) * params.gridWidth + u32(wrappedX);
  return select(0u, 1u, currentCells[idx] > 0u);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  let x = global_id.x;
  let y = global_id.y;

  if (x >= params.gridWidth || y >= params.gridHeight) {
    return;
  }

  let ix = i32(x);
  let iy = i32(y);

  var neighbors: u32 = 0u;
  neighbors += getCellState(ix - 1, iy - 1);
  neighbors += getCellState(ix,     iy - 1);
  neighbors += getCellState(ix + 1, iy - 1);
  neighbors += getCellState(ix - 1, iy);
  neighbors += getCellState(ix + 1, iy);
  neighbors += getCellState(ix - 1, iy + 1);
  neighbors += getCellState(ix,     iy + 1);
  neighbors += getCellState(ix + 1, iy + 1);

  let currentIndex = y * params.gridWidth + x;
  let currentVal = currentCells[currentIndex];
  let isAlive = currentVal > 0u;

  var nextVal: u32 = 0u;
  if (isAlive && (neighbors == 2u || neighbors == 3u)) {
    nextVal = min(currentVal + 1u, 255u);
  } else if (!isAlive && neighbors == 3u) {
    nextVal = 1u;
  }

  nextCells[currentIndex] = nextVal;
}
