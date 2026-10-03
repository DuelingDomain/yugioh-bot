"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { LivePill, RankGem } from "@/components/sheet";
import { SECTION_IDS, type CrosstableProps } from "../sheet-contracts";
import { goToMatch } from "../standings/crosstable";
import { buildBracket, currentBracketRound, type BracketRound, type BracketSide, type BracketSlot } from "./bracket-model";

function Side({ side, ratings, state, score, viewerId }: { side: BracketSide | null; ratings: CrosstableProps["ratings"]; state: BracketSlot["state"]; score: boolean; viewerId: number | null }) {
  if (!side) return null;
  if (side.kind === "from") {
    return <div className="bx-p tbd"><RankGem tier="none" /><span className="t">{side.label}</span><span className="sc" /></div>;
  }
  const cls = side.won === true ? " win" : side.won === false ? " lose" : "";
  return (
    <div className={`bx-p${cls}`}>
      {side.seed !== null && <span className="sd">{side.seed}</span>}
      <RankGem tier={ratings.get(side.playerId)?.rank ?? "none"} />
      <span className="t">{side.name}{side.playerId === viewerId && <> <span className="youtag">you</span></>}</span>
      <span className="sc" data-state={state}>{score && side.score !== null ? side.score : ""}</span>
    </div>
  );
}

function Box({ slot, round, rounds, ratings, viewerId }: { slot: BracketSlot; round: BracketRound; rounds: BracketRound[]; ratings: CrosstableProps["ratings"]; viewerId: number | null }) {
  const match = slot.match;
  const mine = viewerId !== null && match !== null && (match.playerOneId === viewerId || match.playerTwoId === viewerId);
  const showScore = slot.state === "done" || slot.state === "live";
  const previous = rounds[round.number - 2];
  const dataS = slot.state === "open" ? (mine ? "you" : undefined) : slot.state;
  return (
    <div className={`bx${seededClass(slot)}${slot.state === "live" ? " lv" : ""}`} data-s={dataS} data-testid={match ? `bracket-match-${match.id}` : undefined}>
      <Side side={slot.a} ratings={ratings} state={slot.state} score={showScore} viewerId={viewerId} />
      {slot.bye ? <div className="bx-st">Bye · goes straight through</div> : <Side side={slot.b} ratings={ratings} state={slot.state} score={showScore} viewerId={viewerId} />}
      {slot.state === "live" && match && (
        <div className="bx-st">
          <LivePill />Game {match.series?.gameNumber}
          {match.series?.currentDuelSlug && <Link className="link" href={`/duels/${match.series.currentDuelSlug}`}>{mine ? "Open duel" : "Watch"}</Link>}
        </div>
      )}
      {slot.state === "wait" && <div className="bx-st">Reported, waiting to be confirmed</div>}
      {slot.state === "open" && match && <div className="bx-st">Not started<button type="button" className="link" onClick={() => goToMatch(match.id)}>Go to match</button></div>}
      {slot.state === "tbd" && <div className="bx-st"><Clock className="ic sm" aria-hidden="true" />Paired when the {previous ? previous.singular : "round"} ends</div>}
    </div>
  );
}

function seededClass(slot: BracketSlot) {
  return slot.a.kind === "player" && slot.a.seed !== null ? " seeded" : "";
}

function roundNote(round: BracketRound) {
  return round.paired ? `${round.done} of ${round.slots.length} done` : "not paired yet";
}

export function Bracket({ tournament, currentUserPlayerId, ratings, narrow = false }: CrosstableProps & { narrow?: boolean }) {
  const rounds = buildBracket(tournament);
  const [picked, setPicked] = useState<number | null>(null);
  if (rounds.length === 0) {
    return <section id={SECTION_IDS.standings} aria-label="Bracket"><div className="sec-h"><h2 className="sec-t">Bracket</h2></div><p className="small">No players yet.</p></section>;
  }
  const active = picked ?? currentBracketRound(rounds);
  const visible = narrow ? rounds.filter((round) => round.number === active) : rounds;
  const columns = rounds.length;
  const box = (slot: BracketSlot, round: BracketRound) => <Box key={slot.index} slot={slot} round={round} rounds={rounds} ratings={ratings} viewerId={currentUserPlayerId} />;

  return (
    <section id={SECTION_IDS.standings} aria-label="Bracket">
      <div className="sec-h">
        <h2 className="sec-t">Bracket</h2>
        {!narrow && <span className="sec-aux">Join order seeds round 1: first plays last</span>}
      </div>
      {narrow && (
        <div className="seg rsw" role="tablist" aria-label="Round">
          {rounds.map((round) => (
            <button key={round.number} type="button" role="tab" aria-selected={round.number === active} aria-pressed={round.number === active} onClick={() => setPicked(round.number)}>{round.short}</button>
          ))}
        </div>
      )}
      <div className={`br-wrap${narrow ? " switch" : ""}`}>
        <div className="br" style={narrow ? undefined : { gridTemplateColumns: `repeat(${columns}, minmax(212px, 1fr))`, minWidth: columns * 212 + (columns - 1) * 40 }}>
          {visible.map((round) => (
            <div key={round.number} className="br-col on" aria-label={round.name} role="group">
              <div className="br-h">{round.name}<small>{roundNote(round)}</small></div>
              <div className="br-body" style={narrow ? { gap: 10 } : undefined}>
                {narrow
                  ? round.groups.map((group, g) => (
                    <div key={g} className="stack-group" style={{ display: "grid", gap: 10 }}>
                      {group.map((slot, i) => (
                        <div key={slot.index} style={{ display: "contents" }}>
                          {box(slot, round)}
                          {i === 0 && group.length === 2 && round.number < rounds.length && <p className="feed">Winner plays the other {round.singular}&apos;s winner</p>}
                        </div>
                      ))}
                    </div>
                  ))
                  : round.groups.map((group, g) => (
                    <div key={g} className="pair">{group.map((slot) => <div key={slot.index} className="slot">{box(slot, round)}</div>)}</div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
