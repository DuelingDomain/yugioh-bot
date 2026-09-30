"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, EyeOff, Link2 } from "lucide-react";
import type { DuelAnswer, DuelChainLink, DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";
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
  LOCATION_EXTRA,
  LOCATION_GRAVE,
  LOCATION_OVERLAY,
  LOCATION_REMOVED,
} from "./constants";
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

function effectText(option: DuelPromptOption): { name: string; effect: string } {
  let text = option.label.trim().replace(/^Activate\s+/i, "");
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
  const effect = text.trim() || (option.card?.description ?? "").trim();
  return { name: name || option.label, effect };
}

function CardArt({ option, className }: { option: DuelPromptOption; className: string }) {
  if (!option.card) return <span className={`${className} ${styles.noArt}`} aria-hidden />;
  return <img src={cardArtUrl(option.card.code, "small")} alt="" className={className} draggable={false} />;
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

function ResponseBody({
  prompt,
  draft,
  busy,
  slug,
  chain,
  onSubmit,
}: {
  prompt: DuelPrompt;
  draft: PromptDraft;
  busy: boolean;
  slug: string;
  chain: readonly DuelChainLink[];
  onSubmit: (answer: DuelAnswer) => void;
}) {
  const context = prompt.context;
  const choose = (id: string) => onSubmit({ choice: id });

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
        <div className={styles.rows}>
          {prompt.options.map((option, index) => {
            const { name, effect } = effectText(option);
            return (
              <button
                key={option.id}
                type="button"
                className={styles.row}
                data-active={draft.highlight === index}
                data-primary={index === draft.highlight ? true : undefined}
                data-index={index}
                disabled={busy}
                aria-label={option.label}
                onClick={() => choose(option.id)}
                onMouseEnter={() => draft.setHighlight(index)}
              >
                <span className={styles.rowNum}>{index + 1}</span>
                <CardArt option={option} className={styles.rowArt} />
                <span className={styles.rowText}>
                  <b>{name}</b>
                  {effect ? <small>{effect}</small> : null}
                </span>
                <span className={styles.rowGo}>Activate</span>
              </button>
            );
          })}
        </div>
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

  if (isYesNo(prompt)) return <YesNo prompt={prompt} draft={draft} busy={busy} choose={choose} />;

  if (context?.type === "position") {
    return (
      <div className={styles.pills}>
        {prompt.options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            className={styles.btn}
            data-kind={index === 0 ? "primary" : undefined}
            data-primary={index === 0 ? true : undefined}
            data-active={draft.highlight === index}
            disabled={busy}
            onClick={() => choose(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  // Any other list of options: numbered rows, with art when the option names a card.
  return (
    <div className={styles.rows}>
      {prompt.options.map((option, index) => (
        <button
          key={option.id}
          type="button"
          className={styles.row}
          data-plain={option.card ? undefined : "true"}
          data-active={draft.highlight === index}
          data-selected={prompt.kind === "toggle" ? Boolean(option.selected) : undefined}
          data-primary={index === draft.highlight ? true : undefined}
          data-index={index}
          disabled={busy}
          onClick={() => choose(option.id)}
          onMouseEnter={() => draft.setHighlight(index)}
        >
          <span className={styles.rowNum}>{index + 1}</span>
          {option.card ? <CardArt option={option} className={styles.rowArt} /> : null}
          <span className={styles.rowText}>
            <b>{option.label}</b>
          </span>
        </button>
      ))}
    </div>
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
        {yes.label}
      </button>
      <button
        type="button"
        className={styles.btn}
        data-active={prompt.options[draft.highlight]?.id === no.id}
        disabled={busy}
        onClick={() => choose(no.id)}
      >
        {no.label}
      </button>
    </div>
  );
}

function responseTitle(prompt: DuelPrompt, chain: readonly DuelChainLink[]): { title: string; sub?: string } {
  const context = prompt.context;
  if (context?.type === "chain") {
    const last = chain[chain.length - 1];
    const target = last?.name ? ` to ${last.name}` : "";
    const generic = /^select a (mandatory effect|chain link or pass)$/i.test(prompt.title.trim());
    return {
      title: context.forced ? `You must respond${target}` : `You can respond${target}`,
      sub: generic ? undefined : prompt.title,
    };
  }
  if (context?.type === "deck-master-recall") return { title: prompt.title };
  return { title: prompt.title, sub: prompt.description };
}

/* -------------------------------------------------------------- grid picker */

function GridPicker({
  prompt,
  draft,
  busy,
  aim,
  onSubmit,
  onCollapse,
}: {
  prompt: DuelPrompt;
  draft: PromptDraft;
  busy: boolean;
  aim?: PromptAim;
  onSubmit: (answer: DuelAnswer) => void;
  onCollapse: () => void;
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
          <h2>{prompt.title}</h2>
          <p>{prompt.description ? `${prompt.description} · ${status}` : status}</p>
        </div>
        <button type="button" className={styles.hide} aria-label="Hide to look at the board" title="Hide to look at the board" onClick={onCollapse}>
          <EyeOff size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      <ul className={styles.grid}>
        {prompt.options.map((option, index) => {
          const selected = counters ? (draft.counts[option.id] ?? 0) > 0 : draft.selected.includes(option.id);
          const orderIndex = prompt.kind === "order" ? draft.selected.indexOf(option.id) : -1;
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
                  title={option.label}
                  onClick={() => pick(option, index)}
                  onDoubleClick={() => {
                    if (single && !aim && !busy) onSubmit({ selected: [option.id] });
                  }}
                  onMouseEnter={aim ? () => aim.onHover(option) : undefined}
                  onMouseLeave={aim ? () => aim.onHover(null) : undefined}
                >
                  <span className={styles.tileArt}>
                    {option.card ? (
                      <img src={cardArtUrl(option.card.code, "small")} alt="" draggable={false} />
                    ) : (
                      <span className={styles.tileZone}>{option.label}</span>
                    )}
                    {selected && !counters ? (
                      <span className={styles.tileMark} aria-hidden>
                        {orderIndex >= 0 ? orderIndex + 1 : <Check size={13} strokeWidth={2.5} />}
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.tileLabel}>{option.card ? option.label : ""}</span>
                  {valueDetail && option.values?.length ? (
                    <span className={styles.tileValue}>{option.values.join(" / ")}</span>
                  ) : null}
                </button>
                {counters ? (
                  <div className={styles.stepper}>
                    <button type="button" aria-label={`Decrease ${option.label}`} disabled={busy} onClick={() => bump(option, -1)}>
                      −
                    </button>
                    <span>{draft.counts[option.id] ?? 0}</span>
                    <button type="button" aria-label={`Increase ${option.label}`} disabled={busy} onClick={() => bump(option, 1)}>
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
}

/**
 * Mount inside the board box (position: relative; overflow: hidden). It fills the box but only its own
 * panel takes pointer events, so the field underneath stays clickable.
 */
export function PromptCenter(props: PromptCenterProps) {
  const { prompt, mySeat, active, draft, busy, onSubmit, chain, aim, reducedMotion, revision, slug } = props;
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
  const barRef = useRef(false);
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
    if (!kind || (kind === "select" && onBoard !== false) || collapsed) return;
    const panel = panelRef.current;
    // Card grids focus the panel itself: Enter then confirms through the tray's shortcut.
    const target = kind === "response" ? panel?.querySelector<HTMLElement>("[data-primary]:not(:disabled)") : panel;
    target?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptId, collapsed, kind, onBoard]);

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
      if (!current) return;
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

  if (!prompt || !kind) return <div ref={layerRef} className={styles.layer} aria-hidden hidden />;

  const optional = declineAnswer(prompt) != null;
  const chainKind = prompt.context?.type === "chain";
  const tone = chainKind ? "chain" : "action";
  const dataReduced = reducedMotion ? "true" : "false";

  let body: ReactNode = null;

  if (kind === "select" && onBoard !== false) {
    if (onBoard === null) return <div ref={layerRef} className={styles.layer} aria-hidden hidden />;
    const aiming = Boolean(aim);
    const explicit = needsExplicitConfirm(prompt);
    const ok = canConfirm(prompt, draft);
    body = (
      <div
        className={styles.bar}
        data-reduced={dataReduced}
        style={{ top: barTop }}
        role="group"
        aria-label={prompt.title}
      >
        <div className={styles.barText} title={prompt.description}>
          <b>{prompt.title}</b>
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
    const { title, sub } = responseTitle(prompt, chain);
    const actions = prompt.kind === "choice" && isYesNo(prompt) ? null : (
      <Actions prompt={prompt} draft={draft} busy={busy} onSubmit={onSubmit} />
    );
    const hasActions = actions != null && (needsExplicitConfirm(prompt) || prompt.cancelable || prompt.finishable);
    body = (
      <div
        ref={panelRef}
        className={styles.panel}
        data-tone={tone}
        data-forced={prompt.context?.type === "chain" && prompt.context.forced ? "true" : "false"}
        data-reduced={dataReduced}
        role="group"
        aria-label={title}
        aria-live="polite"
      >
        <header className={styles.head}>
          <div className={styles.titles}>
            <h2>{title}</h2>
            {sub ? <p>{sub}</p> : null}
          </div>
          <span className={styles.badge} data-optional={optional}>
            {optional ? "Optional" : "Mandatory"}
          </span>
          {hide}
        </header>
        <ResponseBody prompt={prompt} draft={draft} busy={busy} slug={slug} chain={chain} onSubmit={onSubmit} />
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
        tabIndex={-1}
        data-tone="action"
        data-wide="true"
        data-reduced={dataReduced}
        role="group"
        aria-label={prompt.title}
      >
        <GridPicker prompt={prompt} draft={draft} busy={busy} aim={aim} onSubmit={onSubmit} onCollapse={() => setCollapsed(true)} />
      </div>
    );
  }

  return (
    <div ref={layerRef} className={styles.layer}>
      {body}
    </div>
  );
}
