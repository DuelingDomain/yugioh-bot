/**
 * The "Added to hand" showcase, pure parts: which moves get it, where it starts, how long each leg
 * lasts and the keyframes. MoveFx draws it (add-fx.tsx), move-plan.ts schedules it.
 *
 * A card that an effect puts into a hand (a search, Painful Choice, a salvage, a bounce) is not a draw:
 * it rises to a showcase spot near the middle of the board, is held there with a gold glow and a label,
 * then flies into its hand slot. The hand card stays hidden until the flight lands (MoveFx hides it and
 * releases it at the landing, the same hand-off as a destroyed card), so it is never seen twice.
 */
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { LOCATION_DECK, LOCATION_EXTRA, LOCATION_GRAVE, LOCATION_HAND, LOCATION_REMOVED, LOCATION_MZONE, LOCATION_SZONE } from "./constants";
import { ADD_TO_HAND, MIN_VISIBLE_MS } from "./duel-timing";
import { stripSeenWithin, takePickRect, type PickRect } from "./pick-rects";

export const ADDED_TITLE = "Added to hand";

/**
 * True when a card effect put the card into a hand: the server marks those moves (`addedToHand`). An
 * older server did not, so a move from anywhere but the Deck counts, and a move from the Deck stays a
 * draw (the two cannot be told apart there).
 */
export function isAddToHand(event: DuelEvent): boolean {
  const from = event.from;
  const to = event.zone;
  if (event.kind !== "move" || !from || !to) return false;
  if (to.location !== LOCATION_HAND || from.location === LOCATION_HAND) return false;
  if ((event as DuelEvent & { addedToHand?: boolean }).addedToHand === true) return true;
  if (event.reason === "draw") return false;
  return from.location !== LOCATION_DECK;
}

/* ---------- where it starts ---------- */

export type ShowcaseOrigin =
  /** The card the player just looked at in the card strip: it starts at that rect. */
  | { kind: "strip"; rect: PickRect }
  /** It came from a pick whose strip has closed: it starts at the middle of the board. */
  | { kind: "centre" }
  /** It rises out of the pile or the zone it left. */
  | { kind: "source" };

const PILES = new Set<number>([LOCATION_DECK, LOCATION_GRAVE, LOCATION_REMOVED, LOCATION_EXTRA]);

/**
 * The start of the showcase: the strip card it was picked from; else the middle of the board when a
 * strip that showed cards from this place was seen lately (the pick's strip is gone); else where the
 * card was (`sourceKnown`), else the middle.
 */
export function showcaseOrigin(event: DuelEvent, now: number, sourceKnown: boolean): ShowcaseOrigin {
  const from = event.from;
  const code = event.card != null && event.card.code > 0 ? event.card.code : 0;
  if (code > 0 && from) {
    const rect = takePickRect(code, from.location, now);
    if (rect) return { kind: "strip", rect };
  }
  if (from && PILES.has(from.location) && stripSeenWithin(now, from.location)) return { kind: "centre" };
  return sourceKnown ? { kind: "source" } : { kind: "centre" };
}

/* ---------- the label ---------- */

const PLACE_NAMES = new Map<number, string>([
  [LOCATION_DECK, "Deck"],
  [LOCATION_GRAVE, "GY"],
  [LOCATION_REMOVED, "Banished"],
  [LOCATION_EXTRA, "Extra Deck"],
  [LOCATION_MZONE, "Field"],
  [LOCATION_SZONE, "Field"],
]);

/**
 * "from Deck", "from GY", ... The opponent's hand adds "Opponent · "; a card taken from the other
 * side's zone says whose it was ("from Opponent's GY", "from your GY"). Empty when the place is not known.
 */
export function showcaseSourceLabel(from: DuelZoneRef | undefined, to: DuelZoneRef | undefined, ownerSide: "you" | "opp"): string {
  const place = from ? PLACE_NAMES.get(from.location) : undefined;
  if (!from || !to || !place) return ownerSide === "opp" ? "Opponent" : "";
  if (from.controller !== to.controller) return `from ${ownerSide === "you" ? "Opponent's" : "your"} ${place}`;
  return `${ownerSide === "opp" ? "Opponent · " : ""}from ${place}`;
}

/* ---------- timing ---------- */

