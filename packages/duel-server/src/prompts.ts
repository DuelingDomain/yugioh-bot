import type { DuelAnswer, DuelCardInfo, DuelChainMode, DuelFormat, DuelPrompt, DuelPromptOption, DuelPromptSource, DuelZoneRef } from "@yugidraft/shared/duels";
import { teamOfSeat } from "@yugidraft/shared/duels";
import { chainWindowPasses, effectYesNoPasses, effectiveChainMode } from "./chain-mode.js";
import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgRPS,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  cardMatchesOpcode,
  ocgAttributeParse,
  ocgPositionParse,
  ocgRaceParse,
  type OcgAttribute,
  type OcgCardLoc,
  type OcgMessage,
  type OcgOpCode,
  type OcgRace,
  type OcgResponse,
  type SelectFieldPlace,
} from "ocgcore-wasm";
import type { CardDatabase } from "./cards.js";
import { cardInfoLabel } from "./cards.js";
import { attributeName, fillPlaceholders, locationLabel, positionLabel, raceName, type TemplateValue } from "./text.js";
import { DOMAIN_LEAVE_TAX_STEP, DUELIST_NONE, LOCATION_DECKMASTER, type DomainSeatState } from "./views.js";
import { sortCardResponse } from "./sort-response.js";
export { sortCardResponse } from "./sort-response.js";

export interface MapPromptExtras {
  recall?: { card: DuelCardInfo; returns: number; nextCost: number };
  domain?: readonly DomainSeatState[];
  /** Card code from the last HINT_CARD the core sent: the card whose effect the next prompts belong to. */
  hintCard?: number;
  /**
   * The seat that the upper half of a SELECT_PLACE / SELECT_DISFIELD mask names. The message has no seat for it, and
   * the core reads only the sequence of the answer (any living other seat passes). Default `player ^ 1` (1v1);
   * with more seats the engine gives the next living opponent in turn order (`player ^ 1` can be no seat at all,
   * and in Tag it must not be a partner: see `nextLivingOpponentSeat`).
   */
  placeOpponent?: number;
  /**
   * The seat from the core's last HINT_PLACE_SEAT. It names the seat of the high half of the next SELECT_PLACE /
   * SELECT_DISFIELD mask and wins over `placeOpponent`. Absent on old cores and in 1v1. The core sends it in Tag
   * too: Tag has separate fields for each seat, so the seat of the high half matters there as well.
   */
  placeSeat?: number;
  /**
   * Seats that may be offered in an opponent or direct-attack pick (still in the duel and not leaving).
   */
  livingSeats?: readonly number[];
  /** Seats whose loss has landed. Their cards and zones are no longer part of the board. */
  eliminatedSeats?: readonly number[];
  /** Old zones of cards the core removed while a choice was open, including cards on living fields. */
  removedCards?: readonly DuelZoneRef[];
  /** The Synchro monster explicitly chosen for an inherent summon, with its queried Level. */
  synchroSummon?: DuelZoneRef & { code: number; level: number };
}

/** strings.conf: `Use the effect of "%ls" from [%ls]?` — the core's default for a SELECT_EFFECTYN without a description. */
const EFFECTYN_DEFAULT_DESC = 200;

/** Card strings are `code << 20 | index`; anything that fits in 32 bits is a card code or a system string. */
export function cardStringCode(desc: bigint | number): number {
  const value = typeof desc === "bigint" ? desc : BigInt(desc);
  return value > 0xffffffffn ? Number(value >> 20n) : 0;
}

/** Resolve a strings.conf / card string and fill its placeholders (card name, location, number, in that order). */
export function effectLabel(cards: CardDatabase, desc: bigint | number, values: readonly TemplateValue[] = []): string {
  return fillPlaceholders(cards.resolveLabel(desc), values);
}

function sourceOf(cards: CardDatabase, code: number | undefined, seat: number, zone?: DuelZoneRef): DuelPromptSource | undefined {
  if (!code) return undefined;
  const info = cards.get(code);
  if (!info) return undefined;
  const source: DuelPromptSource = { code, name: info.name, seat, text: info.description };
  if (zone) source.zone = zone;
  return source;
}

/**
 * The source of a prompt for a card at `place`. A controller of 0xFF means "no duelist" (three or more seats):
 * the card has no seat or zone, so the answering seat stands in, as when the engine gave no location at all.
 */
function sourceAt(cards: CardDatabase, code: number | undefined, place: { controller: number; location: number; sequence: number }, answering: number): DuelPromptSource | undefined {
  if (place.controller === DUELIST_NONE) return sourceOf(cards, code, answering);
  return sourceOf(cards, code, place.controller, zoneRef(place));
}

function zoneRef(place: { controller: number; location: number; sequence: number }): DuelZoneRef {
  return { controller: place.controller, location: place.location, sequence: place.sequence };
}

export function recallPromptContext(
  state: { code: number; returns: number },
  cards: CardDatabase,
): { type: "deck-master-recall"; card: DuelCardInfo; returns: number; nextCost: number } | undefined {
  const card = cards.get(state.code);
  if (!card) return undefined;
  return {
    type: "deck-master-recall",
    card,
    returns: state.returns,
    nextCost: (state.returns + 1) * DOMAIN_LEAVE_TAX_STEP,
  };
}

export class EngineAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineAnswerError";
  }
}

export interface PendingPrompt {
  id: string;
  seat: number;
  prompt: DuelPrompt;
  message: OcgMessage;
}

const WAITING_TYPES = new Set<OcgMessageType>([
  OcgMessageType.SELECT_BATTLECMD,
  OcgMessageType.SELECT_IDLECMD,
  OcgMessageType.SELECT_EFFECTYN,
  OcgMessageType.SELECT_YESNO,
  OcgMessageType.SELECT_OPTION,
  OcgMessageType.SELECT_CARD,
  OcgMessageType.SELECT_CHAIN,
  OcgMessageType.SELECT_PLACE,
  OcgMessageType.SELECT_POSITION,
  OcgMessageType.SELECT_TRIBUTE,
  OcgMessageType.SORT_CHAIN,
  OcgMessageType.SELECT_COUNTER,
  OcgMessageType.SELECT_SUM,
  OcgMessageType.SELECT_DISFIELD,
  OcgMessageType.SORT_CARD,
  OcgMessageType.SELECT_UNSELECT_CARD,
  OcgMessageType.ANNOUNCE_RACE,
  OcgMessageType.ANNOUNCE_ATTRIB,
  OcgMessageType.ANNOUNCE_CARD,
  OcgMessageType.ANNOUNCE_NUMBER,
  OcgMessageType.ROCK_PAPER_SCISSORS,
]);

