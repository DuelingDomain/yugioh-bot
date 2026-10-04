"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type {
  DuelAnswer,
  DuelCard,
  DuelCardInfo,
  DuelPrompt,
  DuelPromptContext,
  DuelPromptOption,
} from "@yugidraft/shared/duels";
import { Button } from "@/components/ui/button";
import { searchDuelCards } from "./api";
import { cardArtUrl, LOCATION_MZONE, zoneKey } from "./constants";
import { backOutAnswer } from "./pick-backout";
import { selectBarCopy, sumSelectionValues } from "./select-bar-copy";
import { tributeClick, tributeState } from "./tribute-pick";
import baseStyles from "./prompts.module.css";
import { useSkinStyles } from "./skin";

export interface PromptDraft {
  selected: string[];
  setSelected: Dispatch<SetStateAction<string[]>>;
  counts: Record<string, number>;
  setCounts: Dispatch<SetStateAction<Record<string, number>>>;
  value: number;
  setValue: Dispatch<SetStateAction<number>>;
  cardCode: number | null;
  setCardCode: Dispatch<SetStateAction<number | null>>;
  highlight: number;
  setHighlight: Dispatch<SetStateAction<number>>;
}

/**
 * The engine's "choose what to attack" step is a single-pick `cards` prompt whose hint is
 * "Select an attack target" (system string 549). Some builds word it differently, so when an attacker
 * was just chosen (`attackerChosen`) any single pick made only of opposing monsters counts too.
 */
const ATTACK_TARGET_TITLE = /attack target|target(?:s)? (?:to|for) (?:the )?attack/i;

export function isAttackTargetPrompt(prompt: DuelPrompt | null, attackerChosen = false): boolean {
  if (!prompt || prompt.kind !== "cards") return false;
  if ((prompt.min ?? 1) !== 1 || (prompt.max ?? 1) !== 1) return false;
  if (ATTACK_TARGET_TITLE.test(`${prompt.title} ${prompt.description ?? ""}`)) return true;
  return (
    attackerChosen &&
    prompt.options.length > 0 &&
    prompt.options.every((option) => option.location === LOCATION_MZONE && option.controller != null && option.controller !== prompt.seat)
  );
}

/**
 * "Select a duelist to attack": the choice that follows an attacker on a table of 3 or 4 seats. Every option names one
 * seat to hit directly (a controller, no zone, no prompt context). It is the step before, or instead of, the target pick.
 */
export function isAttackDuelistPrompt(prompt: DuelPrompt | null): boolean {
  if (!prompt || prompt.kind !== "choice" || prompt.context) return false;
  return (
    prompt.options.length > 0 &&
    prompt.options.every((option) => option.controller != null && option.location == null && /^attack\b.*\bdirectly$/i.test(option.label))
  );
}

/** "Attack directly?" yes/no, asked when an attacker could hit the player but monsters are also attackable. */
export function isDirectAttackPrompt(prompt: DuelPrompt | null): boolean {
  if (!prompt || prompt.kind !== "choice" || prompt.context) return false;
  return /attack directly/i.test(prompt.title) && prompt.options.some((option) => option.id === "yes");
}

/** Wiring for the attack-target step: picking only aims; the room's confirm submits. */
export interface PromptAim {
  lockedId: string | null;
  onAim: (option: DuelPromptOption) => void;
  onHover: (option: DuelPromptOption | null) => void;
  /** Words for the prompt while aiming, when the table points with a cursor and sends on one click (3-way, 4-way, Tag). */
  hint?: string;
}

export function optionZoneKeys(option: DuelPromptOption): string[] {
  if (option.controller == null || option.location == null || option.sequence == null) return [];
  return [zoneKey(option.controller, option.location, option.sequence)];
}

export function promptLegalKeys(prompt: DuelPrompt | null): Set<string> {
  const keys = new Set<string>();
  if (!prompt) return keys;
  for (const option of prompt.options) {
    for (const key of optionZoneKeys(option)) keys.add(key);
  }
  return keys;
}

export function promptSelectedKeys(prompt: DuelPrompt | null, selected: string[]): Set<string> {
  const keys = new Set<string>();
  if (!prompt) return keys;
  const chosen = new Set(selected);
  for (const option of prompt.options) {
    if (!chosen.has(option.id) && !(prompt.kind === "toggle" && option.selected)) continue;
    for (const key of optionZoneKeys(option)) keys.add(key);
  }
  return keys;
}

