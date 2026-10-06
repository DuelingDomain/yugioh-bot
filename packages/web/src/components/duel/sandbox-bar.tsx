"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { seatCountFor } from "@yugidraft/shared/duels";
import type { DuelPrompt, DuelRoom, SandboxBoard, SandboxBotMode, SandboxRun } from "@yugidraft/shared/duels";
import {
  closeSandbox, eliminateSandboxSeat, getDuelRoom, restartSandbox, sandboxGoToPhase, sandboxNextTurn,
  saveSandboxState, setSandboxSeatControl,
  type SandboxSaveStateResult, type SandboxView, type SandboxWalkPhase,
} from "./api";
import { phaseLabel } from "./constants";
import styles from "./sandbox-bar.module.css";

/**
 * The dev sandbox row on the duel HUD (spec section 4.3 and 9). It is mounted by room.tsx in the notices slot of
 * every layout (1v1 room, 3D mode, 3-way / 4-way table, Tag), so each shell shows it under its own header.
 * The host answers `view` and `respond` for the acting seat (`as`); the client keeps that seat in the URL.
 */

export interface SandboxRoomInfo {
  board: SandboxBoard;
  run: SandboxRun;
  scenarioId?: number;
}

/** The host adds `sandbox` to the room of a sandbox duel the viewer organizes. Anything else has none. */
export function sandboxInfoOf(room: DuelRoom | null | undefined): SandboxRoomInfo | null {
  const info = (room as { sandbox?: SandboxRoomInfo } | null | undefined)?.sandbox;
  return info && typeof info === "object" && info.run && typeof info.run === "object" ? info : null;
}

export type SeatMode = SandboxBotMode | "you";

export const SEAT_MODE_LABEL: Record<SeatMode, string> = {
  you: "You", pass: "Auto-pass", practice: "Practice bot", manual: "Manual",
};
const BOT_MODES: readonly SandboxBotMode[] = ["pass", "practice", "manual"];

export function seatModeOf(info: SandboxRoomInfo, seat: number): SeatMode {
  return seat === 0 ? "you" : info.run.bots[String(seat) as "1" | "2" | "3"] ?? "pass";
}

/** Seats the admin can act for: seat 0 and every Manual seat. */
export function canActAs(info: SandboxRoomInfo, seat: number): boolean {
  const mode = seatModeOf(info, seat);
  return mode === "you" || mode === "manual";
}

// ---------------------------------------------------------------------------------------------
// Phase walk

export const WALK_PHASES: ReadonlyArray<{ id: SandboxWalkPhase; label: string }> = [
  { id: "standby", label: "Standby" },
  { id: "main1", label: "Main 1" },
  { id: "battle", label: "Battle" },
  { id: "main2", label: "Main 2" },
  { id: "end", label: "End" },
];

const PHASE_RANK: Record<string, number> = {
  Draw: 0, Standby: 1, "Main 1": 2, Battle: 3, Damage: 3, "Damage calculation": 3, "Main 2": 4, End: 5,
};

/** Where a phase sits in the turn (Battle Phase steps count as Battle); null for a phase the bar does not know. */
export function phaseRank(phase: string | number | null | undefined): number | null {
  return PHASE_RANK[phaseLabel(phase)] ?? null;
}

const WALK_RANK: Record<SandboxWalkPhase, number> = { standby: 1, main1: 2, battle: 3, main2: 4, end: 5 };

export interface WalkNote {
  /** The engine revision the note describes. The note hides once the room moves on. */
  revision: number;
  tone: "ok" | "stop";
  text: string;
}

/** What kind of window holds the walk. */
export function windowName(prompt: DuelPrompt): string {
  if (prompt.context?.type === "action") return "action window";
  if (prompt.context?.type === "chain" || prompt.source) return "effect window";
  return `"${prompt.title}" prompt`;
}

/**
 * Says where a phase walk stopped and why, from the room the host answered with. The walk never fakes a phase, so
 * the reason is always something the engine shows: a window that needs an answer, or a phase that is already past.
 */