export function isWaitingMessage(message: OcgMessage): boolean {
  return WAITING_TYPES.has(message.type);
}

/** Direct-attack pick (multi-duelist cores): a SELECT_OPTION entry `0xFFFF0000 | duelist` means "attack that duelist". */
export function directAttackSeat(desc: bigint | number): number | null {
  const value = typeof desc === "bigint" ? desc : BigInt(desc);
  if (value < 0xffff0000n || value > 0xffffffffn) return null;
  const duelist = Number(value & 0xffffn);
  // 0xFF is "no duelist", never a seat to attack.
  return duelist === DUELIST_NONE ? null : duelist;
}

/** Opponent pick (multi-duelist cores): a SELECT_OPTION entry `0xFFFE0000 | duelist` means "choose this opponent". */
export function opponentPickSeat(desc: bigint | number): number | null {
  const value = typeof desc === "bigint" ? desc : BigInt(desc);
  if (value < 0xfffe0000n || value > 0xfffeffffn) return null;
  const duelist = Number(value & 0xffffn);
  return duelist === DUELIST_NONE ? null : duelist;
}

/** True when every entry is an opponent pick (and there is at least one). */
export function isOpponentPick(options: readonly (bigint | number)[]): boolean {
  return options.length > 0 && options.every((option) => opponentPickSeat(option) != null);
}

/** HINT type of the multi-duelist cores: the data is the seat that the high half of the next place mask belongs to. */
export const HINT_PLACE_SEAT = 0xf0;

/** The seat of a HINT_PLACE_SEAT message, or null for any other message (and for "no duelist"). */
export function placeSeatHint(message: OcgMessage): number | null {
  if (message.type !== OcgMessageType.HINT || Number(message.hint_type) !== HINT_PLACE_SEAT) return null;
  const seat = Number(BigInt(message.hint) & 0xffffn);
  return seat === DUELIST_NONE ? null : seat;
}

/**
 * The next living opponent of `seat` in turn order. A Tag partner is never an opponent. When no opponent lives
 * (the duel is over) the first opposing seat of any state is returned, never a team member, so the guess for a
 * place mask stays on the other side. `seat ^ 1` is the last resort for a table with no opposing seat at all.
 */
export function nextLivingOpponentSeat(format: DuelFormat, seatCount: number, seat: number, eliminated: ReadonlySet<number>): number {
  const opposing = (other: number) => teamOfSeat(format, other) !== teamOfSeat(format, seat);
  let fallback: number | null = null;
  for (let step = 1; step < seatCount; step += 1) {
    const other = (seat + step) % seatCount;
    if (!opposing(other)) continue;
    if (!eliminated.has(other)) return other;
    fallback ??= other;
  }
  return fallback ?? seat ^ 1;
}

/**
 * Field places from a placement mask. The high half belongs to one bound opponent. With two duelists
 * that is the other seat; with more, the caller must name it (`opponentSeat`).
 */
export function parseFieldPlaces(mask: number, answeringPlayer: number, opponentSeat: number = answeringPlayer ^ 1): SelectFieldPlace[] {
  const places: SelectFieldPlace[] = [];
  const parsePlayer = (bits: number, player: number) => {
    let value = bits;
    for (let sequence = 0; sequence < 7; sequence++) {
      if ((value & 1) === 0) places.push({ player, location: OcgLocation.MZONE, sequence });
      value >>= 1;
    }
    value >>= 1;
    for (let sequence = 0; sequence < 8; sequence++) {
      if ((value & 1) === 0) places.push({ player, location: OcgLocation.SZONE, sequence });
      value >>= 1;
    }
  };
  parsePlayer(mask & 0xffff, answeringPlayer);
  parsePlayer(mask >> 16, opponentSeat);
  return places;
}

function cardOption(cards: CardDatabase, id: string, code: number, loc: { controller?: number; location?: number; sequence?: number }, extra?: Partial<DuelPromptOption>): DuelPromptOption {
  const info = cards.get(code);
  const option: DuelPromptOption = {
    id,
    label: extra?.label ?? (info?.name ?? `Card ${code}`),
    card: info,
    controller: loc.controller,
    location: loc.location,
    sequence: loc.sequence,
    ...extra,
  };
  if (info?.description && option.cardText == null) option.cardText = info.description;
  return option;
}

/** The effect text of an activatable card entry, with the card's name and location filled in. */
function activationEffect(cards: CardDatabase, card: OcgCardLoc & { description: bigint | number }): string {
  return effectLabel(cards, card.description, [cardInfoLabel(cards, card.code), locationLabel(card.location, card.sequence)]);
}

function sumParamValues(amount: number): number[] {
  const low = amount & 0xffff;
  const high = amount >>> 16;
  return high ? [low, high] : [low];
}

function sumParamLabel(cards: CardDatabase, code: number, amount: number): string {
  const values = sumParamValues(amount);
  return `${cardInfoLabel(cards, code)} (${values.join(" or ")})`;
}

function yesNo(seat: number, id: string, title: string, description: string | undefined, card?: DuelCardInfo, source?: DuelPromptSource): PendingPrompt {
  const bound = (choice: "yes" | "no", label: string): DuelPromptOption => {
    const option: DuelPromptOption = { id: choice, label };
    if (card) {
      option.card = card;
      if (card.description) option.cardText = card.description;
    }
    return option;
  };
  const prompt: DuelPrompt = {
    id,
    seat,
    kind: "choice",
    title,
    options: [bound("yes", "Yes"), bound("no", "No")],
    min: 1,
    max: 1,
  };
  if (description && description !== title) prompt.description = description;
  if (source) prompt.source = source;
  return {
    id,
    seat,
    prompt,
    message: { type: OcgMessageType.SELECT_YESNO, player: seat, description: 0n },
  };
}

