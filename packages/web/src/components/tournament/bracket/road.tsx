"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { Mono, SectionHead, SvButton, ringColour } from "@/components/sheet";
import { focusDuelWindowOnClick } from "@/components/duel/duel-window";
import { SECTION_IDS, type CrosstableProps } from "../sheet-contracts";
import { goToMatch } from "../standings/crosstable";
import { nameList } from "../floor/floor-model";
import { buildBracket, type BracketRound, type BracketSide, type BracketSlot } from "./bracket-model";
import styles from "./road.module.css";

function SideRow({ side, viewerId, showScore }: { side: BracketSide | null; viewerId: number | null; showScore: boolean }) {
  if (!side) return null;
  if (side.kind === "from") return <li className={styles.cs} data-tbd="true"><span className={styles.tbd}>{side.label}</span></li>;
  return (
    <li className={styles.cs} data-lost={side.won === false ? "true" : undefined}>
      <Mono name={side.name} size="sm" ring={ringColour(side.playerId)} you={side.playerId === viewerId} />
      <span className={styles.csn}>{side.name}</span>
      {showScore && side.score !== null && <span className={styles.csc} data-won={side.won ? "true" : undefined}>{side.score}</span>}
    </li>
  );
}

function Chip({ slot, viewerId }: { slot: BracketSlot; viewerId: number | null }) {
  const match = slot.match;
  const mine = viewerId !== null && match !== null && (match.playerOneId === viewerId || match.playerTwoId === viewerId);
  const showScore = slot.state === "done" || slot.state === "live";
  const duelHref = match?.series?.currentDuelSlug ? `/duels/${match.series.currentDuelSlug}` : null;
  return (
    <li className={styles.chip} data-mine={mine ? "true" : undefined} data-bye={slot.bye ? "true" : undefined} data-testid={match ? `bracket-match-${match.id}` : undefined}>
      <ul className={styles.sides}>
        <SideRow side={slot.a} viewerId={viewerId} showScore={showScore} />
        {slot.bye ? null : <SideRow side={slot.b} viewerId={viewerId} showScore={showScore} />}
      </ul>
      {slot.bye && <p className={styles.byew}>Bye. Goes straight through.</p>}
      {slot.state === "live" && match && (
        <p className={styles.cnote}>
          Game {match.series?.gameNumber} in progress.{" "}
          {duelHref && <Link href={duelHref} onClick={(event) => focusDuelWindowOnClick(duelHref, event)}>{mine ? "Open duel" : "Watch"}</Link>}
        </p>
      )}
      {slot.state === "wait" && <p className={styles.cnote}>Reported, waiting to be confirmed.</p>}
      {slot.state === "open" && match && (
        <p className={styles.cnote}>
          Not started.{" "}
          {mine && <button type="button" onClick={() => goToMatch(match.id)}>Go to your match</button>}
        </p>
      )}
    </li>
  );
}

/** "Semifinals is drawn when Kes and Dara finish." */
function undrawnLine(round: BracketRound, previous: BracketRound | undefined): string {
  if (!previous) return `${round.name} is not drawn yet.`;
  const waiting = previous.slots
    .filter((slot) => slot.state !== "done")
    .flatMap((slot) => [slot.a, slot.b])
    .filter((side): side is Extract<BracketSide, { kind: "player" }> => side !== null && side.kind === "player")
    .map((side) => side.name);
  if (waiting.length === 0 || waiting.length > 4) return `${round.name} is drawn when ${previous.name.toLowerCase()} ends.`;
  return `${round.name} is drawn when ${nameList(waiting)} finish.`;
}

function stopState(round: BracketRound, rounds: BracketRound[]): "done" | "now" | "next" {
  if (round.paired && round.done === round.slots.length) return "done";
  const firstOpen = rounds.find((r) => !(r.paired && r.done === r.slots.length));
  return firstOpen?.number === round.number ? "now" : "next";
}

/** Single elimination, drawn as a road: one stop per round, your own path in violet. */
export function Road({ tournament, currentUserPlayerId, final = false }: CrosstableProps & { final?: boolean }) {
  const rounds = buildBracket(tournament);
  const [whole, setWhole] = useState(false);
  const viewerId = currentUserPlayerId;
  const playing = tournament.isParticipant && viewerId !== null && tournament.status === "active";
  const justMine = playing && !whole;
  const title = final ? "The bracket" : justMine ? "Your road" : "The road";

  if (rounds.length === 0) {
    return (
      <section id={SECTION_IDS.standings} aria-label="Bracket">
        <SectionHead title="The bracket" />
        <p className={styles.empty}>No players yet.</p>
      </section>
    );
  }

  return (
    <section id={SECTION_IDS.standings} aria-label="Bracket" className={styles.road}>
      <span id="players" aria-hidden="true" />
      <SectionHead
        title={title}
        note={final ? undefined : "Join order seeds round 1. First plays last."}
        action={playing ? <SvButton variant="quiet" aria-pressed={whole} onClick={() => setWhole(!whole)}>{whole ? "Show only my road" : "Show the whole bracket"}</SvButton> : undefined}
      />
      <ol className={styles.stops} style={{ "--stops": rounds.length } as CSSProperties}>
        {rounds.map((round, index) => {
          const state = stopState(round, rounds);
          const slots = justMine ? round.slots.filter((slot) => slot.match && viewerId !== null && (slot.match.playerOneId === viewerId || slot.match.playerTwoId === viewerId)) : round.slots;
          const mineHere = round.slots.some((slot) => slot.match && viewerId !== null && (slot.match.playerOneId === viewerId || slot.match.playerTwoId === viewerId));
          return (
            <li key={round.number} className={styles.stop} data-state={state} data-mine={mineHere ? "true" : undefined}>
              <i className={styles.node} aria-hidden="true" />
              <h3 className={styles.stopH}>{round.name}</h3>
              <p className={styles.stopNote}>{round.paired ? `${round.done} of ${round.slots.length} done` : "Not drawn yet"}</p>
              {round.paired ? (
                slots.length > 0 ? <ul className={styles.chips}>{slots.map((slot) => <Chip key={slot.index} slot={slot} viewerId={viewerId} />)}</ul>
                  : <p className={styles.undrawn}>You are not in this round.</p>
              ) : (
                <p className={styles.undrawn}>{undrawnLine(round, rounds[index - 1])}</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
