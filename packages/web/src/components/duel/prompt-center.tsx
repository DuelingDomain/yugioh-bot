"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, EyeOff, Link2 } from "lucide-react";
import type { DuelAnswer, DuelCardInfo, DuelChainLink, DuelPrompt, DuelPromptOption, DuelZoneRef } from "@yugidraft/shared/duels";
import {
  AnnounceSearch,
  canConfirm,
  needsExplicitConfirm,
  optionZoneKeys,
  selectionBounds,
  toAnswer,
  toggleSelected,
  type PromptAim,
  type PromptDraft,
} from "./prompts";
import {
  cardArtUrl,
  LOCATION_DECK,
  LOCATION_DMZONE,
  LOCATION_EXTRA,
  LOCATION_FZONE,
  LOCATION_GRAVE,
  LOCATION_HAND,
  LOCATION_MZONE,
  LOCATION_OVERLAY,
  LOCATION_PZONE,
  LOCATION_REMOVED,
  LOCATION_SZONE,
  POS_FACEDOWN_ATTACK,
  POS_FACEDOWN_DEFENSE,
  POS_FACEUP_ATTACK,
  POS_FACEUP_DEFENSE,
} from "./constants";
import { isDirectAttackRow, nextEnabledIndex, opponentPickLabel, outSeatOptionIds } from "./multi-seat";
import { PriorityChips, type PrioritySlot } from "./priority-chips";
import { CardBack } from "./card-face";
import { CardStrip, type StripCard } from "./card-strip";
import { optionNotes } from "./option-strip";
import { battleStepLabel, type BattleStep } from "./station-track";
import { PrecheckBar } from "./prompt-precheck";
import { placeSelectBar, samePlace, type BarPlace, type BarRect } from "./select-bar-place";
import { selectBarCopy, sumSelectionValues, synchroSelectionValues, type BarCopy } from "./select-bar-copy";
import { backOutAnswer, backOutLabel } from "./pick-backout";
import { tributeState } from "./tribute-pick";
import { placeTributeDock, sameDock, type DockPlace } from "./tribute-dock-place";
import base from "./prompts.module.css";
import baseStyles from "./prompt-center.module.css";
import { useSkinExtra, useSkinStyles } from "./skin";

/**
 * Prompts answered in the middle of the board.
 *
 * response  a floating panel over the centre band: chain responses, yes/no, option lists, positions,
 *           announce, number, Deck Master recall
 * select    card / tribute / sum / place picks: answered by clicking the field and either hand, with a
 *           compact instruction bar. Falls back to a centred card grid when a choice is off the board.
 * grid      order picks: always a card grid
 * counters  counter placement: a card grid with steppers
 *
 * The action prompt (your own turn menu) is not centred: the field, card menu and station track answer it.
 */
export type CenterKind = "response" | "select" | "grid" | "counters";

export function centerKind(prompt: DuelPrompt | null): CenterKind | null {
  if (!prompt) return null;
  if (prompt.context?.type === "action") return null;
  switch (prompt.kind) {
    case "choice":
    case "toggle":
    case "number":
    case "announce-card":
      return "response";
    case "cards":
    case "tribute":
    case "sum":
    case "places":
      return "select";
    case "order":
      return "grid";
    case "counters":
      return "counters";
    default:
      return null;
  }
}

/* ------------------------------------------------------------ contract (round 4) */

/**
 * The card an effect prompt is about (DuelPrompt.source) and the per-option texts
 * (DuelPromptOption.cardText / effectText). Typed here as optional intersections so the room compiles
 * against a shared build with or without the fields.
 */
export interface PromptSource {
  code: number;
  name: string;
  seat: number;
  zone?: DuelZoneRef;
  /** Full printed card text. */
  text: string;
}
type SourcedPrompt = DuelPrompt & { source?: PromptSource | null };
type TextedOption = DuelPromptOption & { cardText?: string | null; effectText?: string | null };

export function promptSource(prompt: DuelPrompt | null | undefined): PromptSource | null {
  const source = (prompt as SourcedPrompt | null | undefined)?.source;
  return source && source.name ? source : null;
}

function optionTexts(option: DuelPromptOption): { cardText: string; effectText: string } {
  const texted = option as TextedOption;
  return {
    cardText: (texted.cardText ?? option.card?.description ?? "").trim(),
    effectText: (texted.effectText ?? "").trim(),
  };
}

/**
 * Engine strings are printf templates ("Activate the Trigger Effect of \"%ls\" from [%ls]?"). The server
 * fills them; this guard catches any that slip through so the player never reads a placeholder.
 * The first %ls names the card, a bracketed [%ls] is a location, numbers become an em dash.
 */
export function fillPlaceholders(text: string, name?: string | null, place?: string | null): string {
  if (!text || !text.includes("%")) return text;
  let out = text.replace(/\[%l?s\]/g, () => (place ? `[${place}]` : "[—]"));
  out = out.replace(/%l?s/g, () => name?.trim() || "—");
  out = out.replace(/%(?:l?[diu]|ld|lu)/g, "—");
  // "from [—]" says nothing; drop it rather than show a dash in brackets.
  return out.replace(/\s+(?:from|in|on)\s+\[—\]/g, "").replace(/\[—\]/g, "—");
}

const POSITION_LABELS: Record<string, string> = {
  faceup_attack: "Face-up Attack",
  facedown_attack: "Face-down Attack",
  faceup_defense: "Face-up Defense",
  facedown_defense: "Face-down Defense",
  faceup: "Face-up",
  facedown: "Face-down",
  attack: "Attack Position",
  defense: "Defense Position",
};

