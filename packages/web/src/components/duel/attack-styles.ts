/**
 * Attack styles for the battle animation: which effect a monster's attack plays.
 *
 * Pure data and pure functions (no DOM). The resolver picks, first match wins:
 *   1. a signature attack by passcode (SIGNATURES);
 *   2. a name keyword rule (NAME_RULES, in order);
 *   3. the race table (RACE_STYLES);
 *   4. the default, "impact".
 * The tint comes from the attacker's attribute unless the signature sets its own.
 *
 * To add a signature: add one entry to SIGNATURES keyed by passcode. Alternate art and reprints
 * have their own passcode, so add each id you want covered.
 */

import { BREAK_SETTLE_MS } from "./battle-hold";
import { ATTACK_TIMING, paceAttack } from "./duel-timing";

export const ATTRIBUTE = { EARTH: 0x01, WATER: 0x02, FIRE: 0x04, WIND: 0x08, LIGHT: 0x10, DARK: 0x20, DIVINE: 0x40 } as const;

export type AttackStyleId = "slash" | "claw" | "beam" | "arcane" | "lightning" | "flame" | "impact";

/** Colour triple: hi = hot core, main = body, deep = glow and shadow. */
export type Tint = { hi: string; main: string; deep: string };

export const TINTS = {
  EARTH: { hi: "#fff1d6", main: "#e2a860", deep: "#8a5a22" },
  WATER: { hi: "#eafaff", main: "#5fc0ff", deep: "#1a4f9c" },
  FIRE: { hi: "#fff3d0", main: "#ff7a3a", deep: "#9a1e0a" },
  WIND: { hi: "#f0fff4", main: "#7ee6a8", deep: "#1f7a4a" },
  LIGHT: { hi: "#ffffff", main: "#ffe08a", deep: "#b48a1e" },
  DARK: { hi: "#f3eaff", main: "#a86bff", deep: "#3d1a86" },
  DIVINE: { hi: "#fffbe6", main: "#ffd24a", deep: "#a8720c" },
  // signature palettes
  WHITE_BLUE: { hi: "#ffffff", main: "#9fe0ff", deep: "#2a6fd6" },
  DEEP_PURPLE: { hi: "#efe2ff", main: "#8a4bff", deep: "#2a0f66" },
  PINK_MAGENTA: { hi: "#fff0fb", main: "#ff5fd2", deep: "#8a1466" },
  DARK_RED: { hi: "#ffd9c4", main: "#ff3b2f", deep: "#5a0a0a" },
  CYAN_WHITE: { hi: "#ffffff", main: "#8ff6ff", deep: "#1a7fa8" },
  VIOLET: { hi: "#f4e8ff", main: "#b06cff", deep: "#3b1580" },
} as const satisfies Record<string, Tint>;

export type TintKey = keyof typeof TINTS;

export const STYLE_IDS: readonly AttackStyleId[] = ["slash", "claw", "beam", "arcane", "lightning", "flame", "impact"];

/** Presentation notes per style: what the effect is, and how a destroyed card breaks. */
export const STYLE_INFO: Record<AttackStyleId, { label: string; travel: string; destroy: string }> = {
  slash: { label: "Slash", travel: "blade arc", destroy: "cut in two" },
  claw: { label: "Claw", travel: "three raking tears", destroy: "torn into strips" },
  beam: { label: "Beam", travel: "charged laser", destroy: "disintegrates along the beam" },
  arcane: { label: "Arcane", travel: "orb with rune ring", destroy: "dissolves upward" },
  lightning: { label: "Lightning", travel: "branching bolt", destroy: "shatters" },
  flame: { label: "Flame", travel: "fireball", destroy: "chars and crumbles" },
  impact: { label: "Impact", travel: "heavy smash", destroy: "cracks and drops" },
};

/**
 * When each style's strike lands (`impact`) and when its whole play, destroy included, is over
 * (`total`), in ms from the start of the strike. The LP roll and the prompt reveal key off these.
 */