function zoneLabel(place: SelectFieldPlace): string {
  const owner = `P${place.player + 1}`;
  if (place.location === OcgLocation.MZONE) {
    if (place.sequence === 5) return `${owner} Extra Monster Zone (left)`;
    if (place.sequence === 6) return `${owner} Extra Monster Zone (right)`;
    return `${owner} Monster Zone ${place.sequence + 1}`;
  }
  if (place.sequence === 5) return `${owner} Field Zone`;
  if (place.sequence === 6) return `${owner} Left Pendulum Zone`;
  if (place.sequence === 7) return `${owner} Right Pendulum Zone`;
  return `${owner} Spell & Trap Zone ${place.sequence + 1}`;
}

function idleOptions(message: Extract<OcgMessage, { type: OcgMessageType.SELECT_IDLECMD }>, cards: CardDatabase): DuelPromptOption[] {
  const options: DuelPromptOption[] = [];
  const pushLoc = (prefix: string, actionLabel: string, list: OcgCardLoc[]) => {
    list.forEach((card, index) => {
      options.push(cardOption(cards, `${prefix}:${index}`, card.code, card, { label: `${actionLabel} ${cardInfoLabel(cards, card.code)}`, values: [index] }));
    });
  };
  pushLoc("summon", "Normal Summon", message.summons);
  pushLoc("spsummon", "Special Summon", message.special_summons);
  pushLoc("pos", "Change position of", message.pos_changes);
  pushLoc("mset", "Set monster", message.monster_sets);
  pushLoc("sset", "Set Spell/Trap", message.spell_sets);
  message.activates.forEach((card, index) => {
    const effect = activationEffect(cards, card);
    options.push(cardOption(cards, `activate:${index}`, card.code, card, {
      label: effect ? `Activate ${cardInfoLabel(cards, card.code)}: ${effect}` : `Activate ${cardInfoLabel(cards, card.code)}`,
      values: [index],
      ...(effect ? { effectText: effect } : {}),
    }));
  });
  if (message.to_bp) options.push({ id: "to_bp", label: "Enter Battle Phase" });
  if (message.to_ep) options.push({ id: "to_ep", label: "End Phase" });
  if (message.shuffle) options.push({ id: "shuffle", label: "Shuffle hand" });
  return options;
}

/** Filter a new or suspended prompt without changing the indices the core expects. */
export function filterPromptOptions(pending: PendingPrompt, extras: Pick<MapPromptExtras, "livingSeats" | "eliminatedSeats" | "removedCards">): PendingPrompt {
  const seatPick = pending.message.type === OcgMessageType.SELECT_OPTION &&
    pending.message.options.every((option) => directAttackSeat(option) != null || opponentPickSeat(option) != null);
  const options = pending.prompt.options.filter((option) => {
    if (option.card && extras.removedCards?.some((zone) => zone.controller === option.controller &&
      zone.location === option.location && zone.sequence === option.sequence)) return false;
    if (option.controller == null) return true;
    return !extras.eliminatedSeats?.includes(option.controller) &&
      (!seatPick || !extras.livingSeats || extras.livingSeats.includes(option.controller));
  });
  return { ...pending, prompt: { ...pending.prompt, options } };
}

export function mapPrompt(message: OcgMessage, cards: CardDatabase, id: string, selectHint?: string, extras?: MapPromptExtras): PendingPrompt {
  return filterPromptOptions(buildPrompt(message, cards, id, selectHint, extras), extras ?? {});
}

