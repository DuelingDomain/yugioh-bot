import {
  CARDS_PER_PLAYER_MAX,
  CARDS_PER_PLAYER_MIN,
  EXTRA_DECK_SIZE_MAX,
  LOBBY_SEATS_DEFAULT,
  LOBBY_SEATS_MAX,
  LOBBY_SEATS_MIN,
  PACK_SIZE_MAX,
  PACK_SIZE_MIN,
  PICK_SECONDS_MAX,
  PICK_SECONDS_MIN,
  ROUNDS_MAX,
  ROUNDS_MIN,
  configFromFields,
  validateFields,
  type DraftConfigFieldsValue,
} from "../draft-config-fields";

/**
 * Workbench rules, without any UI. The fields are the same strings the older forms edit
 * (`DraftConfigFieldsValue`), plus a derived round count and a seat target, so the result still goes
 * through `configFromFields` and `validateFields`.
 *
 * Words: a "pile" is one pack (`packSize`), a "round" is one pack per player (`packsPerPlayer`), and
 * "picks" is `cardsPerPlayer`, the cards each player keeps from the Main rounds. A round deals
 * `seats x pile` cards, so full Main demand is `seats x rounds x pile` copies. Partial final piles
 * need only `seats x picks` copies to give each player their cap.
 */

export type RulesFields = DraftConfigFieldsValue;

/** Copies in the pool, by deck. `mainReachable` is optional: Main copies a player can use after the 3-copy cap. */
export interface PoolCounts {
  main: number;
  extra: number;
  mainReachable?: number;
}

export interface Rules {
  seats: number;
  rounds: number;
  pile: number;
  /** Cards each player keeps from the Main rounds (cardsPerPlayer). */
  picks: number;
  picksPerStep: 1 | 2;
  pickSeconds: number;
  copyLimit: boolean;
  extraEnabled: boolean;
  extraSize: number;
}

export const DEFAULT_PICK_SECONDS_CHOICES = [30, 45, 60, 90] as const;

