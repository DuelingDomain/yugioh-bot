/**
 * GLSL of the effect layer. Every quad shader draws in the quad's own uv space (0..1, centre 0.5)
 * and the effect scales and moves the mesh onto the zone. Colours are display-space, no tone mapping.
 */

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HASH = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec3 hueRgb(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
`;

/** A thin bright ring: shockwaves, tuning rings, halos. */
export const RING_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uRadius;
uniform float uWidth;
uniform float uSoft;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float off = abs(d - uRadius);
  float halo = 1.0 - smoothstep(uWidth * 0.4, uWidth + uSoft, off);
  float core = 1.0 - smoothstep(0.0, uWidth * 0.45, off);
  float edge = 1.0 - smoothstep(0.94, 1.0, d);
  float a = (halo * 0.55 + core * 0.95) * uAlpha * edge;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.55), a);
}
`;

/**
 * The ground ripple: bands of light and shade travelling outward, like a lens sliding over the
 * board. Normal blending, so the shade bands darken the field a little and the light bands lift it.
 */
export const RIPPLE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uFront;
uniform float uBand;
uniform float uAmp;
uniform float uGlow;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float x = (d - uFront) / uBand;
  float env = exp(-x * x * 0.8);
  float wave = sin(x * 5.2) * env;
  float edge = 1.0 - smoothstep(0.86, 1.0, d);
  float lit = max(wave, 0.0);
  float dark = max(-wave, 0.0);
  float pool = (1.0 - smoothstep(0.0, max(uFront, 0.06), d)) * uGlow;
  vec3 light = uColor + 0.35;
  float aLit = lit * 0.8 * uAlpha * edge + pool * 0.22 * uAlpha * edge;
  float aDark = dark * 0.5 * uAmp * uAlpha * edge;
  float a = aLit + aDark;
  vec3 col = (light * aLit) / max(a, 0.001);
  gl_FragColor = vec4(col, a);
}
`;

/** A soft round glow. */
export const GLOW_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uPow;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(1.0 - d, 0.0), uPow) * uAlpha;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), a * a * 0.6), a);
}
`;

/** A beam of light: a pillar, an aura column, a rod. uSided 1 = grows upward from the bottom edge. */
export const PILLAR_FRAG = /* glsl */ `
${HASH}
varying vec2 vUv;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uAlpha;
uniform float uGrow;
uniform float uTime;
uniform float uWidth;
uniform float uSided;
uniform float uRainbow;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float y = mix(abs(vUv.y - 0.5) * 2.0, vUv.y, uSided);
  float reach = 1.0 - smoothstep(uGrow - 0.14, uGrow, y);
  float core = pow(max(1.0 - x / max(uWidth, 0.01), 0.0), 2.0);
  float halo = pow(max(1.0 - x, 0.0), 3.0);
  float streak = 0.72 + 0.28 * sin(y * 34.0 - uTime * 16.0 + x * 5.0);
  float top = 1.0 - smoothstep(0.5, 1.0, y);
  float base = mix(1.0, smoothstep(0.0, 0.05, vUv.y), uSided);
  float a = (core * streak + halo * 0.4) * reach * top * base * uAlpha;
  vec3 c = mix(uColor2, uColor, core);
  c = mix(c, hueRgb(fract(y * 0.7 + uTime * 0.25)), uRainbow * (0.35 + 0.4 * core));
  gl_FragColor = vec4(mix(c, vec3(1.0), core * 0.5), a);
}
`;

/**
 * Spiral arms around a centre: the Fusion vortex (additive) and the Xyz galaxy (normal blending,
 * with a dark disc and a dust of stars).
 */
export const VORTEX_FRAG = /* glsl */ `
${HASH}
varying vec2 vUv;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uTime;
uniform float uAlpha;
uniform float uArms;
uniform float uTwist;
uniform float uSpin;
uniform float uHole;
uniform float uDark;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = atan(p.y, p.x);
  float arm = pow(0.5 + 0.5 * sin(ang * uArms + r * uTwist - uTime * uSpin), 2.2);
  float radial = smoothstep(1.0, 0.3, r) * smoothstep(uHole, uHole + 0.16, r);
  float core = exp(-r * r * 9.0);
  float stars = step(0.985, hash21(floor(p * 46.0))) * smoothstep(1.0, 0.2, r) * uDark;
  vec3 c = mix(uColor2, uColor, smoothstep(0.15, 0.85, r));
  c = mix(c, vec3(1.0), core * 0.6 + stars);
  float lit = clamp(arm * radial * 0.95 + core * 0.55 + stars, 0.0, 1.0);
  float disc = uDark * smoothstep(0.85, 0.1, r);
  float a = clamp(lit + disc * 0.85, 0.0, 1.0) * uAlpha;
  vec3 col = mix(vec3(0.02, 0.01, 0.05), c, clamp(lit * 1.3, 0.0, 1.0));
  gl_FragColor = vec4(mix(c, col, uDark), a);
}
`;