export const STYLE_TIMING: Record<AttackStyleId, { impact: number; total: number }> = {
  slash: { impact: paceAttack(520), total: paceAttack(1150) },
  claw: { impact: paceAttack(500), total: paceAttack(1150) },
  beam: { impact: paceAttack(440), total: paceAttack(1200) },
  arcane: { impact: paceAttack(560), total: paceAttack(1250) },
  lightning: { impact: paceAttack(450), total: paceAttack(1150) },
  flame: { impact: paceAttack(540), total: paceAttack(1250) },
  impact: { impact: paceAttack(470), total: paceAttack(1200) },
};

export type Signature = { style: AttackStyleId; tint?: TintKey | Tint; caption?: string };

/** Signature attacks, keyed by passcode. */
export const SIGNATURES: Record<number, Signature> = {
  89631139: { style: "lightning", tint: "WHITE_BLUE", caption: "White Lightning" }, // Blue-Eyes White Dragon
  46986414: { style: "arcane", tint: "DEEP_PURPLE", caption: "Dark Magic Attack" }, // Dark Magician
  38033121: { style: "arcane", tint: "PINK_MAGENTA", caption: "Dark Burning Attack" }, // Dark Magician Girl
  74677422: { style: "flame", tint: "DARK_RED", caption: "Inferno Fire Blast" }, // Red-Eyes Black Dragon
  70095154: { style: "beam", tint: "CYAN_WHITE", caption: "Evolution Burst" }, // Cyber Dragon
  70781052: { style: "lightning", tint: "VIOLET", caption: "Lightning Strike" }, // Summoned Skull
};

/** Name keyword rules, in precedence order. */
export const NAME_RULES: ReadonlyArray<{ style: AttackStyleId; re: RegExp; label: string }> = [
  { style: "slash", re: /sword|blade|knight|samurai|swordsman|axe/i, label: "name /sword|blade|knight|samurai|swordsman|axe/" },
  { style: "claw", re: /claw|fang|wolf|tiger/i, label: "name /claw|fang|wolf|tiger/" },
  { style: "beam", re: /cyber|laser|cannon/i, label: "name /cyber|laser|cannon/" },
  { style: "arcane", re: /magician|sorcer|witch|mage/i, label: "name /magician|sorcer|witch|mage/" },
  { style: "lightning", re: /thunder|lightning|volt/i, label: "name /thunder|lightning|volt/" },
  { style: "flame", re: /flame|fire|blaze|inferno/i, label: "name /flame|fire|blaze|inferno/" },
];

/** Race table. Keys are the race strings the card data carries. */
export const RACE_STYLES: Record<string, AttackStyleId> = {
  Warrior: "slash",
  "Beast-Warrior": "slash",
  Beast: "claw",
  Dinosaur: "claw",
  "Winged Beast": "claw",
  Reptile: "claw",
  Insect: "claw",
  "Sea Serpent": "claw",
  Machine: "beam",
  Cyberse: "beam",
  Psychic: "beam",
  Spellcaster: "arcane",
  Fiend: "arcane",
  Thunder: "lightning",
  Pyro: "flame",
  Dragon: "flame", // tinted by attribute
  Rock: "impact",
  Aqua: "impact",
  Zombie: "impact",
  Plant: "impact",
  Fairy: "impact",
  Fish: "impact",
  "Divine-Beast": "impact",
  Wyrm: "impact",
};

/** What the resolver needs from a card. Every field may be missing (a face-down or unseen card). */
export type AttackCardLike = { code?: number; name?: string; race?: string; attribute?: number };

export type AttackStyle = {
  style: AttackStyleId;
  tint: Tint;
  tintName: string;
  /** Signature attack name, shown briefly at the attacker. */
  caption: string | null;
  /** Which rule chose the style (for tests and debugging). */
  rule: string;
};

const ATTRIBUTE_NAMES: ReadonlyArray<readonly [number, TintKey]> = [
  [ATTRIBUTE.EARTH, "EARTH"],
  [ATTRIBUTE.WATER, "WATER"],
  [ATTRIBUTE.FIRE, "FIRE"],
  [ATTRIBUTE.WIND, "WIND"],
  [ATTRIBUTE.LIGHT, "LIGHT"],
  [ATTRIBUTE.DARK, "DARK"],
  [ATTRIBUTE.DIVINE, "DIVINE"],
];

