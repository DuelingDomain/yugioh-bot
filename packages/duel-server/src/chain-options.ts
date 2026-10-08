import type { DuelChainLink, DuelEvent, DuelPrompt } from "@yugidraft/shared/duels";
import { OcgHintType, OcgMessageType, OcgResponseType, type OcgMessage, type OcgResponse } from "ocgcore-wasm";
import { cardInfoLabel, type CardDatabase } from "./cards.js";
import { fillPlaceholders } from "./text.js";

type PublicChoice = NonNullable<DuelChainLink["chosenOptions"]>[number];
type Link = Pick<DuelChainLink, "index" | "seat" | "code" | "chosenOptions">;
type Prompt = { seat: number; prompt: DuelPrompt; message: OcgMessage };
type Choice = PublicChoice & { key: string; description: bigint; code?: number; seat?: number };

const stringCode = (description: bigint) => description > 0xffffffffn ? Number(description >> 20n) : undefined;
// Multi-seat cores use these SELECT_OPTION values for player/attack targets, not effect operations.
const seatChoice = (description: bigint) => description >= 0xfffe0000n && description <= 0xffffffffn;

/** Tracks only public operation choices. Prompt candidates and engine description IDs never enter a view. */
export class ChainOptions {
  private resolving: Link | undefined;
  private activating: Link | undefined;
  private deferred: Choice[] = [];
  private selected: Choice | undefined;
  private slots = new WeakMap<Link, Map<string, number>>();
  private responseSeq = 0;
  private undoResponse: (() => void) | undefined;

  constructor(private readonly cards: CardDatabase) {}

  private sameCard(code: number, other: number | undefined): boolean {
    return other != null && (this.cards.get(code)?.canonicalPasscode ?? code) === (this.cards.get(other)?.canonicalPasscode ?? other);
  }

  /** Called after mapping, before either an automatic response or a player/bot answer. */
  recordPrompt(pending: Prompt): void {
    this.undoResponse = undefined;
    switch (pending.message.type) {
      case OcgMessageType.SELECT_IDLECMD:
      case OcgMessageType.SELECT_BATTLECMD:
      case OcgMessageType.SELECT_CHAIN:
      case OcgMessageType.SELECT_EFFECTYN:
        // A new action/window cannot inherit an earlier non-chain operation choice.
        this.deferred = [];
        this.selected = undefined;
        break;
      case OcgMessageType.SELECT_OPTION:
        this.selected = undefined;
    }
  }

  private fromPrompt(pending: Prompt, index: number): Choice | undefined {
    if (pending.message.type !== OcgMessageType.SELECT_OPTION || !Number.isInteger(index)) return undefined;
    const description = pending.message.options[index];
    const option = pending.prompt.options.find((entry) => entry.values?.[0] === index);
    if (description == null || !option || seatChoice(description)) return undefined;
    return { key: `answer:${++this.responseSeq}`, description, index, text: option.label, code: stringCode(description) ?? pending.prompt.source?.code, seat: pending.seat };
  }

  private target(choice: Choice): Link | undefined {
    // The chooser can be the opponent of the effect controller. The resolving link wins over seat/code guesses.
    return this.resolving ?? (this.activating && (!choice.code || this.sameCard(choice.code, this.activating.code)) ? this.activating : undefined);
  }

  private add(link: Link, choice: Choice): void {
    const slots = this.slots.get(link) ?? new Map<string, number>();
    const slot = slots.get(choice.key);
    const options = [...(link.chosenOptions ?? [])];
    const previous = slot == null ? undefined : options[slot];
    const index = choice.index ?? previous?.index;
    const publicChoice: PublicChoice = { text: choice.text, ...(index != null ? { index } : {}) };
    if (slot == null) {
      slots.set(choice.key, options.length);
      options.push(publicChoice);
    } else options[slot] = publicChoice;
    this.slots.set(link, slots);
    link.chosenOptions = options;
  }

  private record(choice: Choice): void {
    const target = this.target(choice);
    if (target) this.add(target, choice);
    else {
      const previous = this.deferred.findIndex((entry) => entry.key === choice.key);
      if (previous < 0) this.deferred.push(choice);
      else this.deferred[previous] = { ...this.deferred[previous], ...choice };
    }
  }

  /** Validated responses include manual, practice/AI and automatic single-option answers. RETRY rolls this back. */
  recordResponse(pending: Prompt, response: OcgResponse): void {
    this.undoResponse = undefined;
    if (response.type !== OcgResponseType.SELECT_OPTION) return;
    const selected = this.selected;
    this.selected = undefined;
    const choice = this.fromPrompt(pending, response.index);
    if (!choice) return;
    const target = this.target(choice);
    const options = target?.chosenOptions;
    const slots = target ? new Map(this.slots.get(target)) : undefined;
    const deferred = [...this.deferred];
    this.selected = choice;
    this.record(choice);
    this.undoResponse = () => {
      this.selected = selected;
      this.deferred = deferred;
      if (target) {
        if (options) target.chosenOptions = options;
        else delete target.chosenOptions;
        this.slots.set(target, slots!);
      }
    };
  }

  /** Called after the event observer creates/removes chain memory, in engine message order. */
  observe(message: OcgMessage, chain: readonly Link[], event?: Pick<DuelEvent, "kind" | "chainIndex" | "chosenOptions"> | null): void {
    switch (message.type) {
      case OcgMessageType.RETRY:
        this.undoResponse?.();
        this.undoResponse = undefined;
        break;
      case OcgMessageType.CHAINING: {
        this.activating = chain.find((link) => link.index === message.chain_size);
        if (this.activating) for (const choice of this.deferred) {
          if (choice.code ? this.sameCard(choice.code, this.activating.code) : choice.seat === this.activating.seat) this.add(this.activating, choice);
        }
        this.deferred = [];
        break;
      }
      case OcgMessageType.CHAINED:
        this.activating = undefined;
        break;
      case OcgMessageType.CHAIN_SOLVING:
        this.activating = undefined;
        this.resolving = chain.find((link) => link.index === message.chain_size);
        break;
      case OcgMessageType.CHAIN_SOLVED:
        this.resolving = undefined;
        this.selected = undefined;
        this.deferred = [];
        break;
      case OcgMessageType.CHAIN_END:
      case OcgMessageType.NEW_PHASE:
      case OcgMessageType.NEW_TURN:
        this.activating = this.resolving = undefined;
        this.selected = undefined;
        this.deferred = [];
        this.undoResponse = undefined;
        break;
      case OcgMessageType.HINT: {
        if (message.hint_type !== OcgHintType.OPSELECTED || seatChoice(message.hint)) break;
        const selected = this.selected?.description === message.hint ? this.selected : undefined;
        const code = stringCode(message.hint);
        const source = code ?? this.resolving?.code ?? this.activating?.code;
        const text = selected?.text ?? fillPlaceholders(this.cards.resolveLabel(message.hint), [source ? cardInfoLabel(this.cards, source) : undefined]);
        // HINT_OPSELECTED is public. Its player can name a recipient, so it is never used to guess a link/chooser.
        if (text && (selected || code || this.resolving || this.activating)) {
          this.record(selected ?? { key: `hint:${message.hint}`, description: message.hint, code, text });
        }
        break;
      }
    }
    if (event?.chainIndex != null && (event.kind === "activate" || event.kind === "chain-resolving" || event.kind === "chain-resolved" || event.kind === "chain-negated")) {
      const choices = chain.find((link) => link.index === event.chainIndex)?.chosenOptions;
      if (choices) event.chosenOptions = choices.map((choice) => ({ ...choice }));
    }
  }
}
