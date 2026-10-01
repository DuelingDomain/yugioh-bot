import { clamp01, easeOutCubic, ramp } from "../ease";
import { BOTTOMLESS_OPEN_MS, MIRROR_RISE_MS, MONSTER_TRAVEL_MS, SAKURETSU_BOOM_MS, SAKURETSU_SLAM_MS, SPELL_SIGIL_MS, TRAP_CHAIN_MS, TRAP_GLYPH_MS, TRAP_HOLE_OPEN_MS, mirrorBarrier, mirrorHitPoint } from "../scene-plan";
import type { CutKind } from "../shard-layout";
import type { FxScene, FxVictim, Rgb } from "../types";
import { compose, setColor, type FxFactory, type FxPart } from "./base";
import { buildBanish } from "./wipes/banish";
import { wipeFactory } from "./wipes/common";
import { buildDarkHole } from "./wipes/darkhole";
import { buildRaigeki } from "./wipes/raigeki";
import { buildShock } from "./wipes/shock";
import { buildStorm } from "./wipes/storm";
import { buildTorrential } from "./wipes/torrential";
import {
  bolt,
  centreOf,
  decal,
  dirOf,
  edgeOf,
  hot,
  jagged,
  lerpP,
  orb,
  pool,
  ring,
  runeCircle,
  sparks,
  Stage,
  timedMesh,
  wave,
  WHITE,
  type P,
} from "./draw";
import { cardBreak } from "./shards";

/**
 * The set pieces of trap and effect destroys. Each piece is built ground first (marks, pits,
 * ripples), then the card shards, then the light on top, so shards fall into pits and light covers
 * shards. Times come from `scene-plan` (`victim.atMs`, `hitMs`); this file only draws.
 */

const sec = (ms: number): number => ms / 1000;

type Ctx = { st: Stage; scene: FxScene; tint: FxScene["tint"]; centre: P; u: number; last: number };

const cardSize = (v: FxVictim): number => Math.max(v.rect.w, v.rect.h);

/** Which way the blow pushes the pieces of a victim (unit, y down). */
function pushDir(c: Ctx, v: FxVictim, from: P | null): P {
  const at = centreOf(v.rect);
  if (from) return dirOf(from, at);
  return dirOf(c.centre, at);
}

function breaks(c: Ctx, cut: CutKind, o: { dir?: (v: FxVictim) => P; mode?: "burst" | "suck" | "sink"; pull?: P; glow?: Rgb; flare?: boolean }): FxPart[] {
  const parts: FxPart[] = [];
  const n = c.scene.victims.length;
  c.scene.victims.forEach((v, i) => {
    parts.push(
      ...cardBreak(c.st, {
        rect: v.rect,
        code: v.code,
        defense: v.defense,
        turned: v.turned,
        at: sec(v.atMs),
        dir: o.dir ? o.dir(v) : pushDir(c, v, null),
        cut,
        tint: c.tint,
        seed: (c.st.rig.request.seed ?? 1) * 17 + i,
        mode: o.mode,
        pull: o.pull,
        detail: n > 5 ? 0.6 : c.st.rig.env.quality < 0.8 ? 0.75 : 1,
        flare: o.flare ?? n <= 5,
        glow: o.glow ?? c.tint.accent,
      }),
    );
  });
  return parts;
}

/* ---------- pieces ---------- */

