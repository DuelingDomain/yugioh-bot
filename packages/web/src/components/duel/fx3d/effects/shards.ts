import type * as THREE from "three";
import { layoutShards, type CutKind, type ShardPiece } from "../shard-layout";
import { shardAt, shardMotion, type MotionMode, type ShardMotion } from "../shard-motion";
import type { FxAttackStyle, FxRect, FxTint, Rgb } from "../types";
import { setColor, type FxPart } from "./base";
import { burst } from "./parts";
import { centreOf, hot, pool, ring, type P, Stage } from "./draw";

/**
 * A destroyed card breaking into shards. The card is cut by `layoutShards`, every triangle is a
 * card-sized quad that the shard shader trims to the triangle and textures with the card art, and
 * the pieces fly on the paths of `shard-motion`. Times are seconds from the start of the effect.
 */

export type CardBreakOptions = {
  rect: FxRect;
  code: number;
  defense: boolean;
  /** Seconds. The card is whole (and hidden here: the page still shows it) until then. */
  at: number;
  /** Unit vector of the blow, y down. */
  dir: P;
  cut: CutKind;
  tint: FxTint;
  seed: number;
  mode?: MotionMode;
  /** "suck": the point the pieces fall into, canvas px, y down. */
  pull?: P;
  detail?: number;
  /** Sparks, flash and ring at the break. */
  flare?: boolean;
  glow?: Rgb;
};

type ShardMesh = { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; piece: ShardPiece; index: number };

export function cutOf(style: FxAttackStyle): CutKind {
  return style;
}

/** Card size on screen and the turn of a card that lies sideways. */
export function cardGeometry(rect: FxRect, defense: boolean): { w: number; h: number; base: number } {
  if (defense && rect.w >= rect.h) return { w: rect.h, h: rect.w, base: Math.PI / 2 };
  return { w: rect.w, h: rect.h, base: 0 };
}

export function cardBreak(st: Stage, o: CardBreakOptions): FxPart[] {
  const geo = cardGeometry(o.rect, o.defense);
  if (o.code > 0) st.rig.env.art.prefetch(o.code);
  const centre = centreOf(o.rect);
  const at = st.off(centre);
  const pieces = layoutShards(o.cut, o.seed, o.detail ?? 1);
  // The blow direction and pull point are on screen; the motion works in the card's frame rotated by `base`.
  const cos = Math.cos(-geo.base);
  const sin = Math.sin(-geo.base);
  const local = (v: P): P => ({ x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos });
  const dirLocal = local(o.dir);
  const pull = o.pull ? local({ x: o.pull.x - centre.x, y: o.pull.y - centre.y }) : undefined;
  const motions: ShardMotion[] = [];
  const meshes: ShardMesh[] = [];
  const fallback: Rgb = [0.16, 0.12, 0.2];
  const glow: Rgb = o.glow ?? o.tint.accent;
  pieces.forEach((piece, index) => {
    motions.push(shardMotion(piece, { kind: o.cut, w: geo.w, h: geo.h, dir: dirLocal, mode: o.mode, pull, seed: o.seed }, index));
    for (const tri of piece.tris) {
      const mesh = st.rig.mesh("shard", { x: at.x, y: at.y, w: geo.w, h: geo.h, rot: geo.base });
      const u = mesh.material.uniforms;
      u.uV0.value.set(tri[0][0], tri[0][1]);
      u.uV1.value.set(tri[1][0], tri[1][1]);
      u.uV2.value.set(tri[2][0], tri[2][1]);
      setColor(u.uFallback, fallback);
      setColor(u.uGlow, glow);
      u.uAA.value = 1.2 / Math.max(20, Math.min(geo.w, geo.h));
      mesh.visible = false;
      meshes.push({ mesh, piece, index });
    }
  });
  const cosB = Math.cos(geo.base);
  const sinB = Math.sin(geo.base);
  let textured = false;
  const parts: FxPart[] = [
    {
      update(sec) {
        const t = sec - o.at;
        const live = t >= 0;
        if (live && !textured) {
          const tex = o.code > 0 ? st.rig.env.art.peek(o.code) : null;
          if (tex) {
            for (const s of meshes) {
              s.mesh.material.uniforms.uTex.value = tex;
              s.mesh.material.uniforms.uHasTex.value = 1;
            }
            textured = true;
          }
        }
        for (const s of meshes) {
          const m = motions[s.index];
          const state = shardAt(m, t);
          const visible = live && state.alpha > 0.01;
          s.mesh.visible = visible;
          if (!visible) continue;
          // Piece centroid relative to the card centre, y up, turned by the card's base rotation.
          const lx = (s.piece.cx - 0.5) * geo.w;
          const ly = -(s.piece.cy - 0.5) * geo.h;
          const wx = lx * cosB - ly * sinB;
          const wy = lx * sinB + ly * cosB;
          const c = Math.cos(state.rot);
          const sn = Math.sin(state.rot);
          s.mesh.position.set(
            st.rig.cx + at.x + state.dx + wx - state.scale * (wx * c - wy * sn),
            st.rig.cy + at.y + state.dy + wy - state.scale * (wx * sn + wy * c),
            0,
          );
          s.mesh.scale.set(geo.w * state.scale, geo.h * state.scale, 1);
          s.mesh.rotation.z = geo.base + state.rot;
          const u = s.mesh.material.uniforms;
          u.uAlpha.value = state.alpha;
          u.uHeat.value = state.heat;
        }
      },
    },
  ];
  if (o.flare !== false) {
    const size = Math.max(geo.w, geo.h);
    parts.push(pool(st, centre, { at: o.at, dur: 0.32, size: size * 2.2, color: hot(glow, 0.3), peak: 0.75 }));
    parts.push(ring(st, centre, { at: o.at, dur: 0.4, from: size * 0.4, to: size * 2.2, color: glow, width: 0.05, peak: 0.7 }));
    parts.push(
      burst(st.rig, {
        at: o.at,
        count: 22,
        speed: [120, 420],
        life: [0.3, 0.7],
        size: [3, 8],
        colors: [glow, hot(glow, 0.6), o.tint.main],
        shape: "chunk",
        kind: "solid",
        gravity: [0, -900],
        radius: size * 0.12,
        seed: 40 + o.seed,
        x: at.x,
        y: at.y,
      }),
    );
  }
  return parts;
}
