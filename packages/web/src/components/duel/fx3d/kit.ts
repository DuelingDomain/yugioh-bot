import * as THREE from "three";
import {
  ARC_FRAG,
  ARROW_FRAG,
  BOLT_FRAG,
  CIRCUIT_FRAG,
  DECAL_FRAG,
  FLAME_FRAG,
  HAZE_FRAG,
  SHARD_FRAG,
  SIL_FRAG,
  TIDE_FRAG,
  GLOW_FRAG,
  PILLAR_FRAG,
  PORTRAIT_FRAG,
  POINTS_FRAG,
  POINTS_VERT,
  QUAD_VERT,
  RING_FRAG,
  RIPPLE_FRAG,
  RUNE_FRAG,
  VORTEX_FRAG,
} from "./shaders";
import type { Rgb } from "./types";

/**
 * The shared resources of one canvas: one unit quad, pools of shader materials, and pools of GPU
 * particle sets. Effects borrow from the pools and give back when they end, so a summon after the
 * first one compiles nothing and allocates no GPU buffer.
 */

type UniformMap = Record<string, THREE.IUniform>;

type ShaderDef = {
  vertex: string;
  fragment: string;
  blending: THREE.Blending;
  uniforms: () => UniformMap;
};

const u = <T,>(value: T): THREE.IUniform<T> => ({ value });
const v3 = (r: number, g: number, b: number) => new THREE.Vector3(r, g, b);