function mirrorForce(c: Ctx): FxPart[] {
  const { st, scene, tint } = c;
  const barrier = mirrorBarrier(scene.field, scene.attacker, scene.ownerSide);
  const hit = mirrorHitPoint(barrier, scene.attacker);
  const hitT = sec(scene.hitMs);
  const end = sec(scene.totalMs) - 0.1;
  const bc = centreOf(barrier);
  const parts: FxPart[] = [];
  // ground: a faint reflection on the board under the barrier
  parts.push(wave(st, hit, { at: hitT + 0.02, dur: 0.7, size: scene.field.w * 1.5, color: tint.alt, peak: 0.6, band: 0.16 }));
  parts.push(
    ...breaks(c, "shatter", {
      dir: (v) => dirOf(hit, centreOf(v.rect)),
      glow: tint.accent,
    }),
  );
  parts.push(
    timedMesh(
      st,
      "hex",
      { p: bc, w: barrier.w, h: barrier.h, at: 0, end, fadeIn: 0.05, fadeOut: 0.3, peak: 1 },
      (m) => {
        setColor(m.material.uniforms.uColor, tint.main);
        setColor(m.material.uniforms.uColor2, tint.accent);
        m.material.uniforms.uAspect.value = barrier.w / barrier.h;
        m.material.uniforms.uHit.value.set(clamp01((hit.x - barrier.x) / barrier.w), clamp01(1 - (hit.y - barrier.y) / barrier.h));
      },
      (m, s) => {
        const u = m.material.uniforms;
        u.uTime.value = s;
        u.uReveal.value = 1.1 * easeOutCubic(ramp(s, 0, sec(MIRROR_RISE_MS)));
        u.uHitT.value = s >= hitT ? s - hitT : -1;
      },
    ),
  );
  if (!scene.incoming) {
    // the attack itself is not in this snapshot: a bolt from the attacker meets the barrier
    const from = scene.attacker ? edgeOf(scene.attacker, hit, 2) : { x: hit.x, y: hit.y + (scene.ownerSide === "you" ? -1 : 1) * scene.field.h * 1.5 };
    parts.push(bolt(st, { pts: jagged(from, hit, 8, 12, st.rand), start: hitT - 0.2, grow: 0.18, hold: hitT + 0.02, end: hitT + 0.25, width: 6, color: tint.main, core: WHITE, flick: 0.6, bloom: 0.6 }));
  }
  parts.push(
    pool(st, hit, { at: hitT - 0.03, dur: 0.5, size: scene.field.h * 3.2, color: hot(tint.main, 0.5), peak: 1 }),
    ring(st, hit, { at: hitT, dur: 0.55, from: scene.field.h * 0.3, to: scene.field.w * 0.8, color: tint.accent, width: 0.035, peak: 0.85 }),
    sparks(st, hit, { at: hitT, count: 36, speed: [140, 520], life: [0.25, 0.7], size: [3, 8], colors: [tint.accent, tint.main, WHITE], shape: "star", gravity: [0, -300], radius: 4 }),
  );
  // the reflected wave: a bolt of light from the hit to every victim, and a glow that arrives with it
  scene.victims.forEach((v, i) => {
    const to = centreOf(v.rect);
    const arrive = sec(v.atMs);
    const start = hitT + 0.02 + i * 0.01;
    parts.push(
      bolt(st, { pts: jagged(hit, to, 8, 14, st.rand), start, grow: Math.max(0.06, arrive - start), hold: arrive + 0.05, end: arrive + 0.3, width: 5, color: tint.accent, core: WHITE, flick: 0.5, bloom: 0.6, alpha: 0.9 }),
      pool(st, to, { at: arrive - 0.02, dur: 0.4, size: cardSize(v) * 2.2, color: hot(tint.main, 0.4), peak: 0.85 }),
    );
  });
  return parts;
}

