import type { BattleClock } from "../battle-clock";

/**
 * Shared types of the Three.js effect layer. This file never imports `three`, so the rest of the
 * duel room can use these types without pulling the library into its bundle.
 */

/** A colour as red, green, blue in 0..1 (display space, no colour management). */
export type Rgb = readonly [number, number, number];

/** A rectangle in CSS pixels, relative to the top-left corner of the effect canvas. */
export type FxRect = { x: number; y: number; w: number; h: number };

/** The colours of one effect: main light, secondary light, and a bright accent. */
export type FxTint = { main: Rgb; alt: Rgb; accent: Rgb };

/** Effects that `Fx3dApi.play` knows. The summon ids are `summon:<style>` and `summon:heavy`. */
export type Fx3dEffectId =
  | "summon:fusion"
  | "summon:synchro"
  | "summon:xyz"
  | "summon:link"
  | "summon:ritual"
  | "summon:pendulum"
  | "summon:heavy"
  | "shockwave"
  | "burst"
  | "pillar"
  | "battle"
  | "scene";

/** The seven attack styles (same ids as attack-styles.ts; repeated here so this file stays standalone). */
export type FxAttackStyle = "slash" | "claw" | "beam" | "arcane" | "lightning" | "flame" | "impact";

/** One strike of a fight: the attacker's, or the defender's counter strike. Times are ms from the start of the fight. */
export type FxStrike = {
  style: FxAttackStyle;
  /** Passcode of a signature attack (Blue-Eyes, Dark Magician...), else null. */
  signature: number | null;
  tint: FxTint;
  /** Where it starts and where it lands (overlay CSS px, y down). */
  from: FxRect;
  to: FxRect;
  /** The strike starts here... */
  startMs: number;
  /** ...and lands here (absolute, from the start of the fight). The picture is drawn to meet this time exactly. */
  impactMs: number;
  /** Speed of the counter strike (1 = the attacker's). Sizes of some parts shrink with it. */
  scale: number;
  /** The strike lands on a player (no card): a direct attack. */
  direct: boolean;
};

/** A card that breaks into shards at `atMs` (from the start of the effect). */
export type FxBreak = {
  rect: FxRect;
  /** Card passcode: the shards are cut from its picture. 0 = unknown (a flat colour). */
  code: number;
  defense: boolean;
  /** The card is the far player's: it faces the other way, so its picture is turned half a circle. */
  turned?: boolean;
  atMs: number;
  /** The way the blow came (unit vector, y down): shards fly away along it. */
  dir: { x: number; y: number };
  style: FxAttackStyle;
  tint: FxTint;
};

/** A whole fight for the 3D layer. */
export type FxBattle = {
  strikes: FxStrike[];
  breaks: FxBreak[];
  /** Length of the whole fight (`battleTiming.totalMs`); the effect lives a little longer for falling shards. */
  totalMs: number;
};

/** The set pieces for trap and effect destroys (see scene-plan.ts). */
export type FxScenePiece =
  | "mirror-force"
  | "sakuretsu"
  | "torrential"
  | "dark-hole"
  | "raigeki"
  | "bottomless"
  | "trap-hole"
  | "feather-duster"
  | "heavy-storm"
  | "banish-all"
  | "mass-destroy"
  | "trap"
  | "spell"
  | "monster";

/**
 * How demo world units map to the canvas (see effects/wipes/common.ts). The demo scenes work in a
 * world of 96 x 140 cards, y UP, origin in the middle of the board. In the app:
 * `wx = (px - cx) / u` and `wy = (cy - py) / u` for a canvas point (px, py), y DOWN.
 */
export type FxWorld = {
  /** Origin: centre of all card zones, canvas px, y down. */
  cx: number;
  cy: number;
  /** Canvas px per world unit (card art width / 96). */
  u: number;
  /** Canvas size in CSS px. */
  vw: number;
  vh: number;
};

/** A row of card zones per seat, in canvas px (null when the board has none). */
export type FxRows = { you: { m: FxRect | null; st: FxRect | null }; opp: { m: FxRect | null; st: FxRect | null } };