function buildPrompt(message: OcgMessage, cards: CardDatabase, id: string, selectHint?: string, extras?: MapPromptExtras): PendingPrompt {
  // The card the prompt is about: named by the message itself, else by the core's last HINT_CARD.
  const subjectCode = "code" in message && typeof message.code === "number" && message.code ? message.code : extras?.hintCard;
  const subjectName = subjectCode ? cardInfoLabel(cards, subjectCode) : undefined;
  const hint = selectHint ? fillPlaceholders(selectHint, [subjectName]).trim() : undefined;
  // Prompts raised while an effect resolves inherit that effect's card as their source.
  const hinted = (built: PendingPrompt): PendingPrompt => {
    const summon = extras?.synchroSummon;
    if (summon && summon.controller === built.seat && built.prompt.kind === "toggle" &&
      /\bsynchro material\b/i.test(built.prompt.title)) {
      built.prompt.target = summon.level;
      built.prompt.sumMode = "exact";
      built.prompt.source = sourceOf(cards, summon.code, built.seat, zoneRef(summon));
      // A material with its own Synchro Level (Road Synchron) adds a value the core does not report.
      for (const option of built.prompt.options) {
        const code = option.card?.code;
        if (code && cards.readScript(`c${code}.lua`)?.includes("EFFECT_SYNCHRO_LEVEL")) option.synchroLevelVaries = true;
      }
    }
    if (!built.prompt.source && extras?.hintCard) {
      const source = sourceOf(cards, extras.hintCard, built.seat);
      if (source) built.prompt.source = source;
    }
    return built;
  };
  switch (message.type) {
    case OcgMessageType.SELECT_IDLECMD: {
      const options = idleOptions(message, cards);
      // The native protocol's byte-sized location encodes the 0x4000 Master
      // zone as zero. Restore it only against the authoritative in-zone card.
      if (extras?.domain) {
        for (const option of options) {
          const master = option.controller == null ? undefined : extras.domain[option.controller];
          if (option.location === 0 && option.sequence === 0 && master?.inZone && option.card?.code === master.code) {
            option.location = LOCATION_DECKMASTER;
          }
        }
      }
      return {
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "choice",
          title: hint || "Choose an action",
          options,
          min: 1,
          max: 1,
          context: { type: "action", phase: "main" },
        },
        message,
      };
    }
    case OcgMessageType.SELECT_BATTLECMD: {
      const options: DuelPromptOption[] = [];
      message.chains.forEach((card, index) => {
        const effect = activationEffect(cards, card);
        options.push(cardOption(cards, `activate:${index}`, card.code, card, {
          label: effect ? `Activate ${cardInfoLabel(cards, card.code)}: ${effect}` : `Activate ${cardInfoLabel(cards, card.code)}`,
          values: [index],
          ...(effect ? { effectText: effect } : {}),
        }));
      });
      message.attacks.forEach((card, index) => {
        options.push(cardOption(cards, `attack:${index}`, card.code, card, {
          label: card.can_direct ? `Attack directly with ${cardInfoLabel(cards, card.code)}` : `Attack with ${cardInfoLabel(cards, card.code)}`,
          values: [index],
        }));
      });
      if (message.to_m2) options.push({ id: "to_m2", label: "Enter Main Phase 2" });
      if (message.to_ep) options.push({ id: "to_ep", label: "End Phase" });
      return {
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "choice",
          title: hint || "Choose a battle action",
          options,
          min: 1,
          max: 1,
          context: { type: "action", phase: "battle" },
        },
        message,
      };
    }
    case OcgMessageType.SELECT_YESNO: {
      if (extras?.recall) {
        const { card, returns, nextCost } = extras.recall;
        const built = yesNo(
          message.player,
          id,
          hint || `Return ${card.name} to the Deck Master Zone?`,
          `Next summon from the Deck Master Zone costs ${nextCost} LP.`,
          card,
        );
        built.message = message;
        built.prompt.context = { type: "deck-master-recall", card, returns, nextCost };
        return built;
      }
      // The core names no card here; the last HINT_CARD (if any) is the effect being resolved.
      const text = effectLabel(cards, message.description, [subjectName]);
      const built = yesNo(message.player, id, hint || text || "Choose yes or no", text, subjectCode ? cards.get(subjectCode) : undefined);
      built.message = message;
      return hinted(built);
    }
    case OcgMessageType.SELECT_EFFECTYN: {
      const info = cards.get(message.code);
      const values: TemplateValue[] = [cardInfoLabel(cards, message.code), locationLabel(message.location, message.sequence), message.sequence + 1];
      const text = message.description === 0n
        ? fillPlaceholders(cards.system(EFFECTYN_DEFAULT_DESC) ?? "", values)
        : effectLabel(cards, message.description, values);
      const title = hint || text || `Apply the effect of ${cardInfoLabel(cards, message.code)}?`;
      const built = yesNo(message.player, id, title, text, info, sourceAt(cards, message.code, message, message.player));
      built.message = message;
      return built;
    }
    case OcgMessageType.SELECT_OPTION: {
      // Options are usually the card's own strings (`code << 20 | index`), which name the card.
      const optionCodes = message.options.map((option) => cardStringCode(option));
      const shared = optionCodes.find((code) => code !== 0);
      const sourceCode = shared && optionCodes.every((code) => code === 0 || code === shared) ? shared : extras?.hintCard;
      const attackSeats = message.options.map((option) => directAttackSeat(option));
      const attackPick = attackSeats.length > 0 && attackSeats.every((seat) => seat != null);
      const pickSeats = message.options.map((option) => opponentPickSeat(option));
      const opponentPick = !attackPick && pickSeats.length > 0 && pickSeats.every((seat) => seat != null);
      if (opponentPick) {
        // The option index stays the core's index (values[0]); only the seats that can still be picked are listed.
        const all = pickSeats.map((seat, index) => ({ seat: seat as number, index }));
        const pick: DuelPrompt = {
          id,
          seat: message.player,
          kind: "choice",
          title: hint || "Choose an opponent",
          options: all.map(({ seat, index }) => ({ id: `opt:${index}`, label: `Player ${seat + 1}`, controller: seat, values: [index] })),
          min: 1,
          max: 1,
          context: { type: "opponent" },
        };
        const pickSource = sourceOf(cards, extras?.hintCard, message.player);
        if (pickSource) pick.source = pickSource;
        return { id, seat: message.player, prompt: pick, message };
      }
      const prompt: DuelPrompt = {
        id,
        seat: message.player,
        kind: "choice",
        title: hint || (attackPick ? "Select a duelist to attack" : "Select an option"),
        options: message.options.map((option, index) => {
          const attackSeat = attackSeats[index];
          if (attackPick && attackSeat != null) {
            return { id: `opt:${index}`, label: `Attack Player ${attackSeat + 1} directly`, controller: attackSeat, values: [index] };
          }
          const code = optionCodes[index] || sourceCode;
          const name = code ? cardInfoLabel(cards, code) : subjectName;
          const effect = effectLabel(cards, option, [name]);
          const entry: DuelPromptOption = { id: `opt:${index}`, label: effect || `Option ${index + 1}`, values: [index] };
          if (effect) entry.effectText = effect;
          const text = code ? cards.get(code)?.description : undefined;
          if (text) entry.cardText = text;
          return entry;
        }),
        min: 1,
        max: 1,
      };
      const source = sourceOf(cards, sourceCode, message.player);
      if (source) prompt.source = source;
      return { id, seat: message.player, prompt, message };
    }
    case OcgMessageType.SELECT_CARD:
      return hinted({
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "cards",
          title: hint || `Select ${message.min === message.max ? message.min : `${message.min} to ${message.max}`} card(s)`,
          options: message.selects.map((card, index) => cardOption(cards, `card:${index}`, card.code, card)),
          min: message.min,
          max: message.max,
          cancelable: message.can_cancel,
        },
        message,
      });
    case OcgMessageType.SELECT_TRIBUTE:
      return hinted({
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "tribute",
          title: hint || "Select tribute(s)",
          options: message.selects.map((card, index) =>
            cardOption(cards, `card:${index}`, card.code, card, { values: [card.release_param], label: `${cardInfoLabel(cards, card.code)} (${card.release_param})` }),
          ),
          min: message.min,
          max: message.max,
          cancelable: message.can_cancel,
        },
        message,
      });
    case OcgMessageType.SELECT_CHAIN: {
      const options = message.selects.map((card, index) => {
        const effect = activationEffect(cards, card);
        return cardOption(cards, `card:${index}`, card.code, card, {
          label: effect ? `${cardInfoLabel(cards, card.code)}: ${effect}` : cardInfoLabel(cards, card.code),
          ...(effect ? { effectText: effect } : {}),
        });
      });
      const prompt: DuelPrompt = {
        id,
        seat: message.player,
        kind: "choice",
        title: hint || (message.forced ? "Select a mandatory effect" : "Select a chain link or pass"),
        options,
        min: message.forced ? 1 : 0,
        max: 1,
        cancelable: !message.forced,
        context: { type: "chain", forced: message.forced },
      };
      // A single candidate makes the prompt about that one card (a trigger effect asking to activate).
      const only = message.selects.length === 1 ? message.selects[0] : undefined;
      const source = only ? sourceAt(cards, only.code, only, message.player) : undefined;
      if (source) prompt.source = source;
      return { id, seat: message.player, prompt, message };
    }
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD: {
      const places = parseFieldPlaces(message.field_mask, message.player, extras?.placeSeat ?? extras?.placeOpponent);
      return hinted({
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "places",
          title: hint
            ? hint.toLowerCase().startsWith("select")
              ? hint
              : `Select a zone for ${hint}`
            : message.type === OcgMessageType.SELECT_DISFIELD
              ? "Select zone(s) to disable"
              : "Select a zone",
          options: places.map((place, index) => ({
            id: `place:${index}`,
            label: zoneLabel(place),
            controller: place.player,
            location: place.location,
            sequence: place.sequence,
            values: [place.player, place.location, place.sequence],
          })),
          min: message.count,
          max: message.count,
        },
        message,
      });
    }
    case OcgMessageType.SELECT_POSITION: {
      const positions = ocgPositionParse(message.positions);
      const info = cards.get(message.code);
      return hinted({
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "choice",
          title: hint || `Select a position for ${cardInfoLabel(cards, message.code)}`,
          options: positions.map((position) => ({
            id: `pos:${position}`,
            label: positionLabel(position),
            card: info,
            ...(info?.description ? { cardText: info.description } : {}),
            values: [position],
          })),
          min: 1,
          max: 1,
          context: { type: "position" },
        },
        message,
      });
    }
    case OcgMessageType.SELECT_COUNTER:
      return hinted({
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "counters",
          title: hint || `Remove ${message.count} ${cards.counter(message.counter_type) ?? "counter(s)"}`,
          options: message.cards.map((card, index) =>
            cardOption(cards, `card:${index}`, card.code, card, { max: card.count, values: [card.count] }),
          ),
          min: message.count,
          max: message.count,
          target: message.count,
        },
        message,
      });
    case OcgMessageType.SELECT_SUM: {
      const must = message.selects_must.map((card, index) =>
        cardOption(cards, `must:${index}`, card.code, card, { values: sumParamValues(card.amount), selected: true, label: `${sumParamLabel(cards, card.code, card.amount)}, required` }),
      );
      const optional = message.selects.map((card, index) =>
        cardOption(cards, `card:${index}`, card.code, card, { values: sumParamValues(card.amount), label: sumParamLabel(cards, card.code, card.amount) }),
      );
      return hinted({
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "sum",
          title: hint || `Select cards totaling ${message.select_max ? "at least " : ""}${message.amount}`,
          options: [...must, ...optional],
          min: must.length + message.min,
          max: must.length + (message.select_max ? message.selects.length : message.max),
          target: message.amount,
          sumMode: message.select_max ? "at-least" : "exact",
          mandatory: must.map((option) => option.id),
        },
        message,
      });
    }
    case OcgMessageType.SELECT_UNSELECT_CARD: {
      const select = message.select_cards.map((card, index) => cardOption(cards, `select:${index}`, card.code, card, { selected: false }));
      const unselect = message.unselect_cards.map((card, index) => cardOption(cards, `unselect:${index}`, card.code, card, { selected: true }));
      return hinted({
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "toggle",
          title: hint || "Select or unselect a card",
          options: [...select, ...unselect],
          min: message.min,
          max: message.max,
          cancelable: message.can_cancel,
          finishable: message.can_finish,
        },
        message,
      });
    }
    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN:
      return hinted({
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "order",
          title: hint || (message.type === OcgMessageType.SORT_CHAIN ? "Sort the chain" : "Choose the card order"),
          options: message.cards.map((card, index) => cardOption(cards, `card:${index}`, card.code, card)),
          min: message.cards.length,
          max: message.cards.length,
        },
        message,
      });
    case OcgMessageType.ANNOUNCE_RACE: {
      const races = ocgRaceParse(message.available);
      return hinted({
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "cards",
          title: hint || `Announce ${message.count} monster type(s)`,
          options: races.map((race) => ({
            id: `race:${race.toString()}`,
            label: raceName(race),
            values: [Number(race)],
          })),
          min: message.count,
          max: message.count,
        },
        message,
      });
    }
    case OcgMessageType.ANNOUNCE_ATTRIB: {
      const attributes = ocgAttributeParse(message.available);
      return hinted({
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "cards",
          title: hint || `Announce ${message.count} attribute(s)`,
          options: attributes.map((attribute) => ({
            id: `attr:${attribute}`,
            label: attributeName(attribute),
            values: [attribute],
          })),
          min: message.count,
          max: message.count,
        },
        message,
      });
    }
    case OcgMessageType.ANNOUNCE_CARD:
      return hinted({
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "announce-card",
          title: hint || "Announce a card",
          options: [],
          min: 1,
          max: 1,
        },
        message,
      });
    case OcgMessageType.ANNOUNCE_NUMBER:
      return hinted({
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "choice",
          title: hint || "Announce a number",
          options: message.options.map((value, index) => ({
            id: `num:${index}`,
            label: value.toString(),
            values: [Number(value)],
          })),
          min: 1,
          max: 1,
        },
        message,
      });
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return {
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "choice",
          title: hint || "Rock-Paper-Scissors",
          options: [
            { id: "rps:scissors", label: "Scissors", values: [OcgRPS.SCISSORS] },
            { id: "rps:rock", label: "Rock", values: [OcgRPS.ROCK] },
            { id: "rps:paper", label: "Paper", values: [OcgRPS.PAPER] },
          ],
          min: 1,
          max: 1,
        },
        message,
      };
    default:
      throw new EngineAnswerError(`Unhandled engine prompt ${message.type}`);
  }
}

