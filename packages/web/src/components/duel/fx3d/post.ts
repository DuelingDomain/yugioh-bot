import * as THREE from "three";

/**
 * The full-screen post pass of the wipes (Dark Hole, Raigeki...). It is a port of the post pass of the
 * demo (.fx-demo/js/core.js) for a TRANSPARENT overlay canvas. It runs only while an effect that asks for
 * it plays (FxInstance.usesPost); every other frame is one plain render.
 *
 * How it works:
 *  1. The scene is drawn to a render target (premultiplied colour, no depth).
 *  2. One full-screen quad reads that target and writes the canvas (premultiplied, no blending):
 *     - WARPS move the pixels of the overlay: lens, shockwave, gust, wet ripples, chroma split, board shake.
 *     - GRADE (tint, desat, darken, invert, vignette) changes the pixels of the overlay and ALSO adds a
 *       semi-transparent veil UNDER them, so the page board below is dimmed in the same way. The veil is an
 *       approximation: it can darken and wash with a colour, it can not multiply by a colour.
 *     - HOLE (black disc and glow) is drawn OVER the scene.
 *     - SHOCK ring, wet glints and FLASH are added on top.
 *  The page board itself is never warped: only what the canvas draws is. Board shake is done on the page
 *  (see engine.ts) and on the canvas together.
 *
 * Units: every length uniform is in DEMO units, as in the demo (a fraction of an 800 unit high board).
 * `uK` (set by the wipe context) maps them to the real size of the board, so a demo number gives the same
 * look at any board size. `uCore`, `uShock.xy` and `uGust.x` are uv (0..1, y UP): use ctx.uv(x, y).
 */

const POST_VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;

const POST_FS = `
mat2 rot2(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}
float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vnoise(p);p*=2.03;a*=.5;}return s;}
uniform sampler2D tScene; uniform float uAspect, uTime, uK;
uniform vec4 uWet; uniform vec3 uShake; uniform vec2 uCore; uniform vec4 uLens, uHole, uShock; uniform vec3 uShock2, uShockCol, uHoleCol, uHoleCol2;
uniform float uAberr, uDarken, uDesat, uInvert, uVig, uClouds, uTintAmt; uniform vec4 uFlash; uniform vec3 uTint, uGust;
varying vec2 vUv;
vec2 toP(vec2 uv){return (uv-.5)*vec2(uAspect,1.)*uK;}
vec2 toUv(vec2 p){return p/(vec2(uAspect,1.)*uK)+.5;}
vec4 over(vec4 top, vec4 bot){return top + bot*(1.-top.a);}
void main(){
  vec2 p0 = toP(vUv);
  float cs = cos(uShake.z), sn = sin(uShake.z);
  vec2 p = mat2(cs,sn,-sn,cs)*p0 + uShake.xy;
  vec2 ps = p; vec2 c = toP(uCore);
  vec2 d = p - c; float r = length(d); float R = max(uLens.x,1e-3);
  if (uLens.y != 0. || uLens.z != 0.) {
    float k = exp(-pow(r/R,2.));
    d = rot2(uLens.z*k*k)*d;
    d *= 1. + uLens.y*k + uLens.w*exp(-pow(r/(R*.35),2.));
    ps = c + d;
  }
  vec2 sc = toP(uShock.xy); vec2 sd = p - sc; float sr = length(sd);
  if (uShock.w > 0.) {
    float x = (sr-uShock.z)/uShock.w;
    ps -= normalize(sd+vec2(1e-5))*exp(-x*x)*(-x)*2.*uShock2.x;
  }
  if (uGust.y > 0.) {
    float g = exp(-pow((vUv.x-uGust.x)/uGust.y,2.));
    ps.x -= g*uGust.z; ps.y += g*uGust.z*.45*sin(vUv.y*38.+uTime*24.);
  }
  if (uWet.x > 0. || uWet.y > 0.) {
    vec2 wq = p;
    vec2 w1 = vec2(vnoise(wq*7.+vec2(uTime*.8,uTime*1.1)), vnoise(wq*7.+vec2(5.2-uTime*.9,uTime*.7+1.3))) - .5;
    ps += w1*uWet.x*2.;
    ps.y += sin(p.x*9.+uTime*3.)*uWet.x*.35;
    vec2 rd = p - c; float rr = length(rd);
    ps += rd/(rr+1e-4)*sin(rr*70.-uTime*14.)*uWet.y*exp(-rr*1.4);
  }
  vec2 suv = toUv(ps);
  vec2 ab = (suv-uCore)*uAberr*.03;
  vec2 ua = suv+ab, ub = suv-ab;
  vec4 sr_ = texture2D(tScene,ua), sg_ = texture2D(tScene,suv), sb_ = texture2D(tScene,ub);
  float inA = step(0.,ua.x)*step(ua.x,1.)*step(0.,ua.y)*step(ua.y,1.);
  float inG = step(0.,suv.x)*step(suv.x,1.)*step(0.,suv.y)*step(suv.y,1.);
  float inB = step(0.,ub.x)*step(ub.x,1.)*step(0.,ub.y)*step(ub.y,1.);
  vec3 rgb = vec3(sr_.r*inA, sg_.g*inG, sb_.b*inB);
  float a = (sr_.a*inA + sg_.a*inG + sb_.a*inB)/3.;

  // grade the pixels of the overlay (premultiplied: these are linear in the colour)
  rgb = mix(rgb, rgb*uTint, uTintAmt);
  float l = dot(rgb, vec3(.3,.59,.11)); rgb = mix(rgb, vec3(l), uDesat);
  rgb *= 1. - uDarken;
  rgb = mix(rgb, vec3(a)-rgb, uInvert);
  float vg = smoothstep(.3,.95,length((vUv-.5)*vec2(1.,.9))*1.45);
  float vigA = max(uVig-.25,0.)*vg;
  rgb *= 1. - vigA;

  // the same grade as a veil UNDER the overlay: it dims and washes the page board
  vec4 V = vec4(0.);
  V = over(vec4(uTint*uTintAmt*.12, uTintAmt*.22), V);
  V = over(vec4(0.,0.,0.,uDarken), V);
  if (uClouds > 0.) {
    float n = fbm(vec2(vUv.x*3.+uTime*.12, vUv.y*2.2 - uTime*.05));
    float k = uClouds*(.35+.65*vUv.y);
    V = over(vec4(0.,0.,0.,k*(1.-(.2+.55*n))), V);
  }
  if (uWet.w > 0.) V = over(vec4(vec3(.03,.12,.3)*uWet.w, uWet.w*.3), V);
  V = over(vec4(0.,0.,0.,vigA), V);
  vec3 oc = rgb + V.rgb*(1.-a);
  float oa = a + V.a*(1.-a);

  // the hole is drawn over the scene
  if (uHole.x > 0.) {
    vec2 hd = p - c; float hr = length(hd); float ha = atan(hd.y,hd.x); float H0 = uHole.x;
    float ring = exp(-pow((hr-H0*1.1)/(H0*.2),2.));
    float arms = .55+.45*sin(ha*3.-hr/H0*9.+uTime*6.);
    float halo = exp(-max(hr-H0,0.)/(H0*.9))*.35;
    vec3 gl = uHoleCol*(ring*arms*1.6+halo) + uHoleCol2*exp(-pow((hr-H0)/(H0*.045),2.))*2.2;
    float disc = 1. - smoothstep(H0*.985,H0,hr);
    float da = disc*.985;
    vec3 hc = gl*uHole.y*(1.-disc);
    oc = hc + oc*(1.-da);
    oa = da + oa*(1.-da);
  }
  if (uShock.w > 0.) { float x = (sr-uShock.z)/(uShock.w*.55); oc += uShockCol*exp(-x*x)*uShock2.y; }
  if (uWet.z > 0.) {
    float cs2 = fbm(p*9.+vec2(uTime*.25,-uTime*.2)); float ln = pow(1.-abs(2.*cs2-1.), 6.);
    oc += vec3(.45,.8,1.)*ln*uWet.z;
  }
  oc += uFlash.rgb*uFlash.a;
  oa = max(oa, uFlash.a);
  gl_FragColor = vec4(oc, clamp(oa,0.,1.));
}`;

