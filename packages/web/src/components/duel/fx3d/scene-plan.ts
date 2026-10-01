import type { DuelEvent } from "@yugidraft/shared/duels";
import { clamp01, ramp } from "./ease";
import { MIRROR, mirrorAt, mirrorGeo, mirrorHitSec } from "./mirror-math";
import { DEMO_CW, DEMO_H, DEMO_W, hash1, timeWarp } from "./wipe-math";
import type { FxPiles, FxRect, FxRows, FxScene, FxScenePiece, FxTint, FxVictim, FxWorld, Rgb } from "./types";

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
  18144506: "feather-duster",
  19613556: "heavy-storm",
};

/** The pieces that wipe the board: the canvas draws the cards themselves (see effects/wipes). */
export const WIPE_PIECES: ReadonlySet<FxScenePiece> = new Set<FxScenePiece>([
  "mirror-force",
  "dark-hole",
  "raigeki",
  "torrential",
  "feather-duster",
  "heavy-storm",
  "banish-all",
  "mass-destroy",
]);

export const isWipePiece = (piece: FxScenePiece): boolean => WIPE_PIECES.has(piece);

/** The generic pieces by source kind. Two or more victims of one link turn them into "mass-destroy". */
const GENERIC_PIECES: ReadonlySet<FxScenePiece> = new Set<FxScenePiece>(["trap", "spell", "monster"]);

/** Location bits (the engine's LOCATION_MZONE and LOCATION_SZONE; this file stays free of imports from the room). */
const LOC_MZONE = 0x04;
const LOC_SZONE = 0x08;

export type SceneEventLike = Pick<DuelEvent, "id" | "kind" | "cause" | "sourceCode" | "sourceKind" | "sourceSeat" | "zone" | "reason" | "from">;

/** A banish or a send from the field by a card effect: one card of a "banish-all" group. */
function isFieldLeave(event: SceneEventLike): boolean {
  if (event.kind !== "move" || !event.from || event.sourceCode == null) return false;
  if (event.reason !== "banish" && event.reason !== "send") return false;
  return event.from.location === LOC_MZONE || event.from.location === LOC_SZONE;
}

/**
 * Which piece plays for one event, or null (the plain break-up or flight stays).
 *  - A destroy by a card effect: the piece of the source passcode, else the generic piece of its kind.
 *  - A banish or send from the field by a card effect: "banish-all". It is only a candidate: one card
 *    alone keeps its own flight, so `groupScenes` drops a group of one.
 */