function optionById(prompt: DuelPrompt, id: string): DuelPromptOption {
  const option = prompt.options.find((entry) => entry.id === id);
  if (!option) throw new EngineAnswerError("Invalid answer");
  return option;
}

function selectedIds(prompt: DuelPrompt, answer: DuelAnswer): string[] {
  if (answer.selected) return answer.selected;
  if (answer.choice) return [answer.choice];
  return [];
}

function uniqueIndices(ids: string[], prefix: string): number[] {
  const seen = new Set<number>();
  const indices: number[] = [];
  for (const id of ids) {
    if (!id.startsWith(prefix)) throw new EngineAnswerError("Invalid answer");
    const index = Number(id.slice(prefix.length));
    if (!Number.isInteger(index) || index < 0 || seen.has(index)) throw new EngineAnswerError("Invalid answer");
    seen.add(index);
    indices.push(index);
  }
  return indices;
}

export interface AutoResponseOptions {
  /**
   * Ask about every response window that lists a card, even when none fits the window's timing. Off, a
   * window with spe_count 0 is passed silently. Undefined counts as on: engines without duel settings
   * (and duels saved before the setting existed) must keep producing the prompts they were played with.
   */
  stopAtEveryWindow?: boolean;
  /**
   * The chain mode of the seat the window belongs to (chain-mode.ts). Undefined means the mode that `stopAtEveryWindow`
   * names, so callers that never heard of per-seat modes keep their behaviour.
   */
  chainMode?: DuelChainMode;
  /**
   * The phase the window opens in (the engine's phase name, "draw", "standby", "main1"...). The Draw and
   * Standby Phase are never skipped past a real option: a window that lists a card is offered there even
   * when none fits its timing, so a player holding a Quick-Play Spell or a Trap gets to act. An empty
   * window still passes by itself.
   */
  phase?: string;
}

