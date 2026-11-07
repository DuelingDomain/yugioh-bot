"use client";

import { useState } from "react";
import useSWR from "swr";
import { MatchButton, MatchError } from "../matches/match-controls";
import { isByeMatch } from "../floor/floor-model";
import type { Match, TournamentDetail } from "../types";
import {
  REMOTE_NOTE_MAX, SOURCE_TEXT, END_TEXT, choiceText, detectionLine, evidenceFromRow, evidenceUrl, resultUrl, when,
  type RemoteEvidence, type RemoteEvidenceRow, type RemoteResult,
} from "./remote-result-model";
import styles from "./remote-disputes.module.css";

export type Entry = { match: Match; result: RemoteResult };

/** A slot that is not finished can hold a disputed or proposed Remote result. */
const openMatches = (tournament: TournamentDetail) => tournament.matches.filter(match => !isByeMatch(match) && match.status !== "completed" && match.playerTwoId !== null);

async function readResult(tournamentSlug: string, match: Match): Promise<Entry | null> {
  try {
    const response = await fetch(resultUrl(tournamentSlug, match.id), { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json() as { remoteResult: RemoteResult | null };
    return body.remoteResult && (body.remoteResult.status === "disputed" || body.remoteResult.status === "proposed") ? { match, result: body.remoteResult } : null;
  } catch { return null; }
}

/** Host tools section of a Remote tournament: the disputed matches first, then the proposals the players have not settled. */
export function RemoteDisputes({ tournament, tournamentSlug, onChanged }: { tournament: TournamentDetail; tournamentSlug: string; onChanged: () => void }) {
  const open = openMatches(tournament);
  const { data, mutate, isLoading } = useSWR(open.length ? ["remote-disputes", tournamentSlug, open.map(match => `${match.id}:${match.status}`).join()] : null,
    async () => (await Promise.all(open.map(match => readResult(tournamentSlug, match)))).filter((entry): entry is Entry => entry !== null),
    { refreshInterval: 20_000 });
  const entries = [...(data ?? [])].sort((a, b) => Number(b.result.status === "disputed") - Number(a.result.status === "disputed") || a.match.roundNumber - b.match.roundNumber);
  if (isLoading && !data) return <p className={styles.quiet} role="status">Checking Remote results…</p>;
  if (entries.length === 0) return <p className={styles.quiet} data-testid="remote-disputes-empty">No disputed Remote matches.</p>;
  return <div className={styles.list} data-testid="remote-disputes">
    {entries.map(entry => <DisputeRow key={entry.match.id} entry={entry} tournamentSlug={tournamentSlug} onDone={() => { void mutate(); onChanged(); }} />)}
  </div>;
}

export function DisputeRow({ entry, tournamentSlug, onDone, evidenceOverride }: { entry: Entry; tournamentSlug: string; onDone: () => void; evidenceOverride?: RemoteEvidence | null }) {
  const { match, result } = entry;
  const [open, setOpen] = useState(result.status === "disputed");
  const names = { one: match.playerOneName, two: match.playerTwoName ?? "Player 2" };
  const disputer = result.reports.find(report => report.choice === "dispute");
  const who = disputer ? (disputer.playerId === match.playerOneId ? names.one : names.two) : null;
  const id = `remote-dispute-${match.id}`;
  return <article className={styles.row} data-status={result.status} data-testid={`remote-dispute-${match.id}`}>
    <button type="button" className={styles.head} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <span className={styles.round}>Round {match.roundNumber}</span>
      <span className={styles.pair}>{names.one} <i>vs</i> {names.two}</span>
      <span className={styles.chip} data-status={result.status}>{result.status === "disputed" ? (who ? `Disputed by ${who}` : "Disputed") : "Waiting for players"}</span>
    </button>
    {open ? <div id={id} className={styles.body}>
      <DisputePanel match={match} result={result} tournamentSlug={tournamentSlug} onDone={onDone} evidenceOverride={evidenceOverride} />
    </div> : null}
  </article>;
}

/** Everything the organizer needs on one screen: both reports, the evidence summary and the three actions. */
export function DisputePanel({ match, result, tournamentSlug, onDone, evidenceOverride }: {
  match: Match; result: RemoteResult; tournamentSlug: string; onDone: () => void;
  /** Dev preview only: the evidence to show instead of the read. */
  evidenceOverride?: RemoteEvidence | null;
}) {
  const names = new Map<number, string>([[match.playerOneId, match.playerOneName]]);
  if (match.playerTwoId !== null) names.set(match.playerTwoId, match.playerTwoName ?? "Player 2");
  const name = (playerId: number | null) => (playerId === null ? "No winner" : names.get(playerId) ?? `Player ${playerId}`);
  const evidence = useEvidence(tournamentSlug, match, evidenceOverride);
  const winnerName = result.winnerPlayerId === null ? null : name(result.winnerPlayerId);
  const score = result.score ? `${result.score.playerOne} to ${result.score.playerTwo}` : null;
  return <div className={styles.panel}>
    <p className={styles.claim} data-testid="dispute-claim">
      {winnerName ? <><b>{winnerName}</b> was proposed as the winner{score ? `, ${score}` : ""}{result.source ? `, by ${SOURCE_TEXT[result.source]}` : ""}.</> : "No winner was proposed."}
      {result.proposedAt ? <span> {when(result.proposedAt)}</span> : null}
    </p>
    <section aria-label="Player choices">
      <h4 className={styles.h}>What each player said</h4>
      <ul className={styles.reports}>
        {[match.playerOneId, match.playerTwoId].filter((id): id is number => id !== null).map(id => {
          const report = result.reports.find(item => item.playerId === id);
          return <li key={id} data-choice={report?.choice ?? "none"} data-testid={`dispute-report-${id}`}>
            <span className={styles.who}>{name(id)}</span>
            <span className={styles.choice}>{choiceText(report)}{report?.at ? <small> {when(report.at)}</small> : null}</span>
            {report?.note ? <q className={styles.note}>{report.note}</q> : null}
          </li>;
        })}
      </ul>
    </section>
    <EvidenceView state={evidence} />
    {result.status === "disputed" ? <Rulings match={match} tournamentSlug={tournamentSlug} onDone={onDone} /> : <p className={styles.quiet}>The players can still confirm. The organizer can rule once someone disputes.</p>}
  </div>;
}

type EvidenceState = { status: "loading" } | { status: "none" } | { status: "ready"; evidence: RemoteEvidence };
function useEvidence(tournamentSlug: string, match: Match, override?: RemoteEvidence | null): EvidenceState {
  const names = { playerOne: match.playerOneName, playerTwo: match.playerTwoName ?? "Player 2" };
  const { data, isLoading } = useSWR(override !== undefined ? null : ["remote-evidence", tournamentSlug, match.id], async (): Promise<RemoteEvidence | null> => {
    try {
      // 404 means no copy exists (never finished, or removed after its time).
      const response = await fetch(evidenceUrl(tournamentSlug, match.id), { cache: "no-store" });
      if (!response.ok) return null;
      const row = (await response.json() as { evidence: RemoteEvidenceRow | null }).evidence;
      return row ? evidenceFromRow(row, names) : null;
    } catch { return null; }
  });
  if (override !== undefined) return override ? { status: "ready", evidence: override } : { status: "none" };
  if (isLoading) return { status: "loading" };
  return data ? { status: "ready", evidence: data } : { status: "none" };
}

function EvidenceView({ state }: { state: EvidenceState }) {
  const [all, setAll] = useState(false);
  if (state.status === "loading") return <p className={styles.quiet} role="status">Loading the match record…</p>;
  if (state.status === "none") return <p className={styles.quiet} data-testid="evidence-none">No match record is stored. It is removed after a short time, or the table never finished. Ask the players.</p>;
  const { evidence } = state;
  const bySeat = new Map(evidence.players.map(player => [player.seat, player.displayName]));
  const seatName = (seat: number | null) => seat === null ? "No one" : bySeat.get(seat) ?? `Seat ${seat + 1}`;
  const events = all ? evidence.resultEvents : evidence.resultEvents.slice(-6);
  return <>
    <section aria-label="Games">
      <h4 className={styles.h}>Games{evidence.endReason ? <small> · {END_TEXT[evidence.endReason] ?? evidence.endReason}</small> : null}</h4>
      <table className={styles.games}>
        <thead><tr><th scope="col">Game</th><th scope="col">Winner</th><th scope="col">How</th><th scope="col">Final LP</th></tr></thead>
        <tbody>{evidence.games.map(game => {
          const lp = evidence.finalLp.find(item => item.game === game.number)?.lp ?? [];
          return <tr key={game.number}>
            <td>{game.number}</td><td>{seatName(game.winnerSeat)}</td><td>{END_TEXT[game.reason] ?? game.reason}</td>
            <td className={styles.num}>{lp.map(item => `${seatName(item.seat)} ${item.lp}`).join(" · ")}</td>
          </tr>;
        })}</tbody>
      </table>
    </section>
    <section aria-label="Result events">
      <h4 className={styles.h}>Result events</h4>
      {evidence.resultEvents.length === 0 ? <p className={styles.quiet}>No result events.</p> : <>
        <ol className={styles.events}>{events.map(event => <li key={event.seq}><time>{when(event.at)}</time><span>{event.seat !== null ? `${seatName(event.seat)}: ` : ""}{event.detail}</span></li>)}</ol>
        {evidence.resultEvents.length > 6 ? <button type="button" className={styles.link} onClick={() => setAll(!all)}>{all ? "Show the last 6" : `Show all ${evidence.resultEvents.length}`}</button> : null}
      </>}
    </section>
    {evidence.publicBoard ? <section aria-label="Last public board">
      <h4 className={styles.h}>Last board in the final game</h4>
      <div className={styles.boards}>{evidence.publicBoard.map(board => <dl key={board.seat} className={styles.board}>
        <dt className={styles.boardName}>{seatName(board.seat)}</dt>
        <dd><span>Monsters</span>{board.monsters.join(", ") || "None"}</dd>
        <dd><span>Spell/Trap</span>{board.spellTraps.join(", ") || "None"}</dd>
        <dd><span>Graveyard</span>{board.graveyard.join(", ") || "None"}</dd>
        <dd><span>Banished</span>{board.banished.join(", ") || "None"}</dd>
      </dl>)}</div>
    </section> : null}
    <section aria-label="Detection summary">
      <h4 className={styles.h}>Card detection</h4>
      <ul className={styles.detect}>{evidence.detectionSummary.map(item => <li key={item.seat}>{detectionLine(item, seatName(item.seat))}</li>)}</ul>
      <p className={styles.quiet}>This shows how complete the board record is. It does not decide the winner. Tap and Auto-detect can both miss or misread a card.</p>
    </section>
    <p className={styles.fine}>{`Match record kept until ${evidence.hardDeleteAt ? when(evidence.hardDeleteAt) : "the ruling plus 48 hours"} at most.`}</p>
  </>;
}

type Pending = { kind: "win"; playerId: number } | { kind: "void" } | null;

/** Give the win to either player or void the match. Each action asks once more before it sends. */
function Rulings({ match, tournamentSlug, onDone }: { match: Match; tournamentSlug: string; onDone: () => void }) {
  const [pending, setPending] = useState<Pending>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const two = match.playerTwoId;
  async function send(url: string, body: object, fallback: string, ok: string) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { const data = await response.json().catch(() => null) as { error?: unknown } | null; setError(typeof data?.error === "string" ? data.error : fallback); return; }
      setPending(null); setDone(ok); onDone();
    } catch { setError(fallback); } finally { setBusy(false); }
  }
  const root = `/api/tournaments/${tournamentSlug}/matches/${match.id}`;
  const confirm = () => {
    if (!pending) return;
    if (pending.kind === "win") void send(`${root}/result`, { winnerPlayerId: pending.playerId }, "Could not set the result", "Result set.");
    else void send(`${root}/remote-result/void`, note.trim() ? { note: note.trim() } : {}, "Could not void the match", "Match voided. The slot is open again.");
  };
  if (done) return <p className={styles.done} role="status" data-testid="dispute-done">{done}</p>;
  const label = pending?.kind === "win" ? `Give the win to ${pending.playerId === match.playerOneId ? match.playerOneName : match.playerTwoName}?` : "Void this match and let the players play it again?";
  return <section aria-label="Organizer ruling" className={styles.rule}>
    <h4 className={styles.h}>Your ruling</h4>
    {pending ? <div className={styles.ask} role="group" aria-label={label}>
      <p className={styles.askText}>{label}</p>
      {pending.kind === "void" ? <label className={styles.noteBox}><span>Note for the players (optional)</span>
        <textarea value={note} maxLength={REMOTE_NOTE_MAX} rows={2} onChange={event => setNote(event.target.value)} placeholder="Replay required" /><small>{note.length}/{REMOTE_NOTE_MAX}</small></label> : null}
      <div className={styles.acts}>
        <MatchButton variant="quiet" small disabled={busy} onClick={() => { setPending(null); setError(null); }}>Back</MatchButton>
        <MatchButton variant={pending.kind === "void" ? "danger" : "primary"} small disabled={busy} onClick={confirm} data-testid="dispute-confirm">{pending.kind === "void" ? "Void match" : "Set result"}</MatchButton>
      </div>
    </div> : <div className={styles.acts}>
      <MatchButton variant="secondary" small onClick={() => setPending({ kind: "win", playerId: match.playerOneId })} data-testid="dispute-win-one">Win to {match.playerOneName}</MatchButton>
      {two !== null ? <MatchButton variant="secondary" small onClick={() => setPending({ kind: "win", playerId: two })} data-testid="dispute-win-two">Win to {match.playerTwoName}</MatchButton> : null}
      <MatchButton variant="quiet" small onClick={() => setPending({ kind: "void" })} data-testid="dispute-void">Void and replay</MatchButton>
    </div>}
    <MatchError error={error} />
  </section>;
}
