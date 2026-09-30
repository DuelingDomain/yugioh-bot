import type { DuelEvent } from "@yugidraft/shared/duels";
import type { FxRect, FxScene, FxScenePiece, FxTint, FxVictim, Rgb } from "./types";

/**
 * Set pieces for destroys caused by a card effect (a trap, a spell, a monster effect). Pure:
 * routing by cause and source code, grouping of one card's destroys into a single piece, and the
 * timing of every piece. The geometry (rectangles) comes from the caller; nothing here reads the DOM.
 *
 * Times are ms from the start of the piece. `breaks[i]` is when victim i breaks: the card stays
 * whole on the board until then (the battle hold keeps it), so the piece is always the cause.
 */

/** Passcodes of the cards that have their own piece. */
export const SOURCE_PIECES: Readonly<Record<number, FxScenePiece>> = {
  44095762: "mirror-force",
  56120475: "sakuretsu",
  53582587: "torrential",
  53129443: "dark-hole",
  12580477: "raigeki",
  29401950: "bottomless",
  4206964: "trap-hole",
};

export type SceneEventLike = Pick<DuelEvent, "id" | "kind" | "cause" | "sourceCode" | "sourceKind" | "sourceSeat" | "zone">;

/** Which piece plays for one destroy event, or null (the plain break-up stays). */
export function pieceOf(event: SceneEventLike): FxScenePiece | null {
  if (event.kind !== "destroy" || event.cause !== "effect" || !event.zone) return null;
  const known = event.sourceCode != null ? SOURCE_PIECES[event.sourceCode] : undefined;
  if (known) return known;
  if (event.sourceKind === "trap") return "trap";
  if (event.sourceKind === "spell") return "spell";
  if (event.sourceKind === "monster") return "monster";
  return null;
}

export type SceneGroup<E extends SceneEventLike = SceneEventLike> = {
  /** Stable id of the group: the piece, the source card and the seat that caused it. */
  key: string;
  piece: FxScenePiece;
  sourceCode: number;
  sourceSeat: number;
  events: E[];
};

/**
 * Destroys of one snapshot that come from the same card (same code, same seat) are one piece:
 * Dark Hole, Raigeki and Torrential Tribute destroy many cards and must play once, not once per card.
 * Groups keep the order of their first event; events inside a group are in engine (id) order.
 */
export function groupScenes<E extends SceneEventLike>(events: readonly E[]): SceneGroup<E>[] {
  const groups = new Map<string, SceneGroup<E>>();
  const sorted = [...events].sort((a, b) => a.id - b.id);
  for (const event of sorted) {
    const piece = pieceOf(event);
    if (!piece) continue;
    const sourceCode = event.sourceCode ?? 0;
    const sourceSeat = event.sourceSeat ?? -1;
    const key = `${piece}:${sourceCode}:${sourceSeat}`;
    const group = groups.get(key);
    if (group) group.events.push(event);
    else groups.set(key, { key, piece, sourceCode, sourceSeat, events: [event] });
  }
  return [...groups.values()];
}

/* ---------- timing ---------- */

/** How long the shards of the last victim need after the last break. */
export const SCENE_TAIL_MS = 850;
export const SCENE_LIFE_CAP_MS = 3800;
/** The barrier rises for this long before anything can hit it. */
export const MIRROR_RISE_MS = 380;
/** Mirror Force's own projectile arrives here when no attack in the snapshot is the one it stops. */
export const MIRROR_OWN_HIT_MS = 560;
/** The reflected wave crosses the field at this speed (px per ms). */
export const MIRROR_WAVE_SPEED = 1.5;
export const MIRROR_WAVE_MAX_MS = 520;
export const MIRROR_RANK_MS = 30;
export const SAKURETSU_SLAM_MS = 520;
export const SAKURETSU_BOOM_MS = 560;
export const TIDE_START_MS = 250;
export const TIDE_SWEEP_MS = 750;
export const DARK_HOLE_OPEN_MS = 500;
export const RAIGEKI_FLASH_MS = 300;
export const RAIGEKI_STEP_MS = 70;
export const BOTTOMLESS_OPEN_MS = 450;
export const TRAP_HOLE_OPEN_MS = 250;
export const TRAP_GLYPH_MS = 380;
export const TRAP_CHAIN_MS = 300;
export const SPELL_SIGIL_MS = 350;
export const MONSTER_TRAVEL_MS = 360;

/** Sound cues a piece plays, with the time (ms from the start of the piece) each one sounds. */
export type SceneCueName =
  | "mirror-rise"
  | "mirror-reflect"
  | "armor-clank"
  | "armor-boom"
  | "tidal"
  | "black-hole"
  | "thunder"
  | "fall-rumble"
  | "chain-rattle"
  | "trap-glyph"
  | "spell-burst"
  | "energy-strike";

