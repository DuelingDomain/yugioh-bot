"use client";

import * as React from "react";
import { Check, LogOut, UserPlus } from "lucide-react";
import type { DraftAutoStartRequest, DraftLobbyResponse, LobbyPlayer, LobbySnapshot } from "@yugidraft/shared/types";
import { BugFabLift } from "@/components/bug-report/fab-lift";
import { SheetPortal, StatusLine, SvButton, svButtonClass } from "@/components/sheet";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { cn } from "@/lib/utils";
import {
  AUTO_START_SECONDS,
  LobbyRequestError,
  clockOffset,
  createLobbyApi,
  lobbyErrorMessage,
  lobbyStartBlocker,
  lobbyStartLine,
  nameList,
  notReadyPlayers,
  nudgeWaitSeconds,
  plural,
  startFractionLeft,
  startRemainingMs,
  countdownSeconds,
  type LobbyApi,
} from "./lobby-model";
import styles from "./seats-first.module.css";

/* ---------- dialog ---------- */

/** Open dialogs that hold the page still. The scroll lock is released when the last one closes. */
let scrollLocks = 0;
let savedOverflow = "";
function lockScroll(): () => void {
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks -= 1;
    if (scrollLocks === 0) document.body.style.overflow = savedOverflow;
  };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function canFocus(el: HTMLElement | null | undefined): el is HTMLElement {
  return Boolean(el && el.isConnected && !(el as HTMLButtonElement).disabled);
}

export interface LobbyDialogProps {
  /** Accessible name. Use `labelledBy` when a heading in the dialog names it. */
  label?: string;
  labelledBy?: string;
  /** Esc, and a press on the backdrop when `dismissOnBackdrop` is set. A dialog without it can't be closed from the keyboard. */
  onClose?: () => void;
  dismissOnBackdrop?: boolean;
  /** Gets focus when the dialog opens. Without it the first focusable element does. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Where focus goes on close when the element that opened the dialog is gone or disabled. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** `modal` is a centred box, `sheet` slides up on a phone, `full` fills the screen on a phone. */
  variant?: "modal" | "sheet" | "full";
  className?: string;
  children: React.ReactNode;
}

function DialogBody({ label, labelledBy, onClose, dismissOnBackdrop, initialFocusRef, returnFocusRef, variant = "modal", className, children }: LobbyDialogProps) {
  const box = React.useRef<HTMLDivElement>(null);
  // The element that had focus when the dialog opened. Read once, on the first render of the body (client only).
  const [opener] = React.useState<HTMLElement | null>(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null,
  );
  const closeRef = React.useRef(onClose);
  React.useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const returnRef = React.useRef(returnFocusRef);
  React.useEffect(() => { returnRef.current = returnFocusRef; }, [returnFocusRef]);

  useFocusTrap(box, true);

  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    const unlock = lockScroll();
    const first = canFocus(initialFocusRef?.current) ? initialFocusRef.current : el.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el).focus();
    return () => {
      unlock();
      const restore = () => {
        if (canFocus(opener)) opener.focus();
        else if (canFocus(returnRef.current?.current)) returnRef.current?.current?.focus();
      };
      restore();
      // The opener may be disabled for a moment (its request is still running). Try once more when it settles.
      if (document.activeElement === document.body || document.activeElement === null) setTimeout(restore, 0);
    };
    // Focus moves once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The card inspector uses Esc first (it unpins and prevents the default), so a drawer stays open for that press.
      if (event.key !== "Escape" || event.defaultPrevented || !closeRef.current) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={styles.scrim}
      data-variant={variant}
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) closeRef.current?.();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn(styles.dialog, className)}
        data-variant={variant}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A modal for the lobby: it renders through the sheet portal (the `.ms` root is a size container, so fixed UI must
 * leave it), traps Tab, locks page scroll, closes on Esc, and puts focus back where it was. Used by the start box, the
 * not-ready confirm, the invite modal and the pool drawer.
 */
export function LobbyDialog(props: LobbyDialogProps) {
  return (
    <SheetPortal>
      <DialogBody {...props} />
    </SheetPortal>
  );
}