export function explainWalk(
  target: SandboxWalkPhase | "next-turn",
  before: { turn: number; phase: string },
  room: DuelRoom,
  info: SandboxRoomInfo,
  acting: number,
): WalkNote | null {
  const engine = room.engine;
  if (!engine) return null;
  const revision = engine.revision;
  const here = phaseLabel(engine.phase);
  if (engine.result) return { revision, tone: "ok", text: "The duel ended." };
  if (target === "next-turn") {
    if (engine.turn !== before.turn) return { revision, tone: "ok", text: `Turn ${engine.turn}: ${here} Phase.` };
  } else {
    const rank = phaseRank(engine.phase);
    const wanted = WALK_RANK[target];
    const label = WALK_PHASES.find((phase) => phase.id === target)!.label;
    if (engine.turn === before.turn && rank === wanted) return { revision, tone: "ok", text: `At ${label}.` };
    if (engine.turn === before.turn && rank != null && rank > wanted) {
      const startedPast = (phaseRank(before.phase) ?? 0) > wanted;
      return {
        revision, tone: "stop",
        text: startedPast
          ? `Stopped: ${label} is already past this turn. Use Next turn.`
          : `Stopped: the engine did not offer ${label} this turn. It is now ${here}.`,
      };
    }
  }
  // Something holds the walk before the target: a window that needs a real answer.
  const waiting = engine.prioritySeat;
  const prompt = engine.prompt;
  if (prompt && prompt.seat === acting) return { revision, tone: "stop", text: `Stopped: ${windowName(prompt)} in ${here}.` };
  if (waiting != null && waiting !== acting) {
    const mode = SEAT_MODE_LABEL[seatModeOf(info, waiting)];
    return { revision, tone: "stop", text: `Stopped: P${waiting} (${mode}) has a window in ${here}. Act as P${waiting} to answer.` };
  }
  return { revision, tone: "stop", text: `Stopped in ${here}.` };
}

// ---------------------------------------------------------------------------------------------
// State kept by the room

const REVEAL_KEY = "dk.sandbox.reveal";

