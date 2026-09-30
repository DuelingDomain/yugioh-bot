import * as THREE from "three";
import type { ArtStore } from "../art";
import { rectToWorld } from "../coords";
import type { FxKit, ParticleSet, ShaderName } from "../kit";
import type { FxRequest, FxTint, Rgb } from "../types";

/** What an effect gets from the engine. */
export type FxEnv = {
  kit: FxKit;
  /** The scene group the effect adds its objects to. */
  group: THREE.Group;
  view: { w: number; h: number };
  /** 1 at full quality; lower when the frame rate drops (fewer particles). */
  quality: number;
  art: ArtStore;
};

/** A running effect. `update` gets seconds since the start; the engine disposes it when `durationMs` has passed. */
export interface FxInstance {
  readonly durationMs: number;
  update(sec: number): void;
  dispose(): void;
}

export type FxFactory = (env: FxEnv, request: FxRequest) => FxInstance;

/** One animated piece of an effect. */
export type FxPart = { update(sec: number): void };

export const DEFAULT_TINT: FxTint = { main: [1, 0.9, 0.6], alt: [0.6, 0.5, 1], accent: [1, 1, 1] };

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
    this.tint = request.tint ?? DEFAULT_TINT;
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