/* ---------- requests ---------- */

export type StartOutcome =
  | { status: "started" }
  | { status: "not-ready"; notReadyPlayerIds: number[]; unclaimedPlayerIds: number[] }
  | { status: "failed" };

export interface LobbyControllerOptions {
  slug: string;
  lobby: LobbySnapshot;
  /** Receives every `{lobby, players}` answer so the page can keep the newest one. */
  onResponse: (response: DraftLobbyResponse) => void;
  /** Asked for after a stale or superseded answer. The page refetches the draft. */
  onRefetch?: () => void;
  /** Replaces the fetch based client. For tests. */
  api?: LobbyApi;
}

export interface LobbyController {
  /** The key of the request in flight, or null. One request runs at a time. */
  pending: string | null;
  error: string | null;
  notice: string | null;
  /** Seconds until Nudge may be used again, from the last answer. Zero when it is free. */
  nudgeWait: number;
  dismiss: () => void;
  setError: (message: string | null) => void;
  /** Runs any request under the one-at-a-time rule, with the same error handling. True when it succeeded. */
  run: (key: string, task: () => Promise<unknown>, fallback: string) => Promise<boolean>;
  ready: (next: boolean) => Promise<boolean>;
  leave: () => Promise<boolean>;
  remove: (playerId: number) => Promise<boolean>;
  start: (opts?: { force?: boolean }) => Promise<StartOutcome>;
  stop: (token: string) => Promise<boolean>;
  setAutoStart: (patch: { enabled: boolean; held?: boolean }) => Promise<boolean>;
  nudge: (playerId?: number) => Promise<boolean>;
}

/** A clock that ticks once a second while `active`. Counts the Nudge wait down. */
function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs]);
  return now;
}

/**
 * The lobby requests of one draft with their shared state: which request runs, the last error, the Nudge cooldown.
 * Every request goes through `run`, so a double click does not send twice. A stale lobby (409 STALE_LOBBY) or a
 * superseded start token asks the page to refetch. Nothing here ever starts the draft by itself: the server owns the
 * deadline.
 */
export function useLobbyController({ slug, lobby, onResponse, onRefetch, api }: LobbyControllerOptions): LobbyController {
  const client = React.useMemo(() => api ?? createLobbyApi(slug), [api, slug]);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [nudgeUntil, setNudgeUntil] = React.useState<string | null>(null);
  const inFlight = React.useRef<string | null>(null);
  const callbacks = React.useRef({ onResponse, onRefetch });
  React.useEffect(() => { callbacks.current = { onResponse, onRefetch }; }, [onResponse, onRefetch]);
  const revision = lobby.revision;

  const waiting = nudgeUntil !== null;
  const now = useNow(waiting);
  const nudgeWait = nudgeWaitSeconds(nudgeUntil, now);

  const run = React.useCallback(
    async (key: string, task: () => Promise<unknown>, fallback: string, quiet?: (err: unknown) => boolean): Promise<boolean> => {
      if (inFlight.current !== null) return false;
      inFlight.current = key;
      setPending(key);
      setError(null);
      setNotice(null);
      try {
        await task();
        return true;
      } catch (err) {
        if (err instanceof LobbyRequestError) {
          if (err.stale || err.code === "START_TOKEN_MISMATCH") callbacks.current.onRefetch?.();
          if (err.code === "NUDGE_COOLDOWN" && err.retryAfterSeconds) {
            setNudgeUntil(new Date(Date.now() + err.retryAfterSeconds * 1000).toISOString());
          }
        }
        if (!quiet?.(err)) setError(lobbyErrorMessage(err, fallback));
        return false;
      } finally {
        inFlight.current = null;
        setPending(null);
      }
    },
    [],
  );

  const takeResponse = React.useCallback((response: DraftLobbyResponse) => callbacks.current.onResponse(response), []);

  return React.useMemo<LobbyController>(
    () => ({
      pending,
      error,
      notice,
      nudgeWait,
      dismiss: () => { setError(null); setNotice(null); },
      setError,
      run: (key, task, fallback) => run(key, task, fallback),
      ready: (next) => run("ready", async () => takeResponse(await client.ready(next)), "Couldn't update your ready mark."),
      leave: () => run("leave", async () => takeResponse(await client.leave()), "Couldn't leave the draft."),
      remove: (playerId) => run(`remove:${playerId}`, async () => takeResponse(await client.removePlayer(playerId)), "Couldn't remove that player."),
      start: async (opts) => {
        let outcome: StartOutcome = { status: "failed" };
        const ok = await run(
          "start",
          async () => {
            takeResponse(await client.start({ revision, ...(opts?.force ? { force: true } : {}) }));
          },
          "Couldn't start the draft.",
          (err) => {
            const missing = err instanceof LobbyRequestError ? err.notReady : null;
            if (!missing) return false;
            outcome = { status: "not-ready", ...missing };
            return true;
          },
        );
        return ok ? { status: "started" } : outcome;
      },
      stop: (token) => run("stop", async () => takeResponse(await client.stop(token)), "Couldn't stop the start."),
      setAutoStart: (patch) =>
        run("auto", async () => {
          const body: DraftAutoStartRequest = { enabled: patch.enabled, revision, ...(patch.held !== undefined ? { held: patch.held } : {}) };
          takeResponse(await client.autoStart(body));
        }, "Couldn't change auto-start."),
      nudge: (playerId) =>
        run(playerId === undefined ? "nudge" : `nudge:${playerId}`, async () => {
          const res = await client.nudge(playerId);
          setNudgeUntil(res.nextAllowedAt);
          setNotice(playerId === undefined ? "Posted to the Discord channel." : "Reminder sent.");
        }, "Couldn't post to Discord."),
    }),
    [pending, error, notice, nudgeWait, run, takeResponse, client, revision],
  );
}