export type ShowcasePhases = {
  /** The card travels from its start to the showcase spot (a fade in under reduced motion). */
  riseMs: number;
  /** The card stays at the showcase spot, label shown. */
  holdMs: number;
  /** The card flies to the hand (a fade out under reduced motion). */
  flyMs: number;
  totalMs: number;
  /** The ring of light on the card in the hand after it landed. */
  glowMs: number;
};

/** The legs of one showcase at a backlog speed (1 = normal, 0.6 = the fastest); the hold never gets short. */
export function showcasePhases(speed: number, reduced: boolean): ShowcasePhases {
  const s = Math.min(1, Math.max(0.1, speed));
  // A squeezed leg of travel stays long enough to follow (MIN_VISIBLE_MS); a fade is not squeezed.
  const leg = (base: number) => (reduced ? base : Math.max(Math.round(base * s), Math.min(base, MIN_VISIBLE_MS)));
  const riseMs = leg(reduced ? ADD_TO_HAND.reducedInMs : ADD_TO_HAND.riseMs);
  const holdBase = reduced ? ADD_TO_HAND.reducedHoldMs : ADD_TO_HAND.holdMs;
  const holdMs = Math.round(Math.max(ADD_TO_HAND.holdMinMs, holdBase * s));
  const flyMs = leg(reduced ? ADD_TO_HAND.reducedOutMs : ADD_TO_HAND.flyMs);
  return { riseMs, holdMs, flyMs, totalMs: riseMs + holdMs + flyMs, glowMs: reduced ? 0 : ADD_TO_HAND.glowMs };
}

/** When the next card of the same effect may start, from the start of this one: as this card sets off for the hand. */
export function showcaseGateMs(phases: ShowcasePhases, nextIsShowcase: boolean): number {
  // A second showcase would rise into the same spot: it waits until the first is nearly in the hand.
  return phases.riseMs + phases.holdMs + (nextIsShowcase ? Math.round(phases.flyMs * 0.6) : 0);
}

/* ---------- geometry and keyframes ---------- */

export type ShowcaseSpot = {
  /** Centre of the showcase card, px from the destination centre (the ghost sits on the hand card). */
  dx: number;
  dy: number;
  /** Showcase size relative to the hand card. */
  scale: number;
  /** Height of the showcase card, px. */
  height: number;
};

const CARD_ASPECT = 0.686;

/**
 * The showcase spot in overlay space: the middle of the board, a little above centre so the label fits
 * below it. Returns the card's centre and its height.
 */
export function showcaseBox(overlay: { width: number; height: number }): { cx: number; cy: number; height: number } {
  const height = Math.max(120, Math.min(ADD_TO_HAND.maxHeightPx, overlay.height * ADD_TO_HAND.heightShare, (overlay.width * 0.5) / CARD_ASPECT));
  return { cx: overlay.width / 2, cy: overlay.height / 2 - height * 0.06, height };
}

export type ShowcaseFrames = {
  /** Rise and hold, one animation (`riseMs + holdMs`). */
  stage: Keyframe[];
  /** The flight to the hand, built when it starts so it aims at where the hand is then (`flyMs`). */
  fly: Keyframe[];
  /** Opacity of the label over the rise and the hold. */
  label: Keyframe[];
  /** The gold aura around the card over the stage, and over the flight. */
  aura: Keyframe[];
  auraFly: Keyframe[];
};

export type ShowcaseParams = {
  phases: ShowcasePhases;
  /** Start of the card from the destination centre, px, and its size relative to the hand card. */
  start: { dx: number; dy: number; scale: number };
  spot: ShowcaseSpot;
  /** Where the card ends from the destination centre (0 unless the hand moved meanwhile). */
  end?: { dx: number; dy: number };
  /** The hand card's resting turn, degrees (the opponent's cards sit upside down). */
  endRot: number;
  reduced: boolean;
  /** The card starts out of view (the middle of the board, a card the strip no longer shows). */
  fadeIn: boolean;
};

