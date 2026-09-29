struct RenderParams {
  width: u32,
  height: u32,
  colorScheme: u32,
  gridLines: u32,
};

@group(0) @binding(0) var<uniform> params: RenderParams;
@group(0) @binding(1) var<storage, read> cellState: array<u32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

// Fullscreen triangle generation without any vertex buffer overhead
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
  // Flip Y so (0,0) is top-left
  output.uv.y = 1.0 - output.uv.y;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let gridX = u32(input.uv.x * f32(params.width));
  let gridY = u32(input.uv.y * f32(params.height));

  if (gridX >= params.width || gridY >= params.height) {
    return vec4f(0.04, 0.05, 0.07, 1.0);
  }

  let index = gridY * params.width + gridX;
  let cellAge = cellState[index];

  // Optional grid line overlay
  var gridBorder = 0.0;
  if (params.gridLines == 1u && params.width <= 256u) {
    let cellCoord = fract(input.uv * vec2f(f32(params.width), f32(params.height)));
    let b = 0.05;
    if (cellCoord.x < b || cellCoord.x > (1.0 - b) ||
        cellCoord.y < b || cellCoord.y > (1.0 - b)) {
      gridBorder = 0.12;
    }
  }

  // Dead cell
  if (cellAge == 0u) {
    let bg = vec3f(0.04, 0.05, 0.08) + vec3f(gridBorder);
    return vec4f(bg, 1.0);
  }

  // Alive cell: normalized age factor [0.0 - 1.0]
  let ageNorm = clamp(f32(cellAge) / 25.0, 0.0, 1.0);

  var cellColor = vec3f(0.0);

  if (params.colorScheme == 0u) {
    // 0: Cyberpunk Cyan / Neon Blue
    let newborn = vec3f(0.0, 1.0, 0.8);
    let mature = vec3f(0.1, 0.5, 1.0);
    cellColor = mix(newborn, mature, ageNorm);
  } else if (params.colorScheme == 1u) {
    // 1: Solarized Sunset
    let newborn = vec3f(1.0, 0.85, 0.2);
    let mature = vec3f(0.95, 0.15, 0.45);
    cellColor = mix(newborn, mature, ageNorm);
  } else if (params.colorScheme == 2u) {
    // 2: Electric Violet / Magenta
    let newborn = vec3f(0.9, 0.2, 1.0);
    let mature = vec3f(0.3, 0.4, 1.0);
    cellColor = mix(newborn, mature, ageNorm);
  } else if (params.colorScheme == 3u) {
    // 3: Classic Matrix Green
    let newborn = vec3f(0.3, 1.0, 0.4);
    let mature = vec3f(0.05, 0.55, 0.15);
    cellColor = mix(newborn, mature, ageNorm);
  } else {
    // 4: Pure White
    cellColor = vec3f(0.95, 0.96, 0.98);
  }

  return vec4f(cellColor - vec3f(gridBorder * 0.4), 1.0);
}
