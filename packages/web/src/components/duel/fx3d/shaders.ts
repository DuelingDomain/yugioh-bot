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

const NOISE = /* glsl */ `
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.03 + 7.1) * 0.3 + vnoise(p * 4.1 + 3.3) * 0.15;
}
`;

/**
 * A polyline of light: lasers, lightning, chains, claw rips. The quad covers the bounding box of
 * the points (uSize px); the points are in px from the quad centre, y up. A hot core, a coloured
 * body and a wide bloom. uReveal is how far along the line the head has got, uTail where the
 * visible part starts, uTaper thins the tail end, uDash cuts it into chain links.
 */
export const BOLT_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec2 uPts[12];
uniform float uCount;
uniform vec2 uSize;
uniform float uWidth;
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uAlpha;
uniform float uReveal;
uniform float uTail;
uniform float uFlick;
uniform float uTime;
uniform float uDash;
uniform float uTaper;
uniform float uBloom;
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float best = 1e5;
  float along = 0.0;
  float bestLen = 0.0;
  float cum = 0.0;
  float total = max(uCount - 1.0, 1.0);
  for (int i = 0; i < 11; i++) {
    if (float(i) + 1.0 >= uCount) break;
    vec2 a = uPts[i];
    vec2 b = uPts[i + 1];
    vec2 pa = p - a;
    vec2 ba = b - a;
    float segLen = length(ba);
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
    float d = length(pa - ba * h);
    if (d < best) {
      best = d;
      along = (float(i) + h) / total;
      bestLen = cum + h * segLen;
    }
    cum += segLen;
  }
  float vis = (1.0 - smoothstep(uReveal - 0.025, uReveal + 0.01, along)) * smoothstep(uTail - 0.02, uTail + 0.03, along);
  float w = uWidth * (1.0 - uTaper * (1.0 - along)) * (1.0 + uFlick * 0.28 * sin(uTime * 83.0 + bestLen * 0.07));
  w = max(w, 0.5);
  float body = exp(-pow(best / w, 2.0));
  float hot = exp(-pow(best / (w * 0.42), 2.0));
  float bloom = exp(-best / (w * 2.6)) * uBloom * (1.0 - smoothstep(w * 2.5, w * 5.5, best));
  float link = 1.0;
  if (uDash > 0.0) {
    float f = abs(fract(bestLen / uDash) - 0.5) * 2.0;
    link = 0.35 + 0.65 * smoothstep(0.15, 0.5, f);
  }
  float a = clamp(body * link + bloom, 0.0, 1.0) * vis * uAlpha;
  vec3 c = mix(uColor, uCore, clamp(hot * link + bloom * 0.1, 0.0, 1.0));
  gl_FragColor = vec4(c, a);
}
`;

/** A crescent of light (a sword slash). Faces left; the mesh is turned. uReveal sweeps it top to bottom. */
export const ARC_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uAlpha;
uniform float uReveal;
uniform float uTail;
uniform float uThick;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float o = length(p - vec2(uThick, 0.0));
  float rimOut = 1.0 - smoothstep(0.94, 1.0, r);
  float rimIn = smoothstep(0.97, 1.0, o);
  float shape = rimOut * rimIn;
  float t = 0.5 - p.y * 0.5;
  float vis = (1.0 - smoothstep(uReveal - 0.05, uReveal + 0.02, t)) * smoothstep(uTail - 0.04, uTail + 0.04, t);
  float edge = exp(-max(o - 1.0, 0.0) * 14.0) * exp(-max(1.0 - r, 0.0) * 4.0);
  float halo = exp(-abs(r - 0.98) * 8.0) * 0.35 * (1.0 - smoothstep(0.98, 1.06, o));
  float a = clamp(shape * (0.55 + edge * 0.6) + halo, 0.0, 1.0) * vis * uAlpha;
  gl_FragColor = vec4(mix(uColor, uCore, clamp(edge, 0.0, 1.0)), a);
}
`;

/** A flying ball of fire with a streaming tail; the head is at the right edge, the tail streams left. */
export const FLAME_FRAG = /* glsl */ `
${HASH}
${NOISE}
varying vec2 vUv;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uTime;
uniform float uAlpha;
uniform float uTailLen;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float x = p.x;
  float half_ = 0.44;
  float prof;
  if (x > 0.3) {
    prof = sqrt(max(half_ * half_ - (x - 0.3) * (x - 0.3), 0.0)) ;
  } else {
    prof = half_ * pow(smoothstep(-1.0 + (1.0 - uTailLen) * 0.9, 0.3, x), 0.8);
  }
  float n = fbm(vec2(x * 3.2 + uTime * 5.0, p.y * 3.6));
  float wob = (n - 0.5) * 0.5 * smoothstep(0.35, -0.6, x);
  float d = abs(p.y + wob) / max(prof, 0.001);
  float dens = clamp(1.0 - d, 0.0, 1.0) * step(0.001, prof);
  dens *= 0.75 + 0.5 * n;
  vec3 c = mix(uColor2, uColor, smoothstep(0.1, 0.55, dens));
  c = mix(c, vec3(1.0, 0.96, 0.8), smoothstep(0.55, 0.95, dens));
  float a = clamp(dens * 1.4, 0.0, 1.0) * uAlpha * smoothstep(-1.0, -0.75, x);
  gl_FragColor = vec4(c, a);
}
`;