/* ---------- countdown ---------- */

export interface StartCountdown {
  remainingMs: number;
  seconds: number;
  /** Share left, 0 to 1. */
  fraction: number;
  /** True once the server deadline has passed on this clock. The start still happens on the server. */
  expired: boolean;
}

/**
 * Draws the server's start deadline on the local clock. When it reaches zero it only calls `onExpire` (a refetch),
 * once, then again every 2 s while the lobby still shows the start. It never starts the draft: the server timer does.
 */
export function useStartCountdown(lobby: LobbySnapshot, onExpire?: () => void): StartCountdown | null {
  const start = lobby.start;
  const offset = React.useMemo(() => clockOffset(lobby.serverNow, Date.now()), [lobby.serverNow]);
  const token = start?.token ?? null;
  const now = useNow(token !== null, 200);
  const expireRef = React.useRef(onExpire);
  React.useEffect(() => { expireRef.current = onExpire; }, [onExpire]);

  const remainingMs = start ? startRemainingMs(start, offset, now) : 0;
  const expired = start !== null && remainingMs <= 0;
  React.useEffect(() => {
    if (!expired) return;
    expireRef.current?.();
    const id = setInterval(() => expireRef.current?.(), 2000);
    return () => clearInterval(id);
  }, [expired, token]);

  if (!start) return null;
  return {
    remainingMs,
    seconds: countdownSeconds(remainingMs),
    fraction: startFractionLeft(remainingMs, start.kind),
    expired,
  };
}