const t = (x: number, y: number, rot: number, scale: number) =>
  `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
const easeOut = "cubic-bezier(0.16, 1, 0.3, 1)";
const easeInOut = "cubic-bezier(0.45, 0, 0.2, 1)";

/**
 * Keyframes of one showcase. Position and size are relative to the hand card, which the ghost sits on.
 * Normal motion: rise (ease out, a small turn that straightens) -> hold (a slow breath, 1 to 1.025) -> fly
 * (an arc in with ease in-out, the last 22% is a small settle: a touch under size, then 1). Reduced
 * motion: no travel, a fade in at the spot, the hold, a fade out.
 */
export function buildShowcaseFrames(params: ShowcaseParams): ShowcaseFrames {
  const { phases, start, spot, endRot, reduced, fadeIn } = params;
  const end = params.end ?? { dx: 0, dy: 0 };
  const stageMs = Math.max(1, phases.riseMs + phases.holdMs);
  const riseAt = phases.riseMs / stageMs;
  const here = (scale: number) => t(spot.dx, spot.dy, 0, scale);

  if (reduced) {
    return {
      stage: [
        { offset: 0, opacity: 0, transform: here(spot.scale) },
        { offset: riseAt, opacity: 1, transform: here(spot.scale), easing: "ease-out" },
        { offset: 1, opacity: 1, transform: here(spot.scale) },
      ],
      fly: [
        { offset: 0, opacity: 1, transform: here(spot.scale) },
        { offset: 1, opacity: 0, transform: here(spot.scale) },
      ],
      label: [
        { offset: 0, opacity: 0 },
        { offset: riseAt, opacity: 1 },
        { offset: 1, opacity: 1 },
      ],
      aura: [
        { offset: 0, opacity: 0 },
        { offset: riseAt, opacity: 1 },
        { offset: 1, opacity: 1 },
      ],
      auraFly: [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 0 }],
    };
  }

  const turn = start.dx > spot.dx ? 5 : -5;
  const midRise = Math.min(0.5, riseAt * 0.55);
  const stage: Keyframe[] = [
    { offset: 0, opacity: fadeIn ? 0 : 1, transform: t(start.dx, start.dy, 0, start.scale), easing: easeOut },
    {
      offset: midRise,
      opacity: 1,
      transform: t(lerp(start.dx, spot.dx, 0.55), lerp(start.dy, spot.dy, 0.55) - spot.height * 0.04, turn, lerp(start.scale, spot.scale, 0.6)),
      easing: easeOut,
    },
    { offset: riseAt, opacity: 1, transform: here(spot.scale), easing: "ease-in-out" },
    { offset: lerp(riseAt, 1, 0.5), opacity: 1, transform: t(spot.dx, spot.dy - spot.height * 0.012, 0, spot.scale * 1.025), easing: "ease-in-out" },
    { offset: 1, opacity: 1, transform: here(spot.scale) },
  ];

  const settleAt = 0.78;
  const fly: Keyframe[] = [
    { offset: 0, opacity: 1, transform: here(spot.scale), easing: easeInOut },
    {
      offset: 0.5,
      opacity: 1,
      transform: t(lerp(spot.dx, end.dx, 0.5), lerp(spot.dy, end.dy, 0.5) - spot.height * 0.06, endRot * 0.5, lerp(spot.scale, 1, 0.62)),
      easing: easeInOut,
    },
    { offset: settleAt, opacity: 1, transform: t(end.dx, end.dy, endRot, 1.05), easing: "ease-in-out" },
    { offset: 0.9, opacity: 1, transform: t(end.dx, end.dy, endRot, 0.982), easing: "ease-out" },
    { offset: 1, opacity: 1, transform: t(end.dx, end.dy, endRot, 1) },
  ];
  const labelOut = Math.max(0, 1 - ADD_TO_HAND.labelOutMs / stageMs);
  const labelIn = Math.min(0.5, ADD_TO_HAND.labelInMs / stageMs);
  return {
    stage,
    fly,
    label: [
      { offset: 0, opacity: 0 },
      { offset: Math.min(labelIn, riseAt), opacity: 0 },
      { offset: Math.min(labelIn + 0.12, riseAt + 0.12), opacity: 1 },
      { offset: labelOut, opacity: 1 },
      { offset: 1, opacity: 0 },
    ],
    aura: [
      { offset: 0, opacity: 0 },
      { offset: riseAt, opacity: 1 },
      { offset: lerp(riseAt, 1, 0.5), opacity: 0.8 },
      { offset: 1, opacity: 1 },
    ],
    auraFly: [
      { offset: 0, opacity: 1 },
      { offset: settleAt, opacity: 0.55 },
      { offset: 1, opacity: 0.25 },
    ],
  };
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}
