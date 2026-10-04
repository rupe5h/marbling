// Backward walker: for each pixel, map its position back through actions
// [lo, hi) using each action's inverse (as pst-marble's actions2rgb does).
// If a drop captures the point, the pixel takes the drop's color; otherwise
// the color is sampled from the source state texture (useSrc = 1) or is the
// background (useSrc = 0, i.e. replaying from an empty tank). The source
// holds actions [0, lo) but only within the tank; with fillEdges = 1, points
// that land beyond it walk on through [0, lo) instead of taking the
// background.
//
// Inverse functions mirror src/marble/math.ts.
//
// The walker and the maps are ported from pst-marble 1.6 by Aubrey Jaffer,
// Jürgen Gilg and Manuel Luque; they are Jaffer's PostScript in
// dvips/pst-marble.pro. Copyright (C) 2018-2019 Aubrey Jaffer. LaTeX Project
// Public License 1.3c or later.
// Source: https://ctan.org/pkg/pst-marble.
// This is a modified port, not the original: the changes are listed under
// "Credits" in README.md. Report problems with it to this project, not to
// the pst-marble authors. Each function names the procedure it comes from.

struct Params {
  bg: vec4f,
  size: vec2f,      // destination size in pixels
  origin: vec2u,    // tile origin in pixels
  srcSize: vec2f,
  lo: u32,
  hi: u32,
  useSrc: u32,
  samples: u32,     // supersampling grid (samples x samples)
  fillEdges: u32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform> U: Params;
@group(0) @binding(1) var<storage, read> A: array<f32>;
@group(0) @binding(2) var<storage, read> OFF: array<u32>;
@group(0) @binding(3) var srcTex: texture_2d<f32>;
@group(0) @binding(5) var dst: texture_storage_2d<DST_FORMAT, write>;

const TAU = 6.283185307179586;

fn v2(b: u32) -> vec2f { return vec2f(A[b], A[b + 1u]); }

fn rot(v: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}

// Solves t + m*sin(t) = t1 for t, |m| < 1. Does the job of pst-marble's g_1
// (one Newton step from a guess) by iterating Newton to convergence.
fn solvePhase(t1: f32, m: f32) -> f32 {
  let w = TAU * round(t1 / TAU);
  let tr = t1 - w;
  var t = tr;
  let lo = tr - abs(m);
  let hi = tr + abs(m);
  for (var i = 0; i < 10; i++) {
    t = clamp(t - (t + m * sin(t) - tr) / (1.0 + m * cos(t)), lo, hi);
  }
  return t + w;
}

// Inverse of pst-marble rake-deformation (the rake run backward).
fn invRake(q: vec2f, b: u32) -> vec2f {
  let d = v2(b + 1u);
  let tU = A[b + 3u];
  let Linv = A[b + 4u];
  let n = u32(A[b + 5u]);
  let perp = q.x * d.y - q.y * d.x;
  var s = 0.0;
  for (var i = 0u; i < n; i++) {
    s += exp(-abs(perp - A[b + 6u + i]) * Linv);
  }
  return q - d * (s * tU);
}

// Displacement of the fluid at p while a stylus moves from b to e, one
// sub-step of tU along unit direction n. The loop body of pst-marble
// stylus-deformation.
fn stylusStep(p: vec2f, b: vec2f, e: vec2f, n: vec2f, tU: f32, L: f32) -> vec2f {
  let dB = b - p;
  let dE = e - p;
  let r = length(dB);
  let rr = r / L;
  if (!(rr < 6.0 && rr > 0.0)) { return vec2f(0.0); }
  let s = length(dE);
  let txB = dot(dB, n);
  let txE = dot(dE, n);
  let ty = dB.x * n.y - dB.y * n.x;
  let denr = exp(rr) * r * L * 2.0;
  var inx = (r * L - ty * ty) * tU / denr;
  var iny = txB * ty * tU / denr;
  if (s > 1e-9) {
    let dens = exp(s / L) * s * L * 2.0;
    inx += (s * L - ty * ty) * tU / dens;
    iny += txE * ty * tU / dens;
  }
  return vec2f(inx * n.x + iny * n.y, inx * n.y - iny * n.x);
}

// pst-marble stylus-deformation, stroke from b0 to e0.
fn stylusMap(p0: vec2f, b0: vec2f, e0: vec2f, L: f32) -> vec2f {
  let D = e0 - b0;
  let len = length(D);
  if (len < 1e-9) { return p0; }
  let rpts = u32(min(ceil(len / L), 512.0));
  let n = D / len;
  let tU = len / f32(rpts);
  let stp = D / f32(rpts);
  var b = b0;
  var e = b0 + stp;
  var p = p0;
  for (var k = 0u; k < rpts; k++) {
    p += stylusStep(p, b, e, n, tU, L);
    b = e;
    e += stp;
  }
  return p;
}

fn invStylus(q: vec2f, b: u32) -> vec2f {
  // Reverse stroke: from e back to b.
  return stylusMap(q, v2(b + 3u), v2(b + 1u), A[b + 5u]);
}

// Styli moving together, packed as L, n, then (begin, end) per stylus. The
// fluid moves by the sum of their displacements in each sub-step. Like a
// single stylus, it is inverted by running every stroke backwards. Not in
// pst-marble: this app's extension of stylus-deformation.
fn invStyli(q: vec2f, b: u32) -> vec2f {
  let L = A[b + 1u];
  let n = u32(A[b + 2u]);
  var maxLen = 0.0;
  for (var i = 0u; i < n; i++) {
    let o = b + 3u + 4u * i;
    maxLen = max(maxLen, length(v2(o) - v2(o + 2u)));
  }
  if (maxLen < 1e-9) { return q; }
  let rpts = u32(min(ceil(maxLen / L), 512.0));
  var p = q;
  for (var k = 0u; k < rpts; k++) {
    var m = vec2f(0.0);
    for (var i = 0u; i < n; i++) {
      let o = b + 3u + 4u * i;
      // Reversed: from the stroke's end back to its beginning.
      let s0 = v2(o + 2u);
      let D = v2(o) - s0;
      let len = length(D);
      if (len < 1e-9) { continue; }
      let stp = D / f32(rpts);
      m += stylusStep(p, s0 + stp * f32(k), s0 + stp * f32(k + 1u), D / len, len / f32(rpts), L);
    }
    p += m;
  }
  return p;
}

// Inverse of pst-marble stir-deformation (the rods turned back).
fn invStir(q: vec2f, b: u32) -> vec2f {
  let c = v2(b + 1u);
  let th = A[b + 3u];
  let Linv = A[b + 4u];
  let n = u32(A[b + 5u]);
  let d = q - c;
  let pc = length(d);
  if (pc < 1e-6) { return q; }
  var a = 0.0;
  for (var i = 0u; i < n; i++) {
    let r = A[b + 6u + i];
    let ar = abs(r);
    var t = th * exp(-abs(pc - ar) * Linv / ar);
    if (r > 0.0) { t = -t; }
    a += t;
  }
  return c + rot(d, -a);
}

// Inverse of pst-marble vortex-deformation (the vortex turned back).
fn invVortex(q: vec2f, b: u32) -> vec2f {
  let c = v2(b + 1u);
  let d = q - c;
  let r2 = dot(d, d);
  if (r2 < 1e-12) { return q; }
  let a = pow(A[b + 5u] + pow(r2 * A[b + 4u], 0.75), -4.0 / 3.0) * A[b + 3u];
  return c + rot(d, -a);
}

// Inverse of pst-marble jiggle-deformation.
fn invJiggle(q: vec2f, b: u32) -> vec2f {
  let u = v2(b + 1u);
  let k = A[b + 3u];
  let ofst = A[b + 4u];
  let Am = A[b + 5u];
  let Bm = A[b + 6u];
  let t = solvePhase(k * (dot(q, u) + ofst), k * Am);
  let v = vec2f(u.y, -u.x);
  return q - Am * sin(t) * u - Bm * cos(t) * v;
}

// Inverse of pst-marble wriggle-deformation.
fn invWriggle(q: vec2f, b: u32) -> vec2f {
  let c = v2(b + 1u);
  let k = A[b + 3u];
  let Am = A[b + 4u];
  let Bm = A[b + 5u];
  let d = q - c;
  let r1 = length(d);
  if (r1 < 1e-9) { return q; }
  let t = solvePhase(k * r1, k * Am);
  let r = max(t / k, 0.0);
  let phi = atan2(d.y, d.x) - Bm * cos(t);
  return c + r * vec2f(cos(phi), sin(phi));
}

fn catmullRom(f: f32) -> vec4f {
  return vec4f(
    f * (-0.5 + f * (1.0 - 0.5 * f)),
    1.0 + f * f * (-2.5 + 1.5 * f),
    f * (0.5 + f * (2.0 - 1.5 * f)),
    f * f * (-0.5 + 0.5 * f),
  );
}

fn srcUV(q: vec2f) -> vec2f {
  let S = max(U.srcSize.x, U.srcSize.y);
  return vec2f(q.x * S + 0.5 * U.srcSize.x, 0.5 * U.srcSize.y - q.y * S) / U.srcSize;
}

fn inSrc(q: vec2f) -> bool {
  let uv = srcUV(q);
  return all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
}

// Bicubic (Catmull-Rom) lookup of the source state. Live strokes resample
// the state every frame, and bilinear filtering would blur it a little each
// time. The result is clamped to the four nearest texels so overshoot can't
// build up into ringing over repeated passes.
fn sampleSrc(q: vec2f) -> vec3f {
  if (!inSrc(q)) { return U.bg.rgb; }
  let t = srcUV(q) * U.srcSize - 0.5;
  let i0 = vec2i(floor(t));
  let wx = catmullRom(t.x - floor(t.x));
  let wy = catmullRom(t.y - floor(t.y));
  let maxI = vec2i(U.srcSize) - 1;
  var acc = vec3f(0.0);
  var lo = vec3f(1e9);
  var hi = vec3f(-1e9);
  for (var j = 0; j < 4; j++) {
    for (var k = 0; k < 4; k++) {
      let c = textureLoad(srcTex, clamp(i0 + vec2i(k - 1, j - 1), vec2i(0), maxI), 0).rgb;
      acc += wx[k] * wy[j] * c;
      if ((k == 1 || k == 2) && (j == 1 || j == 2)) {
        lo = min(lo, c);
        hi = max(hi, c);
      }
    }
  }
  return clamp(acc, lo, hi);
}

// A point being walked back through the actions, and the color found so far.
struct Walk {
  q: vec2f,
  base: vec3f,
  blendC: vec3f,
  blendA: f32,
  done: bool,
};

// Walks w back through actions [lo, hi). px: pixel size in world units,
// used for drop edge anti-aliasing. The loop of pst-marble actions2rgb, with
// its drop case; the edge blending is this app's.
fn walk(w0: Walk, lo: u32, hi: u32, px: f32) -> Walk {
  var w = w0;
  var i = i32(hi) - 1;
  loop {
    if (i < i32(lo)) { break; }
    let b = OFF[i];
    switch u32(A[b]) {
      case 1u: {
        let c = v2(b + 1u);
        let r = A[b + 3u];
        let col = vec3f(A[b + 4u], A[b + 5u], A[b + 6u]);
        let d = w.q - c;
        let a2 = dot(d, d);
        let r2 = r * r;
        let alpha = clamp(0.5 - (sqrt(a2) - r) / px, 0.0, 1.0);
        if (alpha >= 1.0) {
          w.base = col;
          w.done = true;
        } else {
          // Partially covered edge pixel: blend the drop color with what
          // surrounds the drop, which is the fluid that sat at its center.
          if (alpha > 0.0 && w.blendA == 0.0) {
            w.blendC = col;
            w.blendA = alpha;
          }
          if (a2 <= r2) { w.q = c; } else { w.q = c + d * sqrt(1.0 - r2 / a2); }
        }
      }
      case 2u: { w.q = invRake(w.q, b); }
      case 3u: { w.q = invStylus(w.q, b); }
      case 4u: { w.q = invStir(w.q, b); }
      case 5u: { w.q = invVortex(w.q, b); }
      case 6u: { w.q = invJiggle(w.q, b); }
      case 7u: { w.q = invWriggle(w.q, b); }
      case 8u: { w.q = w.q - v2(b + 1u); }
      case 9u: { w.q = invStyli(w.q, b); }
      default: {}
    }
    if (w.done) { break; }
    i--;
  }
  return w;
}

fn shade(p: vec2f, px: f32) -> vec3f {
  var w = walk(Walk(p, U.bg.rgb, vec3f(0.0), 0.0, false), U.lo, U.hi, px);
  if (!w.done && U.useSrc == 1u) {
    if (U.fillEdges == 1u && !inSrc(w.q)) {
      w = walk(w, 0u, U.lo, px);
    } else {
      w.base = sampleSrc(w.q);
    }
  }
  return mix(w.base, w.blendC, w.blendA);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let pix = gid.xy + U.origin;
  if (f32(pix.x) >= U.size.x || f32(pix.y) >= U.size.y) { return; }
  let S = max(U.size.x, U.size.y);
  let n = max(U.samples, 1u);
  let px = 1.0 / (S * f32(n));
  var acc = vec3f(0.0);
  for (var sy = 0u; sy < n; sy++) {
    for (var sx = 0u; sx < n; sx++) {
      let fp = vec2f(pix) + (vec2f(f32(sx), f32(sy)) + 0.5) / f32(n);
      let p = vec2f(fp.x - 0.5 * U.size.x, 0.5 * U.size.y - fp.y) / S;
      acc += shade(p, px);
    }
  }
  textureStore(dst, pix, vec4f(acc / f32(n * n), 1.0));
}
