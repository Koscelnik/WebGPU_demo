struct Params {
  gridWidth:  u32,
  gridHeight: u32,
  ruleCount:  u32,
  seed:       u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read>       inputGrid:  array<u32>;
@group(0) @binding(2) var<storage, read_write>  outputGrid: array<u32>;
@group(0) @binding(3) var<storage, read>       rules:      array<u32>;

/* PCG hash for fast pseudo-random numbers */
fn pcg(v: u32) -> u32 {
  var s = v * 747796405u + 2891336453u;
  var w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

/* Population count (number of 1-bits) */
fn popcnt(m: u32) -> u32 {
  var n = m;
  n = n - ((n >> 1u) & 0x55555555u);
  n = (n & 0x33333333u) + ((n >> 2u) & 0x33333333u);
  n = (n + (n >> 4u)) & 0x0F0F0F0Fu;
  return (n * 0x01010101u) >> 24u;
}

/* Select the k-th set bit from a mask */
fn selectBit(mask: u32, k: u32) -> u32 {
  var count = 0u;
  for (var i = 0u; i < 32u; i++) {
    if ((mask & (1u << i)) != 0u) {
      if (count == k) { return i; }
      count++;
    }
  }
  return 0u;
}

/* Read cell with solid boundary barriers (prevents falling off or vanishing) */
fn getCell(x: i32, y: i32) -> u32 {
  if (x < 0 || x >= i32(params.gridWidth) || y < 0 || y >= i32(params.gridHeight)) {
    return 2u; // WALL (solid barrier at all outer edges)
  }
  return inputGrid[u32(y) * params.gridWidth + u32(x)];
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let x = id.x;
  let y = id.y;
  if (x >= params.gridWidth || y >= params.gridHeight) { return; }

  let idx      = y * params.gridWidth + x;
  let curType  = inputGrid[idx];
  var newType   = curType;
  var hitCount  = 0u;
  var rng       = pcg(idx ^ (params.seed * 196613u));

  /* Test every possible rule-center offset (-1..+1 in each axis)
     that places our cell (x, y) inside the rule's 3×3 window */
  for (var cdy: i32 = -1; cdy <= 1; cdy++) {
    for (var cdx: i32 = -1; cdx <= 1; cdx++) {
      let centerX = i32(x) + cdx;
      let centerY = i32(y) + cdy;

      /* Our position index inside the rule's 3×3 (0..8) */
      let ourIdx = u32(-cdy + 1) * 3u + u32(-cdx + 1);

      /* Test rules */
      for (var r = 0u; r < params.ruleCount; r++) {
        let base = r * 18u;

        // CRITICAL OPTIMIZATION: If this rule doesn't change our cell (output is ANY),
        // we can skip checking all 9 inputs for this offset completely!
        let outMask = rules[base + 9u + ourIdx];
        if (outMask == 0xFFFFFFFFu) {
          continue;
        }

        var ok = true;
        for (var ry: i32 = -1; ry <= 1; ry++) {
          for (var rx: i32 = -1; rx <= 1; rx++) {
            if (ok) {
              let pi   = u32(ry + 1) * 3u + u32(rx + 1);
              let mask = rules[base + pi];
              // Only check input condition if it's not ANY
              if (mask != 0xFFFFFFFFu) {
                let val = getCell(centerX + rx, centerY + ry);
                if ((mask & (1u << (val & 31u))) == 0u) {
                  ok = false;
                }
              }
            }
          }
        }

        if (ok) {
          hitCount += 1u;
          rng = pcg(rng);
          /* Reservoir sampling: pick randomly if multiple rules match */
          if ((rng % hitCount) == 0u) {
            let bits = popcnt(outMask);
            if (bits > 0u) {
              rng     = pcg(rng);
              newType = selectBit(outMask, rng % bits);
            }
          }
        }
      }
    }
  }

  outputGrid[idx] = newType;
}
