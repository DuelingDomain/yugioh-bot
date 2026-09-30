"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import { CardBack } from "./card-face";
import { battleStepLabel, type BattleStep } from "./station-track";
import base from "./prompts.module.css";
import styles from "./prompt-center.module.css";

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

function ownerWord(seat: number | undefined, mySeat: number | null, form: "your" | "you"): string {
  if (seat == null || mySeat == null) return form === "your" ? "Your" : "You";
  if (seat === mySeat) return form === "your" ? "Your" : "You";
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

function declineLabel(prompt: DuelPrompt): string {
  if (prompt.context?.type === "chain") return "Pass";
  if (isYesNo(prompt)) return "No";
  return "Cancel";
}

const OFF_BOARD_LOCATIONS = LOCATION_DECK | LOCATION_GRAVE | LOCATION_REMOVED | LOCATION_EXTRA | LOCATION_OVERLAY;

/** True when every option can be clicked where it sits on the board (both hands and all zones count). */
function allOptionsOnBoard(prompt: DuelPrompt, scope: ParentNode): boolean {
  if (prompt.options.length === 0) return true;
  return prompt.options.every((option) => {
    if (option.location != null && (option.location & OFF_BOARD_LOCATIONS) !== 0) return false;
    const keys = optionZoneKeys(option);
    if (keys.length === 0) return false;
    return scope.querySelector(`[data-zones~="${keys[0]}"]`) != null;
  });
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
  if (!option.card) return <span className={`${className} ${styles.noArt}`} aria-hidden />;
  return <img src={cardArtUrl(option.card.code, "small")} alt="" className={className} draggable={false} />;
}

/** Printed card text: clamped to a few lines with a toggle when long, scrollable when open. */
function CardTextBlock({ text, label = "Card text", open: forceOpen }: { text: string; label?: string; open?: boolean }) {
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

function selectionStatus(prompt: DuelPrompt, draft: PromptDraft, aiming: boolean): string {
  if (aiming) return "Point at a target, then confirm";
  const { min, max } = selectionBounds(prompt);
  const count = draft.selected.length;
  if (prompt.kind === "sum") {
    const values = draft.selected
      .map((id) => prompt.options.find((option) => option.id === id)?.values?.join("/"))
      .filter(Boolean)
      .join(" + ");
    return `${prompt.target != null ? `Target ${prompt.target}` : "Select materials"}${values ? ` · ${values}` : ""}`;
  }
  if (prompt.kind === "tribute") {
    return `${count} selected${prompt.min != null ? ` · release ${prompt.min}` : ""}`;
  }
  if (min === 1 && max === 1) return "Pick one";
  if (min === max) return `${count} of ${min} selected`;
  return `${count} selected · ${min} to ${max}`;
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
        </button>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------- response panel */

function ChainStrip({ chain }: { chain: readonly DuelChainLink[] }) {
  if (chain.length === 0) return null;
  const shown = chain.slice(-4);
  return (
    <div className={styles.chainStrip} aria-label="Chain so far">
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
}: {
  prompt: DuelPrompt;
  draft: PromptDraft;
  busy: boolean;
  mySeat: number | null;
  choose: (id: string) => void;
  onInspectCard?: InspectCardHandler;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <div className={styles.rows}>
      {prompt.options.map((option, index) => {
        const { name, effect, cardText } = effectText(option);
        const owner = ownerWord(option.controller ?? prompt.seat, mySeat, "you");
        const open = Boolean(expanded[option.id]);
        const showMore = cardText.length > 0 && cardText !== effect;
        // A short effect label ("Take control") says too little on its own: the printed text follows it.
        const detail = showMore && effect.length < 48 ? cardText : "";
        return (
          <div key={option.id} className={styles.row} data-active={draft.highlight === index} data-open={open ? "true" : "false"}>
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
                  <span className={styles.rowOwner} data-owner={owner === "You" ? "you" : "opp"}>{owner}</span>
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

function ResponseBody({
  prompt,
  draft,
  busy,
  slug,
  chain,
  mySeat,
  onSubmit,
  onInspectCard,
}: {
  prompt: DuelPrompt;
  draft: PromptDraft;
  busy: boolean;
  slug: string;
  chain: readonly DuelChainLink[];
  mySeat: number | null;
  onSubmit: (answer: DuelAnswer) => void;
  onInspectCard?: InspectCardHandler;
}) {
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
      <label className={base.numberField}>
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
    return (
      <>
        <ChainStrip chain={chain} />
        <ChainRows prompt={prompt} draft={draft} busy={busy} mySeat={mySeat} choose={choose} onInspectCard={onInspectCard} />
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

  // Any other list of options: numbered rows, with art when the option names a card.
  return (
    <>
      {source?.text ? <CardTextBlock text={source.text} /> : null}
      <div className={styles.rows}>
        {prompt.options.map((option, index) => {
          const { effectText: optionEffect } = optionTexts(option);
          const label = humanizeLabel(fillPlaceholders(option.label, option.card?.name ?? source?.name));
          return (
            <div
              key={option.id}
              className={styles.row}
              data-plain={option.card ? undefined : "true"}
              data-active={draft.highlight === index}
              data-selected={prompt.kind === "toggle" ? Boolean(option.selected) : undefined}
            >
              <button
                type="button"
                className={styles.rowMain}
                data-primary={index === draft.highlight ? true : undefined}
                data-index={index}
                disabled={busy}
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
                  {optionEffect && optionEffect !== label ? <small>{optionEffect}</small> : null}
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
): { title: string; sub?: string; source: PromptSource | null } {
  const context = prompt.context;
  const source = promptSource(prompt);
  const place = zonePlace(source?.zone, mySeat);
  const kind = effectKind(prompt);
  const sourceLine = source
    ? [source.name, `${ownerWord(source.seat, mySeat, "your")} ${kind ? `${kind} effect` : "effect"}`, place]
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
  const title = fillPlaceholders(prompt.title, source?.name, place).trim();
  const description = prompt.description ? fillPlaceholders(prompt.description, source?.name, place).trim() : undefined;
  if (source && isYesNo(prompt)) {
    return { title: `Activate ${source.name}'s effect?`, sub: sourceLine, source };
  }
  if (source) return { title, sub: sourceLine, source };
  return { title, sub: description && description !== title ? description : undefined, source };
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
  const counters = prompt.kind === "counters";
  const { min, max } = selectionBounds(prompt);
  const single = !counters && min === 1 && max === 1 && prompt.kind !== "order";
  const valueDetail = prompt.kind === "sum" || prompt.kind === "tribute";
  const total = counters ? prompt.options.reduce((sum, option) => sum + (draft.counts[option.id] ?? 0), 0) : 0;
  const status = counters
    ? prompt.target != null
      ? `${total} of ${prompt.target} placed`
      : `${total} placed`
    : selectionStatus(prompt, draft, Boolean(aim));
  const source = promptSource(prompt);
  const title = fillPlaceholders(prompt.title, source?.name);
  const description = prompt.description ? fillPlaceholders(prompt.description, source?.name) : "";

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

  return (
    <>
      <header className={styles.head}>
        <div className={styles.titles}>
          <h2>{title}</h2>
          <p>{description ? `${description} · ${status}` : status}</p>
        </div>
        <button type="button" className={styles.hide} aria-label="Hide to look at the board" title="Hide to look at the board" onClick={onCollapse}>
          <EyeOff size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
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
}

/**
 * Mount inside the board box (position: relative; overflow: hidden). It fills the box but only its own
 * panel takes pointer events, so the field underneath stays clickable.
 * Panels carry `data-prompt-panel`: hover tooltips read it to stay clear of an open prompt.
 */
export function PromptCenter(props: PromptCenterProps) {
  const { prompt, mySeat, active, draft, busy, onSubmit, chain, aim, reducedMotion, revision, slug, battleStep, onInspectCard } = props;
  const revealed = props.revealed ?? true;
  const answering = prompt != null && mySeat != null && prompt.seat === mySeat && active;
  const kind = answering ? centerKind(prompt) : null;

  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [onBoard, setOnBoard] = useState<boolean | null>(null);
  const [barTop, setBarTop] = useState(8);

  const promptRef = useRef(prompt);
  const kindRef = useRef(kind);
  const busyRef = useRef(busy);
  const submitRef = useRef(onSubmit);
  const menuRef = useRef(props.menuOpen);
  const lockedRef = useRef(props.aimLocked);
  const collapsedRef = useRef(collapsed);
  const revealedRef = useRef(revealed);
  const barRef = useRef(false);
  revealedRef.current = revealed;
  promptRef.current = prompt;
  kindRef.current = kind;
  busyRef.current = busy;
  submitRef.current = onSubmit;
  menuRef.current = props.menuOpen;
  lockedRef.current = props.aimLocked;
  collapsedRef.current = collapsed;
  barRef.current = kind === "select" && onBoard !== false;

  const promptId = prompt?.id;
  useEffect(() => setCollapsed(false), [promptId]);

  // Which way to answer a card pick: on the board, or in a centred grid.
  useLayoutEffect(() => {
    const scope = layerRef.current?.parentElement;
    if (kind !== "select" || !prompt || !scope) {
      setOnBoard(null);
      return;
    }
    setOnBoard(allOptionsOnBoard(prompt, scope));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, promptId, revision]);

  // The instruction bar sits under the opponent's hand so it never covers a card you can pick there.
  const placeBar = useCallback(() => {
    const layer = layerRef.current;
    const board = layer?.parentElement;
    if (!layer || !board) return;
    const boardRect = board.getBoundingClientRect();
    let top = 8;
    board.querySelectorAll<HTMLElement>("[data-hand-seat]").forEach((hand) => {
      const rect = hand.getBoundingClientRect();
      if (rect.height > 0 && rect.top + rect.height / 2 < boardRect.top + boardRect.height / 2) {
        top = Math.max(top, Math.min(rect.bottom - boardRect.top + 6, boardRect.height * 0.3));
      }
    });
    setBarTop(Math.round(top));
  }, []);
  useLayoutEffect(() => {
    if (kind !== "select" || onBoard !== true) return;
    placeBar();
    const board = layerRef.current?.parentElement;
    if (!board || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(placeBar);
    observer.observe(board);
    return () => observer.disconnect();
  }, [kind, onBoard, placeBar, revision]);

  // Focus moves into the panel so Enter takes the primary answer.
  useEffect(() => {
    if (!kind || !revealed || (kind === "select" && onBoard !== false) || collapsed) return;
    const panel = panelRef.current;
    // Card grids focus the panel itself: Enter then confirms through the tray's shortcut.
    const target = kind === "response" ? panel?.querySelector<HTMLElement>("[data-primary]:not(:disabled)") : panel;
    target?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptId, collapsed, kind, onBoard, revealed]);

  // Arrow keys (handled by the tray) move the highlight; the focused row follows it.
  const highlight = draft.highlight;
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !panel.contains(document.activeElement)) return;
    panel.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.focus({ preventScroll: true });
  }, [highlight]);

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
      const decline = declineAnswer(current);
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
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || menuRef.current) return;
      if (kindRef.current == null || barRef.current) return;
      const current = promptRef.current;
      if (!current || !revealedRef.current) return;
      event.preventDefault();
      if (collapsedRef.current) {
        setCollapsed(false);
        return;
      }
      const decline = declineAnswer(current);
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

  if (!prompt || !kind || !revealed) return <div ref={layerRef} className={styles.layer} aria-hidden hidden />;

  const optional = declineAnswer(prompt) != null;
  const chainKind = prompt.context?.type === "chain";
  const tone = chainKind ? "chain" : "action";
  const dataReduced = reducedMotion ? "true" : "false";
  const stepName = battleStepLabel(battleStep);
  const stepLine = stepName ? (
    <span className={styles.stepChip} data-tone={tone}>
      <i aria-hidden />
      Battle Phase · {stepName}{chainKind ? " · respond?" : ""}
    </span>
  ) : null;

  let body: ReactNode = null;

  if (kind === "select" && onBoard !== false) {
    if (onBoard === null) return <div ref={layerRef} className={styles.layer} aria-hidden hidden />;
    const aiming = Boolean(aim);
    const explicit = needsExplicitConfirm(prompt);
    const ok = canConfirm(prompt, draft);
    const source = promptSource(prompt);
    const barTitle = fillPlaceholders(prompt.title, source?.name);
    body = (
      <div
        className={styles.bar}
        data-reduced={dataReduced}
        style={{ top: barTop }}
        role="group"
        aria-label={barTitle}
      >
        <div className={styles.barText} title={prompt.description ? fillPlaceholders(prompt.description, source?.name) : undefined}>
          <b>{barTitle}</b>
          <span>{selectionStatus(prompt, draft, aiming)}</span>
        </div>
        <div className={styles.barBtns}>
          {explicit && !aiming ? (
            <button
              type="button"
              className={styles.btn}
              data-kind="primary"
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

  const pill = (
    <button
      type="button"
      className={styles.pill}
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
    const { title, sub, source } = responseTitle(prompt, chain, mySeat);
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
          onInspectCard={onInspectCard} />
        {hasActions || optional ? (
          <footer className={styles.foot}>
            {optional ? <span className={styles.hint}>Right-click to pass</span> : null}
            <span className={styles.spacer} />
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