const RING_RADIUS = 46;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** The start box: a ring that drains, "Starting in N s", and for the host a Stop button that has focus. Esc stops too. */
export function LobbyStartBox({
  lobby,
  controller,
  isHost,
  onExpire,
}: {
  lobby: LobbySnapshot;
  controller: LobbyController;
  isHost: boolean;
  onExpire?: () => void;
}) {
  const count = useStartCountdown(lobby, onExpire);
  const stopRef = React.useRef<HTMLButtonElement>(null);
  const start = lobby.start;
  if (!start || !count) return null;
  const stopping = controller.pending === "stop";
  const stop = () => { void controller.stop(start.token); };
  const auto = start.kind === "auto";
  const note = auto ? "Every seat is filled and ready, so auto-start is counting down." : "The host started the draft.";
  // Screen readers hear one line when the countdown starts and then the last three seconds, not every tick.
  const spoken = !count.expired && count.seconds <= 3 ? String(count.seconds) : "Draft is starting.";
  const live = <span className="sr-only" role="status" aria-live="polite">{spoken}</span>;

  // A guest has nothing to press, so the page stays theirs: a banner at the top, not a dialog that takes focus.
  if (!isHost) {
    return (
      <SheetPortal>
        <div
          data-start-banner=""
          data-kind={start.kind}
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            translate: "-50% 0",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            gap: 12,
            maxWidth: "min(92vw, 520px)",
            padding: "10px 16px",
            border: "1px solid var(--rule)",
            borderRadius: 12,
            background: "var(--panel-2)",
            boxShadow: "0 12px 30px rgb(0 0 0 / 0.5)",
            color: "var(--ink)",
          }}
        >
          <span aria-hidden="true" style={{ font: "600 26px/1 var(--f-num)", fontVariantNumeric: "tabular-nums", minWidth: 28, textAlign: "center" }}>{count.seconds}</span>
          <span style={{ display: "grid", gap: 2 }}>
            <strong aria-hidden="true" style={{ font: "600 16px/1.2 var(--f-display)" }}>{count.expired ? "Starting now" : `Starting in ${count.seconds} s`}</strong>
            <span style={{ color: "var(--ink-3)", fontSize: 13.5, lineHeight: 1.4 }}>{note} Only the host can stop it.</span>
          </span>
          {live}
        </div>
      </SheetPortal>
    );
  }

  return (
    <LobbyDialog label="Draft starting" initialFocusRef={stopRef} onClose={stop}>
      <div className={styles.startBox} data-kind={start.kind}>
        <div className={styles.gring} aria-hidden="true">
          <svg viewBox="0 0 108 108">
            <circle className={styles.gringTrack} cx="54" cy="54" r={RING_RADIUS} />
            <circle
              className={styles.gringFill}
              cx="54"
              cy="54"
              r={RING_RADIUS}
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={RING_LENGTH * (1 - count.fraction)}
            />
          </svg>
          <span className={styles.gringNum}>{count.seconds}</span>
        </div>
        <h2 className={styles.startTitle} aria-busy={count.expired || undefined}>
          {count.expired ? "Starting now" : `Starting in ${count.seconds} s`}
        </h2>
        {live}
        <p className={styles.startNote}>{note}</p>
        {controller.error && (
          <div role="alert"><StatusLine tone="block">{controller.error}</StatusLine></div>
        )}
        <button ref={stopRef} type="button" className={svButtonClass("danger", { big: true, wide: true })} disabled={stopping} aria-busy={stopping || undefined} onClick={stop}>
          Stop
        </button>
        <p className={styles.startFoot}>
          Esc stops too.{auto ? " Stopping holds auto-start until you resume it." : ""}
        </p>
      </div>
    </LobbyDialog>
  );
}

/* ---------- not-ready confirm ---------- */

function NotReadyConfirm({
  names,
  unclaimedNames,
  busy,
  onWait,
  onForce,
}: {
  names: string[];
  unclaimedNames: string[];
  busy: boolean;
  onWait: () => void;
  onForce: () => void;
}) {
  const waitRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  return (
    <LobbyDialog labelledBy={titleId} initialFocusRef={waitRef} onClose={onWait} dismissOnBackdrop>
      <div className={styles.confirm}>
        <h2 className={styles.confirmT} id={titleId}>Not everyone is ready</h2>
        <p className={styles.confirmP}>
          {names.length > 0 ? `${nameList(names)} ${names.length === 1 ? "is" : "are"} not ready.` : "Some players are not ready."}
          {" "}Starting now takes them along as they are.
        </p>
        {unclaimedNames.length > 0 && (
          <p className={styles.confirmP}>
            {nameList(unclaimedNames)} {unclaimedNames.length === 1 ? "has" : "have"} not claimed a theme and will get a random one.
          </p>
        )}
        <div className={styles.confirmActs}>
          <button ref={waitRef} type="button" className={svButtonClass("ghost")} onClick={onWait}>Wait for them</button>
          <button type="button" className={svButtonClass("danger")} disabled={busy} aria-busy={busy || undefined} onClick={onForce}>Start anyway</button>
        </div>
      </div>
    </LobbyDialog>
  );
}