/** Raw snake_case option labels ("faceup_attack") read as words ("Face-up Attack"). Other labels pass through. */
export function humanizeLabel(label: string): string {
  const key = label.trim().toLowerCase();
  if (POSITION_LABELS[key]) return POSITION_LABELS[key];
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(key)) return label;
  return key
    .split("_")
    .map((word) => (word === "faceup" ? "Face-up" : word === "facedown" ? "Face-down" : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

/** The POS_* bit a position option stands for, from its values, its id ("pos:4") or its label. */
export function positionOf(option: DuelPromptOption): number | null {
  const value = option.values?.[0];
  if (value != null && value > 0) return value;
  const id = /^pos:(\d+)$/.exec(option.id);
  if (id) return Number(id[1]);
  const key = option.label.trim().toLowerCase();
  const facedown = key.includes("facedown") || key.includes("face-down");
  if (key.includes("def")) return facedown ? POS_FACEDOWN_DEFENSE : POS_FACEUP_DEFENSE;
  if (key.includes("att")) return facedown ? POS_FACEDOWN_ATTACK : POS_FACEUP_ATTACK;
  return null;
}

function zonePlace(zone: DuelZoneRef | undefined, mySeat: number | null): string | null {
  if (!zone) return null;
  const whose = mySeat == null ? "" : zone.controller === mySeat ? "your " : "opponent's ";
  const location = zone.location;
  let name: string | null = null;
  if (location & LOCATION_HAND) name = "hand";
  else if (location & LOCATION_MZONE) name = "Monster Zone";
  else if (location & LOCATION_SZONE) name = "Spell & Trap Zone";
  else if (location & LOCATION_FZONE) name = "Field Zone";
  else if (location & LOCATION_PZONE) name = "Pendulum Zone";
  else if (location & LOCATION_GRAVE) name = "Graveyard";
  else if (location & LOCATION_REMOVED) name = "banished cards";
  else if (location & LOCATION_EXTRA) name = "Extra Deck";
  else if (location & LOCATION_DECK) name = "Deck";
  else if (location & LOCATION_OVERLAY) name = "Xyz Materials";
  else if (location & LOCATION_DMZONE) name = "Deck Master Zone";
  return name ? `${whose}${name}` : null;
}

type EffectKind = "trigger" | "quick" | "ignition" | "flip" | "";

function effectKind(prompt: DuelPrompt): EffectKind {
  const text = `${prompt.title} ${prompt.description ?? ""}`;
  if (/trigger/i.test(text)) return "trigger";
  if (/quick/i.test(text)) return "quick";
  if (/ignition/i.test(text)) return "ignition";
  if (/\bflip\b/i.test(text)) return "flip";
  if (prompt.context?.type === "chain") return "quick";
  return "";
}

/** Tones of the seats of a table of 3 or 4 (seat -> main and ink colour). */
export type PromptSeatTones = ReadonlyMap<number, { main: string; ink: string }>;

function toneVars(tones: PromptSeatTones | undefined, seat: number | undefined): CSSProperties | undefined {
  const tone = seat != null ? tones?.get(seat) : undefined;
  return tone ? ({ "--seat-main": tone.main, "--seat-ink": tone.ink } as CSSProperties) : undefined;
}

/**
 * "You" / "Opponent" (or "Your" / "Opponent's"). With `nameOf` (a table of 3 or 4, where "Opponent" does not say
 * which one) a rival reads by name.
 */
function ownerWord(seat: number | undefined, mySeat: number | null, form: "your" | "you", nameOf?: (seat: number) => string): string {
  if (seat == null || mySeat == null) return form === "your" ? "Your" : "You";
  if (seat === mySeat) return form === "your" ? "Your" : "You";
  if (nameOf) return form === "your" ? `${nameOf(seat)}'s` : nameOf(seat);
  return form === "your" ? "Opponent's" : "Opponent";
}

function isYesNo(prompt: DuelPrompt): boolean {
  return (
    prompt.kind === "choice" &&
    prompt.options.length === 2 &&
    prompt.options.some((option) => option.id === "yes") &&
    prompt.options.some((option) => option.id === "no")
  );
}

/**
 * The answer that turns a prompt down, or null when the prompt has none (mandatory).
 * Right-click and Esc submit it. Chain: Pass. Yes/No: No. Anything cancelable: Cancel.
 */
export function declineAnswer(prompt: DuelPrompt): DuelAnswer | null {
  const context = prompt.context;
  if (context?.type === "chain") return prompt.cancelable && !context.forced ? { cancel: true } : null;
  if (isYesNo(prompt)) return { choice: "no" };
  if (prompt.cancelable) return { cancel: true };
  return null;
}

/**
 * What right-click and Esc answer. A one-card-at-a-time pick (materials) backs out: unselect the card under
 * the pointer, else cancel the pick, else step back one card (see pick-backout.ts). Everything else declines.
 */
export function dismissAnswer(prompt: DuelPrompt, zoneKeys: readonly string[] = []): DuelAnswer | null {
  return prompt.kind === "toggle" ? backOutAnswer(prompt, zoneKeys) : declineAnswer(prompt);
}

/** The board zones under a pointer event (the zone's data-zones keys), for dismissAnswer. */
function zoneKeysAt(target: Element | null): string[] {
  const zones = target?.closest("[data-zones]")?.getAttribute("data-zones");
  return zones ? zones.split(/\s+/).filter(Boolean) : [];
}

function declineLabel(prompt: DuelPrompt): string {
  if (prompt.context?.type === "chain") return "Pass";
  if (isYesNo(prompt)) return "No";
  return "Cancel";
}

/* -------------------------------------------------------- yes/no pre-check */

/**
 * Prompts that open as the compact "activate an effect?" bar before any list:
 *   chain   an optional chain response (a quick effect, an optional trigger): one or more effects, Pass
 *   effect  an engine yes/no about one card's effect ("Use the effect of X?")
 * Everything else keeps its own prompt: mandatory chain links (no pass), select / position / counters /
 * number / announce, Deck Master recall, and yes/no questions that name no card.
 */
export type PrecheckKind = "chain" | "effect";

export function precheckKind(prompt: DuelPrompt | null): PrecheckKind | null {
  if (!prompt || prompt.kind !== "choice") return null;
  const context = prompt.context;
  if (context?.type === "chain") {
    return !context.forced && prompt.cancelable && prompt.options.length > 0 ? "chain" : null;
  }
  if (context) return null;
  return isYesNo(prompt) && promptSource(prompt) ? "effect" : null;
}

/**
 * What Yes does: answer at once (one effect to activate, or an engine yes/no), or open the list when
 * more than one effect can be activated. Null when the prompt has no pre-check.
 */
export function precheckYes(prompt: DuelPrompt): { answer: DuelAnswer } | { list: true } | null {
  const kind = precheckKind(prompt);
  if (kind === "effect") return { answer: { choice: "yes" } };
  if (kind === "chain") return prompt.options.length === 1 ? { answer: { choice: prompt.options[0].id } } : { list: true };
  return null;
}

/** What No does: the same answer as the Pass / No button and right-click. Null when the prompt has no pre-check. */
export function precheckNo(prompt: DuelPrompt): DuelAnswer | null {
  return precheckKind(prompt) ? declineAnswer(prompt) : null;
}

/**
 * Keys on the bar. Enter on a focused button is left to that button. Number keys would pick an effect
 * from a list the player has not seen, so they are swallowed while Yes opens the list.
 */
export function precheckKeyAction(key: string, onButton: boolean, listFollows: boolean): "yes" | "no" | "swallow" | null {
  if (key === "Enter") return onButton ? null : "yes";
  if (key === "y" || key === "Y") return "yes";
  if (key === "n" || key === "N" || key === "Escape") return "no";
  if (listFollows && (/^[1-9]$/.test(key) || /^Numpad[1-9]$/.test(key))) return "swallow";
  return null;
}

export interface PrecheckCopy {
  name: string;
  ask: string;
  /** Phase / step and what is being answered, short. Empty when there is nothing to say. */
  context: string;
  cards: Array<{ code: number; card?: DuelCardInfo }>;
}

/** Short wording for the bar: the question (its title), the card (or "N effects"), and the step it is in. */
export function precheckCopy(prompt: DuelPrompt, chain: readonly DuelChainLink[], stepName: string | null): PrecheckCopy | null {
  const kind = precheckKind(prompt);
  if (!kind) return null;
  const source = promptSource(prompt);
  const last = chain[chain.length - 1];
  const context = [stepName, kind === "chain" && last?.name ? `in response to ${last.name}` : null].filter(Boolean).join(" · ");
  if (kind === "effect") {
    const yes = prompt.options.find((option) => option.id === "yes");
    const card = yes?.card;
    return {
      name: source?.name ?? card?.name ?? "Effect",
      ask: "Activate its effect?",
      context,
      cards: source || card ? [{ code: (source?.code ?? card?.code) as number, card }] : [],
    };
  }
  const options = prompt.options;
  const cards = options
    .slice(0, 3)
    .map((option) => ({ code: option.card?.code ?? (options.length === 1 ? source?.code : undefined), card: option.card }))
    .filter((entry): entry is { code: number; card: DuelCardInfo | undefined } => entry.code != null)
    .filter((entry, index, all) => all.findIndex((other) => other.code === entry.code) === index);
  return {
    name: options.length === 1 ? (source?.name ?? effectText(options[0]).name) : `${options.length} effects`,
    ask: options.length === 1 ? "Activate its effect?" : "Activate an effect?",
    context,
    cards,
  };
}

const OFF_BOARD_LOCATIONS = LOCATION_DECK | LOCATION_GRAVE | LOCATION_REMOVED | LOCATION_EXTRA | LOCATION_OVERLAY;

/**
 * True when every option can be clicked where it sits on the board (both hands and all zones count).
 * `hasZone` says whether the board draws a zone for a key. Pure so the routing can be tested.
 */
export function optionsOnBoard(prompt: DuelPrompt, hasZone: (key: string) => boolean): boolean {
  if (prompt.options.length === 0) return true;
  return prompt.options.every((option) => {
    if (option.location != null && (option.location & OFF_BOARD_LOCATIONS) !== 0) return false;
    const keys = optionZoneKeys(option);
    return keys.length > 0 && hasZone(keys[0]);
  });
}

/**
 * The box the prompt measures: the room's board is the layer's parent. A table stage puts the layer in a slot beside
 * its canvas, so it marks the stage with `data-prompt-scope` and the zones are found there.
 */
function boardOf(layer: HTMLElement | null): HTMLElement | null {
  return layer?.closest<HTMLElement>("[data-prompt-scope]") ?? layer?.parentElement ?? null;
}

function allOptionsOnBoard(prompt: DuelPrompt, scope: ParentNode): boolean {
  return optionsOnBoard(prompt, (key) => scope.querySelector(`[data-zones~="${key}"]`) != null);
}

/**
 * A pick made one card at a time (the engine's select / unselect step: Synchro, Xyz, Link and Fusion
 * materials, discards) is a "toggle" prompt. It is answered on the board like a card pick, with the bar,
 * when every card is on the board; a card in the Deck, GY, Extra Deck or banished keeps the card strip.
 */
export function isBoardTogglePrompt(prompt: DuelPrompt | null): boolean {
  if (!prompt || prompt.kind !== "toggle" || prompt.options.length === 0) return false;
  const context = prompt.context?.type;
  return context !== "chain" && context !== "position" && context !== "deck-master-recall" && context !== "action";
}

/** Name + effect line for a chain option, from the resolved texts when the server sends them, else the label. */
function effectText(option: DuelPromptOption): { name: string; effect: string; cardText: string } {
  const texts = optionTexts(option);
  let text = fillPlaceholders(option.label, option.card?.name).trim().replace(/^Activate\s+/i, "");
  const cardName = option.card?.name?.trim();
  let name = cardName ?? "";
  if (cardName && text.startsWith(cardName)) {
    text = text.slice(cardName.length).replace(/^\s*[:\-–]\s*/, "");
  } else if (!cardName) {
    const colon = text.indexOf(": ");
    if (colon > 0) {
      name = text.slice(0, colon);
      text = text.slice(colon + 2);
    } else {
      name = text;
      text = "";
    }
  }
  const effect = texts.effectText || text.trim() || texts.cardText;
  return { name: name || option.label, effect, cardText: texts.cardText };
}

function CardArt({ option, className }: { option: DuelPromptOption; className: string }) {
  const styles = useSkinStyles(baseStyles, "prompt");
  if (!option.card) return <span className={`${className} ${styles.noArt}`} aria-hidden />;
  // 3D mode: a square art crop on a background, so the projection scanlines can sit on the art alone.
  if (styles !== baseStyles) {
    return <span className={className} style={{ backgroundImage: `url(${cardArtUrl(option.card.code, "small")})` }} aria-hidden />;
  }
  return <img src={cardArtUrl(option.card.code, "small")} alt="" className={className} draggable={false} />;
}

/** Printed card text: clamped to a few lines with a toggle when long, scrollable when open. */
function CardTextBlock({ text, label = "Card text", open: forceOpen }: { text: string; label?: string; open?: boolean }) {
  const styles = useSkinStyles(baseStyles, "prompt");
  const [open, setOpen] = useState(Boolean(forceOpen));
  const long = text.length > 200 || text.split(/\r?\n/).length > 3;
  const shown = open || !long;
  return (
    <div className={styles.cardText} data-open={shown ? "true" : "false"}>
      <span className={styles.cardTextLabel}>{label}</span>
      <p className={styles.cardTextBody} data-clamped={shown ? "false" : "true"}>{text}</p>
      {long && !forceOpen ? (
        <button type="button" className={styles.cardTextMore} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Show less" : "Show full text"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The words of a pick surface (the select bar and the card-grid header): a short title, the card or purpose,
 * and the progress line. See select-bar-copy.ts.
 */
export function pickCopy(prompt: DuelPrompt, draft: PromptDraft, aiming: boolean, aimHint?: string): BarCopy {
  const { min, max } = selectionBounds(prompt);
  const source = promptSource(prompt);
  const toggling = prompt.kind === "toggle";
  // A one-at-a-time pick keeps its chosen cards on the options, not in the draft.
  const count = toggling ? prompt.options.filter((option) => option.selected).length : draft.selected.length;
  return selectBarCopy({
    kind: prompt.kind,
    title: fillPlaceholders(prompt.title, source?.name),
    description: prompt.description ? fillPlaceholders(prompt.description, source?.name) : undefined,
    min,
    max,
    openEnded: prompt.max == null,
    count,
    ...(prompt.kind === "sum" ? sumSelectionValues(prompt, draft.selected) : {}),
    ...(prompt.kind === "tribute" ? { total: tributeState(prompt, draft.selected).total } : {}),
    ...(toggling ? synchroSelectionValues(prompt) : {}),
    target: prompt.target,
    sumMode: prompt.sumMode,
    toggling,
    aiming,
    aimHint,
    sourceName: source?.name,
    position: prompt.context?.type === "position",
  });
}

export function selectionStatus(prompt: DuelPrompt, draft: PromptDraft, aiming: boolean): string {
  return pickCopy(prompt, draft, aiming).progress;
}

/** Hovering or focusing a card tile shows that card in the left inspector, as board cards do. */
export type InspectCardHandler = (card: DuelCardInfo) => void;

/* ------------------------------------------------------------------ actions */

function Actions({
  prompt,
  draft,
  busy,
  onSubmit,
  confirm = true,
  forceConfirm = false,
}: {
  prompt: DuelPrompt;
  draft: PromptDraft;
  busy: boolean;
  onSubmit: (answer: DuelAnswer) => void;
  confirm?: boolean;
  /** Single picks answer at once on the board; in a grid they select first, then confirm. */
  forceConfirm?: boolean;
}) {
  const styles = useSkinStyles(baseStyles, "prompt");
  const solid = useSkinExtra("prompt");
  const showConfirm = confirm && (forceConfirm || needsExplicitConfirm(prompt));
  const ok = canConfirm(prompt, draft);
  return (
    <>
      {showConfirm ? (
        <button
          type="button"
          className={styles.btn}
          data-kind="primary"
          data-primary
          disabled={!ok || busy}
          onClick={() => onSubmit(toAnswer(prompt, draft))}
        >
          Confirm
        </button>
      ) : null}
      {prompt.finishable ? (
        <button type="button" className={styles.btn} disabled={busy} onClick={() => onSubmit({ finish: true })}>
          Finish
        </button>
      ) : null}
      {prompt.cancelable ? (
        <button type="button" className={styles.btn} data-kind="quiet" disabled={busy} onClick={() => onSubmit({ cancel: true })}>
          {declineLabel(prompt)}
          {styles !== baseStyles && prompt.context?.type === "chain" ? <kbd className={solid?.kbd}>Esc</kbd> : null}
        </button>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------- response panel */

function ChainStrip({
  chain,
  compact = false,
  mySeat = null,
  nameOf,
}: {
  chain: readonly DuelChainLink[];
  compact?: boolean;
  mySeat?: number | null;
  nameOf?: (seat: number) => string;
}) {
  const styles = useSkinStyles(baseStyles, "prompt");
  const solid = useSkinExtra("prompt");
  if (chain.length === 0) return null;
  const shown = chain.slice(-4);
  // 3D mode: the links are tiles, the newest on top (it resolves first), like the concept chain stack.
  if (styles !== baseStyles && !compact) {
    return (
      <div className={styles.chainStrip} aria-label="Chain so far">
        <div className={solid?.chainHead}>
          <span>Chain</span>
          <small>top link resolves first</small>
        </div>
        <ol>
          {[...shown].reverse().map((link) => {
            const owner = link.seat === mySeat ? "you" : "opp";
            return (
              <li key={link.index} className={solid?.chainTile} data-owner={owner}>
                <b className={solid?.clink}>{link.index}</b>
                {link.code != null ? (
                  <span className={solid?.cart} style={{ backgroundImage: `url(${cardArtUrl(link.code, "small")})` }} aria-hidden />
                ) : (
                  <span className={solid?.cart} aria-hidden />
                )}
                <span className={solid?.cmeta}>
                  <span className={solid?.cname}>{link.name ?? "Effect"}</span>
                  <span className={solid?.cowner}>
                    <i aria-hidden />
                    {ownerWord(link.seat, mySeat, "you", nameOf)}
                  </span>
                </span>
                {link.description ? <span className={solid?.ceff}>{link.description}</span> : null}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }
  return (
    <div className={styles.chainStrip} data-compact={compact ? "true" : undefined} aria-label="Chain so far">
      <Link2 size={13} strokeWidth={1.75} aria-hidden />
      <ol>
        {shown.map((link) => (
          <li key={link.index}>
            <b>{link.index}</b>
            {link.name ?? "Effect"}
          </li>
        ))}
      </ol>
      <span className={styles.chainNote}>resolves last first</span>
    </div>
  );
}

function ChainRows({
  prompt,
  draft,
  busy,
  mySeat,
  choose,
  onInspectCard,
  seatTones,
  nameOf,
}: {
  prompt: DuelPrompt;
  draft: PromptDraft;
  busy: boolean;
  mySeat: number | null;
  choose: (id: string) => void;
  onInspectCard?: InspectCardHandler;
  seatTones?: PromptSeatTones;
  nameOf?: (seat: number) => string;
}) {
  const styles = useSkinStyles(baseStyles, "prompt");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <div className={styles.rows} data-toned={seatTones ? "true" : undefined} style={toneVars(seatTones, prompt.seat)}>
      {prompt.options.map((option, index) => {
        const { name, effect, cardText } = effectText(option);
        const ownerSeat = option.controller ?? prompt.seat;
        const owner = ownerWord(ownerSeat, mySeat, "you", seatTones ? nameOf : undefined);
        const open = Boolean(expanded[option.id]);
        const showMore = cardText.length > 0 && cardText !== effect;
        // A short effect label ("Take control") says too little on its own: the printed text follows it.
        const detail = showMore && effect.length < 48 ? cardText : "";
        return (
          <div
            key={option.id}
            className={styles.row}
            data-active={draft.highlight === index}
            data-open={open ? "true" : "false"}
            data-toned={seatTones?.has(ownerSeat) ? "true" : undefined}
            style={toneVars(seatTones, ownerSeat)}
          >
            <button
              type="button"
              className={styles.rowMain}
              data-primary={index === draft.highlight ? true : undefined}
              data-index={index}
              disabled={busy}
              aria-label={fillPlaceholders(option.label, option.card?.name)}
              onClick={() => choose(option.id)}
              onMouseEnter={() => {
                draft.setHighlight(index);
                if (option.card) onInspectCard?.(option.card);
              }}
              onFocus={() => {
                if (option.card) onInspectCard?.(option.card);
              }}
            >
              <span className={styles.rowNum}>{index + 1}</span>
              <CardArt option={option} className={styles.rowArt} />
              <span className={styles.rowText}>
                <b>
                  {name}
                  <span className={styles.rowOwner} data-owner={mySeat == null || ownerSeat === mySeat ? "you" : "opp"}>{owner}</span>
                </b>
                {effect ? <small>{effect}</small> : null}
                {detail ? <small className={styles.rowDetail}>{detail}</small> : null}
              </span>
              <span className={styles.rowGo}>Activate</span>
            </button>
            {showMore ? (
              <button
                type="button"
                className={styles.rowMore}
                aria-expanded={open}
                aria-label={`${open ? "Hide" : "Show"} full text of ${name}`}
                disabled={busy}
                onClick={() => setExpanded((current) => ({ ...current, [option.id]: !open }))}
              >
                {open ? "Hide card text" : "Full card text"}
              </button>
            ) : null}
            {showMore && open ? <CardTextBlock text={cardText} open /> : null}
          </div>
        );
      })}
    </div>
  );
}

function PositionTiles({
  prompt,
  draft,
  busy,
  choose,
}: {
  prompt: DuelPrompt;
  draft: PromptDraft;
  busy: boolean;
  choose: (id: string) => void;
}) {
  const styles = useSkinStyles(baseStyles, "prompt");
  return (
    <div className={styles.positions}>
      {prompt.options.map((option, index) => {
        const position = positionOf(option) ?? 0;
        const defense = (position & (POS_FACEUP_DEFENSE | POS_FACEDOWN_DEFENSE)) !== 0;
        const facedown = (position & (POS_FACEDOWN_ATTACK | POS_FACEDOWN_DEFENSE)) !== 0;
        const label = humanizeLabel(option.label);
        return (
          <button
            key={option.id}
            type="button"
            className={styles.posTile}
            data-kind={index === 0 ? "primary" : undefined}
            data-primary={index === 0 ? true : undefined}
            data-active={draft.highlight === index}
            data-index={index}
            disabled={busy}
            aria-label={label}
            onClick={() => choose(option.id)}
            onMouseEnter={() => draft.setHighlight(index)}
          >
            <span className={styles.posArt} data-defense={defense ? "true" : "false"} data-facedown={facedown ? "true" : "false"}>
              <span className={styles.posCard}>
                {facedown || !option.card ? (
                  <CardBack className={styles.posBack} />
                ) : (
                  <img src={cardArtUrl(option.card.code, "small")} alt="" draggable={false} />
                )}
              </span>
            </span>
            <span className={styles.posLabel}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Re-exported for callers and tests that import the seat-pick rule from here.
export { nextEnabledIndex, outSeatOptionIds };

const NO_ROWS: ReadonlySet<string> = new Set();

/** The row's spoken name; a row that is out or leaving says so (its visible text is not part of an aria-label). */
function rowLabel(label: string | undefined, state: "out" | "leaving" | null): string | undefined {
  return state && label ? `${label}, ${state}` : label;
}

function ResponseBody({
  prompt,
  draft,
  busy,
  slug,
  chain,
  mySeat,
  onSubmit,
  onInspectCard,
  nameOf,
  seatTones,
  priority,
  outRows = NO_ROWS,
  leavingSeats,
}: {
  prompt: DuelPrompt;
  draft: PromptDraft;
  busy: boolean;
  slug: string;
  chain: readonly DuelChainLink[];
  mySeat: number | null;
  onSubmit: (answer: DuelAnswer) => void;
  onInspectCard?: InspectCardHandler;
  nameOf?: (seat: number) => string;
  seatTones?: PromptSeatTones;
  priority?: readonly PrioritySlot[];
  /** Ids of seat rows that are out or leaving (see outSeatOptionIds): shown, not answerable. */
  outRows?: ReadonlySet<string>;
  /** Seats that only leave (their chain still resolves): their disabled rows say "Leaving", not "Out". */
  leavingSeats?: ReadonlySet<number>;
}) {
  const styles = useSkinStyles(baseStyles, "prompt");
  const tray = useSkinStyles(base, "tray");
  const context = prompt.context;
  const choose = (id: string) => onSubmit({ choice: id });
  const source = promptSource(prompt);

  if (prompt.kind === "announce-card") {
    return (
      <AnnounceSearch
        slug={slug}
        cardCode={draft.cardCode}
        busy={busy}
        onPick={(card) => {
          draft.setCardCode(card.code);
          onSubmit({ cardCode: card.code });
        }}
      />
    );
  }

  if (prompt.kind === "number") {
    const ok = canConfirm(prompt, draft);
    return (
      <label className={tray.numberField}>
        <span>Value</span>
        <input
          type="number"
          data-primary
          min={prompt.min}
          max={prompt.max}
          value={draft.value}
          disabled={busy}
          onChange={(event) => draft.setValue(Number(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && ok && !busy) {
              event.preventDefault();
              onSubmit(toAnswer(prompt, draft));
            }
          }}
        />
      </label>
    );
  }

  if (context?.type === "chain") {
    // Every option names a card: the cards side by side, no text. Else the numbered rows.
    const cards = isChainStripPrompt(prompt);
    return (
      <>
        <ChainStrip chain={chain} compact={cards} mySeat={mySeat} nameOf={seatTones ? nameOf : undefined} />
        {priority && nameOf ? <PriorityChips order={priority} mySeat={mySeat} nameOf={nameOf} seatTones={seatTones} compact={cards} /> : null}
        {cards ? (
          <StripChoice prompt={prompt} draft={draft} busy={busy} choose={choose} onInspectCard={onInspectCard} />
        ) : (
          <ChainRows prompt={prompt} draft={draft} busy={busy} mySeat={mySeat} choose={choose} onInspectCard={onInspectCard} seatTones={seatTones} nameOf={nameOf} />
        )}
      </>
    );
  }

  if (context?.type === "deck-master-recall") {
    return (
      <>
        <div className={styles.recall}>
          <img src={cardArtUrl(context.card.code, "small")} alt="" className={styles.recallArt} draggable={false} />
          <div>
            <p className={styles.recallName}>{context.card.name}</p>
            <p className={styles.recallFacts}>
              Return this Deck Master to the Deck Master Zone?
              <br />
              Returns: <b>{context.returns}</b> · Next summon after this recall: <b>{context.nextCost} LP</b>
              <br />
              Each return adds 500 LP to the next summon.
            </p>
          </div>
        </div>
        <YesNo prompt={prompt} draft={draft} busy={busy} choose={choose} />
      </>
    );
  }

  if (isYesNo(prompt)) {
    const yes = prompt.options.find((option) => option.id === "yes");
    const place = zonePlace(source?.zone, mySeat);
    const title = fillPlaceholders(prompt.title, source?.name, place).trim();
    const description = prompt.description ? fillPlaceholders(prompt.description, source?.name, place).trim() : "";
    const effect = (yes ? optionTexts(yes).effectText : "") || (description && description !== title ? description : "");
    return (
      <>
        {effect ? <p className={styles.effect}>{effect}</p> : null}
        {source?.text ? <CardTextBlock text={source.text} /> : null}
        <YesNo prompt={prompt} draft={draft} busy={busy} choose={choose} />
      </>
    );
  }

  if (context?.type === "position") {
    return <PositionTiles prompt={prompt} draft={draft} busy={busy} choose={choose} />;
  }

  // A pick among cards (unselect/select one at a time): a strip of large cards, not rows.
  if (isStripPrompt(prompt)) return <StripChoice prompt={prompt} draft={draft} busy={busy} choose={choose} onInspectCard={onInspectCard} />;

  // Any other list of options: numbered rows, with art when the option names a card.
  return (
    <>
      {source?.text ? <CardTextBlock text={source.text} /> : null}
      <div className={styles.rows}>
        {prompt.options.map((option, index) => {
          const { effectText: optionEffect } = optionTexts(option);
          // Seat-only choices use the same names as the LP panels, including duplicate-name seat numbers.
          const directAttack = seatTones != null && isDirectAttackRow(option);
          const out = outRows.has(option.id);
          const exit = !out ? null : option.controller != null && leavingSeats?.has(option.controller) ? "leaving" : "out";
          const seatName = (context?.type === "opponent" || directAttack) && option.controller != null ? nameOf?.(option.controller) : undefined;
          const label = directAttack && seatName ? `Attack ${seatName} directly`
            : seatName ?? humanizeLabel(fillPlaceholders(option.label, option.card?.name ?? source?.name));
          return (
            <div
              key={option.id}
              className={styles.row}
              data-seat={context?.type === "opponent" || directAttack ? option.controller : undefined}
              data-out={out ? "true" : undefined}
              data-plain={option.card ? undefined : "true"}
              data-active={draft.highlight === index}
              data-selected={prompt.kind === "toggle" ? Boolean(option.selected) : undefined}
            >
              <button
                type="button"
                className={styles.rowMain}
                data-primary={index === draft.highlight ? true : undefined}
                data-index={index}
                disabled={busy || out}
                aria-label={rowLabel(context?.type === "opponent" ? opponentPickLabel(label) : directAttack && seatName ? label : undefined, exit)}
                onClick={() => choose(option.id)}
                onMouseEnter={() => {
                  draft.setHighlight(index);
                  if (option.card) onInspectCard?.(option.card);
                }}
                onFocus={() => {
                  if (option.card) onInspectCard?.(option.card);
                }}
              >
                <span className={styles.rowNum}>{index + 1}</span>
                {option.card ? <CardArt option={option} className={styles.rowArt} /> : null}
                <span className={styles.rowText}>
                  <b>{label}</b>
                  {exit ? <small>{exit === "leaving" ? "Leaving" : "Out"}</small> : optionEffect && optionEffect !== label ? <small>{optionEffect}</small> : null}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function YesNo({
  prompt,
  draft,
  busy,
  choose,
}: {
  prompt: DuelPrompt;
  draft: PromptDraft;
  busy: boolean;
  choose: (id: string) => void;
}) {
  const styles = useSkinStyles(baseStyles, "prompt");
  const yes = prompt.options.find((option) => option.id === "yes");
  const no = prompt.options.find((option) => option.id === "no");
  if (!yes || !no) return null;
  return (
    <div className={styles.pair}>
      <button
        type="button"
        className={styles.btn}
        data-kind="primary"
        data-primary
        data-active={prompt.options[draft.highlight]?.id === yes.id}
        disabled={busy}
        onClick={() => choose(yes.id)}
      >
        {humanizeLabel(yes.label)}
      </button>
      <button
        type="button"
        className={styles.btn}
        data-active={prompt.options[draft.highlight]?.id === no.id}
        disabled={busy}
        onClick={() => choose(no.id)}
      >
        {humanizeLabel(no.label)}
      </button>
    </div>
  );
}

/** Header copy for the response panel: who is asking, about which card, and what kind of effect. */
export function responseTitle(
  prompt: DuelPrompt,
  chain: readonly DuelChainLink[],
  mySeat: number | null = null,
  nameOf?: (seat: number) => string,
): { title: string; sub?: string; source: PromptSource | null } {
  const context = prompt.context;
  const source = promptSource(prompt);
  const place = zonePlace(source?.zone, mySeat);
  const kind = effectKind(prompt);
  const sourceLine = source
    ? [source.name, `${ownerWord(source.seat, mySeat, "your", nameOf)} ${kind ? `${kind} effect` : "effect"}`, place]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  if (context?.type === "chain") {
    const last = chain[chain.length - 1];
    const target = last?.name ? ` to ${last.name}` : "";
    const filled = fillPlaceholders(prompt.title, source?.name, place).trim();
    const generic = /^select a (mandatory effect|chain link or pass)$/i.test(filled);
    return {
      title: context.forced ? `You must respond${target}` : `You can respond${target}`,
      sub: sourceLine ?? (generic ? undefined : filled),
      source,
    };
  }
  if (context?.type === "deck-master-recall") return { title: prompt.title, source };
  if (context?.type === "position") {
    const named = selectBarCopy({
      kind: prompt.kind,
      title: fillPlaceholders(prompt.title, source?.name, place).trim(),
      min: 1,
      max: 1,
      count: 0,
      sourceName: source?.name,
      position: true,
    });
    return { title: named.title, sub: named.detail ?? sourceLine, source };
  }
  const title = fillPlaceholders(prompt.title, source?.name, place).trim();
  const description = prompt.description ? fillPlaceholders(prompt.description, source?.name, place).trim() : undefined;
  if (source && isYesNo(prompt)) {
    return { title: `Activate ${source.name}'s effect?`, sub: sourceLine, source };
  }
  if (source) return { title, sub: sourceLine, source };
  return { title, sub: description && description !== title ? description : undefined, source };
}

/* ------------------------------------------------------------- card strip */

/**
 * True when the options are all cards the player picks by looking at them (select / tribute / sum /
 * order grids, and the one-at-a-time select-unselect list): they show as a wide strip of large cards
 * instead of tall rows or a tile grid. Counters, places, announce lists, chain rows, positions and
 * yes/no keep their own layouts.
 */
export function isStripPrompt(prompt: DuelPrompt): boolean {
  switch (prompt.kind) {
    case "cards":
    case "tribute":
    case "sum":
    case "order":
    case "toggle":
    case "choice":
      break;
    default:
      return false;
  }
  const context = prompt.context?.type;
  if (context === "chain" || context === "position" || context === "deck-master-recall" || context === "action") return false;
  if (isYesNo(prompt)) return false;
  return prompt.options.length > 0 && prompt.options.every((option) => option.card != null);
}

/**
 * True for a chain response (optional "You can respond" list, or mandatory triggers to choose from)
 * whose every option is a card: the cards show side by side with no effect text, a click activates.
 * A chain list with an option that has no card keeps its rows.
 */
export function isChainStripPrompt(prompt: DuelPrompt): boolean {
  return (
    prompt.kind === "choice" &&
    prompt.context?.type === "chain" &&
    prompt.options.length > 0 &&
    prompt.options.every((option) => option.card != null)
  );
}

/** The strip items for a choice prompt: the card, its name, and a short line only where one card has many options. */
export function choiceStripItems(prompt: DuelPrompt): StripCard[] {
  const notes = optionNotes(
    prompt.options.map((option) => ({ code: option.card?.code ?? null, effect: effectText(option).effect })),
  );
  return prompt.options.map((option, index) => ({
    id: option.id,
    card: option.card as DuelCardInfo,
    label: option.card?.name ?? humanizeLabel(option.label),
    selected: prompt.kind === "toggle" && Boolean(option.selected),
    order: null,
    detail: notes[index]?.detail,
    detailTitle: notes[index]?.title,
    location: option.location,
  }));
}

/** Select-unselect and choice prompts answer at once: a click on a card is the answer. */
function StripChoice({
  prompt,
  draft,
  busy,
  choose,
  onInspectCard,
}: {
  prompt: DuelPrompt;
  draft: PromptDraft;
  busy: boolean;
  choose: (id: string) => void;
  onInspectCard?: InspectCardHandler;
}) {
  const chainResponse = prompt.context?.type === "chain";
  return (
    <CardStrip
      items={choiceStripItems(prompt)}
      highlight={draft.highlight}
      busy={busy}
      multi={false}
      tone={chainResponse ? "chain" : undefined}
      hint={chainResponse ? "Click a card to activate it · hover to read it" : undefined}
      label={fillPlaceholders(prompt.title, promptSource(prompt)?.name)}
      onPick={(index) => choose(prompt.options[index].id)}
      onEnter={draft.setHighlight}
      onInspect={onInspectCard}
    />
  );
}

/* -------------------------------------------------------------- grid picker */

function GridPicker({
  prompt,
  draft,
  busy,
  aim,
  onSubmit,
  onCollapse,
  onInspectCard,
}: {
  prompt: DuelPrompt;
  draft: PromptDraft;
  busy: boolean;
  aim?: PromptAim;
  onSubmit: (answer: DuelAnswer) => void;
  onCollapse: () => void;
  onInspectCard?: InspectCardHandler;
}) {
  const styles = useSkinStyles(baseStyles, "prompt");
  const counters = prompt.kind === "counters";
  const { min, max } = selectionBounds(prompt);
  const single = !counters && min === 1 && max === 1 && prompt.kind !== "order";
  const valueDetail = prompt.kind === "sum" || prompt.kind === "tribute";
  const total = counters ? prompt.options.reduce((sum, option) => sum + (draft.counts[option.id] ?? 0), 0) : 0;
  const copy = pickCopy(prompt, draft, Boolean(aim), aim?.hint);
  const status = counters
    ? prompt.target != null
      ? `${total} of ${prompt.target} placed`
      : `${total} placed`
    : copy.sub;
  const title = copy.title;
  const fullTitle = copy.full;
  const description = prompt.description ? fillPlaceholders(prompt.description, promptSource(prompt)?.name) : "";

  function pick(option: DuelPromptOption, index: number) {
    draft.setHighlight(index);
    if (aim) {
      aim.onAim(option);
      return;
    }
    draft.setSelected((current) => toggleSelected(prompt, current, option.id));
  }

  function bump(option: DuelPromptOption, delta: number) {
    draft.setCounts((counts) => ({
      ...counts,
      [option.id]: Math.max(0, Math.min(option.max ?? prompt.max ?? 99, (counts[option.id] ?? 0) + delta)),
    }));
  }

  // Cards to pick: one wide strip of large cards. Zones, counters and the rest keep the tile grid.
  const strip = isStripPrompt(prompt);
  const stripItems: StripCard[] = strip
    ? prompt.options.map((option) => ({
        id: option.id,
        card: option.card as DuelCardInfo,
        label: option.card?.name ?? humanizeLabel(option.label),
        selected: aim ? aim.lockedId === option.id : draft.selected.includes(option.id),
        order: prompt.kind === "order" ? draft.selected.indexOf(option.id) + 1 || null : null,
        note: valueDetail && option.values?.length ? option.values.join(" / ") : undefined,
        location: option.location,
      }))
    : [];

  return (
    <>
      <header className={styles.head}>
        <div className={styles.titles}>
          <h2 title={copy.tooltip}>{title}</h2>
          <p>{description && description !== fullTitle ? `${description} · ${status}` : status}</p>
        </div>
        <button type="button" className={styles.hide} aria-label="Hide to look at the board" title="Hide to look at the board" onClick={onCollapse}>
          <EyeOff size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      {strip ? (
        <CardStrip
          items={stripItems}
          highlight={draft.highlight}
          busy={busy}
          multi
          label={fullTitle}
          onPick={(index) => pick(prompt.options[index], index)}
          onDouble={(index) => {
            if (single && !aim && !busy) onSubmit({ selected: [prompt.options[index].id] });
          }}
          onEnter={(index) => aim?.onHover(prompt.options[index])}
          onLeave={aim ? () => aim.onHover(null) : undefined}
          onInspect={onInspectCard}
        />
      ) : (
      <ul className={styles.grid}>
        {prompt.options.map((option, index) => {
          const selected = counters ? (draft.counts[option.id] ?? 0) > 0 : draft.selected.includes(option.id);
          const orderIndex = prompt.kind === "order" ? draft.selected.indexOf(option.id) : -1;
          const label = humanizeLabel(option.label);
          return (
            <li key={option.id}>
              <div
                className={styles.tile}
                data-selected={aim ? aim.lockedId === option.id : selected}
                data-active={draft.highlight === index}
              >
                <button
                  type="button"
                  className={styles.tileHit}
                  data-primary={index === 0 ? true : undefined}
                  aria-pressed={selected}
                  disabled={busy || counters}
                  title={label}
                  onClick={() => pick(option, index)}
                  onDoubleClick={() => {
                    if (single && !aim && !busy) onSubmit({ selected: [option.id] });
                  }}
                  onMouseEnter={() => {
                    aim?.onHover(option);
                    if (option.card) onInspectCard?.(option.card);
                  }}
                  onMouseLeave={aim ? () => aim.onHover(null) : undefined}
                  onFocus={() => {
                    if (option.card) onInspectCard?.(option.card);
                  }}
                >
                  <span className={styles.tileArt}>
                    {option.card ? (
                      <img src={cardArtUrl(option.card.code, "small")} alt="" draggable={false} />
                    ) : (
                      <span className={styles.tileZone}>{label}</span>
                    )}
                    {selected && !counters ? (
                      <span className={styles.tileMark} aria-hidden>
                        {orderIndex >= 0 ? orderIndex + 1 : <Check size={13} strokeWidth={2.5} />}
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.tileLabel}>{option.card ? label : ""}</span>
                  {valueDetail && option.values?.length ? (
                    <span className={styles.tileValue}>{option.values.join(" / ")}</span>
                  ) : null}
                </button>
                {counters ? (
                  <div className={styles.stepper}>
                    <button type="button" aria-label={`Decrease ${label}`} disabled={busy} onClick={() => bump(option, -1)}>
                      −
                    </button>
                    <span>{draft.counts[option.id] ?? 0}</span>
                    <button type="button" aria-label={`Increase ${label}`} disabled={busy} onClick={() => bump(option, 1)}>
                      +
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      )}
      <footer className={styles.foot}>
        {prompt.kind === "order" && draft.selected.length > 0 ? (
          <button type="button" className={styles.btn} data-kind="quiet" disabled={busy} onClick={() => draft.setSelected([])}>
            Reset order
          </button>
        ) : null}
        <span className={styles.spacer} />
        <Actions prompt={prompt} draft={draft} busy={busy} onSubmit={onSubmit} confirm={!aim} forceConfirm />
      </footer>
    </>
  );
}

/* --------------------------------------------------------------- the layer */

export interface PromptCenterProps {
  prompt: DuelPrompt | null;
  mySeat: number | null;
  /** The duel is running: prompts are answerable. */
  active: boolean;
  slug: string;
  busy: boolean;
  draft: PromptDraft;
  onSubmit: (answer: DuelAnswer) => void;
  /** A card action menu is open: right-click and Esc belong to it. */
  menuOpen: boolean;
  chain: readonly DuelChainLink[];
  /** Attack-target step: picking a card aims instead of answering. */
  aim?: PromptAim;
  /** The attack confirm popover is open on a locked target. */
  aimLocked: boolean;
  reducedMotion: boolean;
  /** Bumps whenever the engine view changes; re-checks what is on the board. */
  revision: number;
  /** Battle Phase sub-step while the prompt is open (engine.battleStep), so a response says when it is. */
  battleStep?: BattleStep | null;
  /**
   * False while the panel waits its human beat after an action (see usePromptReveal). Nothing is
   * drawn and nothing answers the prompt: not right-click, Esc nor Enter. Default true.
   */
  revealed?: boolean;
  /** Hovering or focusing a card in a grid or a response row shows it in the left inspector. */
  onInspectCard?: InspectCardHandler;
  /** Display name of a seat. An opponent pick shows the name instead of the engine's "Player N". */
  nameOf?: (seat: number) => string;
  /**
   * Tones of the seats of a table of 3 or 4 (with `nameOf`). Chain rows then name their owner ("You" or the player's
   * name, never "Opponent") and wear the owner's tone. Left out (1v1), nothing changes.
   */
  seatTones?: PromptSeatTones;
  /** Tables of 3 or 4 seats: who may answer the open chain, in order. A chain response then lists it under the chain. */
  priority?: readonly PrioritySlot[];
  /**
   * Tables of 3 or 4 seats: seats that are out or leaving. In an opponent or direct-attack pick their rows are
   * disabled while another seat row is still living (ids and order unchanged; keys skip them).
   */
  outSeats?: ReadonlySet<number>;
  /** The subset of `outSeats` that only leaves (not yet out). Their rows read "Leaving"; the others read "Out". */
  leavingSeats?: ReadonlySet<number>;
}

/**
 * Mount inside the board box (position: relative; overflow: hidden). It fills the box but only its own
 * panel takes pointer events, so the field underneath stays clickable.
 * Panels carry `data-prompt-panel`: hover tooltips read it to stay clear of an open prompt.
 */
export function PromptCenter(props: PromptCenterProps) {
  const styles = useSkinStyles(baseStyles, "prompt");
  const { prompt, mySeat, active, draft, busy, onSubmit, chain, aim, reducedMotion, revision, slug, battleStep, onInspectCard } = props;
  const revealed = props.revealed ?? true;
  const answering = prompt != null && mySeat != null && prompt.seat === mySeat && active;
  const baseKind = answering ? centerKind(prompt) : null;
  // A one-card-at-a-time pick may be answered on the board with the bar; onBoard (measured below) decides.
  const boardToggle = baseKind === "response" && isBoardTogglePrompt(prompt);

  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [onBoard, setOnBoard] = useState<boolean | null>(null);
  const kind: CenterKind | null = boardToggle && onBoard === true ? "select" : baseKind;
  // Prompt id whose full effect list is open. A prompt with a pre-check starts on the compact bar.
  const [listFor, setListFor] = useState<string | null>(null);
  const [barPlace, setBarPlace] = useState<BarPlace>({ mode: "mid", top: null, left: null, fit: null, stack: false });
  const [dockPlace, setDockPlace] = useState<DockPlace>({ mode: "center", left: null, top: null, bottom: 12, width: null });

  const promptRef = useRef(prompt);
  const kindRef = useRef(kind);
  const busyRef = useRef(busy);
  const submitRef = useRef(onSubmit);
  const menuRef = useRef(props.menuOpen);
  const lockedRef = useRef(props.aimLocked);
  const collapsedRef = useRef(collapsed);
  const revealedRef = useRef(revealed);
  const barRef = useRef(false);
  const mySeatRef = useRef(mySeat);
  mySeatRef.current = mySeat;
  revealedRef.current = revealed;
  promptRef.current = prompt;
  kindRef.current = kind;
  busyRef.current = busy;
  submitRef.current = onSubmit;
  menuRef.current = props.menuOpen;
  lockedRef.current = props.aimLocked;
  collapsedRef.current = collapsed;
  barRef.current = kind === "select" && onBoard !== false;
  // The compact yes/no bar is up (kind "response" with a pre-check, list not opened), or the list behind it.
  const precheck = kind === "response" ? precheckKind(prompt) : null;
  const checking = precheck != null && listFor !== prompt?.id;
  const precheckRef = useRef<{ checking: boolean; backable: boolean; listFollows: boolean; yes: () => void; no: () => void; back: () => void } | null>(null);
  const answerYes = () => {
    if (!prompt || busy) return;
    const plan = precheckYes(prompt);
    if (!plan) return;
    if ("answer" in plan) onSubmit(plan.answer);
    else setListFor(prompt.id);
  };
  const answerNo = () => {
    if (!prompt || busy) return;
    const answer = precheckNo(prompt);
    if (answer) onSubmit(answer);
  };
  const backToCheck = () => setListFor(null);
  precheckRef.current = {
    checking,
    // The list opened from the bar: Back and Esc return to the bar.
    backable: precheck === "chain" && !checking,
    listFollows: precheck === "chain" && (prompt?.options.length ?? 0) > 1,
    yes: answerYes,
    no: answerNo,
    back: backToCheck,
  };

  const promptId = prompt?.id;
  useEffect(() => setCollapsed(false), [promptId]);

  // Seat rows of an out or leaving duelist stay listed but cannot be picked, by click or by key.
  const outRows = outSeatOptionIds(kind === "response" ? prompt : null, props.outSeats);
  const outKey = [...outRows].join("|");

  // Which way to answer a card pick: on the board, or in a centred grid.
  useLayoutEffect(() => {
    const scope = boardOf(layerRef.current);
    if ((baseKind !== "select" && !boardToggle) || !prompt || !scope) {
      setOnBoard(null);
      return;
    }
    setOnBoard(allOptionsOnBoard(prompt, scope));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKind, boardToggle, promptId, revision]);

  // The instruction bar sits in the middle band of the board, between the Extra Monster Zones, so it is
  // easy to see and hits no hand card or field row you can pick (see select-bar-place.ts).
  const placeBar = useCallback(() => {
    const layer = layerRef.current;
    const board = boardOf(layer ?? null);
    if (!layer || !board) return;
    const rectOf = (element: Element): BarRect => {
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    if (promptRef.current?.kind === "tribute") {
      // Tributes are picked on the field: the dock sits by your own hand, not over the board (tribute-dock-place.ts).
      const hands = Array.from(board.querySelectorAll<HTMLElement>("[data-hand-seat]"));
      const own = hands.find((hand) => hand.dataset.handSeat === String(mySeatRef.current))
        ?? [...hands].sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
      // The hand element spans the whole row; the dock needs the room beside the cards themselves.
      let handRect: BarRect | null = own ? rectOf(own) : null;
      const cardRects = own
        ? Array.from(own.querySelectorAll<HTMLElement>("[data-hand-card]")).map(rectOf).filter((r) => r.right - r.left > 1 && r.bottom - r.top > 1)
        : [];
      if (handRect && cardRects.length > 0) {
        handRect = {
          left: Math.min(...cardRects.map((r) => r.left)),
          right: Math.max(...cardRects.map((r) => r.right)),
          top: Math.min(handRect.top, ...cardRects.map((r) => r.top)),
          bottom: Math.max(...cardRects.map((r) => r.bottom)),
        };
      }
      // The seat plates carry the LP and the turn clock: the dock keeps off them. `[data-holo]` is the table shell's
      // plate, `[data-team-plate]` the Rooftop's, `[data-lp-seat]` the 1v1 room's tally (and the chips inside the others).
      const plates = Array.from(board.querySelectorAll<HTMLElement>("[data-holo], [data-team-plate], [data-lp-seat]")).map(rectOf);
      const place = placeTributeDock({ board: rectOf(board), hand: handRect, centered: board.closest('[data-table-stage="tag"]') != null, plates });
      setDockPlace((current) => (sameDock(current, place) ? current : place));
      return;
    }
    const next = placeSelectBar({
      board: rectOf(board),
      emz: Array.from(board.querySelectorAll<HTMLElement>('[data-kind="emz"][data-zones]')).map((zone) => ({
        ...rectOf(zone),
        legal: zone.dataset.legal === "true",
      })),
      hands: Array.from(board.querySelectorAll<HTMLElement>("[data-hand-seat]")).map(rectOf),
    });
    setBarPlace((current) => (samePlace(current, next) ? current : next));
  }, []);
  useLayoutEffect(() => {
    if (kind !== "select" || onBoard !== true) return;
    placeBar();
    const board = boardOf(layerRef.current);
    if (!board || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(placeBar);
    observer.observe(board);
    return () => observer.disconnect();
  }, [kind, onBoard, placeBar, revision, promptId]);

  // Focus moves into the panel so Enter takes the primary answer.
  useEffect(() => {
    if (!kind || !revealed || (kind === "select" && onBoard !== false) || collapsed) return;
    const panel = panelRef.current;
    // Card grids focus the panel itself: Enter then confirms through the tray's shortcut.
    // The highlighted row can be a disabled seat row (out or leaving); focus then goes to the first enabled row.
    const target = kind === "response"
      ? (panel?.querySelector<HTMLElement>("[data-primary]:not(:disabled)") ?? panel?.querySelector<HTMLElement>("[data-index]:not(:disabled)"))
      : panel;
    target?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptId, collapsed, kind, onBoard, revealed, checking]);

  // Arrow keys (handled by the tray) move the highlight; the focused row follows it.
  const highlight = draft.highlight;
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !panel.contains(document.activeElement)) return;
    panel.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.focus({ preventScroll: true });
  }, [highlight]);

  // The highlight never rests on a disabled row (the first one, or one left by a changed prompt). The draft owner
  // resets the highlight to 0 in its own effect, which runs after this one; the microtask lands after that reset.
  useEffect(() => {
    if (!prompt || outRows.size === 0) return;
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      draft.setHighlight((index) => (outRows.has(prompt.options[index]?.id ?? "") ? nextEnabledIndex(prompt, outRows, index, 1) : index));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, promptId, outKey]);

  useEffect(() => {
    if (!kind) return;
    let swallow = false;
    const down = (event: PointerEvent) => {
      if (event.button === 2) swallow = menuRef.current || lockedRef.current;
    };
    const context = (event: MouseEvent) => {
      const current = promptRef.current;
      if (!current) return;
      // Hidden behind its human beat: a right-click answers nothing yet.
      if (!revealedRef.current) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input,textarea,select,[contenteditable='true'],[data-duel-menu],[role='menu'],[role='dialog']")) return;
      if (swallow) {
        // This right-click already closed a menu or backed out of an attack confirm.
        swallow = false;
        event.preventDefault();
        return;
      }
      const decline = dismissAnswer(current, zoneKeysAt(target));
      if (decline) {
        event.preventDefault();
        if (!busyRef.current) submitRef.current(decline);
        return;
      }
      if (kindRef.current != null && !barRef.current) {
        // Mandatory: right-click only folds the panel away so the board can be read.
        event.preventDefault();
        setCollapsed((value) => !value);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || menuRef.current) return;
      // A menu owns its keys: Escape closes it, and n / y in it must not answer the prompt behind.
      if (event.target instanceof Element && event.target.closest("[data-duel-menu],[role='menu']")) return;
      if (kindRef.current == null || barRef.current) return;
      const current = promptRef.current;
      if (!current || !revealedRef.current) return;
      const check = precheckRef.current;
      if (check?.checking) {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("input,textarea,select,[contenteditable='true'],[role='dialog']")) return;
        const action = precheckKeyAction(event.key, target?.closest("button,a,summary,[role='button']") != null, check.listFollows);
        if (!action) return;
        event.preventDefault();
        if (action === "swallow" || event.repeat || busyRef.current) return;
        if (action === "yes") check.yes();
        else check.no();
        return;
      }
      // A dialog opened over the duel (Report a bug) owns its keys: its Escape must not answer the prompt behind it.
      if (event.target instanceof Element && event.target.closest("[role='dialog']")) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (check?.backable && !collapsedRef.current) {
        // Esc in the list goes back to the bar; Esc there says no.
        if (!event.repeat) check.back();
        return;
      }
      if (collapsedRef.current) {
        setCollapsed(false);
        return;
      }
      const decline = dismissAnswer(current);
      if (decline) {
        if (!busyRef.current && !event.repeat) submitRef.current(decline);
      } else {
        setCollapsed(true);
      }
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("contextmenu", context);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("contextmenu", context);
      window.removeEventListener("keydown", key, true);
    };
  }, [kind, promptId]);

  // A one-card-at-a-time pick shows nothing until it is known whether the cards are on the board.
  if (!prompt || !kind || !revealed || (boardToggle && onBoard === null)) {
    return <div ref={layerRef} className={styles.layer} aria-hidden hidden />;
  }

  const optional = declineAnswer(prompt) != null;
  const chainKind = prompt.context?.type === "chain";
  const tone = chainKind ? "chain" : "action";
  const dataReduced = reducedMotion ? "true" : "false";
  const stepName = battleStepLabel(battleStep);
  const stepLine = stepName ? (
    <span className={styles.stepChip} data-tone={tone} title={`Battle Phase · ${stepName}${chainKind ? " · respond?" : ""}`}>
      <i aria-hidden />
      <span className={styles.stepText}>Battle Phase · {stepName}{chainKind ? " · respond?" : ""}</span>
    </span>
  ) : null;

  let body: ReactNode = null;

  if (kind === "select" && onBoard !== false) {
    if (onBoard === null) return <div ref={layerRef} className={styles.layer} aria-hidden hidden />;
    const aiming = Boolean(aim);
    const explicit = needsExplicitConfirm(prompt);
    const toggling = prompt.kind === "toggle";
    // A one-at-a-time pick is done when Finish is offered; every other pick when its count rules hold.
    const ok = toggling ? Boolean(prompt.finishable) : canConfirm(prompt, draft);
    const source = promptSource(prompt);
    // A short whole title, the card or purpose and the progress. The tooltip and aria-label keep the full engine text.
    const copy = pickCopy(prompt, draft, aiming, aim?.hint);
    // After the first material the engine drops Cancel; Undo unselects the last pick instead.
    const canUndo = toggling && backOutLabel(prompt) === "Undo";
    // A Tribute pick sends itself once it cannot change; Summon is for a pick that is worth enough but still open.
    const summon = prompt.kind === "tribute" && ok && !aiming;
    const hasButtons = (explicit && !aiming) || summon || Boolean(prompt.finishable) || canUndo || Boolean(prompt.cancelable);
    // Tributes: the instruction docks by the hand and the field itself is the picker (tribute-dock-place.ts).
    const dock = prompt.kind === "tribute";
    const barStyle = (dock
      ? {
          ...(dockPlace.left != null ? { left: dockPlace.left } : null),
          ...(dockPlace.top != null ? { top: dockPlace.top } : null),
          ...(dockPlace.bottom != null ? { bottom: dockPlace.bottom } : null),
          ...(dockPlace.width != null ? { "--bar-fit": `${dockPlace.width}px` } : null),
        }
      : {
          top: barPlace.top ?? (barPlace.mode === "mid" ? "50%" : 8),
          left: barPlace.left ?? "50%",
          ...(barPlace.fit != null ? { "--bar-fit": `${barPlace.fit}px` } : null),
        }) as CSSProperties;
    body = (
      <div
        className={styles.bar}
        data-prompt-surface=""
        data-reduced={dataReduced}
        data-place={dock ? "dock" : barPlace.mode}
        data-dock={dock ? dockPlace.mode : undefined}
        data-stack={!dock && barPlace.stack ? "true" : "false"}
        data-ready={ok ? "true" : "false"}
        style={barStyle}
        data-actions={hasButtons ? "true" : "false"}
        role="group"
        aria-label={copy.full}
      >
        <div className={styles.barMain} title={copy.tooltip}>
          {source ? (
            <img src={cardArtUrl(source.code, "small")} alt="" className={styles.barThumb} draggable={false} />
          ) : null}
          <div className={styles.barText}>
            <b>{copy.title}</b>
            <span className={styles.barSub}>
              {copy.detail ? <span className={styles.barDetail}>{copy.detail}</span> : null}
              {copy.instruction ? <span className={styles.barAsk}>{copy.instruction}</span> : null}
              {copy.counter ? <span className={styles.barCount} data-done={(copy.met ?? ok) ? "true" : "false"}>{copy.counter}</span> : null}
            </span>
          </div>
        </div>
        <div className={styles.barBtns}>
          {summon ? (
            <button type="button" className={styles.btn} data-kind="primary" disabled={busy} onClick={() => onSubmit(toAnswer(prompt, draft))}>
              Summon
            </button>
          ) : null}
          {explicit && !aiming && prompt.kind !== "tribute" ? (
            <button
              type="button"
              className={styles.btn}
              data-kind="primary"
              disabled={!ok || busy}
              title={!ok && copy.remaining ? `Select ${copy.remaining} more` : undefined}
              onClick={() => onSubmit(toAnswer(prompt, draft))}
            >
              Confirm
            </button>
          ) : null}
          {prompt.finishable ? (
            <button
              type="button"
              className={styles.btn}
              data-kind={toggling ? "primary" : undefined}
              disabled={busy}
              onClick={() => onSubmit({ finish: true })}
            >
              Finish
            </button>
          ) : null}
          {canUndo ? (
            <button
              type="button"
              className={styles.btn}
              data-kind="quiet"
              disabled={busy}
              title="Unselect the last card (Esc or right-click)"
              onClick={() => {
                const undo = backOutAnswer(prompt);
                if (undo) onSubmit(undo);
              }}
            >
              Undo
            </button>
          ) : null}
          {prompt.cancelable ? (
            <button type="button" className={styles.btn} data-kind="quiet" disabled={busy} onClick={() => onSubmit({ cancel: true })}>
              {aiming ? "Back" : "Cancel"}
            </button>
          ) : null}
        </div>
      </div>
    );
    return (
      <div ref={layerRef} className={styles.layer}>
        {body}
      </div>
    );
  }

  // An effect you may activate opens as a small yes/no bar low on the board; Yes then answers or opens the list.
  if (kind === "response" && precheck && checking) {
    const copy = precheckCopy(prompt, chain, stepName);
    if (copy) {
      return (
        <div ref={layerRef} className={styles.layer}>
          <PrecheckBar
            name={copy.name}
            ask={copy.ask}
            context={copy.context}
            cards={copy.cards}
            tone={tone}
            busy={busy}
            reducedMotion={reducedMotion}
            onYes={answerYes}
            onNo={answerNo}
            onInspectCard={onInspectCard}
          />
        </div>
      );
    }
  }

  const pill = (
    <button
      type="button"
      className={styles.pill}
      data-prompt-surface=""
      data-tone={tone}
      data-reduced={dataReduced}
      onClick={() => setCollapsed(false)}
    >
      <i aria-hidden />
      Response needed · show
    </button>
  );

  if (collapsed) {
    return (
      <div ref={layerRef} className={styles.layer}>
        {pill}
      </div>
    );
  }

  const hide = (
    <button
      type="button"
      className={styles.hide}
      aria-label="Hide to look at the board"
      title="Hide to look at the board"
      onClick={() => setCollapsed(true)}
    >
      <EyeOff size={16} strokeWidth={1.75} aria-hidden />
    </button>
  );

  if (kind === "response") {
    const { title, sub, source } = responseTitle(prompt, chain, mySeat, props.seatTones ? props.nameOf : undefined);
    const actions = prompt.kind === "choice" && isYesNo(prompt) ? null : (
      <Actions prompt={prompt} draft={draft} busy={busy} onSubmit={onSubmit} />
    );
    const hasActions = actions != null && (needsExplicitConfirm(prompt) || prompt.cancelable || prompt.finishable);
    body = (
      <div
        ref={panelRef}
        className={styles.panel}
        data-prompt-panel
        data-tone={tone}
        data-forced={prompt.context?.type === "chain" && prompt.context.forced ? "true" : "false"}
        data-strip={isStripPrompt(prompt) || isChainStripPrompt(prompt) ? "true" : undefined}
        data-reduced={dataReduced}
        role="group"
        aria-label={title}
        aria-live="polite"
      >
        <header className={styles.head} data-source={source ? "true" : "false"}>
          {source ? (
            <img src={cardArtUrl(source.code, "small")} alt="" className={styles.sourceArt} draggable={false} />
          ) : null}
          <div className={styles.titles}>
            {stepLine}
            <h2>{title}</h2>
            {sub ? <p>{sub}</p> : null}
          </div>
          <span className={styles.badge} data-optional={optional}>
            {optional ? "Optional" : "Mandatory"}
          </span>
          {hide}
        </header>
        <ResponseBody prompt={prompt} draft={draft} busy={busy} slug={slug} chain={chain} mySeat={mySeat} onSubmit={onSubmit}
          onInspectCard={onInspectCard} nameOf={props.nameOf} seatTones={props.seatTones} priority={props.priority} outRows={outRows} leavingSeats={props.leavingSeats} />
        {hasActions || optional ? (
          <footer className={styles.foot}>
            {optional ? <span className={styles.hint}>Right-click to pass</span> : null}
            <span className={styles.spacer} />
            {precheck === "chain" ? (
              <button type="button" className={styles.btn} data-kind="quiet" disabled={busy} onClick={backToCheck}>
                Back
              </button>
            ) : null}
            {actions}
          </footer>
        ) : null}
      </div>
    );
  } else {
    body = (
      <div
        ref={panelRef}
        className={styles.panel}
        data-prompt-panel
        tabIndex={-1}
        data-tone="action"
        data-wide="true"
        data-strip={isStripPrompt(prompt) ? "true" : undefined}
        data-reduced={dataReduced}
        role="group"
        aria-label={fillPlaceholders(prompt.title, promptSource(prompt)?.name)}
      >
        {stepLine ? <div className={styles.stepRow}>{stepLine}</div> : null}
        <GridPicker prompt={prompt} draft={draft} busy={busy} aim={aim} onSubmit={onSubmit} onCollapse={() => setCollapsed(true)}
          onInspectCard={onInspectCard} />
      </div>
    );
  }

  return (
    <div ref={layerRef} className={styles.layer}>
      {body}
    </div>
  );
}