export function pieceOf(event: SceneEventLike): FxScenePiece | null {
  if (isFieldLeave(event)) return "banish-all";
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
 * Events of one snapshot that come from the same card (same code, same seat) and the same chain link
 * are one piece: Dark Hole, Raigeki and Torrential Tribute destroy many cards and must play once, not
 * once per card. Groups keep the order of their first event; events inside a group are in engine (id) order.
 *
 *  - Named pieces (SOURCE_PIECES) always play, even for one victim.
 *  - A link with two or more effect destroys and no named piece plays "mass-destroy" (also when the
 *    source kind is unknown). One destroy keeps the trap, spell or monster piece, as before.
 *  - A link that banishes or sends two or more cards from the field plays "banish-all".
 *  - A second link of the same source in one snapshot is its own group: key suffix `#2`, `#3`...
 *    (links are split by the chain-resolving and chain-resolved events in `events`).
 */
export function groupScenes<E extends SceneEventLike>(events: readonly E[]): SceneGroup<E>[] {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  type Open = SceneGroup<E> & { segment: number; known: number };
  const groups = new Map<string, Open>();
  const all: Open[] = [];
  let segment = 0;
  for (const event of sorted) {
    if (event.kind === "chain-resolving" || event.kind === "chain-resolved") {
      segment += 1;
      continue;
    }
    const direct = pieceOf(event);
    // A destroy by an effect with a source but no known kind is only counted: it plays when 2+ share a link.
    const unknownKind = !direct && event.kind === "destroy" && event.cause === "effect" && !!event.zone && event.sourceCode != null;
    const piece: FxScenePiece | null = direct ?? (unknownKind ? "monster" : null);
    if (!piece) continue;
    const sourceCode = event.sourceCode ?? 0;
    const sourceSeat = event.sourceSeat ?? -1;
    // Generic pieces share one candidate bucket, so a trap and a monster effect of one card cannot split.
    const bucket = GENERIC_PIECES.has(piece) ? "generic" : piece;
    const base = `${bucket}:${sourceCode}:${sourceSeat}`;
    const known = groups.get(base);
    if (known && known.segment === segment) {
      known.events.push(event);
      if (!unknownKind) known.known += 1;
      continue;
    }
    const taken = all.filter((g) => g.key === base || g.key.startsWith(`${base}#`)).length;
    const group = { key: taken === 0 ? base : `${base}#${taken + 1}`, piece, sourceCode, sourceSeat, events: [event], segment, known: unknownKind ? 0 : 1 };
    groups.set(base, group);
    all.push(group);
  }
  const out: SceneGroup<E>[] = [];
  for (const group of all) {
    const { segment: _segment, known: knownCount, ...plain } = group;
    void _segment;
    if (plain.piece === "banish-all") {
      if (plain.events.length < 2) continue;
      out.push(plain);
      continue;
    }
    if (GENERIC_PIECES.has(plain.piece)) {
      const generic = plain.events.length >= 2;
      if (!generic && knownCount === 0) continue;
      const piece: FxScenePiece = generic ? "mass-destroy" : plain.piece;
      // Single destroys keep the key of their piece (as before); a mass destroy gets its own.
      const suffix = plain.key.includes("#") ? plain.key.slice(plain.key.indexOf("#")) : "";
      out.push({ ...plain, piece, key: `${piece}:${plain.sourceCode}:${plain.sourceSeat}${suffix}` });
      continue;
    }
    out.push(plain);
  }
  return out;
}

/* ---------- timing ---------- */

/** How long the shards of the last victim need after the last break (the older pieces). */
export const SCENE_TAIL_MS = 850;
/** The longest life of an older piece (mirror, sakuretsu, pits, trap, spell, monster). */
export const SCENE_LIFE_CAP_MS = 3800;
/** The longest life of a wipe: the demo scenes run 3 to 4.5 s, and 10 landing streaks add a little. */
export const SCENE_WIPE_CAP_MS = 6000;
/** Tail after the last landing streak arrives, for the glow on the pile and the end of the grade. */
export const WIPE_TAIL_MS = 350;

/** Per-piece life cap (ms). The engine limit (HARD_LIMIT_MS) is above every value here. */
export const sceneCapMs = (piece: FxScenePiece): number => (isWipePiece(piece) ? SCENE_WIPE_CAP_MS : SCENE_LIFE_CAP_MS);
export const SAKURETSU_SLAM_MS = 520;
export const SAKURETSU_BOOM_MS = 560;
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
  | "energy-strike"
  | "gust"
  | "rift"
  | "shock-boom"
  | "glass-break";

export type SceneCue = { cue: SceneCueName; atMs: number; strength: number };

export type SceneInput = {
  piece: FxScenePiece;
  victims: ReadonlyArray<{ rect: FxRect; code: number; defense: boolean; turned?: boolean; pile?: FxRect | null; st?: boolean }>;
  source: FxRect | null;
  attacker: FxRect | null;
  field: FxRect;
  ownerSide: "you" | "opp";
  tint: FxTint;
  /** Mirror Force: ms from now until the attack of the same snapshot lands, or null when there is none. */
  attackImpactMs: number | null;
  /** Wipes: the world mapping (see FxWorld). Without it the plan derives one from the field. */
  world?: FxWorld;
  rows?: FxRows;
  piles?: FxPiles;
};

const cx = (r: FxRect): number => r.x + r.w / 2;
const cy = (r: FxRect): number => r.y + r.h / 2;

function withBreaks(input: SceneInput, times: number[], extra: Partial<FxScene> & { hitMs?: number; incoming?: boolean; cues: SceneCue[] }): { scene: FxScene; cues: SceneCue[] } {
  // Every break must land while the piece still draws: a break the canvas never draws would leave its card only fading out.
  const cap = sceneCapMs(input.piece);
  const latest = cap - SCENE_TAIL_MS;
  const victims: FxVictim[] = input.victims.map((victim, index) => ({
    ...victim,
    atMs: Math.min(latest, Math.round(times[index] ?? times[times.length - 1] ?? 0)),
  }));
  const last = victims.reduce((max, v) => Math.max(max, v.atMs), 0);
  const totalMs = Math.min(cap, last + SCENE_TAIL_MS);
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

/** Plans one piece: when each victim breaks, how long the piece lasts, and which sounds play when. */
export function planScene(input: SceneInput): { scene: FxScene; cues: SceneCue[] } {
  const { piece, victims, field } = input;
  const n = victims.length;
  const index = victims.map((_, i) => i);
  switch (piece) {
    case "sakuretsu":
      return withBreaks(input, index.map((i) => SAKURETSU_BOOM_MS + 80 + i * 30), {
        cues: [
          { cue: "armor-clank", atMs: SAKURETSU_SLAM_MS - 40, strength: 1 },
          { cue: "armor-boom", atMs: SAKURETSU_BOOM_MS, strength: 1 },
        ],
      });
    case "mirror-force":
    case "torrential":
    case "dark-hole":
    case "raigeki":
    case "feather-duster":
    case "heavy-storm":
    case "banish-all":
    case "mass-destroy":
      return planWipe(input);
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

/* ---------- wipes ---------- */

/**
 * Wipes are laid out in demo time. The numbers below come from the demo scenes (.fx-demo/js/scenes.js),
 * in seconds there and in ms here. A wipe has, per victim:
 *   takeMs  the canvas starts to draw the card; the page card hides 40 ms earlier than the first change
 *   atMs    the card is gone from the field
 *   landMs  its landing streak leaves (the streak flies from the card to its pile)
 *   endMs   the streak arrives; the page pile takes the card then
 * and for the piece: `totalMs` (never below the demo length, never below the last endMs + WIPE_TAIL_MS).
 */
export const WIPE_TAKE_LEAD_MS = 40;
/** The shortest time a landing streak flies (ms) and the demo values per piece. */
export const WIPE = {
  darkHole: { tf: 1.55, fd: 0.22, rate: 0.04, blast: 2.25, d: 3.45, landDur: 0.62, stagger: 0.05, spread: 0.3 },
  raigeki: { ts: 0.85, th: 0.94, tn: 1.82, tc: 2.1, d: 3.05, landDur: 0.6, stagger: 0.05, spread: 0.3 },
  storm: { f0: 0.5, f1: 1.62, t0: 1.75, d: 2.6, landDur: 0.6, stagger: 0.045, spread: 0.3 },
  banish: { dMin: 2.4, tEndMin: 1.3, landDur: 0.65, stagger: 0.045, spread: 0.28 },
  shock: { speed: 1000, tr: 0.5, d: 2.4, landDur: 0.62, stagger: 0.05, spread: 0.3 },
  torrential: { tb: 0.78, ts: 0.94, t0: 2.0, d: 3.05, landDur: 0.62, stagger: 0.05, spread: 0.3 },
} as const;

/** The world mapping of an input: given, or derived from the field and the first victim. */
export function worldOf(input: Pick<SceneInput, "world" | "victims" | "field">): FxWorld {
  if (input.world) return input.world;
  const first = input.victims[0]?.rect;
  const u = first ? Math.max(0.1, Math.min(first.w, first.h) / 96) : 1;
  return { cx: cx(input.field), cy: cy(input.field), u, vw: DEMO_W * u, vh: DEMO_H * u };
}

export const toWorldX = (world: FxWorld, px: number): number => (px - world.cx) / world.u;
export const toWorldY = (world: FxWorld, py: number): number => (world.cy - py) / world.u;

const ms = (sec: number): number => Math.round(sec * 1000);

/** Landing streak times: victim order by world x, so the streaks leave from the left to the right. */
function landingTimes(wx: readonly number[], t0Ms: number, staggerSec: number, spreadSec: number, durSec: number): { landMs: number[]; endMs: number[] } {
  const n = wx.length;
  const stagger = Math.min(staggerSec, spreadSec / Math.max(1, n));
  const order = wx.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x || a.i - b.i);
  const landMs: number[] = new Array(n).fill(0);
  order.forEach((entry, rank) => {
    landMs[entry.i] = Math.round(t0Ms + rank * stagger * 1000);
  });
  return { landMs, endMs: landMs.map((l) => l + ms(durSec)) };
}

/** Plans the wipes. Pure. See WIPE for the demo numbers. */
export function planWipe(input: SceneInput): { scene: FxScene; cues: SceneCue[] } {
  const { piece, victims } = input;
  const n = victims.length;
  const world = worldOf(input);
  const wx = victims.map((v) => toWorldX(world, cx(v.rect)));
  const wy = victims.map((v) => toWorldY(world, cy(v.rect)));
  const W = Math.max(1, world.vw / world.u);
  const srcX = input.source ? toWorldX(world, cx(input.source)) : 0;
  const srcY = input.source ? toWorldY(world, cy(input.source)) : 0;

  let takeSec: number[] = [];
  let goneSec: number[] = [];
  let landT0Ms = 0;
  let params: { stagger: number; spread: number; dur: number; dMin: number };
  const cues: SceneCue[] = [];
  const marks: NonNullable<FxScene["marks"]> = {};

  switch (piece) {
    case "dark-hole": {
      const p = WIPE.darkHole;
      const tw = timeWarp(p.tf, p.fd, p.rate);
      const dist = wx.map((x, i) => Math.hypot(x, wy[i]));
      const maxd = Math.max(1, ...dist);
      // s is in world time (te); the card is whole until s - 0.4, gone at s + 0.95.
      const s = dist.map((d, i) => 0.88 + 0.32 * (d / maxd) + hash1(i * 3.1) * 0.06);
      takeSec = s.map((v) => tw.inv(v - 0.4));
      goneSec = s.map((v) => tw.inv(v + 0.95));
      landT0Ms = ms(tw.inv(2.3));
      params = { stagger: p.stagger, spread: p.spread, dur: p.landDur, dMin: p.d };
      marks.open = 0;
      marks.strike = ms(tw.inv(p.blast));
      marks.close = landT0Ms;
      cues.push({ cue: "black-hole", atMs: 0, strength: 1 }, { cue: "shock-boom", atMs: ms(tw.inv(p.blast)), strength: 1 });
      break;
    }
    case "raigeki": {
      const p = WIPE.raigeki;
      const tb = p.th + 0.4;
      takeSec = victims.map(() => 0.4);
      goneSec = victims.map(() => tb + 0.7);
      landT0Ms = ms(p.tc);
      params = { stagger: p.stagger, spread: p.spread, dur: p.landDur, dMin: p.d };
      marks.open = ms(p.ts);
      marks.strike = ms(p.th);
      marks.close = ms(p.tc);
      cues.push({ cue: "thunder", atMs: 120, strength: 0.5 }, { cue: "thunder", atMs: ms(p.th), strength: 1 });
      break;
    }
    case "feather-duster":
    case "heavy-storm": {
      const p = WIPE.storm;
      const hit = wx.map((x) => p.f0 + (p.f1 - p.f0) * clamp01(((x + W / 2) / W - DEMO_CW / 2 / W + 0.12) / 1.3));
      takeSec = hit.map((h) => h - 0.3);
      goneSec = hit.map((h) => h + 1.05);
      landT0Ms = ms(p.t0);
      params = { stagger: p.stagger, spread: p.spread, dur: p.landDur, dMin: p.d };
      marks.open = ms(p.f0);
      marks.strike = ms(p.f1);
      marks.close = ms(p.t0);
      cues.push({ cue: "gust", atMs: 150, strength: piece === "heavy-storm" ? 1 : 0.8 }, { cue: "gust", atMs: ms(p.f0 + (p.f1 - p.f0) * 0.5), strength: 0.7 });
      break;
    }
    case "banish-all": {
      const p = WIPE.banish;
      const s = wx.map((x, i) => 0.8 + 0.3 * ramp(Math.abs(x), 0, 500) + hash1(i * 2.3) * 0.04);
      takeSec = s.map((v) => v - 0.3);
      goneSec = s.map((v) => v + 0.65);
      const tEnd = Math.max(p.tEndMin, ...goneSec);
      landT0Ms = ms(tEnd + 0.05 - 0.1);
      params = { stagger: p.stagger, spread: p.spread, dur: p.landDur, dMin: p.dMin };
      marks.open = 0;
      marks.strike = ms(Math.min(...s, 0.8));
      marks.close = ms(tEnd + 0.05);
      cues.push({ cue: "rift", atMs: 0, strength: 1 });
      break;
    }
    case "mass-destroy": {
      const p = WIPE.shock;
      const hitAt = wx.map((x, i) => p.tr + Math.hypot(x - srcX, wy[i] - srcY) / p.speed);
      takeSec = hitAt.map((h) => h - 0.04);
      goneSec = hitAt.map((h) => h + 1.15);
      const tMax = Math.max(p.tr + 0.5, ...hitAt);
      landT0Ms = ms(tMax + 0.35);
      params = { stagger: p.stagger, spread: p.spread, dur: p.landDur, dMin: p.d };
      marks.open = ms(p.tr);
      marks.strike = ms(Math.min(p.tr + 0.07, ...hitAt.map((h) => h + 0.07)));
      marks.close = ms(tMax + 0.35);
      cues.push({ cue: "shock-boom", atMs: ms(p.tr), strength: 1 });
      break;
    }
    case "mirror-force": {
      const p = MIRROR;
      const incoming = input.attackImpactMs != null;
      const hit = mirrorHitSec(input.attackImpactMs);
      const rowY = (side: "you" | "opp"): number | null => {
        const row = input.rows?.[side].m;
        return row ? toWorldY(world, cy(row)) : null;
      };
      const attacker = input.attacker ? { x: toWorldX(world, cx(input.attacker)), y: toWorldY(world, cy(input.attacker)) } : null;
      const geo = mirrorGeo({ wx, wy, attacker, ownerSide: input.ownerSide, rowYou: rowY("you"), rowOpp: rowY("opp"), incoming });
      // The attacker leans back and forth from the start (no incoming attack); every other card is taken at the impact.
      takeSec = victims.map((_, i) => (!incoming && i === geo.attacker ? 0.06 : hit));
      goneSec = geo.tb.map((tb) => mirrorAt(tb + p.breakLag + p.hold, hit));
      landT0Ms = ms(mirrorAt(p.landAt, hit));
      params = { stagger: p.stagger, spread: p.spread, dur: p.landDur, dMin: p.d + (hit - p.th) };
      marks.open = ms(mirrorAt(0.28, hit));
      marks.strike = ms(hit);
      marks.close = landT0Ms;
      cues.push(
        { cue: "mirror-rise", atMs: ms(mirrorAt(0.24, hit)), strength: 1 },
        { cue: "mirror-reflect", atMs: ms(hit), strength: 1 },
        { cue: "glass-break", atMs: ms(mirrorAt(geo.tbMin + p.breakLag, hit)), strength: 1 },
        { cue: "glass-break", atMs: ms(mirrorAt(p.tsh, hit)), strength: 0.7 },
      );
      break;
    }
    default: {
      // torrential
      const p = WIPE.torrential;
      const hitAt = wx.map((x, i) => p.tb + 0.015 + 0.09 * clamp01(Math.hypot(x - srcX, wy[i] - srcY) / 760));
      takeSec = victims.map(() => 0.25);
      goneSec = hitAt.map((h) => h + 0.36 + 1.15);
      landT0Ms = ms(p.t0);
      params = { stagger: p.stagger, spread: p.spread, dur: p.landDur, dMin: p.d };
      marks.open = ms(p.tb);
      marks.strike = ms(p.ts);
      marks.close = ms(p.t0);
      cues.push({ cue: "tidal", atMs: 0, strength: 0.8 }, { cue: "tidal", atMs: ms(p.tb), strength: 1 });
      break;
    }
  }

  const land = landingTimes(wx, landT0Ms, params.stagger, params.spread, params.dur);
  const cap = sceneCapMs(piece);
  const out: FxVictim[] = victims.map((victim, i) => {
    const atMs = Math.min(cap - 200, Math.max(120, ms(goneSec[i])));
    const takeMs = Math.max(0, Math.min(atMs - 80, ms(takeSec[i]) - WIPE_TAKE_LEAD_MS));
    const landMs = Math.min(cap - 200, land.landMs[i]);
    // The streak never ends before the card is gone, and never before it left.
    const endMs = Math.min(cap - WIPE_TAIL_MS, Math.max(land.endMs[i], atMs + 120, landMs + 200));
    return { ...victim, takeMs, atMs, landMs, endMs, wx: wx[i], wy: wy[i], pile: victim.pile ?? null, st: victim.st ?? false };
  });
  const lastEnd = out.reduce((max, v) => Math.max(max, v.endMs ?? 0), 0);
  const totalMs = Math.min(cap, Math.max(ms(params.dMin), lastEnd + WIPE_TAIL_MS));
  if (n === 0) marks.land = landT0Ms;
  else marks.land = Math.min(...out.map((v) => v.landMs ?? 0));
  return {
    scene: {
      piece,
      victims: out,
      source: input.source,
      attacker: input.attacker,
      field: input.field,
      ownerSide: input.ownerSide,
      tint: input.tint,
      hitMs: marks.strike ?? 0,
      incoming: piece === "mirror-force" && input.attackImpactMs != null,
      totalMs,
      world,
      rows: input.rows,
      piles: input.piles,
      marks,
    },
    cues,
  };
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
  "feather-duster": { main: [1, 0.62, 0.85], alt: [0.6, 0.25, 0.5], accent: [1, 0.9, 0.96] },
  "heavy-storm": { main: [0.5, 0.95, 0.88], alt: [0.15, 0.5, 0.5], accent: [0.9, 1, 0.97] },
  "banish-all": { main: [0.55, 0.85, 1], alt: [0.15, 0.3, 0.6], accent: [0.9, 0.98, 1] },
  "mass-destroy": { main: [1, 0.66, 0.24], alt: [0.7, 0.25, 0.1], accent: [1, 0.93, 0.75] },
  trap: { main: [0.75, 0.35, 0.95], alt: [0.4, 0.15, 0.65], accent: [1, 0.85, 1] },
  spell: { main: [0.3, 0.9, 0.55], alt: [0.1, 0.5, 0.35], accent: [0.85, 1, 0.9] },
  monster: { main: [1, 0.7, 0.3], alt: [0.9, 0.3, 0.2], accent: [1, 0.95, 0.8] },
};