function sakuretsu(c: Ctx): FxPart[] {
  const { st, scene, tint } = c;
  const metal: Rgb = [0.72, 0.78, 0.9];
  const slam = sec(SAKURETSU_SLAM_MS);
  const boom = sec(SAKURETSU_BOOM_MS);
  const parts: FxPart[] = [];
  scene.victims.forEach((v) => {
    const p = centreOf(v.rect);
    parts.push(decal(st, { p, size: cardSize(v) * 1.9, kind: 1, at: boom, hold: boom + 0.5, end: boom + 1.1, color: [0.1, 0.05, 0.03], seed: 0.4, peak: 0.85 }));
  });
  parts.push(...breaks(c, "impact", { dir: (v) => pushDir(c, v, scene.source ? centreOf(scene.source) : null) }));
  scene.victims.forEach((v, i) => {
    const p = centreOf(v.rect);
    const r = cardSize(v);
    const corners: P[] = [
      { x: p.x - r * 1.3, y: p.y - r * 1.1 },
      { x: p.x + r * 1.3, y: p.y - r * 1.1 },
      { x: p.x - r * 1.3, y: p.y + r * 1.1 },
      { x: p.x + r * 1.3, y: p.y + r * 1.1 },
    ];
    const off = i * 0.02;
    corners.forEach((cn, j) => {
      const start = 0.05 + off + j * 0.03;
      const to = lerpP(cn, p, 0.86);
      parts.push(
        bolt(st, { pts: [cn, to], start, grow: Math.max(0.1, slam - start - 0.06), hold: boom + 0.05, end: boom + 0.3, width: 16, color: metal, core: WHITE, taper: 1, bloom: 0.15, alpha: 0.95 }),
      );
    });
    parts.push(
      pool(st, p, { at: slam - 0.03, dur: 0.24, size: r * 2, color: [1, 0.9, 0.7], peak: 0.7 }),
      sparks(st, p, { at: slam - 0.02, count: 16, speed: [120, 400], life: [0.2, 0.5], size: [3, 6], colors: [WHITE, metal], shape: "star", gravity: [0, -600], radius: r * 0.35 }),
      pool(st, p, { at: boom - 0.02, dur: 0.6, size: r * 4, color: hot(tint.main, 0.35), peak: 1 }),
      ring(st, p, { at: boom, dur: 0.5, from: r * 0.4, to: r * 3.2, color: tint.accent, width: 0.06, peak: 0.85 }),
      wave(st, p, { at: boom, dur: 0.6, size: r * 5, color: tint.alt, peak: 0.7 }),
      sparks(st, p, { at: boom, count: 44, speed: [120, 520], life: [0.4, 0.95], size: [4, 11], colors: [tint.main, tint.accent, [1, 0.35, 0.1]], gravity: [0, 200], radius: r * 0.2 }),
      sparks(st, p, { at: boom, count: 12, speed: [30, 120], life: [0.7, 1.2], size: [16, 30], colors: [[0.12, 0.1, 0.1]], kind: "solid", gravity: [0, 100], radius: r * 0.2 }),
    );
  });
  return parts;
}

function pit(c: Ctx, o: { open: number; color: Rgb; dust: Rgb; deep: boolean }): FxPart[] {
  const { st, scene, tint } = c;
  const parts: FxPart[] = [];
  const last = Math.max(...scene.victims.map((v) => sec(v.atMs)), o.open) + 0.35;
  scene.victims.forEach((v) => {
    const p = centreOf(v.rect);
    const r = cardSize(v);
    parts.push(
      decal(st, { p, size: r * 1.9, h: r * (v.defense ? 1.4 : 1.9), kind: 3, at: 0.03, hold: last, end: last + 0.45, color: o.color, seed: 0.3 + (p.x % 7) / 20, open: 1, peak: 0.97, rise: o.open / 3 }),
    );
  });
  parts.push(...breaks(c, "shatter", { mode: "sink", flare: false, glow: tint.main }));
  scene.victims.forEach((v) => {
    const p = centreOf(v.rect);
    const r = cardSize(v);
    parts.push(
      pool(st, p, { at: 0.05, dur: last, size: r * 2.6, color: tint.main, peak: o.deep ? 0.3 : 0.2 }),
      ring(st, p, { at: 0.04, dur: o.open + 0.1, from: r * 0.3, to: r * 2.1, color: tint.accent, width: 0.035, peak: 0.6 }),
      sparks(st, p, { at: sec(v.atMs) - 0.02, count: 20, speed: [40, 220], life: [0.4, 0.9], size: [8, 18], colors: [o.dust], kind: "solid", gravity: [0, 120], radius: r * 0.5 }),
    );
  });
  return parts;
}