/** Link: circuit traces on a grid, a bright pulse travelling in from the rim to the zone. */
export const CIRCUIT_FRAG = /* glsl */ `
${HASH}
varying vec2 vUv;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uAlpha;
uniform float uFront;
uniform float uCells;
uniform float uSeed;
uniform float uLine;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float d = length(p);
  if (d > 1.0) discard;
  vec2 g = vUv * uCells;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(id + uSeed);
  float h2 = hash21(id.yx + 7.3 + uSeed);
  float horiz = step(abs(f.y), uLine) * step(h, 0.46);
  float vert = step(abs(f.x), uLine) * step(0.46, h) * step(h, 0.86);
  float node = step(length(f), uLine * 2.4) * step(0.72, h2);
  float trace = clamp(horiz + vert + node, 0.0, 1.0);
  float front = uFront + (h - 0.5) * 0.22;
  float band = exp(-pow((d - front) / 0.075, 2.0));
  float passed = step(front, d);
  float near = smoothstep(0.55, 0.0, d) * 0.5;
  float lit = band * 1.2 + passed * 0.22 + near * (1.0 - step(uFront, 0.0));
  float a = trace * lit * smoothstep(1.0, 0.7, d) * uAlpha;
  vec3 c = mix(uColor, uColor2, band);
  gl_FragColor = vec4(mix(c, vec3(1.0), band * 0.6), a);
}
`;

/** Link arrow: a small triangle that points up; the mesh is turned to face outward. */
export const ARROW_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  p.y += 0.15;
  float inside = step(-0.7, p.y) * step(abs(p.x), (0.85 - p.y) * 0.6);
  float edge = smoothstep(0.0, 0.16, (0.85 - p.y) * 0.6 - abs(p.x)) * smoothstep(-0.7, -0.5, p.y);
  float glow = pow(max(1.0 - length(p * vec2(0.9, 0.8)), 0.0), 2.0) * 0.55;
  float a = (inside * (0.55 + 0.45 * edge) + glow) * uAlpha;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), inside * 0.5), a);
}
`;

/** Ritual: a ring of procedural runes, revealed around the circle and turning slowly. */
export const RUNE_FRAG = /* glsl */ `
${HASH}
varying vec2 vUv;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uTime;
uniform float uAlpha;
uniform float uRadius;
uniform float uWidth;
uniform float uSegs;
uniform float uReveal;
uniform float uSpin;
float seg(vec2 q, vec2 a, vec2 b, float w) {
  vec2 pa = q - a;
  vec2 ba = b - a;
  float k = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return 1.0 - smoothstep(w * 0.5, w, length(pa - ba * k));
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float base = atan(p.y, p.x) / 6.28318 + 0.5;
  float ang = base + uTime * uSpin;
  float cell = fract(ang * uSegs);
  float id = floor(ang * uSegs);
  float v = (r - uRadius) / uWidth;
  vec2 q = vec2(cell - 0.5, v * 0.5);
  float h = hash21(vec2(id, 3.7));
  float h2 = hash21(vec2(id, 9.1));
  float h3 = hash21(vec2(id, 1.3));
  float glyph = 0.0;
  glyph = max(glyph, seg(q, vec2(0.0, -0.32), vec2(0.0, 0.32), 0.09) * step(0.25, h));
  glyph = max(glyph, seg(q, vec2(-0.2, -0.28), vec2(0.2, 0.28), 0.08) * step(0.5, h2));
  glyph = max(glyph, seg(q, vec2(0.2, -0.28), vec2(-0.2, 0.28), 0.08) * step(0.55, h3));
  glyph = max(glyph, seg(q, vec2(-0.22, 0.0), vec2(0.22, 0.0), 0.08) * step(0.6, h));
  glyph = max(glyph, (1.0 - smoothstep(0.06, 0.12, length(q - vec2(0.0, 0.36)))) * step(0.5, h2));
  glyph *= step(abs(v), 0.78);
  float lines = (1.0 - smoothstep(0.0, 0.05, abs(abs(v) - 0.92))) * 0.8;
  float shown = 1.0 - smoothstep(uReveal - 0.03, uReveal, base);
  float a = clamp(glyph + lines, 0.0, 1.0) * shown * uAlpha * step(abs(v), 1.05);
  gl_FragColor = vec4(mix(uColor, uColor2, glyph * 0.5), a);
}
`;

/** The portrait: the card art in a hologram, with a rim of light, scan lines and a sweeping band. */
export const PORTRAIT_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec4 uCrop;
uniform vec3 uRim;
uniform float uHasTex;
uniform float uAlpha;
uniform float uReveal;
uniform float uTime;
uniform float uFlash;
void main() {
  vec2 uv = mix(uCrop.xy, uCrop.zw, vUv);
  vec3 tex = texture2D(uTex, uv).rgb;
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = min(e.x, e.y);
  float rim = pow(1.0 - smoothstep(0.0, 0.075, edge), 1.4);
  float scan = 0.93 + 0.07 * sin(vUv.y * 230.0 - uTime * 10.0);
  float sweep = exp(-pow((vUv.y - fract(uTime * 0.7)) * 8.0, 2.0)) * 0.3;
  float vis = 1.0 - smoothstep(uReveal - 0.07, uReveal, vUv.y);
  vec3 body = tex * scan;
  body = mix(body, body * vec3(0.9, 1.02, 1.1) + uRim * 0.1, 0.4);
  vec3 col = mix(vec3(0.02, 0.03, 0.06) + uRim * 0.06, body, uHasTex);
  col += uRim * (rim * 0.95 + sweep) + vec3(uFlash);
  float a = uAlpha * vis * (0.97 + rim * 0.03);
  gl_FragColor = vec4(col, a);
}
`;

