import type { DuelAnswer, DuelCardInfo, DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";
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
  ocgAttributeString,
  ocgPositionParse,
  ocgPositionString,
  ocgRaceParse,
  ocgRaceString,
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
import { DOMAIN_LEAVE_TAX_STEP, LOCATION_DECKMASTER, type DomainSeatState } from "./views.js";

export interface MapPromptExtras {
  recall?: { card: DuelCardInfo; returns: number; nextCost: number };
  domain?: readonly DomainSeatState[];
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

export function parseFieldPlaces(mask: number, answeringPlayer: number): SelectFieldPlace[] {
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
  parsePlayer(mask >> 16, answeringPlayer ^ 1);
  return places;
}

function cardOption(cards: CardDatabase, id: string, code: number, loc: { controller?: number; location?: number; sequence?: number }, extra?: Partial<DuelPromptOption>): DuelPromptOption {
  const info = cards.get(code);
  return {
    id,
    label: extra?.label ?? (info?.name ?? `Card ${code}`),
    card: info,
    controller: loc.controller,
    location: loc.location,
    sequence: loc.sequence,
    ...extra,
  };
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

function yesNo(seat: number, id: string, title: string, description: string | undefined, card?: DuelCardInfo): PendingPrompt {
  return {
    id,
    seat,
    prompt: {
      id,
      seat,
      kind: "choice",
      title,
      description,
      options: [
        { id: "yes", label: "Yes", card },
        { id: "no", label: "No", card },
      ],
      min: 1,
      max: 1,
    },
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
    const effect = cards.resolveLabel(card.description);
    options.push(cardOption(cards, `activate:${index}`, card.code, card, {
      label: effect ? `Activate ${cardInfoLabel(cards, card.code)}: ${effect}` : `Activate ${cardInfoLabel(cards, card.code)}`,
      values: [index],
    }));
  });
  if (message.to_bp) options.push({ id: "to_bp", label: "Enter Battle Phase" });
  if (message.to_ep) options.push({ id: "to_ep", label: "End Phase" });
  if (message.shuffle) options.push({ id: "shuffle", label: "Shuffle hand" });
  return options;
}

export function mapPrompt(message: OcgMessage, cards: CardDatabase, id: string, selectHint?: string, extras?: MapPromptExtras): PendingPrompt {
  const hint = selectHint?.trim();
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
        const effect = cards.resolveLabel(card.description);
        options.push(cardOption(cards, `activate:${index}`, card.code, card, {
          label: effect ? `Activate ${cardInfoLabel(cards, card.code)}: ${effect}` : `Activate ${cardInfoLabel(cards, card.code)}`,
          values: [index],
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
      const built = yesNo(message.player, id, hint || cards.resolveLabel(message.description) || "Choose yes or no", cards.resolveLabel(message.description));
      built.message = message;
      return built;
    }
    case OcgMessageType.SELECT_EFFECTYN: {
      const info = cards.get(message.code);
      const title = hint || cards.resolveLabel(message.description) || `Apply the effect of ${cardInfoLabel(cards, message.code)}?`;
      const built = yesNo(message.player, id, title, cards.resolveLabel(message.description), info);
      built.message = message;
      return built;
    }
    case OcgMessageType.SELECT_OPTION:
      return {
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "choice",
          title: hint || "Select an option",
          options: message.options.map((option, index) => ({
            id: `opt:${index}`,
            label: cards.resolveLabel(option) || `Option ${index + 1}`,
            values: [index],
          })),
          min: 1,
          max: 1,
        },
        message,
      };
    case OcgMessageType.SELECT_CARD:
      return {
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
      };
    case OcgMessageType.SELECT_TRIBUTE:
      return {
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
      };
    case OcgMessageType.SELECT_CHAIN: {
      const options = message.selects.map((card, index) => {
        const effect = cards.resolveLabel(card.description);
        return cardOption(cards, `card:${index}`, card.code, card, {
          label: effect ? `${cardInfoLabel(cards, card.code)}: ${effect}` : cardInfoLabel(cards, card.code),
        });
      });
      return {
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "choice",
          title: hint || (message.forced ? "Select a mandatory effect" : "Select a chain link or pass"),
          options,
          min: message.forced ? 1 : 0,
          max: 1,
          cancelable: !message.forced,
          context: { type: "chain", forced: message.forced },
        },
        message,
      };
    }
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD: {
      const places = parseFieldPlaces(message.field_mask, message.player);
      return {
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
      };
    }
    case OcgMessageType.SELECT_POSITION: {
      const positions = ocgPositionParse(message.positions);
      return {
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "choice",
          title: hint || `Select a position for ${cardInfoLabel(cards, message.code)}`,
          options: positions.map((position) => ({
            id: `pos:${position}`,
            label: ocgPositionString.get(position) ?? `Position ${position}`,
            card: cards.get(message.code),
            values: [position],
          })),
          min: 1,
          max: 1,
          context: { type: "position" },
        },
        message,
      };
    }
    case OcgMessageType.SELECT_COUNTER:
      return {
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
      };
    case OcgMessageType.SELECT_SUM: {
      const must = message.selects_must.map((card, index) =>
        cardOption(cards, `must:${index}`, card.code, card, { values: sumParamValues(card.amount), selected: true, label: `${sumParamLabel(cards, card.code, card.amount)}, required` }),
      );
      const optional = message.selects.map((card, index) =>
        cardOption(cards, `card:${index}`, card.code, card, { values: sumParamValues(card.amount), label: sumParamLabel(cards, card.code, card.amount) }),
      );
      return {
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "sum",
          title: hint || `Select cards totaling ${message.amount}`,
          options: [...must, ...optional],
          min: must.length + message.min,
          max: must.length + (message.select_max ? message.selects.length : message.max),
          target: message.amount,
          mandatory: must.map((option) => option.id),
        },
        message,
      };
    }
    case OcgMessageType.SELECT_UNSELECT_CARD: {
      const select = message.select_cards.map((card, index) => cardOption(cards, `select:${index}`, card.code, card, { selected: false }));
      const unselect = message.unselect_cards.map((card, index) => cardOption(cards, `unselect:${index}`, card.code, card, { selected: true }));
      return {
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
      };
    }
    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN:
      return {
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
      };
    case OcgMessageType.ANNOUNCE_RACE: {
      const races = ocgRaceParse(message.available);
      return {
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "cards",
          title: hint || `Announce ${message.count} monster type(s)`,
          options: races.map((race) => ({
            id: `race:${race.toString()}`,
            label: ocgRaceString.get(race) ?? race.toString(),
            values: [Number(race)],
          })),
          min: message.count,
          max: message.count,
        },
        message,
      };
    }
    case OcgMessageType.ANNOUNCE_ATTRIB: {
      const attributes = ocgAttributeParse(message.available);
      return {
        id,
        seat: message.player,
        prompt: {
          id,
          seat: message.player,
          kind: "cards",
          title: hint || `Announce ${message.count} attribute(s)`,
          options: attributes.map((attribute) => ({
            id: `attr:${attribute}`,
            label: ocgAttributeString.get(attribute) ?? String(attribute),
            values: [attribute],
          })),
          min: message.count,
          max: message.count,
        },
        message,
      };
    }
    case OcgMessageType.ANNOUNCE_CARD:
      return {
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
      };
    case OcgMessageType.ANNOUNCE_NUMBER:
      return {
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
      };
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