/** Rising bands of shimmer over hot ground. Normal blending, very faint: a stand-in for heat haze. */
export const HAZE_FRAG = /* glsl */ `
${HASH}
${NOISE}
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(vec2(p.x, p.y * 0.8));
  float mask = smoothstep(1.0, 0.25, r) * smoothstep(-1.0, -0.6, p.y);
  float band = fbm(vec2(p.x * 2.6 + sin(p.y * 6.0 - uTime * 5.0) * 0.35, p.y * 3.0 - uTime * 2.6));
  float s = sin(band * 18.0 - uTime * 7.0);
  float lit = max(s, 0.0);
  float dark = max(-s, 0.0);
  float a = mask * (lit * 0.13 + dark * 0.09) * uAlpha;
  vec3 c = mix(vec3(0.0), uColor + 0.25, step(dark, lit));
  gl_FragColor = vec4(c, a);
}
`;

/**
 * Marks left on the board. uKind: 0 dent (a pressed ring), 1 scorch (a burnt blotch with embers),
 * 2 cracks, 3 pit (the floor opens on a void), 4 scorch line (a burnt streak along x).
 */
export const DECAL_FRAG = /* glsl */ `
${HASH}
${NOISE}
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uKind;
uniform float uSeed;
uniform float uOpen;
uniform float uEmber;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (uKind < 0.5) {
    float ring = exp(-pow((r - 0.55) / 0.16, 2.0));
    float inside = smoothstep(0.62, 0.0, r);
    float dir = dot(normalize(p + 0.0001), vec2(-0.7, 0.7));
    float lit = ring * max(dir, 0.0);
    float shade = ring * max(-dir, 0.0);
    a = (inside * 0.36 + shade * 0.5 + lit * 0.32) * (1.0 - smoothstep(0.85, 1.0, r));
    col = mix(vec3(0.0), uColor + 0.35, lit / max(lit + shade + inside * 0.4, 0.001));
  } else if (uKind < 1.5) {
    float n = fbm(p * 3.0 + uSeed * 9.0);
    float blot = smoothstep(0.92, 0.35, r + (n - 0.5) * 0.7);
    float hotc = pow(smoothstep(0.7, 0.0, r + (n - 0.5) * 0.5), 2.0) * uEmber;
    a = blot * 0.62;
    col = mix(vec3(0.015, 0.01, 0.01), uColor, hotc);
    a = max(a, hotc * 0.7);
  } else if (uKind < 2.5) {
    float ang = atan(p.y, p.x);
    float cells = 9.0;
    float wob = (fbm(vec2(ang * 3.0 + uSeed * 7.0, r * 5.0)) - 0.5) * 0.28;
    float f = abs(fract((ang / 6.28318 + 0.5) * cells + wob) - 0.5);
    float reach = 0.35 + 0.65 * hash21(vec2(floor((ang / 6.28318 + 0.5) * cells + wob), uSeed));
    float line = (1.0 - smoothstep(0.0, 0.04 + 0.03 * (1.0 - r), f)) * step(r, reach * uOpen) * step(0.08, r);
    a = line * 0.85;
    col = mix(vec3(0.0), uColor, exp(-f * 22.0) * 0.6);
  } else if (uKind < 3.5) {
    float rim = exp(-pow((r - uOpen) / 0.07, 2.0));
    float hole = smoothstep(uOpen, uOpen - 0.04, r);
    float depth = smoothstep(uOpen, 0.0, r);
    a = max(hole, rim * 0.8);
    col = mix(uColor * rim, vec3(0.0, 0.0, 0.02) + uColor * 0.06 * depth * depth, hole);
  } else {
    vec2 q = vec2(p.x, p.y * 3.4);
    float len = clamp(uOpen, 0.0, 1.0);
    float n = fbm(vec2(p.x * 6.0 + uSeed * 5.0, p.y * 3.0));
    float w = (1.0 - abs(p.x)) * (0.55 + 0.45 * n);
    float band = smoothstep(w, w * 0.2, abs(q.y)) * smoothstep(1.0, 0.85, abs(p.x)) * step(abs(p.x) - 1.0 + 2.0 * len, 0.0);
    float hotc = pow(smoothstep(w * 0.5, 0.0, abs(q.y)), 2.0) * uEmber * n;
    a = band * 0.6;
    col = mix(vec3(0.015, 0.01, 0.01), uColor, hotc);
    a = max(a, hotc * 0.6);
  }
  gl_FragColor = vec4(col, a * uAlpha);
}
`;

/**
 * One triangle of a broken card, cut from the card picture. The quad is the whole card; the
 * fragment keeps only what lies inside the triangle (card coordinates, y down), with a soft edge
 * and a glowing rim while it is hot.
 */