/* ---------- particles: every point is placed by the vertex shader from its start state ---------- */

export const POINTS_VERT = /* glsl */ `
attribute vec3 aVel;
attribute vec4 aParam;
attribute vec4 aColor;
uniform float uTime;
uniform float uDpr;
uniform float uAlpha;
uniform float uShrink;
uniform vec3 uGravity;
uniform vec4 uSwirl;
varying vec4 vColor;
varying float vSeed;
varying float vK;
mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}
void main() {
  float t = uTime - aParam.x;
  float k = t / max(aParam.y, 0.0001);
  vec3 p = position + aVel * t + 0.5 * uGravity * t * t;
  if (uSwirl.x != 0.0 || uSwirl.y != 0.0) {
    float pull = 1.0 - uSwirl.y * smoothstep(uSwirl.z, 1.0, k);
    float w = uSwirl.x * (1.0 + (aParam.w - 0.5) * uSwirl.w);
    p.xy = rot(w * uTime) * (p.xy * pull);
  }
  float alive = step(0.0, t) * step(t, aParam.y);
  float fadeIn = smoothstep(0.0, 0.12, k);
  float fadeOut = 1.0 - smoothstep(0.6, 1.0, k);
  vColor = vec4(aColor.rgb, aColor.a * fadeIn * fadeOut * alive * uAlpha);
  vSeed = aParam.w;
  vK = k;
  gl_PointSize = aParam.z * (1.0 - uShrink * 0.65 * clamp(k, 0.0, 1.0)) * uDpr * alive;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const POINTS_FRAG = /* glsl */ `
uniform float uShape;
varying vec4 vColor;
varying float vSeed;
varying float vK;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  vec3 col = vColor.rgb;
  float a;
  if (uShape < 0.5) {
    float d = length(c) * 2.0;
    a = pow(max(1.0 - d, 0.0), 1.6);
    col = mix(col, vec3(1.0), a * a * 0.5);
  } else if (uShape < 1.5) {
    float d = length(c) * 2.0;
    float core = pow(max(1.0 - d, 0.0), 3.0);
    float cross = max(smoothstep(0.08, 0.0, abs(c.x)), smoothstep(0.08, 0.0, abs(c.y))) * smoothstep(1.0, 0.15, d);
    a = max(core, cross * 0.9);
    col = mix(col, vec3(1.0), core);
  } else {
    float ang = vSeed * 6.2831 + vK * (2.0 + vSeed * 6.0);
    vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c;
    float m = max(abs(q.x) * 1.15 + abs(q.y) * 0.45, abs(q.y) * 1.05);
    m += 0.05 * sin(atan(q.y, q.x) * 3.0 + vSeed * 9.0);
    a = 1.0 - smoothstep(0.30, 0.34, m);
    col = col * (0.5 + 0.9 * (q.x + 0.3)) + vec3(0.04);
  }
  a *= vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
`;
