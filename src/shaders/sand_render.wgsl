struct RenderParams {
  gridWidth:  u32,
  gridHeight: u32,
  canvasSize: f32,
  showGrid:   u32,
};

@group(0) @binding(0) var<uniform> params: RenderParams;
@group(0) @binding(1) var<storage, read> cellGrid: array<u32>;
@group(0) @binding(2) var paletteTex: texture_2d<f32>;

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
  output.uv = (pos[vertexIndex] + 1.0) * 0.5;
  output.uv.y = 1.0 - output.uv.y;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let gx = u32(input.uv.x * f32(params.gridWidth));
  let gy = u32(input.uv.y * f32(params.gridHeight));

  if (gx >= params.gridWidth || gy >= params.gridHeight) {
    return vec4f(0.027, 0.035, 0.055, 1.0);
  }

  let index = gy * params.gridWidth + gx;
  let cellType = cellGrid[index];
  let safeType = min(cellType, 63u);

  // Directly sample the exact user-defined color from the palette texture!
  var baseColor = textureLoad(paletteTex, vec2<u32>(safeType, 0u), 0).rgb;

  // 1-pixel physical white grid lines
  var gridMix = 0.0;
  if (params.showGrid == 1u) {
    let cellSizePixels = params.canvasSize / f32(params.gridWidth);
    if (cellSizePixels >= 3.5) {
      let pixelPos = fract(input.position.xy / cellSizePixels) * cellSizePixels;
      let distToBorder = min(pixelPos, vec2f(cellSizePixels) - pixelPos);
      if (distToBorder.x < 1.0 || distToBorder.y < 1.0) {
        gridMix = clamp((cellSizePixels - 3.5) / 2.5, 0.0, 1.0);
      }
    }
  }

  let gridWhite = vec3f(1.0, 1.0, 1.0);
  let finalColor = mix(baseColor, gridWhite, gridMix * 0.35);
  return vec4f(finalColor, 1.0);
}