export const SHARD_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uHasTex;
uniform vec2 uV0;
uniform vec2 uV1;
uniform vec2 uV2;
uniform vec3 uFallback;
uniform vec3 uGlow;
uniform float uHeat;
uniform float uAlpha;
uniform float uAA;
float insideOf(vec2 p, vec2 a, vec2 b, float s) {
  vec2 e = b - a;
  vec2 n = vec2(-e.y, e.x) / max(length(e), 0.0001);
  return dot(p - a, n) * s;
}
void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  float area = (uV1.x - uV0.x) * (uV2.y - uV0.y) - (uV2.x - uV0.x) * (uV1.y - uV0.y);
  float s = area > 0.0 ? 1.0 : -1.0;
  float m = min(insideOf(p, uV0, uV1, s), min(insideOf(p, uV1, uV2, s), insideOf(p, uV2, uV0, s)));
  float cover = smoothstep(-uAA, uAA, m);
  if (cover < 0.01) discard;
  vec3 tex = texture2D(uTex, vUv).rgb;
  vec3 col = mix(uFallback, tex, uHasTex);
  float rim = exp(-max(m, 0.0) / (uAA * 5.0)) * uHeat;
  col = col * (1.0 + uHeat * 0.25) + uGlow * rim * 1.2;
  gl_FragColor = vec4(col, cover * uAlpha);
}
`;

/** A wave rolling across the field along +x: body, curling crest and foam. */
export const TIDE_FRAG = /* glsl */ `
${HASH}
${NOISE}
varying vec2 vUv;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uAlpha;
uniform float uFront;
uniform float uTime;
uniform float uBody;
void main() {
  vec2 uv = vUv;
  float wobble = (fbm(vec2(uv.y * 5.0, uTime * 2.0)) - 0.5) * 0.09 + sin(uv.y * 13.0 + uTime * 6.0) * 0.012;
  float x = uv.x - (uFront + wobble);
  float body = smoothstep(0.02, -0.0, x) * smoothstep(-uBody, 0.0, x);
  float foam = exp(-pow((x + 0.012) / 0.03, 2.0));
  float lace = fbm(vec2(uv.x * 14.0 - uTime * 3.0, uv.y * 11.0));
  float ripples = 0.5 + 0.5 * sin((uv.x + uv.y * 0.3) * 60.0 - uTime * 9.0 + lace * 4.0);
  float spray = smoothstep(0.55, 0.9, lace) * exp(-pow((x + 0.04) / 0.07, 2.0));
  float edgeMask = smoothstep(0.0, 0.1, uv.y) * smoothstep(1.0, 0.9, uv.y);
  float a = (body * (0.42 + 0.22 * ripples) + foam * 0.85 + spray * 0.5) * edgeMask * uAlpha;
  vec3 c = mix(uColor, uColor2, clamp(foam + spray + ripples * body * 0.3, 0.0, 1.0));
  c = mix(c, vec3(1.0), clamp(foam * 0.7 + spray * 0.6, 0.0, 1.0));
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
}
`;

/** A dragon head in profile facing +x, as a glowing silhouette: a stylised Blue-Eyes breath. */
export const SIL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uAlpha;
uniform float uOpen;
uniform float uTime;
float seg(vec2 p, vec2 a, vec2 b, float w) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float k = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * k) - w;
}
float ell(vec2 p, vec2 c, vec2 r) {
  vec2 q = (p - c) / r;
  return (length(q) - 1.0) * min(r.x, r.y);
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float d = ell(p, vec2(-0.12, 0.02), vec2(0.5, 0.3));
  d = min(d, seg(p, vec2(0.2, 0.02), vec2(0.78, -0.02), 0.15));
  float jaw = uOpen * 0.22;
  d = min(d, seg(p, vec2(0.1, -0.2), vec2(0.72, -0.24 - jaw), 0.07));
  d = min(d, seg(p, vec2(-0.32, 0.22), vec2(-0.72, 0.62), 0.07));
  d = min(d, seg(p, vec2(-0.12, 0.28), vec2(-0.42, 0.78), 0.06));
  d = min(d, seg(p, vec2(-0.5, -0.05), vec2(-1.0, -0.42), 0.26));
  d = min(d, seg(p, vec2(-0.3, 0.3), vec2(-0.95, 0.1), 0.05));
  float fill = 1.0 - smoothstep(-0.02, 0.02, d);
  float rim = exp(-pow(d / 0.045, 2.0));
  float halo = exp(-max(d, 0.0) * 5.0) * 0.35;
  float eye = 1.0 - smoothstep(0.03, 0.07, length(p - vec2(0.16, 0.1)));
  float pulse = 0.85 + 0.15 * sin(uTime * 30.0);
  float edge = (1.0 - smoothstep(0.7, 1.0, abs(p.x))) * (1.0 - smoothstep(0.7, 1.0, abs(p.y)));
  float a = clamp(fill * 0.32 + rim * 0.9 + halo + eye, 0.0, 1.0) * uAlpha * pulse * edge;
  vec3 c = mix(uColor, uCore, clamp(rim + eye, 0.0, 1.0));
  gl_FragColor = vec4(c, a);
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