export function optionsForKeys(prompt: DuelPrompt, keys: string[]): DuelPromptOption[] {
  const set = new Set(keys);
  return prompt.options.filter((option) => optionZoneKeys(option).some((key) => set.has(key)));
}

export function optionsForCard(prompt: DuelPrompt, card: DuelCard | null, keys: string[]): DuelPromptOption[] {
  if (!card) return optionsForKeys(prompt, keys);
  const physical = [zoneKey(card.controller, card.location, card.sequence)];
  for (const key of keys) {
    const parts = key.split(":");
    if (parts.length !== 3) continue;
    const controller = Number(parts[0]);
    const location = Number(parts[1]);
    const sequence = Number(parts[2]);
    if (!Number.isInteger(controller) || !Number.isInteger(location) || !Number.isInteger(sequence)) continue;
    if (controller === card.controller && location === card.location && sequence !== card.sequence) continue;
    physical.push(key);
  }
  return optionsForKeys(prompt, physical);
}

function parseNumberKey(key: string): number | null {
  if (key >= "1" && key <= "9") return Number(key);
  if (key.startsWith("Numpad") && key.length === 7) {
    const digit = key.slice(6);
    if (digit >= "1" && digit <= "9") return Number(digit);
  }
  return null;
}

function shouldIgnoreKeyboard(event: KeyboardEvent, menuOpen: boolean): boolean {
  if (menuOpen) return true;
  if (event.isComposing || event.key === "Process") return true;
  if (event.defaultPrevented) return true;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      "[data-duel-menu],[role='menu'],[role='menuitem'],[role='listbox'],[role='option'],[role='combobox'],[role='dialog']",
    )
  ) {
    return true;
  }
  if (target.closest("input,textarea,select,[contenteditable='true']")) return true;
  return (
    (event.key === "Enter" || event.key === " ") &&
    target.closest("button,a,summary,[role='button']") != null
  );
}

export function needsExplicitConfirm(prompt: DuelPrompt): boolean {
  switch (prompt.kind) {
    case "choice":
    case "toggle":
    case "announce-card":
      return false;
    case "cards":
    case "places":
    case "tribute":
    case "sum": {
      const min = prompt.min ?? 0;
      const max = prompt.max ?? prompt.options.length;
      return !(min === 1 && max === 1);
    }
    default:
      return true;
  }
}

export function selectionBounds(prompt: DuelPrompt): { min: number; max: number } {
  const fallbackMin =
    prompt.kind === "choice" ||
    prompt.kind === "announce-card" ||
    prompt.kind === "number" ||
    prompt.kind === "toggle"
      ? 1
      : 0;
  return {
    min: prompt.min ?? fallbackMin,
    max: prompt.max ?? Math.max(prompt.options.length, prompt.min ?? fallbackMin),
  };
}

function waitingCopy(prompt: DuelPrompt | null, mySeat: number | null, seatName?: string | null): string {
  if (mySeat == null) return "Spectating. Waiting for a player to act.";
  if (prompt && prompt.seat !== mySeat) return seatName ? `Waiting for ${seatName}.` : "Waiting for the opponent.";
  return "Waiting for a response.";
}

export function usePromptDraft(prompt: DuelPrompt | null): PromptDraft {
  const [selected, setSelected] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [value, setValue] = useState(0);
  const [cardCode, setCardCode] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    setSelected(prompt?.mandatory ?? []);
    setCounts({});
    setValue(prompt?.min ?? 0);
    setCardCode(null);
    setHighlight(0);
  }, [prompt?.id]);

  return {
    selected,
    setSelected,
    counts,
    setCounts,
    value,
    setValue,
    cardCode,
    setCardCode,
    highlight,
    setHighlight,
  };
}

