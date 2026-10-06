"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { ClipboardPaste, Dices, Eraser, Link2, Play, Redo2, Share2, Undo2, UserMinus, UserPlus } from "lucide-react";
import {
  DUEL_FORMATS,
  MULTI_CORE_UNAVAILABLE_MESSAGE,
  SANDBOX_LIMITS,
  SANDBOX_START_PHASES,
  emptyCardQuery,
  encodeSandboxShare,
  multiDomainBlockReason,
  multiplayerTablesBlockReason,
  type CardArchetype,
  type CardQuery,
  type DeckCardInfo,
  type DuelFormat,
  type DuelMasterRule,
  type DuelMode,
  type DuelTableCapabilities,
  type SandboxDuelistId,
  type SandboxShare,
  type SandboxStartPhase,
} from "@yugidraft/shared/duels";
import { CardBrowser } from "@/components/decks/card-browser";
import { getDeckCardFacets } from "@/components/decks/api";
import type { BrowserView } from "@/components/decks/filter-model";
import { cn } from "@/lib/utils";
import { SandboxRequestError, defaultServices, pickByName, type BuilderServices } from "./api";
import {
  DEFAULT_DECK_SIZE,
  applyAction,
  battleBlockReason,
  boardCodes,
  checkBuilderState,
  createBuilderState,
  createHistory,
  getEntry,
  historyReducer,
  isEliminated,
  loadBuilderState,
  activeSeats,
  resolveCardListAsync,
  seatSummary,
  seatsOf,
  supportsElimination,
  type CardLoc,
  type PileZone,
  type SandboxAction,
  type SandboxBuilderState,
} from "./board-model";
import { firstEmptySlot, routeCard, slotRefusal, zoneName, type AddTarget } from "./placement";
import { QuickAdd } from "./quick-add";
import { SeatBoard, sameLoc, type SeatBoardActions } from "./seat-board";
import { isSlotZone } from "./board-model";
import { ShareDialog, shareErrorText, type ShareDialogMode } from "./share-dialog";
import { SandboxTableView } from "./table-view";
import type { CardInfoMap, SandboxDrag } from "./zone-slot";
import styles from "./builder.module.css";
import extra from "./builder-extras.module.css";

const FORMAT_CHOICES: readonly { value: DuelFormat; label: string }[] = [
  { value: "1v1", label: "1v1" },
  { value: "ffa3", label: "3-way" },
  { value: "ffa4", label: "4-way" },
  { value: "tag", label: "Tag" },
];
const MASTER_RULES: readonly DuelMasterRule[] = [1, 2, 3, 4, 5];
const PHASE_LABEL: Record<SandboxStartPhase, string> = {
  draw: "Draw",
  standby: "Standby",
  main1: "Main 1",
  battle: "Battle",
  main2: "Main 2",
  end: "End",
};
const PASTE_PARALLEL = 6;

export interface SandboxBuilderProps {
  /** Start board. Default: an empty 1v1 board (8000 LP, filler Deck of 20, bots auto-pass). */
  initial?: SandboxBuilderState;
  /** Shows the name box when set. */
  name?: string;
  onNameChange?: (name: string) => void;
  /** Host status for the table formats. Without it, every format is open. */
  capabilities?: DuelTableCapabilities;
  /** Id of the saved scenario, sent with Start so the duel links back to it. */
  scenarioId?: number;
  /** Every change of the board or the run. */
  onChange?: (state: SandboxBuilderState) => void;
  /** Called after Start made the duel. Default: go to `/duels/<slug>`. */
  onStarted?: (slug: string) => void;
  /** Save and Share buttons show only when the page gives these. A thrown error shows in the builder. */
  onSave?: (state: SandboxBuilderState) => Promise<void> | void;
  saveLabel?: string;
  onShare?: (state: SandboxBuilderState) => Promise<void> | void;
  /** Server and card calls. Keep the object stable between renders. */
  services?: Partial<BuilderServices>;
}

type Status = { kind: "ok" | "warn"; text: string } | null;