/** Rules as the fields mean them. Every number is clamped, so the math below never sees a bad value. */
export function readRules(fields: RulesFields): Rules {
  const config = configFromFields(fields);
  return {
    seats: config.lobbySeats ?? LOBBY_SEATS_DEFAULT,
    rounds: config.packsPerPlayer,
    pile: config.packSize,
    picks: config.cardsPerPlayer,
    picksPerStep: config.picksPerStep,
    pickSeconds: config.pickSeconds,
    copyLimit: config.copyLimit,
    extraEnabled: config.extraDeckEnabled,
    extraSize: config.extraDeckSize,
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Raw typed number, or NaN. */
const raw = (text: string | undefined) => parseInt(text ?? "");

// ----- edits -----

export type RuleTextKey = "seats" | "rounds" | "pile" | "picks" | "pickSeconds" | "extraSize";

/** The host chooses the cap independently of pile size; round text is retained only for old callers. */
export function editRule(fields: RulesFields, key: RuleTextKey, text: string): RulesFields {
  switch (key) {
    case "seats": return { ...fields, lobbySeatsText: text };
    case "pickSeconds": return { ...fields, pickSecondsText: text };
    case "extraSize": return { ...fields, extraDeckSizeText: text };
    case "picks": return { ...fields, cardsPerPlayerText: text };
    case "rounds": return { ...fields, roundsText: text };
    case "pile": return { ...fields, packSizeText: text };
  }
}

/** Step a number by one, from its clamped value. */
export function stepRule(fields: RulesFields, key: RuleTextKey, delta: 1 | -1): RulesFields {
  const rules = readRules(fields);
  const [lo, hi] = RULE_LIMITS[key];
  return editRule(fields, key, String(clamp(rules[key] + delta, lo, hi)));
}

/** Hard limits the panel enforces on typing and stepping. */
export const RULE_LIMITS: Record<RuleTextKey, readonly [number, number]> = {
  seats: [LOBBY_SEATS_MIN, LOBBY_SEATS_MAX],
  rounds: [ROUNDS_MIN, ROUNDS_MAX],
  pile: [PACK_SIZE_MIN, PACK_SIZE_MAX],
  picks: [CARDS_PER_PLAYER_MIN, CARDS_PER_PLAYER_MAX],
  pickSeconds: [PICK_SECONDS_MIN, PICK_SECONDS_MAX],
  extraSize: [0, EXTRA_DECK_SIZE_MAX],
};

/** Put a typed number back inside its limits, such as when the input loses focus. */
export function settleRule(fields: RulesFields, key: RuleTextKey): RulesFields {
  const text = key === "pile" ? fields.packSizeText
    : key === "rounds" ? fields.roundsText ?? String(readRules(fields).rounds)
    : key === "seats" ? fields.lobbySeatsText ?? String(LOBBY_SEATS_DEFAULT)
    : key === "picks" ? fields.cardsPerPlayerText
    : key === "pickSeconds" ? fields.pickSecondsText
    : fields.extraDeckSizeText ?? "";
  const n = raw(text);
  const [lo, hi] = RULE_LIMITS[key];
  const fallback = key === "extraSize" ? hi : lo;
  const settled = String(Number.isFinite(n) ? clamp(n, lo, hi) : fallback);
  return settled === text ? fields : editRule(fields, key, settled);
}

export function setPicksPerStep(fields: RulesFields, picksPerStep: 1 | 2): RulesFields {
  return { ...fields, picksPerStep };
}

// ----- presets -----

export type RulePresetId = "community" | "quick";

export interface RulePreset {
  id: RulePresetId;
  /** rounds x seats x pile, as the owner reads it. */
  label: string;
  /** The totals, literally. */
  detail: string;
  rules: Pick<Rules, "seats" | "rounds" | "pile" | "picks" | "picksPerStep" | "pickSeconds">;
}

const presetLabel = (r: Pick<Rules, "seats" | "rounds" | "pile" | "picksPerStep">) =>
  `${r.rounds} × ${r.seats} × ${r.pile} · ${r.picksPerStep}-pick`;

function makePreset(id: RulePresetId, rules: RulePreset["rules"]): RulePreset {
  return { id, label: presetLabel(rules), detail: `${rules.picks} Main Deck cards each, ${rules.seats * rules.rounds * rules.pile} cards dealt`, rules };
}

/** 5 x 4 x 24 two-pick (120 Main picks) and 3 x 4 x 15 one-pick (45 Main picks). */
export const RULE_PRESETS: readonly RulePreset[] = [
  makePreset("community", { seats: 4, rounds: 5, pile: 24, picks: 120, picksPerStep: 2, pickSeconds: 45 }),
  makePreset("quick", { seats: 4, rounds: 3, pile: 15, picks: 45, picksPerStep: 1, pickSeconds: 30 }),
];

export function applyPreset(fields: RulesFields, id: RulePresetId): RulesFields {
  const preset = RULE_PRESETS.find((p) => p.id === id);
  if (!preset) return fields;
  const r = preset.rules;
  return {
    ...fields,
    lobbySeatsText: String(r.seats),
    roundsText: String(r.rounds),
    packSizeText: String(r.pile),
    cardsPerPlayerText: String(r.picks),
    picksPerStep: r.picksPerStep,
    pickSecondsText: String(r.pickSeconds),
  };
}

/**
 * Where a new booster draft form starts: 4 seats, 1 pick per turn, piles of 10, 40 Main Deck cards each (4 rounds), 45s.
 * It is not a preset, so no preset chip is pressed. The host raises the numbers from here.
 */
export const START_RULES: RulePreset["rules"] = { seats: 4, rounds: 4, pile: 10, picks: 40, picksPerStep: 1, pickSeconds: 45 };

export function applyStartRules(fields: RulesFields): RulesFields {
  const r = START_RULES;
  return {
    ...fields,
    lobbySeatsText: String(r.seats),
    roundsText: String(r.rounds),
    packSizeText: String(r.pile),
    cardsPerPlayerText: String(r.picks),
    picksPerStep: r.picksPerStep,
    pickSecondsText: String(r.pickSeconds),
  };
}

/** The preset the fields spell out, if any. */
export function matchPreset(fields: RulesFields): RulePresetId | null {
  const rules = readRules(fields);
  const hit = RULE_PRESETS.find((p) => (Object.keys(p.rules) as Array<keyof RulePreset["rules"]>).every((k) => rules[k] === p.rules[k]));
  return hit?.id ?? null;
}

// ----- the math -----

export interface RulesAnalysis {
  rules: Rules;
  /** seats x rounds x pile. */
  mainDemand: number;
  /** Separate Extra round: seats x extra size. 0 when the round is off. */
  extraDemand: number;
  mainHave: number;
  extraHave: number;
  /** Main copies missing from a full deal, including cards beyond each player's cap. */
  mainShort: number;
  /** Main copies missing from seats x picks, even with partial final piles. */
  mainPicksShort: number;
  extraShort: number;
  /** Main copies left out of the deal. */
  spare: number;
  /** Cards each player is dealt in the Main rounds (rounds x pile). */
  dealtEach: number;
  /** Cards each player keeps from the Main rounds. */
  picksEach: number;
  /** Dealt cards a player never gets to pick (dealt - picks, never negative). */
  unpickedEach: number;
  extraEach: number;
  /** Timed picks per player. A 2-pick turn is two timed picks, one after the other. */
  timedPicks: number;
  /** Slowest case: every pick uses the whole timer. */
  maxMinutes: number;
  /** Extra Deck cards in the pool that are not dealt, because the Extra round is off. */
  extraIdle: number;
  emptyPool: boolean;
  errors: string[];
  warnings: string[];
  ok: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function analyzeRules(fields: RulesFields, pool: PoolCounts): RulesAnalysis {
  const rules = readRules(fields);
  const mainDemand = rules.seats * rules.rounds * rules.pile;
  const extraEach = rules.extraEnabled ? rules.extraSize : 0;
  const extraDemand = rules.seats * extraEach;
  const emptyPool = pool.main + pool.extra === 0;
  const mainShort = Math.max(0, mainDemand - pool.main);
  const mainPicksShort = Math.max(0, rules.seats * rules.picks - pool.main);
  const extraShort = Math.max(0, extraDemand - pool.extra);
  const dealtEach = rules.rounds * rules.pile;
  const timedPicks = rules.picks + extraEach;
  const errors: string[] = [];
  const warnings: string[] = [];

  const fieldError = validateFields(fields);
  if (fieldError) errors.push(fieldError);
  if (emptyPool) errors.push("Add cards to the pool");
  else {
    if (mainPicksShort > 0) errors.push(`Main piles are ${plural(mainPicksShort, "card", "cards")} short`);
    if (mainShort > 0) warnings.push(`A full deal needs ${mainDemand} Main cards, but the pool has ${pool.main}. The last round will use partial piles.`);
    if (extraShort > 0) errors.push(`Extra Deck piles are ${extraShort} cards short`);
  }
  if (!emptyPool && pool.mainReachable !== undefined && pool.mainReachable < rules.picks && rules.copyLimit) {
    warnings.push(`A player can use only ${pool.mainReachable} Main cards under the 3-copy limit, but takes ${rules.picks}`);
  }
  const unpickedEach = Math.max(0, dealtEach - rules.picks);
  if (unpickedEach > 0) warnings.push(`${plural(unpickedEach, "card", "cards")} in each player's last round ${unpickedEach === 1 ? "isn't" : "aren't"} picked`);

  return {
    rules,
    mainDemand,
    extraDemand,
    mainHave: pool.main,
    extraHave: pool.extra,
    mainShort,
    mainPicksShort,
    extraShort,
    spare: Math.max(0, pool.main - mainDemand),
    dealtEach,
    picksEach: rules.picks,
    unpickedEach,
    extraEach,
    timedPicks,
    maxMinutes: Math.ceil((timedPicks * rules.pickSeconds) / 60),
    extraIdle: rules.extraEnabled ? 0 : pool.extra,
    emptyPool,
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

/** One line for the footer above the Create action. */
export function readinessText(a: RulesAnalysis): string {
  if (!a.ok) return a.errors[0];
  return `Ready · ${plural(a.rules.seats, "seat", "seats")} open`;
}

/** The collapsed header: "4P · 5R · 24 · 2-pick · 45s". */
export function rulesSummary(fields: RulesFields): string {
  const r = readRules(fields);
  return `${r.seats}P · ${r.rounds}R · ${r.pile} · ${r.picksPerStep}-pick · ${r.pickSeconds}s`;
}

export function extraSummary(fields: RulesFields): string {
  const r = readRules(fields);
  return r.extraEnabled ? `On · ${r.extraSize} per player` : "Off";
}

// ----- Fit to pool -----

export interface FitResult {
  /** Both decks fit after the change (or already did). */
  ok: boolean;
  fields: RulesFields;
  /** Plain sentences for what changed. Empty when nothing needed to. */
  changes: string[];
  /** Main copies still missing when even 40 picks per player do not fit. 0 when Main fits. */
  mainDeficit: number;
  /** Extra copies still missing for the separate Extra round. 0 when it fits or is off. */
  extraDeficit: number;
}

/**
 * Smallest change that fills each player's cap from the pool, never an illegal preset. Main stays
 * unchanged when partial final piles fill the cap. Otherwise it keeps the
 * rounds when it can, else the closest round count, and always stays within 40-120 picks, piles of
 * 5 or more, and the pool. No legal fit leaves Main as it is and reports the deficit.
 */
export function fitRulesToPool(fields: RulesFields, pool: PoolCounts): FitResult {
  const rules = readRules(fields);
  let next = fields;
  const changes: string[] = [];
  let mainDeficit = 0;
  let extraDeficit = 0;

  if (rules.seats * rules.picks > pool.main) {
    const each = Math.floor(pool.main / rules.seats);
    let best: { rounds: number; pile: number } | null = null;
    for (let rounds = ROUNDS_MIN; rounds <= ROUNDS_MAX; rounds++) {
      const pile = Math.min(PACK_SIZE_MAX, Math.floor(each / rounds), Math.floor(CARDS_PER_PLAYER_MAX / rounds));
      if (pile < PACK_SIZE_MIN || pile < rules.picksPerStep || rounds * pile < CARDS_PER_PLAYER_MIN) continue;
      const better = !best
        || Math.abs(rounds - rules.rounds) < Math.abs(best.rounds - rules.rounds)
        || (Math.abs(rounds - rules.rounds) === Math.abs(best.rounds - rules.rounds) && rounds * pile > best.rounds * best.pile);
      if (better) best = { rounds, pile };
    }
    if (best) {
      const picks = Math.min(rules.picks, best.rounds * best.pile);
      next = { ...next, roundsText: String(best.rounds), packSizeText: String(best.pile),
        cardsPerPlayerText: String(picks) };
      changes.push(`${best.rounds} rounds of ${best.pile} per pile use ${rules.seats * best.rounds * best.pile} of ${pool.main} Main cards`);
      if (picks !== rules.picks) changes.push(`Main Deck cards each: ${rules.picks} -> ${picks}`);
    } else {
      mainDeficit = Math.max(1, rules.seats * CARDS_PER_PLAYER_MIN - pool.main);
    }
  }

  if (rules.extraEnabled && rules.seats * rules.extraSize > pool.extra) {
    const size = Math.min(EXTRA_DECK_SIZE_MAX, Math.floor(pool.extra / rules.seats));
    if (size >= 1) {
      next = editRule(next, "extraSize", String(size));
      changes.push(`Extra Deck round: ${size} per player`);
    } else {
      extraDeficit = rules.seats - pool.extra;
    }
  }

  return { ok: mainDeficit === 0 && extraDeficit === 0, fields: next, changes, mainDeficit, extraDeficit };
}