const SHADERS = {
  ring: {
    vertex: QUAD_VERT,
    fragment: RING_FRAG,
    blending: THREE.AdditiveBlending,
    uniforms: () => ({ uColor: u(v3(1, 1, 1)), uAlpha: u(1), uRadius: u(0.8), uWidth: u(0.06), uSoft: u(0.08) }),
  },
  ripple: {
    vertex: QUAD_VERT,
    fragment: RIPPLE_FRAG,
    blending: THREE.NormalBlending,
    uniforms: () => ({ uColor: u(v3(1, 1, 1)), uAlpha: u(1), uFront: u(0), uBand: u(0.2), uAmp: u(1), uGlow: u(1) }),
  },
  glow: {
    vertex: QUAD_VERT,
    fragment: GLOW_FRAG,
    blending: THREE.AdditiveBlending,
    uniforms: () => ({ uColor: u(v3(1, 1, 1)), uAlpha: u(1), uPow: u(2) }),
  },
  pillar: {
    vertex: QUAD_VERT,
    fragment: PILLAR_FRAG,
    blending: THREE.AdditiveBlending,
    uniforms: () => ({
      uColor: u(v3(1, 1, 1)),
      uColor2: u(v3(1, 1, 1)),
      uAlpha: u(1),
      uGrow: u(1),
      uTime: u(0),
      uWidth: u(0.5),
      uSided: u(0),
      uRainbow: u(0),
    }),
  },
  vortex: {
    vertex: QUAD_VERT,
    fragment: VORTEX_FRAG,
    blending: THREE.AdditiveBlending,
    uniforms: () => ({
      uColor: u(v3(1, 1, 1)),
      uColor2: u(v3(0.5, 0.5, 1)),
      uTime: u(0),
      uAlpha: u(1),
      uArms: u(3),
      uTwist: u(6),
      uSpin: u(4),
      uHole: u(0.05),
      uDark: u(0),
    }),
  },
  galaxy: {
    vertex: QUAD_VERT,
    fragment: VORTEX_FRAG,
    blending: THREE.NormalBlending,
    uniforms: () => ({
      uColor: u(v3(1, 0.85, 0.4)),
      uColor2: u(v3(0.4, 0.3, 0.8)),
      uTime: u(0),
      uAlpha: u(1),
      uArms: u(2),
      uTwist: u(7),
      uSpin: u(2),
      uHole: u(0.02),
      uDark: u(1),
    }),
  },
  circuit: {
    vertex: QUAD_VERT,
    fragment: CIRCUIT_FRAG,
    blending: THREE.AdditiveBlending,
    uniforms: () => ({
      uColor: u(v3(0.3, 0.6, 1)),
      uColor2: u(v3(0.7, 0.95, 1)),
      uAlpha: u(1),
      uFront: u(1),
      uCells: u(16),
      uSeed: u(0),
      uLine: u(0.07),
    }),
  },
  arrow: {
    vertex: QUAD_VERT,
    fragment: ARROW_FRAG,
    blending: THREE.AdditiveBlending,
    uniforms: () => ({ uColor: u(v3(0.4, 0.8, 1)), uAlpha: u(0) }),
  },
  rune: {
    vertex: QUAD_VERT,
    fragment: RUNE_FRAG,
    blending: THREE.AdditiveBlending,
    uniforms: () => ({
      uColor: u(v3(0.5, 0.75, 1)),
      uColor2: u(v3(0.85, 0.95, 1)),
      uTime: u(0),
      uAlpha: u(1),
      uRadius: u(0.7),
      uWidth: u(0.12),
      uSegs: u(20),
      uReveal: u(1),
      uSpin: u(0.05),
    }),
  },
  portrait: {
    vertex: QUAD_VERT,
    fragment: PORTRAIT_FRAG,
    blending: THREE.NormalBlending,
    uniforms: () => ({
      uTex: u<THREE.Texture | null>(null),
      uCrop: u(new THREE.Vector4(0, 0, 1, 1)),
      uRim: u(v3(1, 1, 1)),
      uHasTex: u(0),
      uAlpha: u(1),
      uReveal: u(1),
      uTime: u(0),
      uFlash: u(0),
    }),
  },
  bolt: {
    vertex: QUAD_VERT,
    fragment: BOLT_FRAG,
    blending: THREE.AdditiveBlending,
    uniforms: () => ({
      uPts: u(Array.from({ length: 12 }, () => new THREE.Vector2())),
      uCount: u(2),
      uSize: u(new THREE.Vector2(100, 100)),
      uWidth: u(4),
      uColor: u(v3(1, 1, 1)),
      uCore: u(v3(1, 1, 1)),
      uAlpha: u(1),
      uReveal: u(1.05),
      uTail: u(0),
      uFlick: u(0),
      uTime: u(0),
      uDash: u(0),
      uTaper: u(0),
      uBloom: u(0.35),
    }),
  },
  arc: {
    vertex: QUAD_VERT,
    fragment: ARC_FRAG,
    blending: THREE.AdditiveBlending,
    uniforms: () => ({ uColor: u(v3(1, 1, 1)), uCore: u(v3(1, 1, 1)), uAlpha: u(1), uReveal: u(1.05), uTail: u(0), uThick: u(0.3) }),
  },
  flame: {
    vertex: QUAD_VERT,
    fragment: FLAME_FRAG,
    blending: THREE.AdditiveBlending,
    uniforms: () => ({ uColor: u(v3(1, 0.5, 0.1)), uColor2: u(v3(0.8, 0.1, 0.02)), uTime: u(0), uAlpha: u(1), uTailLen: u(1) }),
  },
  haze: {
    vertex: QUAD_VERT,
    fragment: HAZE_FRAG,
    blending: THREE.NormalBlending,
    uniforms: () => ({ uColor: u(v3(1, 0.6, 0.3)), uAlpha: u(1), uTime: u(0) }),
  },
  decal: {
    vertex: QUAD_VERT,
    fragment: DECAL_FRAG,
    blending: THREE.NormalBlending,
    uniforms: () => ({ uColor: u(v3(1, 0.5, 0.2)), uAlpha: u(1), uKind: u(0), uSeed: u(0), uOpen: u(1), uEmber: u(1) }),
  },
  shard: {
    vertex: QUAD_VERT,
    fragment: SHARD_FRAG,
    blending: THREE.NormalBlending,
    uniforms: () => ({
      uTex: u<THREE.Texture | null>(null),
      uHasTex: u(0),
      uV0: u(new THREE.Vector2()),
      uV1: u(new THREE.Vector2()),
      uV2: u(new THREE.Vector2()),
      uFallback: u(v3(0.16, 0.12, 0.2)),
      uGlow: u(v3(1, 0.8, 0.5)),
      uHeat: u(0),
      uAlpha: u(1),
      uAA: u(0.01),
    }),
  },
  tide: {
    vertex: QUAD_VERT,
    fragment: TIDE_FRAG,
    blending: THREE.NormalBlending,
    uniforms: () => ({ uColor: u(v3(0.1, 0.4, 0.8)), uColor2: u(v3(0.6, 0.9, 1)), uAlpha: u(1), uFront: u(-0.2), uTime: u(0), uBody: u(0.6) }),
  },
  sil: {
    vertex: QUAD_VERT,
    fragment: SIL_FRAG,
    blending: THREE.AdditiveBlending,
    uniforms: () => ({ uColor: u(v3(0.6, 0.85, 1)), uCore: u(v3(1, 1, 1)), uAlpha: u(1), uOpen: u(0), uTime: u(0) }),
  },
  pointsAdd: {
    vertex: POINTS_VERT,
    fragment: POINTS_FRAG,
    blending: THREE.AdditiveBlending,
    uniforms: () => pointUniforms(),
  },
  pointsSolid: {
    vertex: POINTS_VERT,
    fragment: POINTS_FRAG,
    blending: THREE.NormalBlending,
    uniforms: () => pointUniforms(),
  },
} satisfies Record<string, ShaderDef>;

function pointUniforms(): UniformMap {
  return {
    uTime: u(0),
    uAlpha: u(1),
    uShrink: u(1),
    uShape: u(0),
    uGravity: u(v3(0, 0, 0)),
    uSwirl: u(new THREE.Vector4(0, 0, 0, 0)),
  };
}

export type ShaderName = keyof typeof SHADERS;

/** A batch of GPU particles. Fill it with `set`, call `commit`, then move `points` to the effect origin. */
export class ParticleSet {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly param: Float32Array;
  private readonly color: Float32Array;
  count = 0;