/* ---------- actions ---------- */

export function LobbyFeedback({ controller, className }: { controller: LobbyController; className?: string }) {
  if (!controller.error && !controller.notice) return null;
  return (
    <div className={className}>
      {controller.error && (
        <div role="alert"><StatusLine tone="block">{controller.error}</StatusLine></div>
      )}
      {!controller.error && controller.notice && (
        <div role="status"><StatusLine tone="ready">{controller.notice}</StatusLine></div>
      )}
    </div>
  );
}

export interface LobbyActionsProps {
  lobby: LobbySnapshot;
  players: LobbyPlayer[];
  controller: LobbyController;
  isHost: boolean;
  /** The viewer holds a seat. */
  isMember: boolean;
  /** The server sent a lobby. Without it there is no Ready, no seat target, no auto-start and Start goes to `onLegacyStart`. */
  hasLobby?: boolean;
  /** Join stays with the page (it also reloads the draft). */
  onJoin?: () => Promise<void>;
  /** Manual start for a server that sends no lobby. */
  onLegacyStart?: () => Promise<void>;
  /** An extra reason Start can't be used, for example a theme seat with no claim. It replaces the default reason. */
  blocker?: string | null;
  /** The refetch the start box asks for when the deadline has passed. */
  onExpire?: () => void;
  className?: string;
}

/**
 * The action column of the lobby: Join for a guest, Ready for a player, Start for the host (with the not-ready
 * confirm), and the start box (a clock for everyone, Stop for the host). Pass the same controller to `SeatControls` and
 * `LobbyAutoStart`. A press never starts the draft by timer; Start on the server begins a server-side countdown.
 */
