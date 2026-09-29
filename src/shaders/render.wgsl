struct RenderParams {
  width: u32,
  height: u32,
  gridLines: u32,
  _padding: u32,
};

@group(0) @binding(0) var<uniform> params: RenderParams;
@group(0) @binding(1) var<storage, read> cellState: array<u32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

// Fullscreen triangle generation
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
  let gridX = u32(input.uv.x * f32(params.width));
  let gridY = u32(input.uv.y * f32(params.height));

  if (gridX >= params.width || gridY >= params.height) {
    return vec4f(0.04, 0.05, 0.08, 1.0);
  }

  let index = gridY * params.width + gridX;
  let cellAge = cellState[index];

  // Grid line overlay
  var gridBorder = 0.0;
  if (params.gridLines == 1u) {
    let cellCoord = fract(input.uv * vec2f(f32(params.width), f32(params.height)));
    let b = 0.04;
    if (cellCoord.x < b || cellCoord.x > (1.0 - b) ||
        cellCoord.y < b || cellCoord.y > (1.0 - b)) {
      gridBorder = 0.15;
    }
  }

  // Dead cell
  if (cellAge == 0u) {
    let bg = vec3f(0.03, 0.04, 0.07) + vec3f(gridBorder);
    return vec4f(bg, 1.0);
  }

  // Alive cell: vibrant cyan with subtle age glow
  let ageNorm = clamp(f32(cellAge) / 20.0, 0.0, 1.0);
  let young = vec3f(0.0, 1.0, 0.8);
  let mature = vec3f(0.1, 0.55, 1.0);
  let cellColor = mix(young, mature, ageNorm);

  return vec4f(cellColor - vec3f(gridBorder * 0.35), 1.0);
}