export function attributeName(attribute: number | undefined): TintKey | null {
  const bits = attribute ?? 0;
  for (const [bit, name] of ATTRIBUTE_NAMES) if (bits & bit) return name;
  return null;
}

export function tintOf(key: TintKey | Tint | null | undefined): Tint {
  if (key == null) return TINTS.LIGHT;
  if (typeof key === "string") return TINTS[key] ?? TINTS.LIGHT;
  return key;
}

/** The attack style for a card. Never throws; an unknown card gets the default impact in a light tint. */
export function attackStyleFor(card: AttackCardLike | null | undefined): AttackStyle {
  const attrName = attributeName(card?.attribute);
  const attrTint: Tint = attrName ? TINTS[attrName] : TINTS.LIGHT;
  const fallbackName = attrName ?? "LIGHT";
  const sig = card?.code != null ? SIGNATURES[card.code] : undefined;
  if (sig) {
    return {
      style: sig.style,
      tint: sig.tint ? tintOf(sig.tint) : attrTint,
      tintName: typeof sig.tint === "string" ? sig.tint : sig.tint ? "custom" : fallbackName,
      caption: sig.caption ?? null,
      rule: `signature ${card?.code}`,
    };
  }
  const name = card?.name ?? "";
  for (const rule of NAME_RULES) {
    if (rule.re.test(name)) return { style: rule.style, tint: attrTint, tintName: fallbackName, caption: null, rule: rule.label };
  }
  const byRace = card?.race ? RACE_STYLES[card.race] : undefined;
  if (byRace) return { style: byRace, tint: attrTint, tintName: fallbackName, caption: null, rule: `race ${card?.race}` };
  return { style: "impact", tint: attrTint, tintName: fallbackName, caption: null, rule: "default" };
}

/* ---------- timing of one whole attack ---------- */

/**
 * How the fight reads on screen. `held` = neither monster is destroyed and nobody is hurt (a
 * defender holds); `bounce` = neither is destroyed, but the attacker's controller takes the damage
 * (a Defense Position defender with higher DEF: the blow bounces back); `lose` = the attacker dies
 * alone and the defender strikes back; `tie` = both die, after the defender's counter strike.
 */
export type BattleKind = "direct" | "win" | "lose" | "tie" | "held" | "bounce";

export function battleKind(direct: boolean, destroyed: { attacker: boolean; target: boolean }, attackerHurt = false): BattleKind {
  if (direct) return "direct";
  if (destroyed.attacker && destroyed.target) return "tie";
  if (destroyed.attacker) return "lose";
  if (destroyed.target) return "win";
  return attackerHurt ? "bounce" : "held";
}

/** Counter strike: starts this long after the attacker's impact (a short pause to read the first hit), at this speed. */
export const COUNTER_GAP_MS = ATTACK_TIMING.counterGapMs;
export const COUNTER_SCALE = 0.92;
/** How long after the impact the destroyed card's break-up takes at most. */
export const DESTROY_TAIL_MS = 900;
/**
 * A destroyed card breaks this long after the strike that killed it lands, so the hit and the
 * start of the LP roll are seen first (the card never breaks before, or while, the strike travels).
 */
export const DESTROY_BEAT_MS = ATTACK_TIMING.destroyBeatMs;
/** The Graveyard flight starts this long after the slice, so the halves are seen before the card leaves. */
export const GRAVEYARD_AFTER_SLICE_MS = BREAK_SETTLE_MS;
/** No fight holds the prompts longer than this (the slowest counter fight is about 3 s). */
export const MAX_BATTLE_MS = ATTACK_TIMING.maxBattleMs;

export type BattleTiming = {
  /** The attacker's strike lands (damage to the defender rolls here). */
  impactMs: number;
  /** When damage that lands on the attacker's own seat rolls (the counter's impact when the defender strikes back). */
  attackerDamageMs: number;
  /** When the destroyed target breaks (null when it survives). Always after the strike that killed it landed. */
  targetBreakMs: number | null;
  /** When the destroyed attacker breaks (null when it survives). After the counter strike, if any. */
  attackerBreakMs: number | null;
  /** Whole sequence, prompts wait for this. */
  totalMs: number;
};