function trapGlyph(c: Ctx, chains: boolean): FxPart[] {
  const { st, scene, tint } = c;
  const parts: FxPart[] = [];
  scene.victims.forEach((v) => {
    const p = centreOf(v.rect);
    parts.push(decal(st, { p, size: cardSize(v) * 1.8, kind: 1, at: sec(v.atMs), hold: sec(v.atMs) + 0.4, end: sec(v.atMs) + 1, color: [0.06, 0.02, 0.1], seed: 0.7, peak: 0.7 }));
  });
  parts.push(...breaks(c, "impact", { dir: (v) => pushDir(c, v, scene.source ? centreOf(scene.source) : null), flare: false, glow: tint.accent }));
  scene.victims.forEach((v, i) => {
    const p = centreOf(v.rect);
    const r = cardSize(v);
    const at = sec(v.atMs);
    parts.push(runeCircle(st, { p, size: r * 2.1, at: i * 0.03, full: sec(TRAP_GLYPH_MS), end: at + 0.25, color: tint.main, color2: tint.accent, peak: 0.95, squash: 0.85, segs: 18 }));
    if (chains) {
      const ch = sec(TRAP_CHAIN_MS) + i * 0.03;
      const reach = r * 0.85;
      const a = [{ x: p.x - reach, y: p.y - reach * 0.9 }, { x: p.x - reach * 0.3, y: p.y - reach * 0.2 }, { x: p.x + reach * 0.4, y: p.y + reach * 0.3 }, { x: p.x + reach, y: p.y + reach * 0.9 }];
      const b = [{ x: p.x + reach, y: p.y - reach * 0.9 }, { x: p.x + reach * 0.3, y: p.y - reach * 0.2 }, { x: p.x - reach * 0.4, y: p.y + reach * 0.3 }, { x: p.x - reach, y: p.y + reach * 0.9 }];
      parts.push(
        bolt(st, { pts: a, start: ch, grow: 0.16, hold: at, end: at + 0.06, width: 7, color: tint.main, core: tint.accent, dash: 1, bloom: 0.3, alpha: 0.95 }),
        bolt(st, { pts: b, start: ch + 0.04, grow: 0.16, hold: at, end: at + 0.06, width: 7, color: tint.main, core: tint.accent, dash: 1, bloom: 0.3, alpha: 0.95 }),
      );
    }
    if (scene.source) {
      const from = edgeOf(scene.source, p, 2);
      parts.push(bolt(st, { pts: jagged(from, p, 7, 10, st.rand), start: 0.02 + i * 0.03, grow: 0.18, hold: at - 0.05, end: at + 0.1, width: 3, color: tint.main, core: WHITE, flick: 0.5, bloom: 0.4, alpha: 0.8 }));
    }
    parts.push(
      pool(st, p, { at: at - 0.03, dur: 0.5, size: r * 3, color: hot(tint.main, 0.3), peak: 0.9 }),
      ring(st, p, { at, dur: 0.45, from: r * 0.3, to: r * 2.4, color: tint.accent, width: 0.06, peak: 0.85 }),
      wave(st, p, { at, dur: 0.55, size: r * 4, color: tint.alt, peak: 0.6 }),
      sparks(st, p, { at, count: 28, speed: [120, 460], life: [0.3, 0.8], size: [3, 9], colors: [tint.accent, tint.main], shape: "star", gravity: [0, -400], radius: 6 }),
    );
  });
  return parts;
}

function spell(c: Ctx): FxPart[] {
  const { st, scene, tint } = c;
  const parts: FxPart[] = [];
  parts.push(...breaks(c, "arcane", { dir: (v) => pushDir(c, v, scene.source ? centreOf(scene.source) : null), flare: false, glow: tint.accent }));
  scene.victims.forEach((v, i) => {
    const p = centreOf(v.rect);
    const r = cardSize(v);
    const at = sec(v.atMs);
    parts.push(
      runeCircle(st, { p, size: r * 2.1, at: i * 0.03, full: sec(SPELL_SIGIL_MS), end: at + 0.3, color: tint.main, color2: tint.accent, peak: 0.95, squash: 0.85 }),
      pool(st, p, { at: at - 0.03, dur: 0.55, size: r * 3.2, color: hot(tint.main, 0.3), peak: 0.9 }),
      ring(st, p, { at, dur: 0.5, from: r * 0.3, to: r * 2.6, color: tint.accent, width: 0.05, peak: 0.8 }),
      sparks(st, p, { at, count: 34, speed: [80, 340], life: [0.5, 1.0], size: [4, 11], colors: [tint.accent, tint.main, WHITE], shape: "star", gravity: [0, 140], radius: r * 0.2 }),
    );
  });
  return parts;
}