export type SceneCue = { cue: SceneCueName; atMs: number; strength: number };

export type SceneInput = {
  piece: FxScenePiece;
  victims: ReadonlyArray<{ rect: FxRect; code: number; defense: boolean }>;
  source: FxRect | null;
  attacker: FxRect | null;
  field: FxRect;
  ownerSide: "you" | "opp";
  tint: FxTint;
  /** Mirror Force: ms from now until the attack of the same snapshot lands, or null when there is none. */
  attackImpactMs: number | null;
};

const cx = (r: FxRect): number => r.x + r.w / 2;
const cy = (r: FxRect): number => r.y + r.h / 2;

/** Where the barrier stands: a band across the owner's row, between the owner and the attacker. */
export function mirrorBarrier(field: FxRect, attacker: FxRect | null, ownerSide: "you" | "opp"): FxRect {
  const rowY = cy(field);
  const h = Math.max(24, field.h * 0.95);
  let y: number;
  if (attacker) {
    y = cy(attacker) + (rowY - cy(attacker)) * 0.62;
  } else {
    // No attacker: stand just in front of the row, on the side of the opponent.
    y = rowY + (ownerSide === "you" ? -1 : 1) * field.h * 0.62;
  }
  const w = field.w * 1.06;
  return { x: cx(field) - w / 2, y: y - h / 2, w, h };
}

/** The point on the barrier where the attack strikes it (x of the attacker, y of the barrier). */
export function mirrorHitPoint(barrier: FxRect, attacker: FxRect | null): { x: number; y: number } {
  return { x: attacker ? Math.min(barrier.x + barrier.w - 8, Math.max(barrier.x + 8, cx(attacker))) : cx(barrier), y: cy(barrier) };
}

/** When the attack (or Mirror Force's own projectile) meets the barrier, ms from the start of the piece. */
export function mirrorHitMs(attackImpactMs: number | null): { hitMs: number; incoming: boolean } {
  if (attackImpactMs == null) return { hitMs: MIRROR_OWN_HIT_MS, incoming: false };
  return { hitMs: Math.max(MIRROR_RISE_MS + 40, Math.round(attackImpactMs)), incoming: true };
}

function withBreaks(input: SceneInput, times: number[], extra: Partial<FxScene> & { hitMs?: number; incoming?: boolean; cues: SceneCue[] }): { scene: FxScene; cues: SceneCue[] } {
  // Every break must land while the piece still draws (a late attack impact can push Mirror Force's
  // wave past the life cap): a break the canvas never draws would leave its card only fading out.
  const latest = SCENE_LIFE_CAP_MS - SCENE_TAIL_MS;
  const victims: FxVictim[] = input.victims.map((victim, index) => ({
    ...victim,
    atMs: Math.min(latest, Math.round(times[index] ?? times[times.length - 1] ?? 0)),
  }));
  const last = victims.reduce((max, v) => Math.max(max, v.atMs), 0);
  const totalMs = Math.min(SCENE_LIFE_CAP_MS, last + SCENE_TAIL_MS);
  const { cues, ...rest } = extra;
  return {
    scene: {
      piece: input.piece,
      victims,
      source: input.source,
      attacker: input.attacker,
      field: input.field,
      ownerSide: input.ownerSide,
      tint: input.tint,
      hitMs: rest.hitMs ?? 0,
      incoming: rest.incoming ?? false,
      totalMs,
    },
    cues,
  };
}

/** Rank of each victim when sorted by `key` (0 = first). */
function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out: number[] = new Array(values.length).fill(0);
  order.forEach((entry, rank) => {
    out[entry.index] = rank;
  });
  return out;
}