function randomSeed(): [string, string, string, string] {
  const words = new Uint32Array(8);
  crypto.getRandomValues(words);
  const out: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const value = (BigInt(words[i * 2]) << 32n) | BigInt(words[i * 2 + 1]);
    out.push((value === 0n ? 1n : value).toString());
  }
  return out as [string, string, string, string];
}

export function formatBlockReason(caps: DuelTableCapabilities | undefined, format: DuelFormat, mode: DuelMode): string | null {
  if (!caps || format === "1v1") return null;
  return (
    multiplayerTablesBlockReason(format, caps.multiplayerTables) ??
    (caps.multiCoreReady ? null : MULTI_CORE_UNAVAILABLE_MESSAGE) ??
    multiDomainBlockReason(mode, format, caps.multiDomainCoreReady)
  );
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
}

export function SandboxBuilder({
  initial,
  name,
  onNameChange,
  capabilities,
  scenarioId,
  onChange,
  onStarted,
  onSave,
  saveLabel = "Save",
  onShare,
  services: given,
}: SandboxBuilderProps) {
  const services = useMemo<BuilderServices>(() => ({ ...defaultServices, ...given }), [given]);
  const [history, dispatch] = useReducer(historyReducer, initial, (start) => createHistory(start ?? createBuilderState()));
  const state = history.present;
  const stateRef = useRef(state);
  stateRef.current = state;

  const [seat, setSeat] = useState<SandboxDuelistId>("p0");
  const [target, setTarget] = useState<AddTarget>("hand");
  const [armed, setArmed] = useState<DeckCardInfo | null>(null);
  const [open, setOpen] = useState<CardLoc | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [infos, setInfos] = useState<Map<number, DeckCardInfo>>(() => new Map());
  const [side, setSide] = useState<"quick" | "browse">("quick");
  const [busy, setBusy] = useState<"start" | "save" | "share" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: ShareDialogMode; code?: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const requested = useRef(new Set<number>());

  useEffect(() => { searchRef.current?.focus(); }, []);

  const seats = seatsOf(state.board.format);
  const activeSeat = seats.includes(seat) ? seat : "p0";
  const format = state.board.format ?? "1v1";
  const mode = state.board.mode ?? "normal";
  const check = useMemo(() => checkBuilderState(state), [state]);

  useEffect(() => {
    if (!seats.includes(seat)) setSeat("p0");
  }, [seats, seat]);

  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const firstState = useRef(state);
  useEffect(() => {
    if (state !== firstState.current) changeRef.current?.(state);
  }, [state]);

  // ---- card data -----------------------------------------------------------------------------

  const remember = useCallback((cards: readonly DeckCardInfo[]) => {
    if (cards.length === 0) return;
    setInfos((prev) => {
      let next: Map<number, DeckCardInfo> | null = null;
      for (const card of cards) {
        if (prev.has(card.code)) continue;
        next ??= new Map(prev);
        next.set(card.code, card);
      }
      return next ?? prev;
    });
  }, []);

  useEffect(() => {
    const missing = boardCodes(state).filter((code) => !infos.has(code) && !requested.current.has(code));
    if (missing.length === 0) return;
    missing.forEach((code) => requested.current.add(code));
    for (let i = 0; i < missing.length; i += 100) {
      services.lookup(missing.slice(i, i + 100)).then(remember, () => undefined);
    }
  }, [state, infos, services, remember]);

  // ---- changes -------------------------------------------------------------------------------

  /** Apply one action. A refusal shows its text and leaves the board alone. */
  const act = useCallback((action: SandboxAction): boolean => {
    const result = applyAction(stateRef.current, action);
    if (result.error) {
      setStatus({ kind: "warn", text: result.error });
      return false;
    }
    dispatch(action);
    if (result.notice) setStatus({ kind: "warn", text: result.notice });
    return true;
  }, []);

  function say(text: string, kind: "ok" | "warn" = "ok") {
    setStatus({ kind, text });
  }

  function placeCard(card: DeckCardInfo, to: CardLoc): boolean {
    if (isSlotZone(to.zone)) {
      const refusal = slotRefusal(to.zone, card);
      if (refusal) {
        say(refusal, "warn");
        return false;
      }
      if (!act({ type: "place", at: to, card: card.code })) return false;
      say(`Placed ${card.name} in ${zoneName(to.zone)}${to.zone === "field" || to.zone === "deckMaster" ? "" : ` ${to.index + 1}`}.`);
      return true;
    }
    return addToPile(card, to.zone as PileZone, 1);
  }

  function addToPile(card: DeckCardInfo, zone: PileZone, count: number, note?: string): boolean {
    remember([card]);
    if (count <= 1) {
      if (!act({ type: "add", seat: activeSeat, zone, card: card.code })) return false;
      say(`Added ${card.name} to ${zoneName(zone)}.${note ? ` ${note}` : ""}`);
      return true;
    }
    const result = applyAction(stateRef.current, { type: "paste", seat: activeSeat, zone, codes: Array(count).fill(card.code) });
    if (result.error) {
      say(result.error, "warn");
      return false;
    }
    dispatch({ type: "paste", seat: activeSeat, zone, codes: Array(count).fill(card.code) });
    const dropped = result.overflow ?? 0;
    say(`Added ${result.added ?? 0}x ${card.name} to ${zoneName(zone)}.${dropped ? ` ${dropped} did not fit.` : ""}`, dropped ? "warn" : "ok");
    return true;
  }

  /** Quick add: Enter in the search box, or the + on a hit. */
  function addCard(card: DeckCardInfo, count: number) {
    remember([card]);
    const route = routeCard(target, card);
    if (route.kind === "error") {
      say(route.message, "warn");
      return;
    }
    if (route.kind === "pile") {
      addToPile(card, route.zone, count, route.note);
      return;
    }
    // `act` reads the board of the last render, so chain the copies on a local board.
    let working = stateRef.current;
    let placed = 0;
    for (let i = 0; i < count; i += 1) {
      const loc = firstEmptySlot(working, activeSeat, route.zone);
      if (!loc) break;
      const action: SandboxAction = { type: "place", at: loc, card: card.code };
      const result = applyAction(working, action);
      if (result.error) {
        if (placed === 0) say(result.error, "warn");
        break;
      }
      working = result.state;
      dispatch(action);
      placed += 1;
    }
    if (placed === 0) {
      if (!firstEmptySlot(stateRef.current, activeSeat, route.zone)) say(`No empty ${zoneName(route.zone)}.`, "warn");
    } else {
      say(`Placed ${placed > 1 ? `${placed}x ` : ""}${card.name} in ${zoneName(route.zone)}.${placed < count ? ` No room for ${count - placed} more.` : ""}`, placed < count ? "warn" : "ok");
    }
  }

  function onSlot(loc: CardLoc) {
    const entry = getEntry(stateRef.current, loc);
    if (entry !== null) {
      setOpen((prev) => (sameLoc(prev, loc) ? null : loc));
      return;
    }
    setOpen(null);
    if (!armed) {
      say("Search a card first, then click a zone to place it.", "warn");
      searchRef.current?.focus();
      return;
    }
    placeCard(armed, loc);
  }

  function onDropOnLoc(drag: SandboxDrag, to: CardLoc) {
    if (drag.kind === "card") {
      const card = infos.get(drag.code);
      if (card) placeCard(card, to);
      else if (isSlotZone(to.zone)) act({ type: "place", at: to, card: drag.code });
      else act({ type: "add", seat: activeSeat, zone: to.zone as PileZone, card: drag.code });
      return;
    }
    if (drag.loc.seat !== to.seat) return;
    if (act({ type: "move", from: drag.loc, to })) setOpen(null);
  }

  async function addMaterialByName(loc: CardLoc, text: string): Promise<string | null> {
    try {
      const cards = await services.search(text, 8);
      remember(cards);
      const card = pickByName(text, cards);
      if (!card) return "No card matches.";
      const result = applyAction(stateRef.current, { type: "addMaterial", at: loc, card: card.code });
      if (result.error) return result.error;
      dispatch({ type: "addMaterial", at: loc, card: card.code });
      return null;
    } catch {
      return "Card search failed. Try again.";
    }
  }

  async function paste(input: { text: string; zone: PileZone; mode: "append" | "replace" }): Promise<string> {
    let active = 0;
    const waiting: Array<() => void> = [];
    const slot = async <T,>(job: () => Promise<T>): Promise<T> => {
      if (active >= PASTE_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
      active += 1;
      try {
        return await job();
      } finally {
        active -= 1;
        waiting.shift()?.();
      }
    };
    const { codes, unresolved } = await resolveCardListAsync(input.text, (cardName) =>
      slot(async () => {
        const cards = await services.search(cardName, 5);
        remember(cards);
        return pickByName(cardName, cards)?.code ?? null;
      }),
    );
    let message = "";
    if (codes.length > 0) {
      const result = applyAction(stateRef.current, { type: "paste", seat: activeSeat, zone: input.zone, codes, mode: input.mode });
      if (result.error) return result.error;
      dispatch({ type: "paste", seat: activeSeat, zone: input.zone, codes, mode: input.mode });
      message = `${input.mode === "replace" ? "Set" : "Added"} ${result.added ?? 0} in ${zoneName(input.zone)}.`;
      if (result.overflow) message += ` ${result.overflow} did not fit.`;
    }
    if (unresolved.length > 0) {
      const shown = unresolved.slice(0, 3).map((line) => `"${line.text}"`).join(", ");
      message += `${message ? " " : ""}Not found: ${shown}${unresolved.length > 3 ? ` and ${unresolved.length - 3} more` : ""}.`;
    }
    return message || "Nothing to add.";
  }

  /** Copy a code that holds the whole board and the bot settings. Another admin loads it with Import code. */
  async function copyShareCode() {
    setProblem(null);
    const current = stateRef.current;
    let code: string;
    try {
      const label = name?.trim();
      code = encodeSandboxShare({ ...(label ? { name: label } : {}), board: current.board, run: current.run });
    } catch (error) {
      setProblem(shareErrorText(error));
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      say("Share code copied. Send it to another admin: Import code loads it.");
    } catch {
      setDialog({ mode: "export", code });
    }
  }

  /** Load a decoded share into the builder. Throws a text the dialog shows when this table cannot run it. */
  function importShare(share: SandboxShare) {
    const next = loadBuilderState(share.board, share.run);
    const blocked = formatBlockReason(capabilities, next.board.format ?? "1v1", next.board.mode ?? "normal");
    if (blocked) throw new Error(blocked);
    dispatch({ type: "replace", state: next });
    if (share.name && onNameChange && !(name ?? "").trim()) onNameChange(share.name);
    setSeat("p0");
    setOpen(null);
    setProblem(null);
    say(`Imported ${share.name ? `"${share.name}"` : "the board"}. Undo brings the old board back.`);
  }

  async function run(kind: "start" | "save" | "share") {
    if (busy) return;
    setBusy(kind);
    setProblem(null);
    try {
      const current = stateRef.current;
      if (kind === "start") {
        const { slug } = await services.start({ board: current.board, run: current.run, scenarioId });
        if (onStarted) onStarted(slug);
        else window.location.assign(`/duels/${slug}`);
        return;
      }
      await (kind === "save" ? onSave?.(current) : onShare?.(current));
    } catch (error) {
      setProblem(error instanceof SandboxRequestError || error instanceof Error ? error.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const actions: SeatBoardActions = {
    act,
    onSlot,
    onDropOnLoc,
    onSelectTarget: (zone) => setTarget(zone),
    onAddArmedToPile: (zone) => {
      if (armed) addToPile(armed, zone, 1);
    },
    onOpen: setOpen,
    onAddMaterialByName: addMaterialByName,
  };

  // ---- keys ----------------------------------------------------------------------------------

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      if (open) {
        setOpen(null);
      } else if (armed) {
        setArmed(null);
      }
      return;
    }
    if (typing(event.target) || event.altKey) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "redo" : "undo" });
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      dispatch({ type: "redo" });
    } else if (event.key === "/" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      setSide("quick");
      searchRef.current?.focus();
    }
  }

  // Close the popover on a press outside any slot or popover.
  useEffect(() => {
    if (!open) return;
    function onPress(event: PointerEvent) {
      if (event.target instanceof Element && !event.target.closest("[data-sbx-slot]")) setOpen(null);
    }
    document.addEventListener("pointerdown", onPress);
    return () => document.removeEventListener("pointerdown", onPress);
  }, [open]);

  const errorSeat = check.error ? (check.error.path.match(/^p[0-3]/)?.[0] ?? null) : null;
  const battleReason = battleBlockReason(state.board);
  const table = supportsElimination(state.board.format);
  const outSeats = seats.filter((id) => isEliminated(state.board, id));
  const seatLabel = activeSeat === "p0" ? "P0 (You)" : activeSeat.toUpperCase();

  return (
    <div className={styles.root} onKeyDown={onKeyDown}>
      <header className={styles.bar}>
        <div className={styles.barRow}>
          {onNameChange ? (
            <label className={styles.nameField}>
              <span className="sr">Scenario name</span>
              <input className="input" value={name ?? ""} maxLength={80} placeholder="Name this board" onChange={(event) => onNameChange(event.target.value)} />
            </label>
          ) : null}

          <fieldset className={styles.group}>
            <legend>Table</legend>
            <div className="seg" role="group" aria-label="Table format">
              {FORMAT_CHOICES.map((choice) => {
                const reason = formatBlockReason(capabilities, choice.value, mode);
                return (
                  <button
                    key={choice.value}
                    type="button"
                    aria-pressed={format === choice.value}
                    disabled={reason !== null}
                    title={reason ?? undefined}
                    onClick={() => act({ type: "setFormat", format: choice.value })}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend>Mode</legend>
            <div className="seg" role="group" aria-label="Mode">
              {(["normal", "domain"] as const).map((value) => {
                const reason = value === "domain" ? formatBlockReason(capabilities, format, "domain") : null;
                return (
                  <button key={value} type="button" aria-pressed={mode === value} disabled={reason !== null} title={reason ?? undefined} onClick={() => act({ type: "setMode", mode: value })}>
                    {value === "normal" ? "Normal" : "Domain"}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className={styles.group}>
            <span className={styles.legend}>Master Rule</span>
            <select className="input select" value={state.board.masterRule ?? 5} onChange={(event) => act({ type: "setMasterRule", masterRule: Number(event.target.value) as DuelMasterRule })}>
              {MASTER_RULES.map((rule) => <option key={rule} value={rule}>Master Rule {rule}</option>)}
            </select>
          </label>

          <label className={styles.group}>
            <span className={styles.legend}>Turn player</span>
            <select className="input select" value={state.board.turn ?? "p0"} onChange={(event) => act({ type: "setTurn", turn: event.target.value as SandboxDuelistId })}>
              {seats.map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}
            </select>
          </label>

          <label className={styles.group}>
            <span className={styles.legend}>Filler Deck</span>
            <input
              className={cn("input num", styles.deckSize)}
              type="number"
              min={0}
              max={SANDBOX_LIMITS.deckSize}
              value={state.board.deckSize ?? DEFAULT_DECK_SIZE}
              aria-label="Deck size per seat"
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value)) act({ type: "setDeckSize", deckSize: value });
              }}
            />
          </label>

          <label className={styles.check}>
            <input type="checkbox" checked={state.board.attackFirstTurn === true} onChange={(event) => act({ type: "setAttackFirstTurn", value: event.target.checked })} />
            Attack on turn 1
          </label>

          <div className={styles.group}>
            <label className={styles.legend} htmlFor="sbx-start-in">Start in</label>
            <select
              id="sbx-start-in"
              className="input select"
              value={state.board.startAt ?? "draw"}
              aria-describedby={battleReason ? "sbx-start-hint" : undefined}
              onChange={(event) => act({ type: "setStartAt", phase: event.target.value as SandboxStartPhase })}
            >
              {SANDBOX_START_PHASES.map((phase) => (
                <option key={phase} value={phase} disabled={phase === "battle" && battleReason !== null}>
                  {PHASE_LABEL[phase]} Phase
                </option>
              ))}
            </select>
            {battleReason ? <span id="sbx-start-hint" className={extra.startHint}>{battleReason}</span> : null}
          </div>

          <div className={styles.group}>
            <span className={styles.legend}>Seed</span>
            <div className={styles.seedRow}>
              <div className="seg" role="group" aria-label="Seed">
                <button type="button" aria-pressed={!state.run.seed} onClick={() => act({ type: "setSeed", seed: null })}>Random</button>
                <button type="button" aria-pressed={!!state.run.seed} onClick={() => { if (!state.run.seed) act({ type: "setSeed", seed: randomSeed() }); }}>Fixed</button>
              </div>
              {state.run.seed ? (
                <button type="button" className={styles.iconBtn} aria-label="New fixed seed" title="New fixed seed" onClick={() => act({ type: "setSeed", seed: randomSeed() })}>
                  <Dices size={15} aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className={styles.barRow}>
          <div className={styles.tools}>
            <button type="button" className="btn btn-quiet btn-sm" disabled={history.past.length === 0} onClick={() => dispatch({ type: "undo" })} title="Undo (Ctrl+Z)">
              <Undo2 size={14} aria-hidden /> Undo
            </button>
            <button type="button" className="btn btn-quiet btn-sm" disabled={history.future.length === 0} onClick={() => dispatch({ type: "redo" })} title="Redo (Ctrl+Shift+Z)">
              <Redo2 size={14} aria-hidden /> Redo
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => act({ type: "clearBoard" })} title="Remove every card from every seat">
              <Eraser size={14} aria-hidden /> Clear board
            </button>
          </div>
          <div className={styles.spacer} />
          {!check.ok && check.error ? <p className={styles.invalid} role="alert">{check.error.path}: {check.error.message}</p> : null}
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDialog({ mode: "import" })} title="Load a board from a share code">
            <ClipboardPaste size={14} aria-hidden /> Import code
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!check.ok} onClick={() => void copyShareCode()} title="Copy a code that holds this whole board">
            <Share2 size={14} aria-hidden /> Copy share code
          </button>
          {onShare ? (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void run("share")} title="Copy a link that starts this saved scenario">
              <Link2 size={14} aria-hidden /> Copy link
            </button>
          ) : null}
          {onSave ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null || !check.ok} onClick={() => void run("save")}>{busy === "save" ? "Saving…" : saveLabel}</button> : null}
          <button type="button" className="btn btn-primary" disabled={busy !== null || !check.ok} onClick={() => void run("start")}>
            <Play size={15} aria-hidden /> {busy === "start" ? "Starting…" : "Start"}
          </button>
        </div>
        {problem ? <p className={styles.problem} role="alert">{problem}</p> : null}
      </header>

      <div className={styles.main}>
        <div className={styles.boardCol}>
          <div className={styles.seatTabs} role="tablist" aria-label="Seats">
            {seats.map((id) => {
              const sum = seatSummary(state, id);
              const out = isEliminated(state.board, id);
              const toggleReason = !table ? null : out ? null : (state.board.turn ?? "p0") === id ? "The turn player stays in." : activeSeats(state.board).length <= 2 ? "Two players must stay in." : null;
              return (
                <div key={id} className={extra.seatTabWrap}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={id === activeSeat}
                    className={styles.seatTab}
                    data-error={errorSeat === id ? "true" : undefined}
                    data-out={out ? "true" : undefined}
                    onClick={() => { setSeat(id); setOpen(null); }}
                  >
                    <strong>{id.toUpperCase()}{id === "p0" ? " You" : ""}{out ? " (out)" : ""}</strong>
                    <span className="num">{out ? "Out of the duel" : `${sum.hand} hand · ${sum.field} field · ${sum.grave} GY`}</span>
                  </button>
                  {table ? (
                    <button
                      type="button"
                      className={cn("btn btn-quiet btn-sm", extra.outToggle)}
                      aria-label={out ? `Put ${id.toUpperCase()} back in` : `Take ${id.toUpperCase()} out`}
                      title={toggleReason ?? (out ? "Put this player back in. The seat comes back empty." : "Take this player out. Its cards go away and it keeps its place.")}
                      disabled={toggleReason !== null}
                      onClick={() => act({ type: "toggleEliminated", seat: id })}
                    >
                      {out ? <UserPlus size={14} aria-hidden /> : <UserMinus size={14} aria-hidden />} {out ? "Put in" : "Take out"}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className={cn(styles.statusLine, status?.kind === "warn" && styles.statusWarn)} role="status" aria-live="polite">{status?.text ?? ""}</p>
          {table ? (
            <SandboxTableView
              state={state}
              activeSeat={activeSeat}
              onSelectSeat={(id) => { setSeat(id); setOpen(null); }}
              infos={infos as CardInfoMap}
              armedCode={armed?.code ?? null}
              target={target}
              open={open}
              actions={actions}
            />
          ) : (
            <SeatBoard state={state} seat={activeSeat} infos={infos as CardInfoMap} armedCode={armed?.code ?? null} target={target} open={open} actions={actions} />
          )}
          <p className={styles.note}>
            Cards are placed by script, like an EDOPro puzzle. They have no &ldquo;this turn&rdquo; state, equip links or counters, so a result here can differ from real play.
          </p>
        </div>

        <aside className={styles.side}>
          <div className="seg" role="group" aria-label="Card source">
            <button type="button" aria-pressed={side === "quick"} onClick={() => setSide("quick")}>Quick add</button>
            <button type="button" aria-pressed={side === "browse"} onClick={() => setSide("browse")}>Browse cards</button>
          </div>
          <div hidden={side !== "quick"}>
            <QuickAdd
              seatLabel={seatLabel}
              services={services}
              target={target}
              onTarget={setTarget}
              armed={armed}
              onArm={setArmed}
              onAdd={addCard}
              onPaste={paste}
              onCards={remember}
              inputRef={searchRef}
            />
          </div>
          {side === "browse" ? (
            <BrowsePane
              armed={armed}
              onArm={(card) => { remember([card]); setArmed(card); }}
              onAdd={(card) => addCard(card, 1)}
              onCards={remember}
              targetLabel={target === "field" ? "the field" : zoneName(target)}
            />
          ) : null}
        </aside>
      </div>
      {dialog ? <ShareDialog mode={dialog.mode} code={dialog.code} onImport={importShare} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

/** The deck editor's card browser. Click selects a card; double click or right click adds it to the target. */
function BrowsePane({ armed, onArm, onAdd, onCards, targetLabel }: {
  armed: DeckCardInfo | null;
  onArm: (card: DeckCardInfo) => void;
  onAdd: (card: DeckCardInfo) => void;
  onCards: (cards: DeckCardInfo[]) => void;
  targetLabel: string;
}) {
  const [query, setQuery] = useState<CardQuery>(() => emptyCardQuery());
  const [view, setView] = useState<BrowserView>("grid");
  const [archetypes, setArchetypes] = useState<readonly CardArchetype[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    getDeckCardFacets().then((facets) => { if (live) setArchetypes(facets.archetypes); }, () => undefined);
    return () => { live = false; };
  }, []);

  return (
    <div className={styles.browse}>
      <p className={styles.browseHint}>Click a card to select it. Double click adds it to {targetLabel}.</p>
      <div className={styles.browseFrame}>
        <CardBrowser
          id="sandbox-card-browser"
          query={query}
          onQueryChange={setQuery}
          archetypes={archetypes}
          limits={null}
          view={view}
          onViewChange={setView}
          deckCount={() => 0}
          inspectCode={armed?.code ?? null}
          onInspect={(card) => onArm(card)}
          onHover={() => undefined}
          onAdd={onAdd}
          onCatalog={onCards}
          onRemoveDrop={() => undefined}
          searchRef={searchRef}
        />
      </div>
    </div>
  );
}

export { DUEL_FORMATS };