export function autoResponse(pending: PendingPrompt, options: AutoResponseOptions = {}): OcgResponse | null {
  const { message, prompt } = pending;
  switch (message.type) {
    case OcgMessageType.SELECT_CHAIN:
      if (prompt.options.length === 0) {
        // A mandatory trigger already offered by the core must be consumed, even if its handler
        // was removed. The core controls its resolution and rejects a pass in a forced window.
        return { type: OcgResponseType.SELECT_CHAIN, index: message.forced && message.selects.length > 0 ? 0 : null };
      }
      if (message.forced && prompt.options.length === 1) return { type: OcgResponseType.SELECT_CHAIN, index: uniqueIndices([prompt.options[0]!.id], "card:")[0]! };
      // spe_count is the core's count of listed effects that belong to this window: optional triggers, and
      // free-chain or quick effects whose declared hint timing matches it (every listed card during an
      // attack declaration or a chain). The EDOPro client passes a non-forced window at 0; a Battle Step or
      // Damage Step with only off-timing cards is the case that stalled a direct attack. A card that can
      // really act there (an ATK boost in the Damage Step) declares the timing, so its window stays.
      // The seat's chain mode decides the rest (chain-mode.ts): Auto passes a window where nothing fits, Always never
      // passes one that lists a card, Off passes every optional window, optional triggers too (OFF_SKIPS_OPTIONAL_TRIGGERS).
      if (chainWindowPasses(message, effectiveChainMode(options), options.phase)) {
        return { type: OcgResponseType.SELECT_CHAIN, index: null };
      }
      return null;
    case OcgMessageType.SELECT_CARD:
      if (prompt.options.length === 0 && message.selects.length > 0 && message.can_cancel) {
        return { type: OcgResponseType.SELECT_CARD, indicies: null };
      }
      if (message.min === message.max && message.max === prompt.options.length && prompt.options.length > 0) {
        return { type: OcgResponseType.SELECT_CARD, indicies: uniqueIndices(prompt.options.map((option) => option.id), "card:") };
      }
      if (message.min === 0 && message.max === 0) return { type: OcgResponseType.SELECT_CARD, indicies: [] };
      return null;
    case OcgMessageType.SELECT_TRIBUTE: {
      const indicies = uniqueIndices(prompt.options.map((option) => option.id), "card:");
      if (!message.can_cancel && indicies.length > 0 && indicies.every((index) => message.selects[index]!.release_param === 1) && message.min === message.max && message.min === indicies.length) {
        return { type: OcgResponseType.SELECT_TRIBUTE, indicies };
      }
      return null;
    }
    case OcgMessageType.SELECT_POSITION: {
      const positions = ocgPositionParse(message.positions);
      if (positions.length === 1) return { type: OcgResponseType.SELECT_POSITION, position: positions[0] };
      return null;
    }
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD: {
      // The mapped options carry the seats that mapPrompt chose for the mask (see MapPromptExtras.placeOpponent).
      const places = pending.prompt.options.map((option) => ({
        player: option.controller as number,
        location: option.location as OcgLocation,
        sequence: option.sequence as number,
      }));
      if (places.length === message.count && message.count > 0) {
        return {
          type: message.type === OcgMessageType.SELECT_DISFIELD ? OcgResponseType.SELECT_DISFIELD : OcgResponseType.SELECT_PLACE,
          places,
        };
      }
      return null;
    }
    case OcgMessageType.SELECT_OPTION:
      if (prompt.options.length === 1) return { type: OcgResponseType.SELECT_OPTION, index: prompt.options[0]!.values![0]! };
      return null;
    case OcgMessageType.SELECT_SUM: {
      if (message.selects.length === 0 && message.min === 0) {
        return { type: OcgResponseType.SELECT_SUM, indicies: [] };
      }
      return null;
    }
    case OcgMessageType.SELECT_UNSELECT_CARD:
      if (prompt.options.length === 0 && message.can_finish) {
        return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
      }
      if (prompt.options.length === 1 && prompt.options[0]!.id.startsWith("select:") && message.min === 1 && message.max === 1 && !message.can_cancel && !message.can_finish) {
        return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: uniqueIndices([prompt.options[0]!.id], "select:")[0]! };
      }
      return null;
    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN:
      if (message.cards.length <= 1) return sortCardResponse(null);
      return null;
    case OcgMessageType.SELECT_EFFECTYN:
      // The yes/no of ONE optional trigger of this duelist: Off answers no (chain-mode.ts). Any other effect prompt asks.
      if (effectYesNoPasses(message, effectiveChainMode(options))) return { type: OcgResponseType.SELECT_EFFECTYN, yes: false };
      return null;
    case OcgMessageType.SELECT_IDLECMD:
    case OcgMessageType.SELECT_BATTLECMD:
    case OcgMessageType.SELECT_YESNO:
    case OcgMessageType.ANNOUNCE_RACE:
    case OcgMessageType.ANNOUNCE_ATTRIB:
    case OcgMessageType.ANNOUNCE_CARD:
    case OcgMessageType.ANNOUNCE_NUMBER:
    case OcgMessageType.ROCK_PAPER_SCISSORS:
    case OcgMessageType.SELECT_COUNTER:
      return null;
    default:
      return prompt.options.length === 0 ? null : null;
  }
}

