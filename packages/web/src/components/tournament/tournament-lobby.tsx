"use client";

import { useRef, useState } from "react";
import { CopyLinkRow, FloorList, FloorRow, Mono, SectionHead, Seat, StatusLine, SvButton, ringColour } from "@/components/sheet";
import { generateSingleElimFirstRound } from "@yugidraft/shared/tournaments";
import { useFlipList } from "@/lib/motion";
import styles from "./tournament-lobby.module.css";
import { MyDeckPanel } from "./my-deck-panel";
import { DeckMarker } from "./deck-marker";
import { RulesPanel } from "./sheet/rules-panel";
import { formatLabel, rulesSummary } from "./sheet-rules";
import rail from "./sheet/rail.module.css";
import { UNRATED_ELO, type PlayerRatings } from "./sheet-contracts";
import type { TournamentDetail } from "./types";

interface TournamentLobbyProps {
  tournament: TournamentDetail;
  tournamentSlug: string;
  isCreator: boolean;
  currentUserId: number | null;
  onChanged: () => void;
  ratings?: PlayerRatings;
}

/** Matches a round robin makes: every pair once. Single elimination makes n - 1. */
function matchCount(format: string, players: number) {
  return format === "single_elim" ? Math.max(0, players - 1) : (players * (players - 1)) / 2;
}

function roundsOf(format: string, players: number) {
  if (format === "single_elim") {
    let r = 0;
    for (let n = players; n > 1; n = Math.ceil(n / 2)) r += 1;
    return r;
  }
  return players % 2 === 0 ? Math.max(0, players - 1) : players;
}

/** Seats are in join order, which is the order start() hands the engine, so seat numbers stand in for players. */
export function firstRoundNote(players: number) {
  if (players < 2) return "";
  const { byes, pairings } = generateSingleElimFirstRound(Array.from({ length: players }, (_, i) => i + 1));
  const shown = pairings.slice(0, 2).map((p) => `${p.playerOneId} with ${p.playerTwoId}`);
  const list = pairings.length > 2 ? `${shown.join(", ")} and so on` : shown.join(" and ");
  return `${byes.length ? `Seat ${byes[0]} gets a bye. ` : ""}Round 1 pairs ${list}.`;
}

