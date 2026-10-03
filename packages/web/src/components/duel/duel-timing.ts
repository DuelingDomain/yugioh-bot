/**
 * One place for the pace of the duel board. Every number here is a length of time a player sees:
 * the rule is that an effect must stay on screen long enough to tell that it happened and what
 * happened. Nothing here changes order, only length. The planners (attack-styles, move-plan,
 * chain-state, event-queue, result-reveal, prompt-reveal) and the draw code read these values, so a
 * pace change is one edit in this file.
 *
 * Not in this file, on purpose: hover and button feedback, menus and prompt input. They stay fast.
 * Pure data, no imports (so it can be read from anywhere without a cycle).
 */

/** The shortest visible motion of an effect on its own (a hover or a button press is not an effect). */
export const MIN_VISIBLE_MS = 400;

/* ---------- attacks ---------- */

/** How much longer an attack plays than the first version did (windup, strike, impact, counter). */
export const ATTACK_PACE = 1.4;

/** An attack length (ms, as drawn at the first pace) at the current attack pace. */
export const paceAttack = (ms: number): number => Math.round(ms * ATTACK_PACE);

export const ATTACK_TIMING = {
  /** The counter strike starts this long after the attacker's impact: time to read the first hit. */
  counterGapMs: 200,
  /** A card breaks this long after the strike that killed it lands: hit, then reaction, then the break. */
  destroyBeatMs: 480,
  /** The LP roll starts this long after the hit lands, so the blow is seen before the number moves. */
  lpAfterHitMs: 140,
  /** When no counter strike is drawn, damage to the attacker's own seat rolls this long after the impact. */
  attackerDamageGapMs: 200,
  /** Shakes, rings and flashes at the point of impact last this many times longer than they were drawn first. */
  hitLinger: 1.5,
  /** A direct attack ends this long after its strike: the LP plate takes the blow. */
  directTailMs: 360,
  /** No fight holds the prompts longer than this (the slowest counter fight is about 3 s). */
  maxBattleMs: 3600,
  /** Reduced motion: flashes and fades only, same order, same holds. */
  reducedImpactMs: 400,
  reducedCounterMs: 640,
  reducedBreakMs: 760,
  reducedBreakTieMs: 940,
  reducedTotalMs: 1100,
  reducedCounterExtraMs: 140,
} as const;

/* ---------- life points ---------- */

export const LP_TIMING = {
  /** The whole roll, by the size of the hit: 1.2 s for a scratch, 1.8 s for a full 8000. */
  rollMinMs: 1200,
  rollMaxMs: 1800,
  /** The plate shakes and flashes when a loss starts to roll (the impact on the number). */
  plateHitMs: 460,
  /** The struck old value and the delta chip fade in, and they stay until the next change. */
  oldInMs: 420,
  strikeMs: 480,
  chipInMs: 460,
  /** Reduced motion: the tally changes with a plain fade, no travel. */
  reducedFadeMs: 260,
  /** Reduced motion: the colour cue stays on the number this long. */
  cueMs: 800,
  /** A hold armed by a battle waits this long at most for the LP change that uses it. */
  holdExpiryMs: 4500,
  /** Waits past the roll before the safety timer lands the number (throttled tabs). */
  finishSlackMs: 200,
} as const;

/* ---------- destroy and card flights ---------- */

export const MOVE_PACE = {
  placeMinMs: 700,
  placeMaxMs: 860,
  tossMinMs: 680,
  tossMaxMs: 840,
  /** About 10% quicker; 667 preserves the 400 ms floor at minSpeed. */
  drawMs: 667,
  reducedMs: 150,
  /** The next flight in a group starts when this share of the one before has played. */
  overlap: 0.7,
  /** The next flight starts at least this long after the one before it started. */
  minGapMs: 280,
  /** Hand entries use 90% of the ordinary stagger and queue cap. */
  handMinGapMs: 252,
  handQueueCapMs: 3960,
  /** A queue of flights is compressed to fit in about this long (the slowest speed is minSpeed). */
  queueCapMs: 4400,
  minSpeed: 0.6,
  /** An effect destroy: the card shows its cracks this long before its pieces leave. */
  destroyBreakMs: 420,
  /** A battle destroy that no slice drew (a plain break). */
  destroyBreakBattleMs: 620,
  /** After a slice the halves stay in view this long before the card flies to the Graveyard. */
  breakSettleMs: 520,
  /** A fight that holds a card cracks it this long after the hold starts. */
  heldCrackMs: 140,
} as const;