function readReveal(): boolean {
  try {
    return window.localStorage.getItem(REVEAL_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeReveal(value: boolean): void {
  try {
    window.localStorage.setItem(REVEAL_KEY, value ? "1" : "0");
  } catch { /* a blocked store only costs the remembered toggle */ }
}

function parseAs(value: string | null | undefined): number | null {
  return value != null && /^[0-3]$/.test(value) ? Number(value) : null;
}

/** The `?as=` of the address bar. Read once: this hook is the only writer after that. */
function readAsParam(): number | null {
  try {
    return typeof window === "undefined" ? null : parseAs(new URL(window.location.href).searchParams.get("as"));
  } catch {
    return null;
  }
}

/** Keeps `?as=` in the address bar without a navigation; a reload then keeps the acting seat. */
function writeAsParam(seat: number | null): void {
  try {
    const url = new URL(window.location.href);
    if (seat == null || seat === 0) url.searchParams.delete("as");
    else url.searchParams.set("as", String(seat));
    window.history.replaceState(window.history.state, "", url);
  } catch { /* the address only helps a reload */ }
}

export interface SandboxRoomOptions {
  slug: string;
  room: DuelRoom | undefined;
  /** Read by the room's fetches and answers. The hook keeps it current on every render. */
  viewRef: MutableRefObject<SandboxView | undefined>;
  /** Put a fresh room on the board (the answer of a control call). */
  setRoom: (room: DuelRoom) => unknown;
  /** Ask the host for the room again with the current view. */
  refresh: () => unknown;
}

/**
 * Sandbox state of one duel room: the acting seat (URL), Reveal hands, Follow prompt and the bar to render.
 * For a duel that is not a sandbox the bar is null and the view stays undefined, so nothing changes.
 */
export function useSandboxRoom({ slug, room, viewRef, setRoom, refresh }: SandboxRoomOptions): { bar: ReactNode } {
  const router = useRouter();
  const info = sandboxInfoOf(room);
  const [asParam, setAsParam] = useState<number | null>(() => readAsParam());
  const [reveal, setRevealState] = useState(true);
  const [follow, setFollow] = useState(false);
  useEffect(() => setRevealState(readReveal()), []);

  const acting = info && asParam != null && asParam < seatCountFor(room!.session.format) && canActAs(info, asParam) ? asParam : 0;
  // A URL with ?as= asks the host before the first room says it is a sandbox; the host rejects it for any other duel.
  viewRef.current = info ? { as: acting, reveal } : asParam != null ? { as: asParam, reveal } : undefined;

  const viewKey = viewRef.current ? `${viewRef.current.as}|${viewRef.current.reveal}` : "";
  const lastKey = useRef(viewKey);
  useEffect(() => {
    if (lastKey.current === viewKey) return;
    lastKey.current = viewKey;
    void refresh();
  }, [viewKey, refresh]);

  const actAs = useCallback(async (seat: number, next: DuelRoom) => {
    await setRoom(next);
    setAsParam(seat);
    writeAsParam(seat);
  }, [setRoom]);
  const setReveal = useCallback((value: boolean) => { setRevealState(value); writeReveal(value); }, []);
  const restarted = useCallback((nextSlug: string) => {
    router.replace(`/duels/${encodeURIComponent(nextSlug)}${acting ? `?as=${acting}` : ""}`);
  }, [router, acting]);
  const closed = useCallback(() => { router.push("/sandbox"); }, [router]);

  const bar = info && room ? (
    <SandboxBar
      slug={slug} room={room} info={info} acting={acting} reveal={reveal} follow={follow}
      onActAs={actAs} onRoom={setRoom} onReveal={setReveal} onFollow={setFollow} onRestarted={restarted} onClosed={closed}
    />
  ) : null;
  return { bar };
}

// ---------------------------------------------------------------------------------------------
// The bar

export interface SandboxBarProps {
  slug: string;
  room: DuelRoom;
  info: SandboxRoomInfo;
  /** The seat the admin acts as now. */
  acting: number;
  reveal: boolean;
  follow: boolean;
  /** Act as `seat`; `room` is the room as that seat sees it (already fetched). */
  onActAs: (seat: number, room: DuelRoom) => unknown;
  onRoom: (room: DuelRoom) => unknown;
  onReveal: (value: boolean) => void;
  onFollow: (value: boolean) => void;
  onRestarted: (slug: string) => void;
  /** The duel is closed (Save & close or Close): leave for the sandbox list. */
  onClosed: () => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The sandbox request failed.";
}

/** Name the scenario gets when the person does not type one: "<duel name> - turn N <phase>", at most 80 characters. */
export function defaultStateName(room: DuelRoom): string {
  const engine = room.engine;
  const tail = engine ? ` - turn ${engine.turn} ${phaseLabel(engine.phase)}` : " - state";
  const base = (room.session.name || "Sandbox").trim().slice(0, Math.max(1, 80 - tail.length)).trim() || "Sandbox";
  return `${base}${tail}`;
}

type BarMenu = "phase" | "save" | "exit" | number | null;
type Confirm = { kind: "eliminate"; seat: number } | { kind: "close" } | null;

/** Seats the engine already sent out (FFA). Empty for a room that has no engine yet. */
export function eliminatedSeatsOf(room: DuelRoom): Set<number> {
  return new Set((room.engine?.seats ?? []).filter((view) => view.eliminated).map((view) => view.seat));
}

export function SandboxBar({ slug, room, info, acting, reveal, follow, onActAs, onRoom, onReveal, onFollow, onRestarted, onClosed }: SandboxBarProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<WalkNote | null>(null);
  const [menu, setMenu] = useState<BarMenu>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [stateName, setStateName] = useState("");
  const [saved, setSaved] = useState<SandboxSaveStateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const engine = room.engine;
  const seats = useMemo(() => Array.from({ length: seatCountFor(room.session.format) }, (_, seat) => seat), [room.session.format]);
  const live = room.session.status === "active" && engine != null && !engine.result;
  const view: SandboxView = { as: acting, reveal };
  const isFfa = room.session.format === "ffa3" || room.session.format === "ffa4";
  const out = useMemo(() => eliminatedSeatsOf(room), [room]);
  const aliveCount = seats.length - out.size;
  const rank = phaseRank(engine?.phase);

  const guarded = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMenu(null);
    try {
      await work();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  // A confirmation belongs to the menu that asked for it.
  useEffect(() => { if (menu == null) setConfirm(null); }, [menu]);

  // Close an open menu on a click elsewhere or Escape.
  useEffect(() => {
    if (menu == null) return undefined;
    const onDown = (event: MouseEvent) => { if (!barRef.current?.contains(event.target as Node)) setMenu(null); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menu]);

  // The note describes one engine revision. Any later move of the room (an answer, a bot) retires it.
  const shownNote = note && engine && note.revision === engine.revision ? note : null;

  const switchTo = useCallback(async (seat: number) => {
    const next = await getDuelRoom(slug, false, { as: seat, reveal });
    await onActAs(seat, next);
  }, [slug, reveal, onActAs]);

  const chooseSeat = (seat: number) => {
    if (seat === acting) return;
    void guarded(async () => {
      // Taking a bot seat means taking its decisions: it becomes Manual first.
      if (!canActAs(info, seat)) await setSandboxSeatControl(slug, seat, "manual", view);
      await switchTo(seat);
    });
  };

  const setMode = (seat: number, mode: SandboxBotMode) => {
    void guarded(async () => {
      const next = await setSandboxSeatControl(slug, seat, mode, view);
      if (seat === acting && mode !== "manual") {
        await switchTo(0);
      } else {
        await onRoom(next);
      }
    });
  };

  // Follow prompt: the acting seat jumps to the Manual seat the engine waits on.
  const waiting = engine?.prioritySeat ?? null;
  const followRef = useRef(switchTo);
  followRef.current = switchTo;
  useEffect(() => {
    if (!follow || busy || !live || waiting == null || waiting === acting || !canActAs(info, waiting)) return;
    void guarded(async () => { await followRef.current(waiting); });
  }, [follow, busy, live, waiting, acting, info, guarded]);

  const walk = (target: SandboxWalkPhase | "next-turn") => {
    if (!engine) return;
    const before = { turn: engine.turn, phase: engine.phase };
    void guarded(async () => {
      setNote(null);
      const next = target === "next-turn" ? await sandboxNextTurn(slug, view) : await sandboxGoToPhase(slug, target, view);
      await onRoom(next);
      setNote(explainWalk(target, before, next, info, acting));
    });
  };

  const restart = () => {
    void guarded(async () => {
      const { slug: next } = await restartSandbox(slug, view);
      onRestarted(next);
    });
  };

  const eliminate = (seat: number) => {
    void guarded(async () => {
      const next = await eliminateSandboxSeat(slug, seat, view);
      // An eliminated seat has nothing left to act for: go back to seat 0.
      if (seat === acting && seat !== 0) await switchTo(0);
      else await onRoom(next);
    });
  };

  const openSave = () => {
    if (menu === "save") { setMenu(null); return; }
    setStateName(defaultStateName(room));
    setMenu("save");
  };

  const saveState = () => {
    const name = stateName.trim();
    if (!name) return;
    void guarded(async () => {
      setSaved(null);
      setSaved(await saveSandboxState(slug, { name }, view));
    });
  };

  // Save & close: the save must succeed first. A failed save (or close) leaves the duel open with the error shown.
  const saveAndClose = () => {
    void guarded(async () => {
      setSaved(null);
      const result = await saveSandboxState(slug, { name: defaultStateName(room) }, view);
      setSaved(result);
      await closeSandbox(slug, view);
      onClosed();
    });
  };

  const closeOnly = () => {
    void guarded(async () => {
      await closeSandbox(slug, view);
      onClosed();
    });
  };

  const builderHref = info.scenarioId != null ? `/sandbox/${info.scenarioId}` : `/sandbox/new?from=${encodeURIComponent(slug)}`;
  const shareLink = info.scenarioId != null ? `${typeof window === "undefined" ? "" : window.location.origin}/sandbox/${info.scenarioId}?play=1` : null;
  const copyLink = () => {
    if (!shareLink) return;
    void navigator.clipboard?.writeText(shareLink).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); },
      () => setError("Could not copy the link. Copy it from the Sandbox page."),
    );
  };

  return (
    <div className={styles.bar} ref={barRef} data-testid="sandbox-bar" role="region" aria-label="Sandbox controls">
      <div className={styles.row}>
        <span className={styles.tag}>Sandbox</span>
        <div className={styles.group} role="group" aria-label="Acting seat">
          {seats.map((seat) => {
            const mode = seatModeOf(info, seat);
            const isActing = seat === acting;
            const isOut = out.has(seat);
            return (
              <span key={seat} className={styles.chipWrap} data-acting={isActing ? "true" : undefined}>
                <button type="button" className={styles.chip} disabled={busy || isOut} aria-pressed={isActing}
                  data-testid={`sandbox-seat-${seat}`} data-mode={mode} data-out={isOut ? "true" : undefined}
                  title={isOut ? `P${seat} is eliminated` : isActing ? `Acting as P${seat}` : mode === "manual" || mode === "you" ? `Act as P${seat}` : `Take control of P${seat} and act as it`}
                  onClick={() => chooseSeat(seat)}>
                  {waiting === seat ? <span className={styles.dot} aria-label="The engine waits on this seat" role="img" /> : null}
                  <b>P{seat}</b> {isOut ? "Out" : SEAT_MODE_LABEL[mode]}
                </button>
                {!isOut && (seat > 0 || isFfa) ? (
                  <button type="button" className={styles.caret} disabled={busy} aria-label={seat > 0 ? `Set P${seat} mode` : `P${seat} options`}
                    aria-haspopup="menu" aria-expanded={menu === seat}
                    onClick={() => setMenu(menu === seat ? null : seat)}>▾</button>
                ) : null}
                {menu === seat ? (
                  <div className={styles.menu} role="menu" aria-label={seat > 0 ? `P${seat} mode` : `P${seat} options`}>
                    {seat > 0 ? BOT_MODES.map((option) => (
                      <button key={option} type="button" role="menuitemradio" aria-checked={mode === option}
                        className={styles.menuItem} onClick={() => setMode(seat, option)}>
                        {SEAT_MODE_LABEL[option]}
                      </button>
                    )) : null}
                    {isFfa ? (confirm?.kind === "eliminate" && confirm.seat === seat ? (
                      <div className={styles.confirm} role="group" aria-label={`Eliminate P${seat}`}>
                        <span>Eliminate P{seat}?</span>
                        <button type="button" className={styles.danger} data-testid={`sandbox-eliminate-confirm-${seat}`}
                          onClick={() => eliminate(seat)}>Eliminate</button>
                        <button type="button" className={styles.menuItem} onClick={() => setConfirm(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button type="button" role="menuitem" className={styles.menuItem} data-testid={`sandbox-eliminate-${seat}`}
                        disabled={!live || aliveCount <= 2}
                        title={aliveCount <= 2 ? "Two seats must stay in the duel" : `Send P${seat} out of the duel`}
                        onClick={() => setConfirm({ kind: "eliminate", seat })}>
                        Eliminate…
                      </button>
                    )) : null}
                  </div>
                ) : null}
              </span>
            );
          })}
        </div>
        <span className={styles.sep} aria-hidden />
        <span className={styles.chipWrap}>
          <button type="button" className={styles.btn} disabled={busy || !live} aria-haspopup="menu" aria-expanded={menu === "phase"}
            data-testid="sandbox-go-to-phase" onClick={() => setMenu(menu === "phase" ? null : "phase")}>
            Go to phase ▾
          </button>
          {menu === "phase" ? (
            <div className={styles.menu} role="menu" aria-label="Go to phase">
              {WALK_PHASES.map((phase) => {
                const past = rank != null && rank > WALK_RANK[phase.id];
                return (
                  <button key={phase.id} type="button" role="menuitem" className={styles.menuItem} disabled={past}
                    title={past ? "Already past this turn" : `Walk the engine to ${phase.label}`}
                    data-testid={`sandbox-phase-${phase.id}`} onClick={() => walk(phase.id)}>
                    {phase.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </span>
        <button type="button" className={styles.btn} disabled={busy || !live} data-testid="sandbox-next-turn"
          onClick={() => walk("next-turn")}>Next turn</button>
        <span className={styles.sep} aria-hidden />
        <label className={styles.toggle}>
          <input type="checkbox" checked={follow} onChange={(event) => onFollow(event.target.checked)} />
          Follow prompt
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={reveal} onChange={(event) => onReveal(event.target.checked)} />
          Reveal hands
        </label>
        <span className={styles.sep} aria-hidden />
        <span className={styles.chipWrap}>
          <button type="button" className={styles.btn} disabled={busy || !live} aria-haspopup="dialog" aria-expanded={menu === "save"}
            data-testid="sandbox-save-state" onClick={openSave}>Save state</button>
          {menu === "save" ? (
            <form className={`${styles.menu} ${styles.saveMenu}`} aria-label="Save state"
              onSubmit={(event) => { event.preventDefault(); saveState(); }}>
              <label className={styles.nameLabel}>
                Scenario name
                <input className={styles.nameInput} value={stateName} maxLength={80} autoFocus data-testid="sandbox-state-name"
                  onChange={(event) => setStateName(event.target.value)} />
              </label>
              <button type="submit" className={styles.btn} disabled={busy || !stateName.trim()} data-testid="sandbox-state-save">Save</button>
            </form>
          ) : null}
        </span>
        <button type="button" className={styles.btn} disabled={busy} data-testid="sandbox-restart" onClick={restart}>Restart</button>
        <Link className={styles.btn} href={builderHref} data-testid="sandbox-builder">Back to builder</Link>
        {shareLink ? (
          <button type="button" className={styles.btn} onClick={copyLink} data-testid="sandbox-copy">
            {copied ? "Link copied" : "Copy link"}
          </button>
        ) : null}
        <span className={styles.sep} aria-hidden />
        <span className={`${styles.chipWrap} ${styles.exitWrap}`}>
          <button type="button" className={`${styles.btn} ${styles.exit}`} disabled={busy} aria-haspopup="menu" aria-expanded={menu === "exit"}
            data-testid="sandbox-exit" onClick={() => setMenu(menu === "exit" ? null : "exit")}>
            Exit sandbox ▾
          </button>
          {menu === "exit" ? (
            <div className={`${styles.menu} ${styles.menuEnd}`} role="menu" aria-label="Exit sandbox">
              <button type="button" role="menuitem" className={styles.menuItem} disabled={!live}
                title={live ? "Save the live state as a scenario, then close" : "The duel is over; there is no live state to save"}
                data-testid="sandbox-save-close" onClick={saveAndClose}>Save &amp; close</button>
              {confirm?.kind === "close" ? (
                <div className={styles.confirm} role="group" aria-label="Close without saving">
                  <span>Close without saving?</span>
                  <button type="button" className={styles.danger} data-testid="sandbox-close-confirm" onClick={closeOnly}>Close</button>
                  <button type="button" className={styles.menuItem} onClick={() => setConfirm(null)}>Cancel</button>
                </div>
              ) : (
                <button type="button" role="menuitem" className={styles.menuItem} data-testid="sandbox-close"
                  onClick={() => setConfirm({ kind: "close" })}>Close…</button>
              )}
            </div>
          ) : null}
        </span>
      </div>
      {saved ? (
        <div className={styles.note} data-testid="sandbox-saved" role="status">
          Saved &quot;{saved.scenario.name}&quot;.{" "}
          <Link className={styles.noteLink} href={`/sandbox/${saved.scenario.id}`} data-testid="sandbox-saved-link">Open scenario</Link>
          {" "}<button type="button" className={styles.noteBtn} onClick={() => setSaved(null)}>Dismiss</button>
          {saved.lost.length ? (
            <>
              <span> The board cannot keep:</span>
              <ul className={styles.lost} data-testid="sandbox-lost">
                {saved.lost.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      {error ? <p className={styles.note} data-tone="stop" role="alert">{error}</p> : null}
      {!error && shownNote ? <p className={styles.note} data-tone={shownNote.tone} role="status">{shownNote.text}</p> : null}
      {!live && room.session.status === "active" && !error && !shownNote ? <p className={styles.note} role="status">The engine is not ready.</p> : null}
    </div>
  );
}