export function LobbyActions({ lobby, players, controller, isHost, isMember, hasLobby = true, onJoin, onLegacyStart, blocker, onExpire, className }: LobbyActionsProps) {
  const [confirm, setConfirm] = React.useState<{ notReadyPlayerIds: number[]; unclaimedPlayerIds: number[] } | null>(null);
  const me = players.find((p) => p.isYou);
  const starting = lobby.start !== null;
  const busy = controller.pending !== null;
  const targetSeats = lobby.targetSeats;
  const full = targetSeats !== null && lobby.joined >= targetSeats;
  const reason = blocker !== undefined && blocker !== null ? blocker : lobbyStartBlocker({ joined: lobby.joined, errors: lobby.errors });
  const nameOf = (id: number) => players.find((p) => p.playerId === id)?.displayName ?? "A player";
  const reasonId = React.useId();

  const press = async () => {
    if (!hasLobby) {
      if (onLegacyStart) await controller.run("start", onLegacyStart, "Failed to start draft");
      return;
    }
    // The host's own mark does not hold the start back: pressing Start is the host's go.
    const missing = notReadyPlayers(players).filter((p) => !(p.isHost && p.isYou));
    if (missing.length > 0) {
      setConfirm({ notReadyPlayerIds: missing.map((p) => p.playerId), unclaimedPlayerIds: [] });
      return;
    }
    const outcome = await controller.start();
    if (outcome.status === "not-ready") setConfirm({ notReadyPlayerIds: outcome.notReadyPlayerIds, unclaimedPlayerIds: outcome.unclaimedPlayerIds });
  };
  const force = async () => {
    await controller.start({ force: true });
    setConfirm(null);
  };

  let body: React.ReactNode;
  if (!isMember && !isHost) {
    body = (
      <>
        <SvButton variant="primary" big wide disabled={full || (busy && controller.pending !== "join")} aria-busy={controller.pending === "join" || undefined} onClick={() => onJoin && void controller.run("join", onJoin, "Failed to join draft")}>
          <UserPlus size={18} aria-hidden="true" />Join draft
        </SvButton>
        <p className={styles.gonote}>{full ? "Every seat is taken." : "Take a seat to draft with the group."}</p>
      </>
    );
  } else if (isHost) {
    body = (
      <>
        <SvButton
          variant="primary"
          big
          wide
          className={styles.startBtn}
          disabled={reason !== null || starting || (busy && controller.pending !== "start")}
          aria-busy={controller.pending === "start" || starting || undefined}
          aria-describedby={reasonId}
          onClick={() => void press()}
        >
          {starting ? "Starting…" : "Start draft"}
        </SvButton>
        <p className={styles.gonote} id={reasonId}>
          {reason ?? (hasLobby ? lobbyStartLine({ joined: lobby.joined, targetSeats }) : `Starts with ${plural(lobby.joined, "player")}. Nobody can join after this.`)}
        </p>
        {hasLobby && me && <ReadyToggle me={me} controller={controller} compact />}
        {!isMember && onJoin && !full && (
          <SvButton variant="ghost" wide disabled={busy && controller.pending !== "join"} aria-busy={controller.pending === "join" || undefined} onClick={() => void controller.run("join", onJoin, "Failed to join draft")}>
            <UserPlus size={16} aria-hidden="true" />Take a seat
          </SvButton>
        )}
      </>
    );
  } else {
    body = (
      <>
        {hasLobby && me ? (
          <ReadyToggle me={me} controller={controller} />
        ) : null}
        <p className={styles.gonote}>
          {me?.ready ? "You're ready. The host starts when everyone is." : "Waiting for the host to start. Press ready when you are set."}
        </p>
      </>
    );
  }

  const unclaimedNames = confirm ? confirm.unclaimedPlayerIds.map(nameOf) : [];
  return (
    <BugFabLift className={cn(styles.go, className)}>
      {body}
      {lobby.lastStartError && !starting && (
        <div role="status"><StatusLine tone="warn">The last start failed: {lobby.lastStartError}</StatusLine></div>
      )}
      <LobbyFeedback controller={controller} />
      {confirm && !starting && (
        <NotReadyConfirm
          names={confirm.notReadyPlayerIds.map(nameOf)}
          unclaimedNames={unclaimedNames}
          busy={controller.pending === "start"}
          onWait={() => setConfirm(null)}
          onForce={() => void force()}
        />
      )}
      {starting && <LobbyStartBox lobby={lobby} controller={controller} isHost={isHost} onExpire={onExpire} />}
    </BugFabLift>
  );
}

function ReadyToggle({ me, controller, compact = false }: { me: LobbyPlayer; controller: LobbyController; compact?: boolean }) {
  const pending = controller.pending === "ready";
  return (
    <SvButton
      variant={me.ready ? "ghost" : compact ? "ghost" : "primary"}
      big={!compact}
      wide
      className={styles.readyBtn}
      aria-pressed={me.ready}
      aria-busy={pending || undefined}
      disabled={controller.pending !== null && !pending}
      onClick={() => void controller.ready(!me.ready)}
      data-ready={me.ready ? "true" : undefined}
    >
      {me.ready && <Check size={18} aria-hidden="true" />}I&apos;m ready
    </SvButton>
  );
}

/* ---------- auto-start ---------- */

function autoStartLine(lobby: LobbySnapshot, isHost: boolean): string {
  const { autoStart, targetSeats } = lobby;
  if (!autoStart.enabled) return isHost ? "Off. You start the draft yourself." : "Off. The host starts the draft.";
  if (autoStart.held) return "Held. It waits until the host resumes it.";
  if (targetSeats !== null && lobby.joined < targetSeats) {
    return `Waiting for ${plural(targetSeats - lobby.joined, "more player")}. Then ${AUTO_START_SECONDS} s after everyone is ready.`;
  }
  if (!lobby.allReady) return `Starts ${AUTO_START_SECONDS} s after everyone is ready.`;
  if (lobby.errors.length > 0) return "Fix the problems first. Then it starts.";
  return "Starting soon.";
}