type Uniforms = Record<string, THREE.IUniform>;

/**
 * The uniforms the wipes write each frame. Names and meanings are the demo's (`P.uDarken.value = 0.3`).
 * `reset()` runs before every frame: a wipe sets what it needs and the rest is neutral.
 * Do not write `uShake` (the engine owns it), `tScene`, `uAspect`, `uTime` or `uK`.
 */
export type PostUniforms = {
  tScene: THREE.IUniform<THREE.Texture | null>;
  uAspect: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  /** Demo units to board size: demo units fraction of the screen height = `vh / (800 u)`. Set by the wipe context. */
  uK: THREE.IUniform<number>;
  uShake: THREE.IUniform<THREE.Vector3>;
  uCore: THREE.IUniform<THREE.Vector2>;
  uLens: THREE.IUniform<THREE.Vector4>;
  uHole: THREE.IUniform<THREE.Vector4>;
  uShock: THREE.IUniform<THREE.Vector4>;
  uShock2: THREE.IUniform<THREE.Vector3>;
  uShockCol: THREE.IUniform<THREE.Color>;
  uHoleCol: THREE.IUniform<THREE.Color>;
  uHoleCol2: THREE.IUniform<THREE.Color>;
  uAberr: THREE.IUniform<number>;
  uDarken: THREE.IUniform<number>;
  uDesat: THREE.IUniform<number>;
  uInvert: THREE.IUniform<number>;
  uVig: THREE.IUniform<number>;
  uClouds: THREE.IUniform<number>;
  uTintAmt: THREE.IUniform<number>;
  uFlash: THREE.IUniform<THREE.Vector4>;
  uTint: THREE.IUniform<THREE.Color>;
  uGust: THREE.IUniform<THREE.Vector3>;
  uWet: THREE.IUniform<THREE.Vector4>;
};

