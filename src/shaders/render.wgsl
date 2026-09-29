struct RenderParams {
  gridWidth: u32,
  gridHeight: u32,
  canvasSize: f32,
  showGrid: u32,
};

@group(0) @binding(0) var<uniform> params: RenderParams;
@group(0) @binding(1) var<storage, read> cellState: array<u32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );

  var output: VertexOutput;
  output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
  output.uv = (pos[vertexIndex] + vec2f(1.0, 1.0)) * 0.5;
  output.uv.y = 1.0 - output.uv.y;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let gridX = u32(input.uv.x * f32(params.gridWidth));
  let gridY = u32(input.uv.y * f32(params.gridHeight));

  if (gridX >= params.gridWidth || gridY >= params.gridHeight) {
    return vec4f(0.03, 0.04, 0.07, 1.0);
  }

  let index = gridY * params.gridWidth + gridX;
  let cellAge = cellState[index];

  // Exact 1-physical-pixel grid line calculation
  var gridBorderFactor = 0.0;
  if (params.showGrid == 1u) {
    let cellSizePixels = params.canvasSize / f32(params.gridWidth);
    // Render grid lines when cells are at least 3.5 screen pixels wide
    if (cellSizePixels >= 3.5) {
      let pixelInCell = fract(input.position.xy / cellSizePixels) * cellSizePixels;
      let distFromEdge = min(pixelInCell, vec2f(cellSizePixels) - pixelInCell);

      if (distFromEdge.x < 1.0 || distFromEdge.y < 1.0) {
        // Smoothly fade in grid between 3.5px and 6.0px cell size
        gridBorderFactor = clamp((cellSizePixels - 3.5) / 2.5, 0.0, 1.0);
      }
    }
  }

  let darkBg = vec3f(0.03, 0.04, 0.07);
  let gridLineColor = vec3f(0.12, 0.16, 0.23);

  // Dead cell
  if (cellAge == 0u) {
    let finalBg = mix(darkBg, gridLineColor, gridBorderFactor * 0.65);
    return vec4f(finalBg, 1.0);
  }

  // Alive cell: vibrant neon cyan with subtle age maturation
  let ageNorm = clamp(f32(cellAge) / 20.0, 0.0, 1.0);
  let young = vec3f(0.0, 1.0, 0.82);
  let mature = vec3f(0.1, 0.55, 1.0);
  let cellColor = mix(young, mature, ageNorm);

  // Outline alive cells subtly so adjacent blocks are distinguishable
  let aliveWithBorder = mix(cellColor, cellColor * 0.6, gridBorderFactor * 0.4);
  return vec4f(aliveWithBorder, 1.0);
}
