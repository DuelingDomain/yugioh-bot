"use client";

import { useEffect, useState } from "react";
import type { DuelFirstChoice, DuelOpeningView, DuelRpsOpeningView, DuelRpsMove } from "@yugidraft/shared/duels";
import { DUEL_RPS_MOVES } from "@yugidraft/shared/duels";
import { duelFontClasses } from "./fonts";
import { cx } from "./sheet-ui";
import styles from "./opening.module.css";
import {
  MOVE_LABEL,
  isOpeningPlayer,
  myPickText,
  openingSeats,
  openingStage,
  opponentPickText,
  revealEndsAt,
  revealOutcome,
  startText,
} from "./opening-model";
import { secondsUntil } from "./series-model";

/** Simple original line icons, drawn with the current text color. */
export function MoveIcon({ move, size = 56 }: { move: DuelRpsMove; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 48 48", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round", "aria-hidden": true, focusable: false } as const;
  if (move === "rock") {
    return (
      <svg {...common}>
        <path d="M10 30 14 17l9-6 11 3 5 10-3 11-12 4-11-5Z" />
        <path d="m14 17 9 7 11-10M23 24l-1 15M23 24l13 3" opacity="0.55" />
      </svg>
    );
  }
  if (move === "paper") {
    return (
      <svg {...common}>
        <path d="M12 6h17l8 8v28H12Z" />
        <path d="M29 6v8h8" />
        <path d="M18 23h13M18 30h13M18 37h8" opacity="0.55" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="36" r="5" />
      <circle cx="26" cy="38" r="5" />
      <path d="m15 32 20-22M23 34 14 10" />
    </svg>
  );
}

function Countdown({ iso, label, now }: { iso: string; label: string; now: number }) {
  const seconds = secondsUntil(iso, now);
  if (seconds == null) return null;
  return (
    <p className={styles.countdown} data-testid="opening-countdown">
      {label} <b aria-hidden>{Math.max(0, seconds)}</b><span className={styles.sr}>{Math.max(0, seconds)} seconds</span>
    </p>
  );
}

/** Server time plus monotonic elapsed time; ticks countdowns and ends reveals without a poll. */
function useNow(opening: DuelOpeningView, receivedAt?: number): number | null {
  const [clock, setClock] = useState({ opening, receivedAt, now: opening.serverNow });
  useEffect(() => {
    const serverNow = opening.serverNow ?? Date.now();
    // Browser time already includes the cache age when an older host omits serverNow.
    const at = opening.serverNow == null ? performance.now() : receivedAt ?? performance.now();
    const sample = () => serverNow + (performance.now() - at);
    const update = () => setClock({ opening, receivedAt, now: sample() });
    update();
    if (opening.phase === "start") return undefined;
    const interval = window.setInterval(update, 500);
    const end = "rounds" in opening ? Date.parse(opening.deadlineAt) : revealEndsAt(opening);
    const wait = end - sample();
    const timer = wait > 0 ? window.setTimeout(update, wait + 20) : undefined;
    return () => {
      window.clearInterval(interval);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [opening, receivedAt]);
  return (clock.opening === opening && clock.receivedAt === receivedAt ? clock.now : opening.serverNow) ?? null;
}

/**
 * The opening of a match: rock-paper-scissors, then the winner chooses to go first or second.
 * Picks stay hidden until both are in; the server decides the result and the timeouts.
 */
function RpsOpeningScreen({ opening, receivedAt, mySeat, names, busy = false, error = null, onPick, onChoose }: {
  opening: DuelRpsOpeningView;
  /** Monotonic client time when the room response arrived; retained with cached rooms. */
  receivedAt?: number;
  mySeat: number | null;
  names: [string, string];
  busy?: boolean;
  error?: string | null;
  onPick: (move: DuelRpsMove) => void;
  onChoose: (choice: DuelFirstChoice) => void;
}) {
  const now = useNow(opening, receivedAt);
  if (now == null) return null;
  const stage = openingStage(opening, mySeat, now);
  const player = isOpeningPlayer(mySeat);
  const { me, them } = openingSeats(mySeat);
  const outcome = revealOutcome(opening, mySeat);
  const reveal = opening.reveal;
  const mine = myPickText(opening, mySeat);
  const theirs = opponentPickText(opening, mySeat, names[them]);
  const picked = mySeat != null ? opening.myPick : null;

  let status = "";
  if (stage === "reveal") status = "Tie — again";
  else if (stage === "pick") status = player ? (picked ? `You chose ${MOVE_LABEL[picked]}. ${theirs.text}` : "Choose your move") : "Rock-paper-scissors";
  else if (stage === "choose") status = "You win. Go first or second?";
  else if (stage === "wait-choose") {
    const winner = opening.winnerSeat == null ? "The winner" : names[opening.winnerSeat];
    status = player ? "You lose. Opponent is choosing…" : `${winner} wins. ${winner} is choosing…`;
  }
  else status = startText(opening, mySeat, names);

  return (
    <div className={cx(styles.root, duelFontClasses)} role="dialog" aria-modal="true" aria-labelledby="opening-title" data-testid="opening-screen" data-stage={stage}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <h2 id="opening-title" className={styles.title}>Who goes first?</h2>
          <p className={styles.sub}>{names[0]} vs {names[1]}{opening.round > 1 ? ` · Round ${opening.round}` : ""}</p>
        </header>

        <p className={styles.status} role="status" aria-live="polite" data-testid="opening-status">{status}</p>

        {(stage === "reveal" || stage === "choose" || stage === "wait-choose") && reveal ? (
          <div className={styles.reveal} data-outcome={outcome} data-testid="opening-reveal">
            {([me, them] as const).map((seat, index) => (
              <div key={seat} className={styles.revealCard} data-win={reveal.winnerSeat === seat ? "true" : undefined} data-side={index === 0 ? "me" : "them"}>
                <MoveIcon move={reveal.picks[seat]} size={72} />
                <span>{MOVE_LABEL[reveal.picks[seat]]}</span>
                <small>{mySeat == null ? names[seat] : seat === me ? "You" : "Opponent"}</small>
              </div>
            ))}
          </div>
        ) : null}

        {stage === "pick" ? (
          <>
            {player ? (
              <div className={styles.moves} role="group" aria-label="Choose your move">
                {DUEL_RPS_MOVES.map((move) => (
                  <button key={move} type="button" className={styles.move} aria-pressed={picked === move}
                    disabled={busy || picked != null} onClick={() => onPick(move)} data-testid={`opening-move-${move}`}>
                    <MoveIcon move={move} />
                    <span>{MOVE_LABEL[move]}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className={styles.chips}>
              {mine ? <span className={styles.chip} data-done={mine.done ? "true" : "false"}>{mine.text}</span> : null}
              <span className={styles.chip} data-done={theirs.done ? "true" : "false"} data-testid="opening-opponent">{theirs.text}</span>
            </div>
            <Countdown iso={opening.deadlineAt} label="A random move is made in" now={now} />
          </>
        ) : null}

        {stage === "choose" ? (
          <>
            <div className={styles.orders} role="group" aria-label="Turn order">
              <button type="button" className={styles.order} disabled={busy} onClick={() => onChoose("first")} data-testid="opening-first">
                <b>Go first</b><span>You take the first turn</span>
              </button>
              <button type="button" className={styles.order} disabled={busy} onClick={() => onChoose("second")} data-testid="opening-second">
                <b>Go second</b><span>The opponent takes the first turn</span>
              </button>
            </div>
            <Countdown iso={opening.deadlineAt} label="You go first in" now={now} />
          </>
        ) : null}

        {stage === "wait-choose" ? (
          <Countdown iso={opening.deadlineAt} label="Time left" now={now} />
        ) : null}

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>
    </div>
  );
}


/** Plain server-driven dice text until the final FFA opening screen is ready. */
export function OpeningScreen(props: {
  opening: DuelOpeningView;
  receivedAt?: number;
  mySeat: number | null;
  names: string[];
  busy?: boolean;
  error?: string | null;
  onPick: (move: DuelRpsMove) => void;
  onChoose: (choice: DuelFirstChoice) => void;
}) {
  if (!("rounds" in props.opening)) {
    return <RpsOpeningScreen {...props} opening={props.opening} names={[props.names[0]!, props.names[1]!]} />;
  }
  return <DiceOpeningScreen opening={props.opening} receivedAt={props.receivedAt} names={props.names} error={props.error} />;
}

function DiceOpeningScreen({ opening, receivedAt, names, error }: {
  opening: Extract<DuelOpeningView, { rounds: unknown }>;
  receivedAt?: number;
  names: string[];
  error?: string | null;
}) {
  const now = useNow(opening, receivedAt);
  const round = opening.rounds.at(-1);
  const name = (lobbySeat: number) => {
    const seat = opening.phase === "start" ? opening.finalSeats?.[lobbySeat] ?? lobbySeat : lobbySeat;
    return names[seat] ?? `Player ${lobbySeat + 1}`;
  };
  return (
    <div className={cx(styles.root, duelFontClasses)} role="dialog" aria-modal="true" aria-labelledby="opening-title" data-testid="opening-screen" data-stage={opening.phase}>
      <div className={styles.inner}>
        <h2 id="opening-title" className={styles.title}>Turn order · Round {opening.round}</h2>
        <div role="status" aria-live="polite">
          {round?.rolls.map((roll, lobbySeat) => <p key={lobbySeat}>{name(lobbySeat)}: {roll ?? "No re-roll"}</p>)}
          {opening.order ? <>
            <p>Turn order: {opening.order.map(name).join(" → ")}</p>
            {opening.finalSeats?.map((seat, lobbySeat) => <p key={lobbySeat}>{name(lobbySeat)} → seat {seat + 1}</p>)}
          </> : <p>Tied players roll again.</p>}
        </div>
        {now !== null && opening.phase === "dice" && <Countdown iso={opening.deadlineAt} label={opening.order ? "Duel starts in" : "Re-roll in"} now={now} />}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
