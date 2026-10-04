// Draws the current state texture to the canvas. The state is oversampled,
// so four taps spread over the pixel footprint give a cheap box filter.

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VOut;
  o.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(xy.x, 1.0 - xy.y);
  return o;
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let dx = dpdx(v.uv) * 0.25;
  let dy = dpdy(v.uv) * 0.25;
  let c = textureSample(tex, samp, v.uv + dx + dy)
        + textureSample(tex, samp, v.uv + dx - dy)
        + textureSample(tex, samp, v.uv - dx + dy)
        + textureSample(tex, samp, v.uv - dx - dy);
  return vec4f(c.rgb * 0.25, 1.0);
}