/** Kinds where the defender strikes back with its own style. */
export function hasCounterStrike(kind: BattleKind): boolean {
  return kind === "lose" || kind === "tie" || kind === "bounce";
}

export function battleTiming(kind: BattleKind, attacker: AttackStyleId, defender: AttackStyleId | null): BattleTiming {
  const a = STYLE_TIMING[attacker];
  if (hasCounterStrike(kind) && defender) {
    const d = STYLE_TIMING[defender];
    const start = a.impact + COUNTER_GAP_MS;
    const counterImpact = Math.round(start + d.impact * COUNTER_SCALE);
    const slice = kind === "bounce" ? null : counterImpact + DESTROY_BEAT_MS;
    const fightMs = Math.round(Math.max(a.total, start + d.total * COUNTER_SCALE));
    return {
      impactMs: a.impact,
      attackerDamageMs: counterImpact,
      // A tie slices both cards together, after the counter landed: the defender never breaks while it strikes.
      targetBreakMs: kind === "tie" ? slice : null,
      attackerBreakMs: kind === "lose" || kind === "tie" ? slice : null,
      totalMs: Math.min(MAX_BATTLE_MS, fightMs + (slice == null ? 0 : DESTROY_BEAT_MS)),
    };
  }
  if (kind === "win") {
    return { impactMs: a.impact, attackerDamageMs: a.impact + ATTACK_TIMING.attackerDamageGapMs, targetBreakMs: a.impact + DESTROY_BEAT_MS, attackerBreakMs: null, totalMs: a.total + DESTROY_BEAT_MS };
  }
  // A direct attack ends a beat later: the plate takes the blow and its number rolls before the next thing happens.
  const tail = kind === "direct" ? ATTACK_TIMING.directTailMs : 0;
  return { impactMs: a.impact, attackerDamageMs: a.impact + ATTACK_TIMING.attackerDamageGapMs, targetBreakMs: null, attackerBreakMs: null, totalMs: a.total + tail };
}

export type BattleBeatId =
  | "strike-start"
  | "strike-impact"
  | "counter-start"
  | "counter-impact"
  | "slice-target"
  | "slice-attacker"
  | "graveyard-target"
  | "graveyard-attacker";

export type BattleBeat = { id: BattleBeatId; atMs: number };

/**
 * The fight as an ordered list of beats, from the same numbers the picture, the sound, the LP
 * roll and the destroy holds use. The order the player must see:
 *   1 the attacker's strike lands, 2 a short pause, 3 the defender strikes back in its own style,
 *   4 the counter lands on the attacker, 5 only then the loser is sliced, 6 then it goes to the Graveyard.
 * A win has no counter: strike, slice, Graveyard. Beats with the same time keep this order.
 */
export function battleTimeline(kind: BattleKind, attacker: AttackStyleId, defender: AttackStyleId | null): BattleBeat[] {
  const t = battleTiming(kind, attacker, defender);
  const beats: BattleBeat[] = [
    { id: "strike-start", atMs: 0 },
    { id: "strike-impact", atMs: t.impactMs },
  ];
  if (hasCounterStrike(kind) && defender) {
    beats.push({ id: "counter-start", atMs: t.impactMs + COUNTER_GAP_MS }, { id: "counter-impact", atMs: t.attackerDamageMs });
  }
  if (t.targetBreakMs != null) {
    beats.push({ id: "slice-target", atMs: t.targetBreakMs }, { id: "graveyard-target", atMs: t.targetBreakMs + GRAVEYARD_AFTER_SLICE_MS });
  }
  if (t.attackerBreakMs != null) {
    beats.push({ id: "slice-attacker", atMs: t.attackerBreakMs }, { id: "graveyard-attacker", atMs: t.attackerBreakMs + GRAVEYARD_AFTER_SLICE_MS });
  }
  return beats.map((beat, index) => ({ beat, index })).sort((x, y) => x.beat.atMs - y.beat.atMs || x.index - y.index).map((entry) => entry.beat);
}