export function canConfirm(prompt: DuelPrompt, draft: PromptDraft): boolean {
  const { min, max } = selectionBounds(prompt);
  switch (prompt.kind) {
    case "choice":
    case "toggle":
      return draft.selected.length === 1;
    case "cards":
    case "places":
      return draft.selected.length >= min && draft.selected.length <= max;
    case "tribute": {
      if (prompt.mandatory?.some((id) => !draft.selected.includes(id))) return false;
      // Tribute min is contribution value, not card count (one card may count as two): the picked cards
      // must be worth at least `min`, and there may be at most `max` of them (tribute-pick.ts).
      const state = tributeState(prompt, draft.selected);
      return state.count >= 1 && state.count <= max && state.met;
    }
    case "order":
      return draft.selected.length >= min && draft.selected.length <= max;
    case "counters": {
      const total = prompt.options.reduce((sum, option) => sum + (draft.counts[option.id] ?? 0), 0);
      if (prompt.target != null && total !== prompt.target) return false;
      return prompt.options.every((option) => {
        const count = draft.counts[option.id] ?? 0;
        if (prompt.mandatory?.includes(option.id) && count < 1) return false;
        return count >= 0 && count <= (option.max ?? max);
      });
    }
    case "number":
      return draft.value >= (prompt.min ?? 0) && draft.value <= (prompt.max ?? Number.MAX_SAFE_INTEGER);
    case "announce-card":
      return draft.cardCode != null;
    case "sum": {
      if (prompt.mandatory?.some((id) => !draft.selected.includes(id))) return false;
      return draft.selected.length >= min && draft.selected.length <= max &&
        (prompt.target == null || sumSelectionValues(prompt, draft.selected).sumMet === true);
    }
    default:
      return false;
  }
}

export function toAnswer(prompt: DuelPrompt, draft: PromptDraft): DuelAnswer {
  switch (prompt.kind) {
    case "choice":
    case "toggle":
      return { choice: draft.selected[0] };
    case "number":
      return { value: draft.value };
    case "announce-card":
      return { cardCode: draft.cardCode ?? undefined };
    case "counters":
      return { counts: draft.counts };
    default:
      return { selected: draft.selected };
  }
}

export function toggleSelected(prompt: DuelPrompt, current: string[], optionId: string): string[] {
  if (current.includes(optionId)) {
    if (prompt.mandatory?.includes(optionId)) return current;
    return current.filter((id) => id !== optionId);
  }
  const { max } = selectionBounds(prompt);
  if (prompt.kind !== "order" && current.length >= max) {
    if (max === 1 && !prompt.mandatory?.length) return [optionId];
    return current;
  }
  return [...current, optionId];
}

/** Why a click on a card changes nothing: the pick is full, or the card is a forced pick that cannot be undone. */
export type PickRefusal = { reason: "full" | "mandatory"; text: string };

/** Null when the click toggles the card; else the reason it cannot. Mirrors toggleSelected. */
export function pickRefusal(prompt: DuelPrompt, current: string[], optionId: string): PickRefusal | null {
  if (toggleSelected(prompt, current, optionId) !== current) return null;
  if (current.includes(optionId)) return { reason: "mandatory", text: "This card must stay picked" };
  return { reason: "full", text: `Already picked ${current.length}. Click a picked card to undo it` };
}