/** The graveyard and banish pile of each seat, in canvas px. */
export type FxPiles = { you: { gy: FxRect | null; banish: FxRect | null }; opp: { gy: FxRect | null; banish: FxRect | null } };

export type FxVictim = {
  rect: FxRect;
  code: number;
  defense: boolean;
  turned?: boolean;
  /** Old pieces: the card breaks here (ms from the start). Wipes: the card is gone from the field here. */
  atMs: number;
  /** Wipes: the canvas starts to draw this card (the page card hides here, about 40 ms earlier than any change). */
  takeMs?: number;
  /** Wipes: the landing streak of this card starts here (ms). */
  landMs?: number;
  /** Wipes: the landing streak arrives at the pile here (ms); the page pile takes the card then. */
  endMs?: number;
  /** Wipes: the pile this card ends in (canvas px), when known. */
  pile?: FxRect | null;
  /** Wipes: position in world units (see FxWorld). */
  wx?: number;
  wy?: number;
  /** Wipes: the card is a Spell or Trap (it stands in a spell/trap zone). */
  st?: boolean;
};

export type FxScene = {
  piece: FxScenePiece;
  victims: FxVictim[];
  /** The zone of the card that caused it (a trap or spell zone, or a monster), when it is on the board. */
  source: FxRect | null;
  /** The card that attacked (Mirror Force, Sakuretsu Armor, Trap Hole). */
  attacker: FxRect | null;
  /** The bounds of the monster row(s) the piece works on. */
  field: FxRect;
  /** Where the effect's owner stands: it decides which way waves and barriers face. */
  ownerSide: "you" | "opp";
  tint: FxTint;
  /** Mirror Force: when the attack (or its own projectile) meets the barrier, ms from the start. */
  hitMs: number;
  /** Mirror Force: the attack in the same snapshot is the one it stops (no projectile of its own). */
  incoming: boolean;
  totalMs: number;
  /** Wipes only: world mapping, rows and piles. Absent on the older pieces. */
  world?: FxWorld;
  rows?: FxRows;
  piles?: FxPiles;
  /** Wipes only: how the demo times were laid out (key points in ms, for the sound and the lab). */
  marks?: Partial<Record<"open" | "strike" | "close" | "land", number>>;
};

export type FxRequest = {
  /** The card zone (or card) the effect lands on. Same pixel space as the SummonFx overlay. */
  rect: FxRect;
  /** Colours; every effect has a default. */
  tint?: FxTint;
  /** How hard it hits, 0.6 to 1.6 (see slamStrengthOf). Default 1. */
  strength?: number;
  /** Movement scale from the shake preference: 0 (off) to 1.6. Default 1. */
  shake?: number;
  /** The side of the board the zone belongs to; the portrait rises toward the other one. */
  side?: "you" | "opp";
  /** The card lies sideways (Defense Position). */
  defense?: boolean;
  /** Card passcode: the art of the embodiment. */
  artCode?: number;
  /** Seed for the random parts, so a replay looks the same. */
  seed?: number;
  /** The effect is already this many ms late (it was planned earlier than it started): it starts advanced by this much. */
  skipMs?: number;
  /** Battle's shared performance.now() origin, with initial catch-up capped at 120 ms. */
  startedAt?: number;
  /** Lets the engine publish its capped origin to the DOM, audio and already-armed holds. */
  clock?: BattleClock;
  /** id "battle": the fight. */
  battle?: FxBattle;
  /** id "scene": the trap or effect set piece. */
  scene?: FxScene;
};

export interface Fx3dApi {
  /** True while the canvas can draw (no context loss, not disposed). */
  readonly ready: boolean;
  /** Runs an effect. Resolves when it has finished or was cancelled (abort the signal); never rejects. */
  play(id: Fx3dEffectId, request: FxRequest, signal?: AbortSignal): Promise<void>;
  /** Loads art; uploadEarly is reserved for the attacker and target of a pending battle. */
  prefetchArt(code: number, uploadEarly?: boolean): void;
  /** Stops every running effect at once. */
  cancelAll(): void;
}