  constructor(readonly capacity: number) {
    const geometry = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.param = new Float32Array(capacity * 4);
    this.color = new Float32Array(capacity * 4);
    geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geometry.setAttribute("aVel", new THREE.BufferAttribute(this.vel, 3));
    geometry.setAttribute("aParam", new THREE.BufferAttribute(this.param, 4));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.color, 4));
    geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(geometry);
    // Positions come from the vertex shader, so the CPU-side bounds mean nothing.
    this.points.frustumCulled = false;
  }

  /** Adds one particle; ignored when the set is full. Positions are pixels around the effect origin, y up. */
  add(p: {
    x: number;
    y: number;
    vx?: number;
    vy?: number;
    birth: number;
    life: number;
    size: number;
    seed: number;
    color: Rgb;
    weight?: number;
  }): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.pos.set([p.x, p.y, 0], i * 3);
    this.vel.set([p.vx ?? 0, p.vy ?? 0, 0], i * 3);
    this.param.set([p.birth, p.life, p.size, p.seed], i * 4);
    this.color.set([p.color[0], p.color[1], p.color[2], p.weight ?? 1], i * 4);
  }

  commit(): void {
    const geometry = this.points.geometry;
    for (const name of ["position", "aVel", "aParam", "aColor"]) {
      const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.needsUpdate = true;
    }
    geometry.setDrawRange(0, this.count);
  }

  reset(): void {
    this.count = 0;
    this.param.fill(0);
    this.points.geometry.setDrawRange(0, 0);
    this.points.removeFromParent();
  }

  dispose(): void {
    this.points.geometry.dispose();
  }
}

const POINT_BUCKETS = [32, 64, 128, 256, 512];

export class FxKit {
  readonly quad = new THREE.PlaneGeometry(1, 1);
  /** Device pixels per CSS pixel; every point material reads it. */
  readonly dpr: THREE.IUniform<number> = { value: 1 };
  private readonly materials = new Map<ShaderName, THREE.ShaderMaterial[]>();
  private readonly sets = new Map<number, ParticleSet[]>();
  private readonly everything = new Set<THREE.ShaderMaterial>();
  private readonly allSets = new Set<ParticleSet>();

  private make(name: ShaderName): THREE.ShaderMaterial {
    const def: ShaderDef = SHADERS[name];
    const material = new THREE.ShaderMaterial({
      vertexShader: def.vertex,
      fragmentShader: def.fragment,
      uniforms: { ...def.uniforms(), ...(name.startsWith("points") ? { uDpr: this.dpr } : {}) },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: def.blending,
      side: THREE.DoubleSide,
    });
    this.everything.add(material);
    return material;
  }

  /** A material with default uniforms; give it back with `release`. */
  material(name: ShaderName): THREE.ShaderMaterial {
    return this.materials.get(name)?.pop() ?? this.make(name);
  }

  release(name: ShaderName, material: THREE.ShaderMaterial): void {
    const fresh: UniformMap = SHADERS[name].uniforms();
    for (const key of Object.keys(fresh)) {
      const target = material.uniforms[key];
      if (target) target.value = fresh[key].value;
    }
    const list = this.materials.get(name) ?? [];
    list.push(material);
    this.materials.set(name, list);
  }

  /** A quad mesh (unit size, centred) with a pooled material. */
  mesh(name: ShaderName): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    const mesh = new THREE.Mesh(this.quad, this.material(name));
    mesh.frustumCulled = false;
    return mesh;
  }

  releaseMesh(name: ShaderName, mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>): void {
    mesh.removeFromParent();
    this.release(name, mesh.material);
  }

  /** A particle set with room for at least `count` particles, and a pooled material. */
  particles(count: number, kind: "add" | "solid" = "add"): { set: ParticleSet; material: THREE.ShaderMaterial } {
    const capacity = POINT_BUCKETS.find((size) => size >= count) ?? POINT_BUCKETS[POINT_BUCKETS.length - 1];
    const set = this.sets.get(capacity)?.pop() ?? this.newSet(capacity);
    const material = this.material(kind === "add" ? "pointsAdd" : "pointsSolid");
    set.points.material = material;
    return { set, material };
  }

  releaseParticles(set: ParticleSet, kind: "add" | "solid"): void {
    this.release(kind === "add" ? "pointsAdd" : "pointsSolid", set.points.material as THREE.ShaderMaterial);
    set.reset();
    const list = this.sets.get(set.capacity) ?? [];
    list.push(set);
    this.sets.set(set.capacity, list);
  }

  private newSet(capacity: number): ParticleSet {
    const set = new ParticleSet(capacity);
    this.allSets.add(set);
    return set;
  }

  dispose(): void {
    this.quad.dispose();
    for (const material of this.everything) material.dispose();
    for (const set of this.allSets) set.dispose();
    this.everything.clear();
    this.allSets.clear();
    this.materials.clear();
    this.sets.clear();
  }
}