export function createPostUniforms(): PostUniforms {
  const v4 = (...a: [number, number, number, number]) => new THREE.Vector4(...a);
  const col = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
  return {
    tScene: { value: null },
    uAspect: { value: 1 },
    uTime: { value: 0 },
    uK: { value: 1 },
    uShake: { value: new THREE.Vector3() },
    uCore: { value: new THREE.Vector2(0.5, 0.5) },
    uLens: { value: v4(0.5, 0, 0, 0) },
    uHole: { value: v4(0, 0, 0, 0) },
    uShock: { value: v4(0.5, 0.5, 0, 0) },
    uShock2: { value: new THREE.Vector3() },
    uShockCol: { value: col(1, 1, 1) },
    uHoleCol: { value: col(0.62, 0.25, 1) },
    uHoleCol2: { value: col(1, 0.85, 1) },
    uAberr: { value: 0 },
    uDarken: { value: 0 },
    uDesat: { value: 0 },
    uInvert: { value: 0 },
    uVig: { value: 0.25 },
    uClouds: { value: 0 },
    uTintAmt: { value: 0 },
    uFlash: { value: v4(1, 1, 1, 0) },
    uTint: { value: col(1, 1, 1) },
    uGust: { value: new THREE.Vector3() },
    uWet: { value: v4(0, 0, 0, 0) },
  };
}

/** Neutral values for every uniform a wipe may write (not the engine ones: tScene, uAspect, uTime, uK, uShake). */
export function resetPostUniforms(u: PostUniforms): void {
  u.uCore.value.set(0.5, 0.5);
  u.uLens.value.set(0.5, 0, 0, 0);
  u.uHole.value.set(0, 0, 0, 0);
  u.uShock.value.set(0.5, 0.5, 0, 0);
  u.uShock2.value.set(0, 0, 0);
  u.uShockCol.value.setRGB(1, 1, 1);
  u.uHoleCol.value.setRGB(0.62, 0.25, 1);
  u.uHoleCol2.value.setRGB(1, 0.85, 1);
  u.uAberr.value = 0;
  u.uDarken.value = 0;
  u.uDesat.value = 0;
  u.uInvert.value = 0;
  u.uVig.value = 0.25;
  u.uClouds.value = 0;
  u.uTintAmt.value = 0;
  u.uFlash.value.set(1, 1, 1, 0);
  u.uTint.value.setRGB(1, 1, 1);
  u.uGust.value.set(0, 0, 0);
  u.uWet.value.set(0, 0, 0, 0);
}

/** The GPU side of the pass: made on the first frame that needs it, dropped with the engine. */
export class PostPass {
  readonly uniforms: PostUniforms = createPostUniforms();
  private target: THREE.WebGLRenderTarget | null = null;
  private quad: THREE.Mesh | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new THREE.Vector2();
  private broken = false;

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  /** False when the pass could not be built (the engine then draws the plain scene). */
  get usable(): boolean {
    return !this.broken;
  }

  reset(): void {
    resetPostUniforms(this.uniforms);
    this.uniforms.uShake.value.set(0, 0, 0);
  }

  private ensure(): boolean {
    if (this.broken) return false;
    try {
      this.renderer.getDrawingBufferSize(this.size);
      const w = Math.max(1, Math.floor(this.size.x));
      const h = Math.max(1, Math.floor(this.size.y));
      if (!this.target) {
        this.target = new THREE.WebGLRenderTarget(w, h, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
          stencilBuffer: false,
          generateMipmaps: false,
        });
        this.target.texture.colorSpace = THREE.NoColorSpace;
        this.uniforms.tScene.value = this.target.texture;
        this.quad = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          new THREE.ShaderMaterial({
            uniforms: this.uniforms as unknown as Uniforms,
            vertexShader: POST_VS,
            fragmentShader: POST_FS,
            blending: THREE.NoBlending,
            transparent: false,
            depthTest: false,
            depthWrite: false,
          }),
        );
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
      } else if (this.target.width !== w || this.target.height !== h) {
        this.target.setSize(w, h);
      }
      return true;
    } catch (error) {
      console.warn("[fx3d] post pass unavailable", error);
      this.broken = true;
      return false;
    }
  }

  /** Draws `scene` through the pass. Returns false when it could not (nothing was drawn). */
  render(scene: THREE.Scene, camera: THREE.Camera, timeSec: number, aspect: number): boolean {
    if (!this.ensure() || !this.target) return false;
    this.uniforms.uTime.value = timeSec;
    this.uniforms.uAspect.value = aspect;
    const r = this.renderer;
    try {
      r.setRenderTarget(this.target);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(scene, camera);
      r.setRenderTarget(null);
      r.clear();
      r.render(this.scene, this.camera);
      return true;
    } catch (error) {
      r.setRenderTarget(null);
      console.warn("[fx3d] post pass failed", error);
      this.broken = true;
      return false;
    }
  }

  dispose(): void {
    this.target?.dispose();
    if (this.quad) {
      this.quad.geometry.dispose();
      (this.quad.material as THREE.ShaderMaterial).dispose();
    }
    this.target = null;
    this.quad = null;
  }
}