/**
 * A card that an effect adds to a hand (a search, Painful Choice, a salvage, a bounce; not a draw) is
 * shown: it rises to a showcase spot near the middle of the board at a large size with a gold glow and
 * an "Added to hand" label, stays there long enough to read, then flies into the hand and settles.
 * The cards of the same effect that go to the Graveyard start when the showcase card sets off for the
 * hand. A backlog squeezes the rise and the flight, never the hold below `holdMinMs`.
 */
export const ADD_TO_HAND = {
  /** Source (the card strip, a pile, the field) to the showcase spot. */
  riseMs: 414,
  /** The card stays at the showcase spot, label shown. */
  holdMs: 720,
  /** The shortest hold when a backlog is squeezed. */
  holdMinMs: 540,
  /** Showcase spot to the hand slot, the last share of it is the small settle. */
  flyMs: 504,
  /** The gold glow ring on the card in the hand after it landed. */
  glowMs: 468,
  /** The label fades in this long after the card started to rise, and out this long before it flies. */
  labelInMs: 216,
  labelOutMs: 126,
  /** The showcase card is this share of the board height tall (and never above maxHeightPx). */
  heightShare: 0.44,
  maxHeightPx: 340,
  /** Reduced motion: a fade in at the showcase spot, a hold, a fade out as the card shows in the hand. */
  reducedInMs: 144,
  reducedHoldMs: 720,
  reducedOutMs: 180,
  /** The strip card a pick came from is remembered this long after the strip closed. */
  pickRectTtlMs: 6000,
  /** A card that left a pile within this long after a strip was seen came from a pick: it starts at the middle. */
  pickWindowMs: 45000,
} as const;

/* ---------- flips, positions, hand, summon ---------- */

export const CARD_FX = {
  /** Full activation ghost/flip and ring, and its reduced glow. */
  activationMs: 800,
  reducedEffectMs: 320,
  destroyFlashMs: 420,
  /** A card turns to the other position. */
  turnMs: 600,
  /** A face-down card flips face up and shows its face. */
  flipRevealMs: 820,
  flipFaceAtMs: 560,
  /** Cards that change together start this far apart. */
  staggerMs: 260,
  /** A card in the hand flips or enters. */
  handFlipMs: 480,
  handEnterMs: 480,
  /** The glide of a card to its new zone. */
  glideMs: 300,
  landFadeMs: 220,
  /** A heavy summon: rise, hover, impact, the hand over to the board, the total. */
  heavyTimeline: { riseMs: 400, hoverEndMs: 650, impactMs: 800, handOverMs: 890, totalMs: 1625 },
  /** The typed summons (fusion, synchro...) are authored at this pace of their own timeline (1 = as authored). */
  typedScale: 1,
  heavyLockMs: 1500,
  summonStaggerMs: 300,
} as const;

/* ---------- banners, chains, gates ---------- */

export const BANNER_TIMING = {
  activateMs: 2000,
  eventMs: 1600,
  defaultMs: 1300,
  reducedActivateMs: 1500,
  reducedDefaultMs: 1200,
  /** A backlog of banners is squeezed, never dropped: every banner keeps this long at least. */
  minCueMs: 500,
  blinkCueMs: 300,
  catchUpBudgetMs: 4800,
  maxBacklogMs: 9000,
  /** Entrance and exit of a banner. */
  enterMin: 140,
  enterMax: 360,
  leaveMin: 120,
  leaveMax: 260,
} as const;

/**
 * The phase beats: Draw, Standby and Main Phase 1 of every turn (the opening of the duel too) each show
 * their ribbon and light the phase bar in turn, so no phase is skipped past. An empty phase is a short
 * beat; a phase with a card flight (the draw) lasts until the card has landed.
 */
