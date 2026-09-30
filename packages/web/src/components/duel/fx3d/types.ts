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
  | "pillar";

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
};

export interface Fx3dApi {
  /** True while the canvas can draw (no context loss, not disposed). */
  readonly ready: boolean;
  /** Runs an effect. Resolves when it has finished or was cancelled (abort the signal); never rejects. */
  play(id: Fx3dEffectId, request: FxRequest, signal?: AbortSignal): Promise<void>;
  /** Starts loading the art of a card so the embodiment finds it in the cache. */
  prefetchArt(code: number): void;
  /** Stops every running effect at once. */
  cancelAll(): void;
}