/** The auto-start row: a switch for the host, Hold and Resume, and one line saying what it waits for. Nothing for a lobby with no seat target. */
export function LobbyAutoStart({ lobby, controller, isHost, className }: { lobby: LobbySnapshot; controller: LobbyController; isHost: boolean; className?: string }) {
  const labelId = React.useId();
  if (lobby.targetSeats === null) return null;
  const { enabled, held } = lobby.autoStart;
  const pending = controller.pending === "auto";
  return (
    <div className={cn(styles.auto, className)} data-on={enabled ? "true" : undefined} data-held={held ? "true" : undefined}>
      <div className={styles.autoText}>
        <span className={styles.autoT} id={labelId}>Auto-start</span>
        <span className={styles.autoNote}>{autoStartLine(lobby, isHost)}</span>
      </div>
      {isHost && (
        <div className={styles.autoActs}>
          {enabled && held && (
            <SvButton variant="ghost" disabled={controller.pending !== null && !pending} aria-busy={pending || undefined} onClick={() => void controller.setAutoStart({ enabled: true, held: false })}>
              Resume
            </SvButton>
          )}
          {enabled && !held && (
            <SvButton variant="quiet" disabled={controller.pending !== null && !pending} aria-busy={pending || undefined} onClick={() => void controller.setAutoStart({ enabled: true, held: true })}>
              Hold
            </SvButton>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-labelledby={labelId}
            className={styles.sw}
            disabled={controller.pending !== null && !pending}
            aria-busy={pending || undefined}
            onClick={() => void controller.setAutoStart({ enabled: !enabled })}
          >
            <i aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- seat controls ---------- */

/**
 * The small buttons on a seat. You get Leave on your own seat. The host gets Nudge (a Discord reminder, not for bots or
 * ready players) and Remove (two presses) on the other seats. Everything waits while a start is running.
 */
export function SeatControls({ player, lobby, controller, isHost, discordEnabled = true, className }: { player: LobbyPlayer; lobby: LobbySnapshot; controller: LobbyController; isHost: boolean; /** The Discord bot is on. When false there is no Nudge. */ discordEnabled?: boolean; className?: string }) {
  const [armed, setArmed] = React.useState(false);
  const locked = lobby.start !== null;
  const key = (prefix: string) => `${prefix}:${player.playerId}`;
  const busy = controller.pending !== null;
  const disabledFor = (own: string) => locked || (busy && controller.pending !== own);

  if (player.isYou) {
    return (
      <div className={cn(styles.seatActs, className)}>
        <SvButton variant="quiet" className={styles.seatBtn} disabled={disabledFor("leave")} aria-busy={controller.pending === "leave" || undefined} onClick={() => void controller.leave()}>
          <LogOut size={15} aria-hidden="true" />Leave
        </SvButton>
      </div>
    );
  }
  if (!isHost) return null;

  const wait = controller.nudgeWait;
  const canNudge = discordEnabled && !player.isBot && !player.ready;
  return (
    <div className={cn(styles.seatActs, className)}>
      {canNudge && (
        <SvButton
          variant="quiet"
          className={styles.seatBtn}
          disabled={disabledFor(key("nudge")) || wait > 0}
          aria-busy={controller.pending === key("nudge") || undefined}
          aria-label={wait > 0 ? `Nudge ${player.displayName} (wait ${wait} s)` : `Nudge ${player.displayName}`}
          onClick={() => void controller.nudge(player.playerId)}
        >
          {wait > 0 ? `${wait} s` : "Nudge"}
        </SvButton>
      )}
      <SvButton
        variant={armed ? "danger" : "quiet"}
        className={styles.seatBtn}
        disabled={disabledFor(key("remove"))}
        aria-busy={controller.pending === key("remove") || undefined}
        aria-label={armed ? `Confirm remove ${player.displayName}` : `Remove ${player.displayName}`}
        onBlur={() => setArmed(false)}
        onClick={() => {
          if (!armed) { setArmed(true); return; }
          setArmed(false);
          void controller.remove(player.playerId);
        }}
      >
        {armed ? "Remove?" : "Remove"}
      </SvButton>
    </div>
  );
}