function monster(c: Ctx): FxPart[] {
  const { st, scene, tint } = c;
  const parts: FxPart[] = [];
  parts.push(...breaks(c, "impact", { dir: (v) => pushDir(c, v, scene.source ? centreOf(scene.source) : null), flare: false, glow: tint.accent }));
  scene.victims.forEach((v) => {
    const to = centreOf(v.rect);
    const from = scene.source ? edgeOf(scene.source, to, 2) : { x: to.x, y: -20 };
    const at = sec(v.atMs);
    const travel = sec(MONSTER_TRAVEL_MS);
    const start = Math.max(0, at - 0.04 - travel);
    const flight = orb(st, { from, to, size: cardSize(v) * 0.38, start, travel, end: start + travel + 0.04, color: tint.main, trail: 20, trailColor: tint.accent, ease: "in" });
    parts.push(
      pool(st, from, { at: start, dur: 0.3, size: cardSize(v) * 1.4, color: tint.main, peak: 0.6 }),
      bolt(st, { pts: [from, to], start: start + 0.02, grow: travel, hold: at, end: at + 0.18, width: 5, color: tint.main, core: WHITE, bloom: 0.5, alpha: 0.7 }),
      ...flight.parts,
      pool(st, to, { at: at - 0.03, dur: 0.5, size: cardSize(v) * 3, color: hot(tint.main, 0.4), peak: 0.9 }),
      ring(st, to, { at, dur: 0.45, from: cardSize(v) * 0.3, to: cardSize(v) * 2.4, color: tint.accent, width: 0.05, peak: 0.8 }),
      wave(st, to, { at, dur: 0.55, size: cardSize(v) * 4, color: tint.alt, peak: 0.55 }),
      sparks(st, to, { at, count: 26, speed: [120, 460], life: [0.3, 0.8], size: [3, 9], colors: [tint.accent, tint.main], shape: "star", gravity: [0, -400], radius: 6 }),
    );
  });
  return parts;
}

/** The wipe pieces (one file each under ./wipes). They run through the post pass; see wipes/common.ts. */
const WIPES: Partial<Record<FxScene["piece"], FxFactory>> = {
  "dark-hole": wipeFactory(buildDarkHole),
  raigeki: wipeFactory(buildRaigeki),
  "feather-duster": wipeFactory(buildStorm),
  "heavy-storm": wipeFactory(buildStorm),
  "banish-all": wipeFactory(buildBanish),
  "mass-destroy": wipeFactory(buildShock),
  torrential: wipeFactory(buildTorrential),
};

export const sceneEffect: FxFactory = (env, request) => {
  const scene = request.scene;
  const wipe = scene ? WIPES[scene.piece] : undefined;
  if (wipe) return wipe(env, request);
  const st = new Stage(env, request, 5);
  if (!scene) return compose(st.rig, [], 1);
  const field = scene.field;
  const c: Ctx = { st, scene, tint: scene.tint, centre: centreOf(field), u: Math.max(60, field.h), last: Math.max(0, ...scene.victims.map((v) => v.atMs)) };
  const parts = (() => {
    switch (scene.piece) {
      case "mirror-force":
        return mirrorForce(c);
      case "sakuretsu":
        return sakuretsu(c);
      case "bottomless":
        return pit(c, { open: sec(BOTTOMLESS_OPEN_MS), color: [0, 0, 0.02], dust: [0.25, 0.15, 0.35], deep: true });
      case "trap-hole":
        return pit(c, { open: sec(TRAP_HOLE_OPEN_MS), color: [0.05, 0.03, 0.02], dust: [0.45, 0.33, 0.22], deep: false });
      case "trap":
        return trapGlyph(c, true);
      case "spell":
        return spell(c);
      default:
        return monster(c);
    }
  })();
  return compose(st.rig, parts, scene.totalMs);
};