export function autoResponse(pending: PendingPrompt): OcgResponse | null {
  const { message, prompt } = pending;
  switch (message.type) {
    case OcgMessageType.SELECT_CHAIN:
      if (message.selects.length === 0) return { type: OcgResponseType.SELECT_CHAIN, index: null };
      if (message.forced && message.selects.length === 1) return { type: OcgResponseType.SELECT_CHAIN, index: 0 };
      return null;
    case OcgMessageType.SELECT_CARD:
      if (message.min === message.max && message.max === message.selects.length && message.selects.length > 0) {
        return { type: OcgResponseType.SELECT_CARD, indicies: message.selects.map((_, index) => index) };
      }
      if (message.min === 0 && message.max === 0) return { type: OcgResponseType.SELECT_CARD, indicies: [] };
      return null;
    case OcgMessageType.SELECT_TRIBUTE:
      if (!message.can_cancel && message.selects.length > 0 && message.selects.every((card) => card.release_param === 1) && message.min === message.max && message.min === message.selects.length) {
        return { type: OcgResponseType.SELECT_TRIBUTE, indicies: message.selects.map((_, index) => index) };
      }
      return null;
    case OcgMessageType.SELECT_POSITION: {
      const positions = ocgPositionParse(message.positions);
      if (positions.length === 1) return { type: OcgResponseType.SELECT_POSITION, position: positions[0] };
      return null;
    }
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD: {
      const places = parseFieldPlaces(message.field_mask, message.player);
      if (places.length === message.count && message.count > 0) {
        return {
          type: message.type === OcgMessageType.SELECT_DISFIELD ? OcgResponseType.SELECT_DISFIELD : OcgResponseType.SELECT_PLACE,
          places,
        };
      }
      return null;
    }
    case OcgMessageType.SELECT_OPTION:
      if (message.options.length === 1) return { type: OcgResponseType.SELECT_OPTION, index: 0 };
      return null;
    case OcgMessageType.SELECT_SUM: {
      if (message.selects.length === 0 && message.min === 0) {
        return { type: OcgResponseType.SELECT_SUM, indicies: [] };
      }
      return null;
    }
    case OcgMessageType.SELECT_UNSELECT_CARD:
      if (message.select_cards.length + message.unselect_cards.length === 0 && message.can_finish) {
        return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
      }
      if (message.select_cards.length === 1 && message.unselect_cards.length === 0 && message.min === 1 && message.max === 1 && !message.can_cancel && !message.can_finish) {
        return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: 0 };
      }
      return null;
    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN:
      if (message.cards.length <= 1) return { type: OcgResponseType.SORT_CARD, order: message.cards.map((_, index) => index) };
      return null;
    case OcgMessageType.SELECT_IDLECMD:
    case OcgMessageType.SELECT_BATTLECMD:
    case OcgMessageType.SELECT_YESNO:
    case OcgMessageType.SELECT_EFFECTYN:
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
      if (ids.length < message.min || ids.length > message.max) throw new EngineAnswerError("Invalid answer");
      const indicies = uniqueIndices(ids, "card:");
      if (indicies.some((index) => index >= message.selects.length)) throw new EngineAnswerError("Invalid answer");
      return { type: OcgResponseType.SELECT_CARD, indicies };
    }
    case OcgMessageType.SELECT_TRIBUTE: {
      const ids = selectedIds(prompt, answer);
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
      const index = prompt.options.indexOf(option);
      if (index < 0) throw new EngineAnswerError("Invalid answer");
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
        return count;
      });
      const total = counters.reduce((sum, count) => sum + count, 0);
      if (total !== message.count) throw new EngineAnswerError("Invalid answer");
      return { type: OcgResponseType.SELECT_COUNTER, counters };
    }
    case OcgMessageType.SELECT_SUM: {
      const ids = selectedIds(prompt, answer).filter((id) => id.startsWith("card:"));
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
      const index = prompt.options.indexOf(option);
      if (index < 0) throw new EngineAnswerError("Invalid answer");
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index };
    }
    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN: {
      const ids = answer.selected ?? [];
      if (ids.length !== message.cards.length) throw new EngineAnswerError("Invalid answer");
      const order = uniqueIndices(ids, "card:");
      if (order.some((index) => index >= message.cards.length)) throw new EngineAnswerError("Invalid answer");
      return { type: OcgResponseType.SORT_CARD, order };
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
