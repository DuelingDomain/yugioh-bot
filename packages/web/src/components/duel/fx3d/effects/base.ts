import * as THREE from "three";
import type { ArtStore } from "../art";
import { rectToWorld } from "../coords";
import type { FxKit, ParticleSet, ShaderName } from "../kit";
import type { PostUniforms } from "../post";
import type { Fx3dPalette, FxRequest, FxTint, Rgb } from "../types";

/** What an effect gets from the engine. */
export type FxEnv = {
  kit: FxKit;
  /** The scene group the effect adds its objects to. */
  group: THREE.Group;
  view: { w: number; h: number };
  /** 1 at full quality; lower when the frame rate drops (fewer particles). */
  quality: number;
  art: ArtStore;
  /** The uniforms of the full-screen post pass (see post.ts). Written only by instances with `usesPost`. */
  post: PostUniforms;
  /** Table tilt in degrees (CSS rotateX of the board plane). 0 = flat, the V1 output. */
  tilt?: number;
  /** Colour set for the gold and purple projector lights. Default "v1". */
  palette?: Fx3dPalette;
};

/** Board shake of one frame: CSS px (x right, y DOWN) and radians (clockwise). The engine applies it to the page board and the canvas. */
export type FxShake = { x: number; y: number; rot: number };

/** A running effect. `update` gets seconds since the start; the engine disposes it when `durationMs` has passed. */
export interface FxInstance {
  readonly durationMs: number;
  /** The effect draws through the post pass (lens, shock, flash...). The engine resets the post uniforms before each `update`. */
  readonly usesPost?: boolean;
  /** Board shake at `sec` (before the shake preference is applied: the engine scales it by `request.shake` and clamps it). */
  shake?(sec: number): FxShake;
  update(sec: number): void;
  dispose(): void;
}

export type FxFactory = (env: FxEnv, request: FxRequest) => FxInstance;

/** One animated piece of an effect. */
export type FxPart = { update(sec: number): void };

export const DEFAULT_TINT: FxTint = { main: [1, 0.9, 0.6], alt: [0.6, 0.5, 1], accent: [1, 1, 1] };

const hex = (value: number): Rgb => [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];

/**
 * The gold and purple lights of each palette. "v1" is the classic look (the values the effects always used);
 * "solid" is the Solid Vision table: gold #c8a55f / #e8cf94, purple #8f76f2 / #b8a8ff, loss red #f27a6b.
 * A palette changes colours only: never a duration, an order or a route.
 */
export const PALETTES: Record<Fx3dPalette, { gold: Rgb; goldHi: Rgb; purple: Rgb; purpleHi: Rgb; loss: Rgb; tint: FxTint }> = {
  v1: { gold: [1, 0.8, 0.32], goldHi: [1, 0.9, 0.6], purple: [0.66, 0.42, 1], purpleHi: [0.7, 0.4, 1], loss: [1, 0.15, 0.1], tint: DEFAULT_TINT },
  solid: {
    gold: hex(0xc8a55f),
    goldHi: hex(0xe8cf94),
    purple: hex(0x8f76f2),
    purpleHi: hex(0xb8a8ff),
    loss: hex(0xf27a6b),
    tint: { main: hex(0xe8cf94), alt: hex(0xb8a8ff), accent: [1, 1, 1] },
  },
};

/** Ground-plane shaders: they lie on the table, so a tilted table squashes them. Billboards and cards stay screen-facing. */
const GROUND_SHADERS: ReadonlySet<ShaderName> = new Set<ShaderName>(["ring", "ripple", "rune", "decal", "vortex", "galaxy"]);

/** Radians of the -tilt rotation about X for a tilt in degrees (0 when flat or not finite). */
export function groundTiltRad(deg: number | undefined): number {
  return deg && Number.isFinite(deg) ? (-deg * Math.PI) / 180 : 0;
}

type QuadMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

/**
 * The scene objects of one effect, placed around one origin: the centre of the zone. Offsets are in
 * CSS pixels from that centre with y UP. Everything borrowed from the kit goes back on `dispose`.
 */
export class Rig {
  readonly cx: number;
  readonly cy: number;
  /** World rectangle of the zone (centre, size). */
  readonly w: number;
  readonly h: number;
  readonly tint: FxTint;
  readonly strength: number;
  readonly shake: number;
  readonly palette: Fx3dPalette;
  /** Rotation about X (radians) of ground meshes; 0 on a flat table. */
  private readonly groundTilt: number;
  private readonly meshes: Array<[ShaderName, QuadMesh]> = [];
  private readonly sets: Array<[ParticleSet, "add" | "solid"]> = [];
  private order = 0;

  constructor(
    readonly env: FxEnv,
    readonly request: FxRequest,
  ) {
    const world = rectToWorld(request.rect, env.view);
    this.cx = world.cx;
    this.cy = world.cy;
    this.w = Math.max(8, world.w);
    this.h = Math.max(8, world.h);
    this.palette = env.palette ?? "v1";
    this.groundTilt = groundTiltRad(env.tilt);
    this.tint = request.tint ?? PALETTES[this.palette].tint;
    this.strength = Math.min(1.6, Math.max(0.6, request.strength ?? 1));
    this.shake = Math.max(0, request.shake ?? 1);
  }

  /** Scaled particle count: quality lowers it, never below a handful. */
  count(n: number): number {
    return Math.max(6, Math.round(n * this.env.quality));
  }

  mesh(name: ShaderName, o: { x?: number; y?: number; w: number; h?: number; rot?: number }): QuadMesh {
    const mesh = this.env.kit.mesh(name);
    mesh.position.set(this.cx + (o.x ?? 0), this.cy + (o.y ?? 0), 0);
    mesh.scale.set(o.w, o.h ?? o.w, 1);
    mesh.rotation.z = o.rot ?? 0;
    // Euler XYZ turns in the quad's own plane first (z), then lays it into the table plane (x).
    mesh.rotation.x = GROUND_SHADERS.has(name) ? this.groundTilt : 0;
    mesh.renderOrder = this.order++;
    this.env.group.add(mesh);
    this.meshes.push([name, mesh]);
    return mesh;
  }

  points(count: number, kind: "add" | "solid" = "add"): { set: ParticleSet; material: THREE.ShaderMaterial } {
    const made = this.env.kit.particles(count, kind);
    made.set.points.position.set(this.cx, this.cy, 0);
    made.set.points.renderOrder = this.order++;
    this.env.group.add(made.set.points);
    this.sets.push([made.set, kind]);
    return made;
  }

  dispose(): void {
    for (const [name, mesh] of this.meshes) this.env.kit.releaseMesh(name, mesh);
    for (const [set, kind] of this.sets) this.env.kit.releaseParticles(set, kind);
    this.meshes.length = 0;
    this.sets.length = 0;
  }
}

export function setColor(uniform: THREE.IUniform<THREE.Vector3>, color: Rgb, scale = 1): void {
  uniform.value.set(color[0] * scale, color[1] * scale, color[2] * scale);
}

/** Builds an effect from a list of parts; the engine calls `update` each frame. */
export function compose(rig: Rig, parts: FxPart[], durationMs: number): FxInstance {
  return {
    durationMs,
    update(sec) {
      for (const part of parts) part.update(sec);
    },
    dispose() {
      rig.dispose();
    },
  };
}

/** A random colour near `base`, a little lighter or darker. */
export function jitter(base: Rgb, rand: () => number, amount = 0.2): Rgb {
  const k = 1 - amount / 2 + rand() * amount;
  return [Math.min(1, base[0] * k), Math.min(1, base[1] * k), Math.min(1, base[2] * k)];
}