function OptionButton({
  option,
  index,
  active,
  selected,
  onPick,
  detail,
  disabled,
  onHover,
}: {
  option: DuelPromptOption;
  index: number;
  active: boolean;
  selected: boolean;
  onPick: () => void;
  detail?: string;
  disabled?: boolean;
  onHover?: (option: DuelPromptOption | null) => void;
}) {
  const styles = useSkinStyles(baseStyles, "tray");
  return (
    <button
      type="button"
      onClick={onPick}
      onMouseEnter={onHover ? () => onHover(option) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      onFocus={onHover ? () => onHover(option) : undefined}
      onBlur={onHover ? () => onHover(null) : undefined}
      disabled={disabled}
      aria-pressed={selected}
      title={option.label}
      data-selected={selected ? "true" : "false"}
      data-active={active ? "true" : "false"}
      className={styles.option}
    >
      <span className={styles.index}>{index + 1}</span>
      {option.card ? (
        <img src={cardArtUrl(option.card.code, "small")} alt="" className={styles.art} />
      ) : null}
      <span className={styles.label}>{option.label}</span>
      {detail ? <span className={styles.detail}>{detail}</span> : null}
    </button>
  );
}

export function AnnounceSearch({
  slug,
  cardCode,
  busy,
  onPick,
}: {
  slug: string;
  cardCode: number | null;
  busy: boolean;
  onPick: (card: DuelCardInfo) => void;
}) {
  const styles = useSkinStyles(baseStyles, "tray");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DuelCardInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setSearching(true);
      searchDuelCards(trimmed, slug)
        .then((data) => {
          if (cancelled) return;
          setResults(data.cards);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "Search failed");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, slug]);

  return (
    <div className={styles.search}>
      <label htmlFor="announce-card">Search card name</label>
      <input
        id="announce-card"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
      />
      {searching ? <p className={styles.note}>Searching…</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      <ul className={styles.results}>
        {results.map((card) => (
          <li key={card.code}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(card)}
              data-selected={cardCode === card.code ? "true" : "false"}
              className={styles.result}
            >
              <img src={cardArtUrl(card.code, "small")} alt="" className={styles.art} />
              <span>{card.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PromptHeader({ prompt, badge, tone }: { prompt: DuelPrompt; badge?: string; tone?: "gold" | "forced" }) {
  const styles = useSkinStyles(baseStyles, "tray");
  return (
    <div className={styles.header}>
      <h2 className={styles.title}>{prompt.title}</h2>
      {prompt.description ? <p className={styles.description}>{prompt.description}</p> : null}
      {badge ? (
        <span className={styles.badge} data-tone={tone}>
          {badge}
        </span>
      ) : null}
    </div>
  );
}

function EngineActions({
  prompt,
  busy,
  confirmable,
  onConfirm,
  onFinish,
  onCancel,
}: {
  prompt: DuelPrompt;
  busy: boolean;
  confirmable: boolean;
  onConfirm?: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const styles = useSkinStyles(baseStyles, "tray");
  const showConfirm = Boolean(onConfirm) && needsExplicitConfirm(prompt);
  const chain = prompt.context?.type === "chain";
  if (!showConfirm && !prompt.finishable && !prompt.cancelable) return null;
  return (
    <div className={styles.actions}>
      {showConfirm && onConfirm ? (
        <Button type="button" size="md" loading={busy} disabled={!confirmable || busy} onClick={onConfirm}>
          Confirm
        </Button>
      ) : null}
      {prompt.finishable ? (
        <Button type="button" size="md" variant="secondary" disabled={busy} onClick={onFinish}>
          Finish
        </Button>
      ) : null}
      {prompt.cancelable ? (
        <Button type="button" size="md" variant={chain ? "secondary" : "ghost"} disabled={busy} onClick={onCancel}>
          {chain ? "Pass" : "Cancel"}
        </Button>
      ) : null}
    </div>
  );
}

function ChoiceButtons({
  prompt,
  busy,
  onChoice,
  highlight,
}: {
  prompt: DuelPrompt;
  busy: boolean;
  onChoice: (id: string) => void;
  highlight: number;
}) {
  const styles = useSkinStyles(baseStyles, "tray");
  const yes = prompt.options.find((option) => option.id === "yes");
  const no = prompt.options.find((option) => option.id === "no");
  if (yes && no && prompt.options.length === 2) {
    return (
      <div className={styles.pair}>
        <button type="button" className={styles.choice} data-kind="yes" data-active={prompt.options[highlight]?.id === yes.id} disabled={busy} onClick={() => onChoice(yes.id)}>
          {yes.label}
        </button>
        <button type="button" className={styles.choice} data-kind="no" data-active={prompt.options[highlight]?.id === no.id} disabled={busy} onClick={() => onChoice(no.id)}>
          {no.label}
        </button>
      </div>
    );
  }
  return (
    <div className={styles.options}>
      {prompt.options.map((option, index) => (
        <OptionButton
          key={option.id}
          option={option}
          index={index}
          active={highlight === index}
          selected={prompt.kind === "toggle" ? Boolean(option.selected) : prompt.mandatory?.includes(option.id) ?? false}
          disabled={busy}
          onPick={() => onChoice(option.id)}
        />
      ))}
    </div>
  );
}

export function PromptTray({
  prompt,
  mySeat,
  slug,
  busy,
  draft,
  onSubmit,
  menuOpen,
  active,
  aim,
  headless,
  suspended,
  waitingName,
}: {
  prompt: DuelPrompt | null;
  mySeat: number | null;
  slug: string;
  busy: boolean;
  draft: PromptDraft;
  onSubmit: (answer: DuelAnswer) => void;
  menuOpen?: boolean;
  active?: boolean;
  /**
   * The prompt is drawn by PromptCenter over the board. The tray then only keeps its keyboard
   * shortcuts (number keys, arrows, Enter, F) and renders nothing while you are answering.
   */
  headless?: boolean;
  /** The centred panel is still hidden behind its human beat: no keyboard shortcut answers yet. */
  suspended?: boolean;
  /** Set while the prompt is the attack-target step: picking a target aims instead of answering. */
  aim?: PromptAim;
  /** 3 and 4 seat tables: the name of the seat that must answer. */
  waitingName?: string | null;
}) {
  const styles = useSkinStyles(baseStyles, "tray");
  const seated = prompt != null && mySeat != null && prompt.seat === mySeat;
  const answering = seated && active !== false;
  const context: DuelPromptContext | undefined = prompt?.context;
  const confirmable = prompt != null && answering && canConfirm(prompt, draft);
  const promptRef = useRef(prompt);
  const draftRef = useRef(draft);
  const busyRef = useRef(busy);
  const onSubmitRef = useRef(onSubmit);
  const answeringRef = useRef(answering);
  const menuOpenRef = useRef(Boolean(menuOpen));
  const confirmableRef = useRef(confirmable);
  const aimRef = useRef(aim);
  const suspendedRef = useRef(Boolean(suspended));
  aimRef.current = aim;
  suspendedRef.current = Boolean(suspended);
  promptRef.current = prompt;
  draftRef.current = draft;
  busyRef.current = busy;
  onSubmitRef.current = onSubmit;
  answeringRef.current = answering;
  menuOpenRef.current = Boolean(menuOpen);
  confirmableRef.current = confirmable;

  function submitAnswer(answer: DuelAnswer) {
    if (busyRef.current) return;
    const current = promptRef.current;
    if (!current || !answeringRef.current) return;
    onSubmitRef.current(answer);
  }

  useEffect(() => {
    if (!answering || !prompt || context?.type === "action") return;

    function onKey(event: KeyboardEvent) {
      if (shouldIgnoreKeyboard(event, menuOpenRef.current)) return;
      if (suspendedRef.current) return;
      const current = promptRef.current;
      const currentDraft = draftRef.current;
      if (!current || !answeringRef.current) return;
      if (current.context?.type === "action") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const options = current.options;
      const numberKey = parseNumberKey(event.key);
      const submitKey = event.key === "Enter" || event.key === "Escape" || event.key === "f" || event.key === "F";
      if (busyRef.current && (submitKey || numberKey != null)) return;
      if (event.repeat && submitKey) return;

      if (numberKey != null && options[numberKey - 1]) {
        event.preventDefault();
        const option = options[numberKey - 1];
        currentDraft.setHighlight(numberKey - 1);
        if (current.kind === "choice" || current.kind === "toggle") {
          submitAnswer({ choice: option.id });
          return;
        }
        if (current.kind === "counters") {
          currentDraft.setCounts((counts) => ({
            ...counts,
            [option.id]: Math.min(option.max ?? current.max ?? 99, (counts[option.id] ?? 0) + 1),
          }));
          return;
        }
        if (current.kind === "number") {
          currentDraft.setValue(numberKey);
          return;
        }
        const { min, max } = selectionBounds(current);
        if (
          (current.kind === "cards" || current.kind === "places" || current.kind === "tribute" || current.kind === "sum") &&
          min === 1 &&
          max === 1
        ) {
          if (aimRef.current) aimRef.current.onAim(option);
          else submitAnswer({ selected: [option.id] });
          return;
        }
        currentDraft.setSelected((selected) => toggleSelected(current, selected, option.id));
        return;
      }

      if ((event.key === "ArrowDown" || event.key === "ArrowRight") && options.length > 0) {
        event.preventDefault();
        currentDraft.setHighlight((index) => (index + 1) % options.length);
        return;
      }
      if ((event.key === "ArrowUp" || event.key === "ArrowLeft") && options.length > 0) {
        event.preventDefault();
        currentDraft.setHighlight((index) => (index - 1 + options.length) % options.length);
        return;
      }
      if (event.key === "Enter") {
        const highlighted = options[currentDraft.highlight];
        if (highlighted && (current.kind === "choice" || current.kind === "toggle")) {
          event.preventDefault();
          submitAnswer({ choice: highlighted.id });
          return;
        }
        const { min, max } = selectionBounds(current);
        if (
          highlighted &&
          (current.kind === "cards" || current.kind === "places" || current.kind === "tribute" || current.kind === "sum") &&
          min === 1 &&
          max === 1
        ) {
          event.preventDefault();
          if (aimRef.current) aimRef.current.onAim(highlighted);
          else submitAnswer({ selected: [highlighted.id] });
          return;
        }
        if (confirmableRef.current) {
          event.preventDefault();
          submitAnswer(toAnswer(current, currentDraft));
        }
        return;
      }
      if (event.key === "Escape") {
        // A material pick backs out (cancel, or one card back once the engine drops Cancel).
        const back = current.kind === "toggle" ? backOutAnswer(current) : current.cancelable ? { cancel: true } : null;
        if (back) {
          event.preventDefault();
          submitAnswer(back);
          return;
        }
      }
      if ((event.key === "f" || event.key === "F") && current.finishable) {
        event.preventDefault();
        submitAnswer({ finish: true });
        return;
      }
      if ((event.key === "+" || event.key === "=") && current.kind === "number") {
        event.preventDefault();
        currentDraft.setValue((value) => Math.min(current.max ?? Number.MAX_SAFE_INTEGER, value + 1));
        return;
      }
      if (event.key === "-" && current.kind === "number") {
        event.preventDefault();
        currentDraft.setValue((value) => Math.max(current.min ?? 0, value - 1));
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answering, context?.type, prompt?.id]);

  if (!prompt || !answering) {
    return (
      <p className={styles.waiting} aria-live="polite">
        {waitingCopy(prompt, mySeat, waitingName)}
      </p>
    );
  }
  if (headless) return null;

  function pickSelectable(option: DuelPromptOption) {
    if (!prompt) return;
    const { min, max } = selectionBounds(prompt);
    if (
      (prompt.kind === "cards" || prompt.kind === "places" || prompt.kind === "tribute" || prompt.kind === "sum") &&
      min === 1 &&
      max === 1
    ) {
      if (aim) aim.onAim(option);
      else submitAnswer({ selected: [option.id] });
      return;
    }
    draft.setSelected((selected) => toggleSelected(prompt, selected, option.id));
  }

  const actions = (
    <EngineActions
      prompt={prompt}
      busy={busy}
      confirmable={confirmable}
      onConfirm={needsExplicitConfirm(prompt) ? () => submitAnswer(toAnswer(prompt, draft)) : undefined}
      onFinish={() => submitAnswer({ finish: true })}
      onCancel={() => submitAnswer({ cancel: true })}
    />
  );

  if (context?.type === "action") {
    const copy =
      context.phase === "battle"
        ? "Choose an attack, activation, or a phase action."
        : "Choose a card or a phase action.";
    return (
      <div className={styles.tray} aria-live="polite">
        <p className={styles.srOnly}>{copy}</p>
        {prompt.finishable || prompt.cancelable ? actions : null}
      </div>
    );
  }

  if (context?.type === "chain") {
    return (
      <div className={styles.tray} aria-live="polite">
        <div className={styles.chain} data-forced={context.forced ? "true" : "false"}>
          <PromptHeader
            prompt={prompt}
            badge={context.forced ? "Mandatory" : "Optional"}
            tone={context.forced ? "forced" : undefined}
          />
          <p className={styles.hint}>
            {context.forced ? "You must activate one of these effects." : "Activate an effect, or pass."}
          </p>
          {prompt.cancelable ? (
            <button type="button" className={styles.choice} data-kind="pass" disabled={busy} onClick={() => submitAnswer({ cancel: true })}>
              Pass
            </button>
          ) : null}
          <ChoiceButtons prompt={prompt} busy={busy} highlight={draft.highlight} onChoice={(id) => submitAnswer({ choice: id })} />
          {prompt.finishable ? (
            <Button type="button" size="md" variant="secondary" disabled={busy} onClick={() => submitAnswer({ finish: true })}>
              Finish
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (context?.type === "deck-master-recall") {
    const recall = context;
    return (
      <div className={styles.tray} aria-live="polite">
        <PromptHeader prompt={prompt} badge="Deck Master" tone="gold" />
        <div className={styles.recall}>
          <img src={cardArtUrl(recall.card.code, "small")} alt="" className={styles.recallArt} />
          <div>
            <p className={styles.recallName}>{recall.card.name}</p>
            <p className={styles.recallFacts}>
              Return this Deck Master to the Deck Master Zone?
              <br />
              Returns: <span className={styles.cost}>{recall.returns}</span>
              <br />
              Next summon cost after this recall: <span className={styles.cost}>{recall.nextCost} LP</span>
              <br />
              Each return adds 500 LP to the next summon.
            </p>
          </div>
        </div>
        <ChoiceButtons prompt={prompt} busy={busy} highlight={draft.highlight} onChoice={(id) => submitAnswer({ choice: id })} />
        {actions}
      </div>
    );
  }

  if (context?.type === "position") {
    return (
      <div className={styles.tray} aria-live="polite">
        <PromptHeader prompt={prompt} />
        <div className={styles.positions}>
          {prompt.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={styles.choice}
              disabled={busy}
              data-active={prompt.options[draft.highlight]?.id === option.id}
              onClick={() => submitAnswer({ choice: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
        {prompt.finishable || prompt.cancelable ? actions : null}
      </div>
    );
  }

  if (prompt.kind === "announce-card") {
    return (
      <div className={styles.tray} aria-live="polite">
        <PromptHeader prompt={prompt} />
        <AnnounceSearch
          slug={slug}
          cardCode={draft.cardCode}
          busy={busy}
          onPick={(card) => {
            draft.setCardCode(card.code);
            submitAnswer({ cardCode: card.code });
          }}
        />
        {actions}
      </div>
    );
  }

  if (prompt.kind === "number") {
    return (
      <div className={styles.tray} aria-live="polite">
        <PromptHeader prompt={prompt} />
        <label className={styles.numberField}>
          <span>Value</span>
          <input
            type="number"
            min={prompt.min}
            max={prompt.max}
            value={draft.value}
            disabled={busy}
            onChange={(event) => draft.setValue(Number(event.target.value))}
          />
        </label>
        {actions}
      </div>
    );
  }

  if (prompt.kind === "choice" || prompt.kind === "toggle") {
    return (
      <div className={styles.tray} aria-live="polite">
        <PromptHeader prompt={prompt} />
        <ChoiceButtons prompt={prompt} busy={busy} highlight={draft.highlight} onChoice={(id) => submitAnswer({ choice: id })} />
        {actions}
      </div>
    );
  }

  if (prompt.kind === "counters") {
    return (
      <div className={styles.tray} aria-live="polite">
        <PromptHeader prompt={prompt} />
        {prompt.target != null ? <p className={styles.status}>Place {prompt.target}</p> : null}
        {prompt.options.map((option, index) => (
          <div key={option.id} className={styles.counterRow}>
            <OptionButton
              option={option}
              index={index}
              active={draft.highlight === index}
              selected={(draft.counts[option.id] ?? 0) > 0}
              disabled={busy}
              onPick={() => draft.setHighlight(index)}
            />
            <button
              type="button"
              className={styles.stepper}
              aria-label={`Decrease ${option.label}`}
              disabled={busy}
              onClick={() =>
                draft.setCounts((counts) => ({
                  ...counts,
                  [option.id]: Math.max(0, (counts[option.id] ?? 0) - 1),
                }))
              }
            >
              −
            </button>
            <span className={styles.count}>{draft.counts[option.id] ?? 0}</span>
            <button
              type="button"
              className={styles.stepper}
              aria-label={`Increase ${option.label}`}
              disabled={busy}
              onClick={() =>
                draft.setCounts((counts) => ({
                  ...counts,
                  [option.id]: Math.min(option.max ?? prompt.max ?? 99, (counts[option.id] ?? 0) + 1),
                }))
              }
            >
              +
            </button>
          </div>
        ))}
        {actions}
      </div>
    );
  }

  const { min, max } = selectionBounds(prompt);
  const valueDetail = prompt.kind === "sum" || prompt.kind === "tribute";

  return (
    <div className={styles.tray} aria-live="polite">
      <PromptHeader prompt={prompt} />
      {prompt.kind === "sum" ? (
        <p className={styles.status}>
          {selectBarCopy({
            kind: prompt.kind, title: prompt.title, min, max, count: draft.selected.length,
            target: prompt.target, sumMode: prompt.sumMode, ...sumSelectionValues(prompt, draft.selected),
          }).progress}
        </p>
      ) : null}
      {prompt.kind === "tribute" ? (
        <p className={styles.status}>
          {prompt.min != null ? `Release ${prompt.min}` : "Tribute"}
          {prompt.max != null ? ` · up to ${prompt.max} cards` : ""}
        </p>
      ) : null}
      {aim ? (
        <p className={styles.hint}>{aim.hint ?? "Point at a target, then confirm the attack. Esc goes back."}</p>
      ) : null}
      {!aim && (prompt.kind === "cards" || prompt.kind === "places" || prompt.kind === "order") ? (
        <p className={styles.status}>
          {draft.selected.length} selected
          {min === max ? ` · ${min} required` : ` · ${min} to ${max}`}
        </p>
      ) : null}
      <div className={styles.options}>
        {prompt.options.map((option, index) => (
          <OptionButton
            key={option.id}
            option={option}
            detail={prompt.kind === "order" && draft.selected.includes(option.id)
              ? `Order ${draft.selected.indexOf(option.id) + 1}`
              : valueDetail ? option.values?.join(" / ") : undefined}
            index={index}
            active={draft.highlight === index}
            selected={aim ? aim.lockedId === option.id : draft.selected.includes(option.id)}
            disabled={busy}
            onHover={aim?.onHover}
            onPick={() => {
              draft.setHighlight(index);
              pickSelectable(option);
            }}
          />
        ))}
      </div>
      {prompt.kind === "order" && draft.selected.length > 1 ? (
        <div className={styles.actions}>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              draft.setSelected((current) => {
                const next = [...current];
                const id = prompt.options[draft.highlight]?.id;
                const from = current.indexOf(id ?? "");
                if (from <= 0) return current;
                const swap = next[from - 1];
                next[from - 1] = next[from];
                next[from] = swap;
                return next;
              })
            }
          >
            Move up
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              draft.setSelected((current) => {
                const next = [...current];
                const id = prompt.options[draft.highlight]?.id;
                const from = current.indexOf(id ?? "");
                if (from < 0 || from >= current.length - 1) return current;
                const swap = next[from + 1];
                next[from + 1] = next[from];
                next[from] = swap;
                return next;
              })
            }
          >
            Move down
          </Button>
        </div>
      ) : null}
      {actions}
    </div>
  );
}

export function activatePromptFromField(
  prompt: DuelPrompt | null,
  mine: boolean,
  keys: string[],
  card: DuelCard | null,
  draft: PromptDraft,
  onSubmit?: (answer: DuelAnswer) => void,
  onRefuse?: (refusal: PickRefusal) => void,
): boolean {
  if (!prompt || !mine) return false;
  if (
    prompt.kind !== "cards" &&
    prompt.kind !== "places" &&
    prompt.kind !== "sum" &&
    prompt.kind !== "order" &&
    prompt.kind !== "tribute"
  ) {
    return false;
  }
  const matches = optionsForCard(prompt, card, keys);
  if (matches.length !== 1) return false;
  const option = matches[0];
  if (prompt.kind === "tribute") {
    // Tributes are picked on the field and send themselves once the pick cannot change (tribute-pick.ts).
    const click = tributeClick(prompt, draft.selected, option.id);
    if (click.next === draft.selected) {
      const refusal = pickRefusal(prompt, draft.selected, option.id);
      if (refusal) onRefuse?.(refusal);
      return true;
    }
    draft.setSelected(click.next);
    if (click.send) onSubmit?.({ selected: click.next });
    return true;
  }
  const { min, max } = selectionBounds(prompt);
  if (
    (prompt.kind === "cards" || prompt.kind === "places" || prompt.kind === "sum") &&
    min === 1 &&
    max === 1
  ) {
    draft.setSelected([option.id]);
    onSubmit?.({ selected: [option.id] });
    return true;
  }
  const refusal = pickRefusal(prompt, draft.selected, option.id);
  if (refusal) {
    // Nothing changes: say why, instead of a click that looks ignored.
    onRefuse?.(refusal);
    return true;
  }
  draft.setSelected((current) => toggleSelected(prompt, current, option.id));
  return true;
}