export const PHASE_TIMING = {
  /** One phase ribbon, and the least time a phase stays lit on the phase bar. */
  beatMs: 900,
  reducedBeatMs: 600,
  /** A phase starts this long after the last card flight before it has landed (the deal, the draw). */
  afterMovesMs: 220,
  /** The player may act this long after the Main Phase 1 ribbon starts. */
  releaseLeadMs: 250,
  /** Nothing holds the player for longer than this, whatever the timers do. */
  capMs: 15000,
} as const;

export const CHAIN_TIMING = {
  activateMs: 950,
  resolvingMs: 1150,
  resolvedMs: 720,
  negatedMs: 950,
  endMs: 640,
  fallbackMs: 560,
  /** A backlog of more than this many beats is played faster, down to the floor. */
  backlogBeats: 10,
  floorMs: 320,
  /** A link's own effect starts this long after its badge starts to pulse. */
  effectLeadMs: 440,
  effectLeadReducedMs: 200,
} as const;

/** Plain numbers (not literals): the gates take a custom timing in tests and tools. */
export const GATE_TIMING: Record<"resultPauseMs" | "resultCapMs" | "resultReducedPauseMs" | "promptBeatMs" | "promptSettleMs" | "promptCapMs" | "promptReducedMs" | "pickHoldMs", number> = {
  /** The result screen waits this long after the last blow. */
  resultPauseMs: 1500,
  resultCapMs: 9500,
  resultReducedPauseMs: 400,
  /** A prompt panel waits this long before it shows, and settles this long after the board is quiet. */
  promptBeatMs: 600,
  promptSettleMs: 500,
  /** Raised from 6500 so a whole wipe piece (up to 6000 ms, see fx3d/scene-plan.ts) can finish before the prompt. */
  promptCapMs: 8000,
  promptReducedMs: 200,
  /** After a pick, the board holds this long before the next prompt. */
  pickHoldMs: 1600,
};

/**
 * Every visible effect length above, by name. Used by a test (and by anyone who adds an effect):
 * none of these may be under MIN_VISIBLE_MS. Reduced motion values are not listed (they are fades).
 */
export const VISIBLE_EFFECT_MS: Readonly<Record<string, number>> = {
  "lp roll (scratch)": LP_TIMING.rollMinMs,
  "lp roll (full)": LP_TIMING.rollMaxMs,
  "lp plate hit": LP_TIMING.plateHitMs,
  "lp old value": LP_TIMING.oldInMs,
  "lp strike": LP_TIMING.strikeMs,
  "lp chip": LP_TIMING.chipInMs,
  "place flight": MOVE_PACE.placeMinMs,
  "toss flight": MOVE_PACE.tossMinMs,
  "draw flight": MOVE_PACE.drawMs,
  "add to hand rise": ADD_TO_HAND.riseMs,
  "add to hand hold": ADD_TO_HAND.holdMs,
  "add to hand flight": ADD_TO_HAND.flyMs,
  "effect destroy crack": MOVE_PACE.destroyBreakMs,
  "slice settle": MOVE_PACE.breakSettleMs,
  "position turn": CARD_FX.turnMs,
  "flip reveal": CARD_FX.flipRevealMs,
  "hand flip": CARD_FX.handFlipMs,
  "hand enter": CARD_FX.handEnterMs,
  "heavy summon": CARD_FX.heavyTimeline.totalMs,
  "activate banner": BANNER_TIMING.activateMs,
  "event banner": BANNER_TIMING.eventMs,
  "phase ribbon": PHASE_TIMING.beatMs,
  "default banner": BANNER_TIMING.defaultMs,
  "chain activate": CHAIN_TIMING.activateMs,
  "chain resolving": CHAIN_TIMING.resolvingMs,
  "chain resolved": CHAIN_TIMING.resolvedMs,
  "chain negated": CHAIN_TIMING.negatedMs,
  "chain end": CHAIN_TIMING.endMs,
  "chain fallback": CHAIN_TIMING.fallbackMs,
  "attack counter gap + beat": ATTACK_TIMING.counterGapMs + ATTACK_TIMING.destroyBeatMs,
};