export function TournamentLobby({ tournament, tournamentSlug, isCreator, onChanged, ratings }: TournamentLobbyProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
    const [announced, setAnnounced] = useState(false);

  const isParticipant = tournament.isParticipant;
  const players = tournament.participants;
  // Someone who joins arrives with a short rise; the rest stay put.
  const seatsRef = useRef<HTMLDivElement>(null);
  useFlipList(seatsRef, { enter: true });
  const count = players.length;
  const canStart = count >= 2;
  const single = tournament.format === "single_elim";
  const rules = rulesSummary(tournament);
  const base = `/api/tournaments/${tournamentSlug}`;

  async function call(key: string, url: string, init: RequestInit, fallback: string, after?: () => void) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? fallback);
      }
      after?.();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(null);
    }
  }

  const post = (key: string, path: string, fallback: string, after?: () => void) => call(key, `${base}${path}`, { method: "POST" }, fallback, after);
  const link = typeof window !== "undefined" ? `${window.location.origin}/tournament/${tournamentSlug}` : `/tournament/${tournamentSlug}`;
  const needed = 2 - count;

  const rulesLine = rules ? `${formatLabel(tournament.format)}, best of ${rules.bestOf}` : formatLabel(tournament.format);
  const extra = rules ? rules.line.split(", ").slice(2).join(", ") : "";

  return (
    <div className={styles.lobby}>
      <div className={styles.main}>
        {error && <div role="alert"><StatusLine tone="block">{error}</StatusLine></div>}

        {!isParticipant && (
          <section className={styles.join} aria-label={`Join ${tournament.name}`}>
            <div>
              <h2 className={styles.joinT}>Join {tournament.name}</h2>
              <p className={styles.joinN}>{rulesLine}{extra ? `, ${extra}` : ""}. {count} {count === 1 ? "player" : "players"} so far.</p>
              <p className={styles.note}>You register a deck after joining. You can leave any time before the start.</p>
            </div>
            <SvButton variant="primary" big disabled={busy === "join"} aria-busy={busy === "join"} onClick={() => post("join", "/join", "Failed to join tournament")}>Join tournament</SvButton>
          </section>
        )}

        {isParticipant && !isCreator && (
          <section className={styles.joined}>
            <p className={styles.joinN}>You&apos;re in. Waiting for the organizer to start.</p>
            <SvButton variant="quiet" disabled={busy === "leave"} onClick={() => post("leave", "/leave", "Failed to leave")}>Leave tournament</SvButton>
          </section>
        )}

        <section aria-label={isCreator ? "Invite players" : "Invite link"} className={styles.invite}>
          <SectionHead title={isCreator ? "Invite players" : "Invite link"} note={isCreator ? "Anyone in the server can join." : "Share it so others can join."} />
          <CopyLinkRow value={link} label="Invite link" />
          {isCreator && (
            <p className={styles.note}>Players can also join from Discord with <code className={styles.cmd}>/event join</code>.</p>
          )}
        </section>

        <section aria-labelledby="seats-t" className={styles.seats}>
          <SectionHead title="Who's in" id="seats-t" note={`${count} joined. At least 2 to start. No seat limit.`} />
          <div ref={seatsRef}>
          <FloorList>
            {players.map((p, i) => {
              const you = p.playerId === tournament.currentUserPlayerId;
              const rating = ratings?.get(p.playerId);
              const rated = rating && rating.rating !== UNRATED_ELO;
              return (
                <FloorRow key={p.playerId} flipId={p.playerId} you={you} cols={single ? "28px minmax(0, 1fr) auto auto" : "minmax(0, 1fr) auto auto"} phoneCols={undefined}>
                  {single && <span className={styles.no}>{i + 1}</span>}
                  <span className={styles.who}>
                    <Seat
                      name={p.displayName}
                      href={`/player/${p.playerId}`}
                      you={you}
                      ring={ringColour(p.playerId)}
                      tier={rating?.rank}
                      elo={rated ? rating.rating : undefined}
                      trailing={isCreator && you ? <span className={styles.host}>Host</span> : undefined}
                    />
                  </span>
                  {isCreator ? <DeckMarker participant={p} /> : <span />}
                  {isCreator && !you ? (
                    <SvButton
                      variant="quiet"
                      aria-label={`Remove ${p.displayName}`}
                      disabled={busy === `kick-${p.playerId}`}
                      onClick={() => call(`kick-${p.playerId}`, `${base}/kick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: p.playerId }) }, "Failed to remove")}
                    >
                      Remove
                    </SvButton>
                  ) : <span />}
                </FloorRow>
              );
            })}
            {Array.from({ length: Math.max(0, needed) }).map((_, i) => (
              <FloorRow key={`open-${i}`} cols="minmax(0, 1fr)">
                <span className={styles.open}><Mono name="" dashed size="md" />Open seat. Needed to start.</span>
              </FloorRow>
            ))}
          </FloorList>
          </div>
          {single && count > 1 && <p className={styles.note}>{firstRoundNote(count)}</p>}
          {isParticipant && isCreator && (
            <div className={styles.joined}>
              <p className={styles.joinN}>Hosting and playing in this tournament.</p>
              <SvButton variant="quiet" disabled={busy === "leave"} onClick={() => post("leave", "/leave", "Failed to leave")}>Leave as participant</SvButton>
            </div>
          )}
        </section>

        {isParticipant && (
          <section id="my-deck" aria-label="Your deck" className={styles.deck}>
            <MyDeckPanel tournament={tournament} tournamentSlug={tournamentSlug} onChanged={onChanged} />
          </section>
        )}
      </div>

      <aside className={`${rail.rail} ${styles.rail}`} aria-label="Tournament details">
        {isCreator && (
          <section className={rail.sec} aria-label="Start">
            <h2 className={rail.h}>Start</h2>
            <div className={styles.startActs}>
              <SvButton variant="primary" big wide disabled={!canStart || busy === "start"} title={!canStart ? "Need at least 2 participants to start" : undefined} onClick={() => call("start", base, { method: "POST" }, "Failed to start")}>
                Start the tournament
              </SvButton>
              {process.env.NODE_ENV !== "production" && (
                <SvButton variant="quiet" disabled={busy === "add-bot"} onClick={() => post("add-bot", "/join-bot", "Failed to add bot")}>Add a bot</SvButton>
              )}
              <SvButton variant="quiet" disabled={busy === "announce"} onClick={() => post("announce", "/announce", "Failed to announce", () => { setAnnounced(true); setTimeout(() => setAnnounced(false), 2500); })}>
                {announced ? "Announced" : "Announce in Discord"}
              </SvButton>
            </div>
            <p className={styles.note}>
              {canStart
                ? `Starting draws the first round: ${matchCount(tournament.format, count)} matches over ${roundsOf(tournament.format, count)} rounds for the ${count} players here. Nobody can join after this. Players without a deck can still register one later.`
                : `Starting needs 2 or more players. ${needed} more to go.`}
            </p>
          </section>
        )}
        <RulesPanel tournament={tournament} tournamentSlug={tournamentSlug} isHost={isCreator} onChanged={onChanged} />
        {isCreator && (
          <section className={rail.sec} aria-label="Cancel">
            {confirmCancel ? (
              <div className={rail.confirmBox}>
                <StatusLine tone="warn"><strong>Cancel this tournament?</strong> It is removed for the {count} {count === 1 ? "player" : "players"} who joined. Nothing has been played yet.</StatusLine>
                <div className={rail.endActs}>
                  <SvButton variant="quiet" onClick={() => setConfirmCancel(false)}>Go back</SvButton>
                  <SvButton variant="danger" disabled={busy === "cancel"} onClick={() => call("cancel", base, { method: "DELETE" }, "Failed to cancel", () => setConfirmCancel(false))}>Yes, cancel</SvButton>
                </div>
              </div>
            ) : (
              <div className={rail.endRow}>
                <p className={rail.endT}>Cancel the tournament</p>
                <p className={rail.endN}>Cancelling removes the tournament for everyone. Nothing has been played yet.</p>
                <div className={rail.endActs}><SvButton variant="danger" onClick={() => setConfirmCancel(true)}>Cancel the tournament</SvButton></div>
              </div>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