/** Plans one piece: when each victim breaks, how long the piece lasts, and which sounds play when. */
export function planScene(input: SceneInput): { scene: FxScene; cues: SceneCue[] } {
  const { piece, victims, field } = input;
  const n = victims.length;
  const index = victims.map((_, i) => i);
  switch (piece) {
    case "mirror-force": {
      const barrier = mirrorBarrier(field, input.attacker, input.ownerSide);
      const hit = mirrorHitPoint(barrier, input.attacker);
      const { hitMs, incoming } = mirrorHitMs(input.attackImpactMs);
      const dist = victims.map((v) => Math.hypot(cx(v.rect) - hit.x, cy(v.rect) - hit.y));
      const rank = ranks(dist);
      const times = victims.map((_, i) => hitMs + 40 + Math.min(MIRROR_WAVE_MAX_MS, dist[i] / MIRROR_WAVE_SPEED) + rank[i] * MIRROR_RANK_MS);
      return withBreaks(input, times, {
        hitMs,
        incoming,
        cues: [
          { cue: "mirror-rise", atMs: 0, strength: 1 },
          { cue: "mirror-reflect", atMs: hitMs, strength: 1 },
        ],
      });
    }
    case "sakuretsu":
      return withBreaks(input, index.map((i) => SAKURETSU_BOOM_MS + 80 + i * 30), {
        cues: [
          { cue: "armor-clank", atMs: SAKURETSU_SLAM_MS - 40, strength: 1 },
          { cue: "armor-boom", atMs: SAKURETSU_BOOM_MS, strength: 1 },
        ],
      });
    case "torrential": {
      const left = field.x;
      const width = Math.max(1, field.w);
      const times = victims.map((v) => TIDE_START_MS + Math.min(1, Math.max(0, (cx(v.rect) - left) / width)) * TIDE_SWEEP_MS + 120);
      return withBreaks(input, times, { cues: [{ cue: "tidal", atMs: 0, strength: 1 }] });
    }
    case "dark-hole":
      return withBreaks(input, index.map((i) => DARK_HOLE_OPEN_MS + 120 + i * 50), { cues: [{ cue: "black-hole", atMs: 0, strength: 1 }] });
    case "raigeki": {
      const times = index.map((i) => RAIGEKI_FLASH_MS + i * RAIGEKI_STEP_MS + 60);
      const cues: SceneCue[] = [{ cue: "thunder", atMs: RAIGEKI_FLASH_MS, strength: 1 }];
      if (n > 3) cues.push({ cue: "thunder", atMs: RAIGEKI_FLASH_MS + 3 * RAIGEKI_STEP_MS, strength: 0.8 });
      return withBreaks(input, times, { cues });
    }
    case "bottomless":
      return withBreaks(input, index.map((i) => BOTTOMLESS_OPEN_MS + 30 + i * 90), { cues: [{ cue: "fall-rumble", atMs: 260, strength: 1 }] });
    case "trap-hole":
      return withBreaks(input, index.map((i) => TRAP_HOLE_OPEN_MS + 50 + i * 70), { cues: [{ cue: "fall-rumble", atMs: 120, strength: 0.9 }] });
    case "trap":
      return withBreaks(input, index.map((i) => TRAP_GLYPH_MS + 340 + i * 80), {
        cues: [
          { cue: "trap-glyph", atMs: 0, strength: 1 },
          { cue: "chain-rattle", atMs: TRAP_CHAIN_MS, strength: 1 },
        ],
      });
    case "spell":
      return withBreaks(input, index.map((i) => SPELL_SIGIL_MS + 50 + i * 60), {
        cues: [
          { cue: "trap-glyph", atMs: 0, strength: 0.7 },
          { cue: "spell-burst", atMs: SPELL_SIGIL_MS, strength: 1 },
        ],
      });
    default:
      return withBreaks(input, index.map((i) => MONSTER_TRAVEL_MS + 40 + i * 60), { cues: [{ cue: "energy-strike", atMs: 60, strength: 1 }] });
  }
}

/** A tint from a passcode, so a monster effect always looks the same. */
export function tintForCode(code: number): FxTint {
  const h = (((code * 2654435761) >>> 0) % 360) / 360;
  const rgb = (hue: number, s: number, l: number): Rgb => {
    const k = (n: number) => (n + hue * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)];
  };
  return { main: rgb(h, 0.85, 0.58), alt: rgb((h + 0.08) % 1, 0.8, 0.36), accent: rgb(h, 0.7, 0.9) };
}

/** Piece defaults for tint when the source is unknown. */
export const PIECE_TINTS: Record<FxScenePiece, FxTint> = {
  "mirror-force": { main: [0.45, 0.75, 1], alt: [0.2, 0.4, 0.9], accent: [0.95, 0.99, 1] },
  sakuretsu: { main: [1, 0.55, 0.2], alt: [0.55, 0.6, 0.7], accent: [1, 0.95, 0.75] },
  torrential: { main: [0.15, 0.55, 0.95], alt: [0.05, 0.25, 0.65], accent: [0.8, 0.96, 1] },
  "dark-hole": { main: [0.55, 0.25, 0.9], alt: [0.2, 0.05, 0.4], accent: [0.9, 0.75, 1] },
  raigeki: { main: [0.75, 0.85, 1], alt: [0.4, 0.5, 1], accent: [1, 1, 1] },
  bottomless: { main: [0.6, 0.3, 0.85], alt: [0.15, 0.05, 0.3], accent: [0.9, 0.7, 1] },
  "trap-hole": { main: [0.85, 0.6, 0.3], alt: [0.3, 0.15, 0.08], accent: [1, 0.85, 0.6] },
  trap: { main: [0.75, 0.35, 0.95], alt: [0.4, 0.15, 0.65], accent: [1, 0.85, 1] },
  spell: { main: [0.3, 0.9, 0.55], alt: [0.1, 0.5, 0.35], accent: [0.85, 1, 0.9] },
  monster: { main: [1, 0.7, 0.3], alt: [0.9, 0.3, 0.2], accent: [1, 0.95, 0.8] },
};