export function resolveAnswer(pending: PendingPrompt, seat: number, promptId: string, answer: DuelAnswer, cards: CardDatabase): OcgResponse {
  if (seat !== pending.seat) throw new EngineAnswerError("Wrong seat");
  if (promptId !== pending.id) throw new EngineAnswerError("Stale prompt");
  const { message, prompt } = pending;
  if (answer.cancel) {
    if (!prompt.cancelable) throw new EngineAnswerError("Invalid answer");
    switch (message.type) {
      case OcgMessageType.SELECT_CARD:
        return { type: OcgResponseType.SELECT_CARD, indicies: null };
      case OcgMessageType.SELECT_TRIBUTE:
        return { type: OcgResponseType.SELECT_TRIBUTE, indicies: null };
      case OcgMessageType.SELECT_CHAIN:
        return { type: OcgResponseType.SELECT_CHAIN, index: null };
      case OcgMessageType.SELECT_UNSELECT_CARD:
        return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
      case OcgMessageType.SORT_CARD:
      case OcgMessageType.SORT_CHAIN:
        return { type: OcgResponseType.SORT_CARD, order: null };
      default:
        throw new EngineAnswerError("Invalid answer");
    }
  }
  if (answer.finish) {
    if (message.type !== OcgMessageType.SELECT_UNSELECT_CARD || !message.can_finish) throw new EngineAnswerError("Invalid answer");
    return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
  }

  switch (message.type) {
    case OcgMessageType.SELECT_IDLECMD: {
      const choice = answer.choice;
      if (!choice) throw new EngineAnswerError("Invalid answer");
      if (choice === "to_bp") return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
      if (choice === "to_ep") return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
      if (choice === "shuffle") return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SHUFFLE, index: null };
      const option = optionById(prompt, choice);
      const index = option.values?.[0];
      if (index == null) throw new EngineAnswerError("Invalid answer");
      const action = choice.startsWith("summon:") ? SelectIdleCMDAction.SELECT_SUMMON
        : choice.startsWith("spsummon:") ? SelectIdleCMDAction.SELECT_SPECIAL_SUMMON
        : choice.startsWith("pos:") ? SelectIdleCMDAction.SELECT_POS_CHANGE
        : choice.startsWith("mset:") ? SelectIdleCMDAction.SELECT_MONSTER_SET
        : choice.startsWith("sset:") ? SelectIdleCMDAction.SELECT_SPELL_SET
        : choice.startsWith("activate:") ? SelectIdleCMDAction.SELECT_ACTIVATE
        : null;
      if (action == null) throw new EngineAnswerError("Invalid answer");
      return { type: OcgResponseType.SELECT_IDLECMD, action, index };
    }
    case OcgMessageType.SELECT_BATTLECMD: {
      const choice = answer.choice;
      if (!choice) throw new EngineAnswerError("Invalid answer");
      if (choice === "to_m2") return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_M2, index: null };
      if (choice === "to_ep") return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
      const option = optionById(prompt, choice);
      const index = option.values?.[0];
      if (index == null) throw new EngineAnswerError("Invalid answer");
      if (choice.startsWith("activate:")) return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_CHAIN, index };
      if (choice.startsWith("attack:")) return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index };
      throw new EngineAnswerError("Invalid answer");
    }
    case OcgMessageType.SELECT_YESNO:
    case OcgMessageType.SELECT_EFFECTYN: {
      const choice = answer.choice;
      if (choice !== "yes" && choice !== "no") throw new EngineAnswerError("Invalid answer");
      return {
        type: message.type === OcgMessageType.SELECT_EFFECTYN ? OcgResponseType.SELECT_EFFECTYN : OcgResponseType.SELECT_YESNO,
        yes: choice === "yes",
      };
    }
    case OcgMessageType.SELECT_OPTION: {
      if (!answer.choice) throw new EngineAnswerError("Invalid answer");
      const option = optionById(prompt, answer.choice);
      const index = option.values?.[0];
      if (index == null) throw new EngineAnswerError("Invalid answer");
      return { type: OcgResponseType.SELECT_OPTION, index };
    }
    case OcgMessageType.SELECT_CARD: {
      const ids = selectedIds(prompt, answer);
      for (const id of ids) optionById(prompt, id);
      if (ids.length < message.min || ids.length > message.max) throw new EngineAnswerError("Invalid answer");
      const indicies = uniqueIndices(ids, "card:");
      if (indicies.some((index) => index >= message.selects.length)) throw new EngineAnswerError("Invalid answer");
      return { type: OcgResponseType.SELECT_CARD, indicies };
    }
    case OcgMessageType.SELECT_TRIBUTE: {
      const ids = selectedIds(prompt, answer);
      for (const id of ids) optionById(prompt, id);
      const indicies = uniqueIndices(ids, "card:");
      if (indicies.some((index) => index >= message.selects.length)) throw new EngineAnswerError("Invalid answer");
      const tribute = indicies.reduce((sum, index) => sum + message.selects[index].release_param, 0);
      if (indicies.length > message.max || tribute < message.min) throw new EngineAnswerError("Invalid answer");
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies };
    }
    case OcgMessageType.SELECT_CHAIN: {
      if (!answer.choice) {
        if (message.forced) throw new EngineAnswerError("Invalid answer");
        return { type: OcgResponseType.SELECT_CHAIN, index: null };
      }
      const option = optionById(prompt, answer.choice);
      const index = uniqueIndices([option.id], "card:")[0]!;
      return { type: OcgResponseType.SELECT_CHAIN, index };
    }
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD: {
      const ids = selectedIds(prompt, answer);
      if (ids.length !== message.count) throw new EngineAnswerError("Invalid answer");
      const places = ids.map((id) => {
        const option = optionById(prompt, id);
        const player = option.controller;
        const location = option.location;
        const sequence = option.sequence;
        if (player == null || location == null || sequence == null) throw new EngineAnswerError("Invalid answer");
        return { player, location: location as OcgLocation, sequence };
      });
      return {
        type: message.type === OcgMessageType.SELECT_DISFIELD ? OcgResponseType.SELECT_DISFIELD : OcgResponseType.SELECT_PLACE,
        places,
      };
    }
    case OcgMessageType.SELECT_POSITION: {
      if (!answer.choice) throw new EngineAnswerError("Invalid answer");
      const option = optionById(prompt, answer.choice);
      const position = option.values?.[0] as OcgPosition | undefined;
      if (position == null) throw new EngineAnswerError("Invalid answer");
      return { type: OcgResponseType.SELECT_POSITION, position };
    }
    case OcgMessageType.SELECT_COUNTER: {
      const counters = message.cards.map((card, index) => {
        const count = answer.counts?.[`card:${index}`] ?? 0;
        if (!Number.isInteger(count) || count < 0 || count > card.count) throw new EngineAnswerError("Invalid answer");
        if (count > 0) optionById(prompt, `card:${index}`);
        return count;
      });
      const total = counters.reduce((sum, count) => sum + count, 0);
      if (total !== message.count) throw new EngineAnswerError("Invalid answer");
      return { type: OcgResponseType.SELECT_COUNTER, counters };
    }
    case OcgMessageType.SELECT_SUM: {
      const ids = selectedIds(prompt, answer).filter((id) => id.startsWith("card:"));
      for (const id of ids) optionById(prompt, id);
      const indicies = uniqueIndices(ids, "card:");
      if (indicies.some((index) => index >= message.selects.length)) throw new EngineAnswerError("Invalid answer");
      if (!message.select_max && (indicies.length < message.min || indicies.length > message.max)) {
        throw new EngineAnswerError("Invalid answer");
      }
      return { type: OcgResponseType.SELECT_SUM, indicies };
    }
    case OcgMessageType.SELECT_UNSELECT_CARD: {
      if (!answer.choice) throw new EngineAnswerError("Invalid answer");
      const option = optionById(prompt, answer.choice);
      const index = option.id.startsWith("select:")
        ? uniqueIndices([option.id], "select:")[0]!
        : message.select_cards.length + uniqueIndices([option.id], "unselect:")[0]!;
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index };
    }
    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN: {
      const ids = answer.selected ?? [];
      if (ids.length !== message.cards.length) throw new EngineAnswerError("Invalid answer");
      const order = uniqueIndices(ids, "card:");
      if (order.some((index) => index >= message.cards.length)) throw new EngineAnswerError("Invalid answer");
      return sortCardResponse(order);
    }
    case OcgMessageType.ANNOUNCE_RACE: {
      const ids = selectedIds(prompt, answer);
      if (ids.length !== message.count) throw new EngineAnswerError("Invalid answer");
      const races = ids.map((id) => {
        const option = optionById(prompt, id);
        return BigInt(option.id.slice("race:".length)) as OcgRace;
      });
      return { type: OcgResponseType.ANNOUNCE_RACE, races };
    }
    case OcgMessageType.ANNOUNCE_ATTRIB: {
      const ids = selectedIds(prompt, answer);
      if (ids.length !== message.count) throw new EngineAnswerError("Invalid answer");
      const attributes = ids.map((id) => optionById(prompt, id).values?.[0] as OcgAttribute);
      if (attributes.some((attribute) => attribute == null)) throw new EngineAnswerError("Invalid answer");
      return { type: OcgResponseType.ANNOUNCE_ATTRIB, attributes };
    }
    case OcgMessageType.ANNOUNCE_CARD: {
      const code = answer.cardCode;
      if (!code) throw new EngineAnswerError("Invalid answer");
      const data = cards.cardData(code);
      if (!data || !cardMatchesOpcode(data, message.opcodes as OcgOpCode[])) throw new EngineAnswerError("Invalid answer");
      return { type: OcgResponseType.ANNOUNCE_CARD, card: code };
    }
    case OcgMessageType.ANNOUNCE_NUMBER: {
      if (answer.choice) {
        const option = optionById(prompt, answer.choice);
        const index = prompt.options.indexOf(option);
        if (index < 0) throw new EngineAnswerError("Invalid answer");
        return { type: OcgResponseType.ANNOUNCE_NUMBER, value: index };
      }
      if (answer.value != null) {
        const index = message.options.findIndex((value) => Number(value) === answer.value);
        if (index < 0) throw new EngineAnswerError("Invalid answer");
        return { type: OcgResponseType.ANNOUNCE_NUMBER, value: index };
      }
      throw new EngineAnswerError("Invalid answer");
    }
    case OcgMessageType.ROCK_PAPER_SCISSORS: {
      if (!answer.choice) throw new EngineAnswerError("Invalid answer");
      const option = optionById(prompt, answer.choice);
      const value = option.values?.[0];
      if (value !== 1 && value !== 2 && value !== 3) throw new EngineAnswerError("Invalid answer");
      return { type: OcgResponseType.ROCK_PAPER_SCISSORS, value };
    }
    default:
      throw new EngineAnswerError("Invalid answer");
  }
}
