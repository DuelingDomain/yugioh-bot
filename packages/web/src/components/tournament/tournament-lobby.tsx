"use client";

import { useState } from "react";
import { Check, Copy, LogOut, Megaphone, UserPlus, X } from "lucide-react";
import { RankGem, SheetPanel, DangerZone, DangerRow, ConfirmPanel } from "@/components/sheet";
import { Link as LinkIcon } from "lucide-react";
import { MyDeckPanel } from "./my-deck-panel";
import { DeckMarker } from "./deck-marker";
import { RulesPanel } from "./sheet/rules-panel";
import { formatLabel, rulesSummary } from "./sheet-rules";
import { UNRATED_ELO, type PlayerRatings } from "./sheet-contracts";
import type { TournamentDetail } from "./types";

interface TournamentLobbyProps {
  tournament: TournamentDetail;
  tournamentSlug: string;
  isCreator: boolean;
  currentUserId: string | null;
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

export function TournamentLobby({ tournament, tournamentSlug, isCreator, onChanged, ratings }: TournamentLobbyProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [copied, setCopied] = useState(false);
  const [announced, setAnnounced] = useState(false);

  const isParticipant = tournament.isParticipant;
  const players = tournament.participants;
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

  const nameLine = rules ? `${formatLabel(tournament.format)} · Best of ${rules.bestOf}` : formatLabel(tournament.format);

  return (
    <div className="t-grid">
      <div className="t-main">
        {error && <div className="banner banner-bad" role="alert"><p>{error}</p></div>}

        {!isParticipant && (
          <div className="join">
            <div>
              <h2>Join {tournament.name}</h2>
              <p>{nameLine}{rules ? ` · ${rules.line.split(" · ").slice(1).join(" · ")}` : ""}. {count} {count === 1 ? "player" : "players"} so far.</p>
            </div>
            <button type="button" className="btn btn-primary btn-lg" disabled={busy === "join"} onClick={() => post("join", "/join", "Failed to join tournament")}>
              <UserPlus className="ic" aria-hidden="true" />Join tournament
            </button>
          </div>
        )}
        {!isParticipant && <p className="small">You register a deck after joining. You can leave any time before the start.</p>}

        {isParticipant && !isCreator && (
          <div className="inline-note">
            <p>You&apos;re in. Waiting for the organizer to start.</p>
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy === "leave"} onClick={() => post("leave", "/leave", "Failed to leave")}>
              <LogOut className="ic sm" aria-hidden="true" />Leave tournament
            </button>
          </div>
        )}

        {isCreator && (
          <section className="panel invite" aria-labelledby="invite-t">
            <h2 className="panel-t"><span id="invite-t">Invite players</span><small>anyone in the server can join</small></h2>
            <div className="invite-row">
              <input className="input" readOnly value={link} aria-label="Invite link" />
              <div className="acts">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check className="ic" aria-hidden="true" /> : <Copy className="ic" aria-hidden="true" />}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy === "announce"}
                  onClick={() => post("announce", "/announce", "Failed to announce", () => { setAnnounced(true); setTimeout(() => setAnnounced(false), 2500); })}
                >
                  {announced ? <Check className="ic" aria-hidden="true" /> : <Megaphone className="ic" aria-hidden="true" />}
                  {announced ? "Announced" : "Announce in Discord"}
                </button>
              </div>
            </div>
            <p className="small">Players can also join from Discord with <code className="cmd">/event join</code>.</p>
          </section>
        )}
        {!isCreator && (
          <section className="panel invite" aria-labelledby="invite-t">
            <h2 className="panel-t"><span id="invite-t">Invite link</span><small>share it so others can join</small></h2>
            <div className="invite-row">
              <input className="input" readOnly value={link} aria-label="Invite link" />
              <div className="acts">
                <button type="button" className="btn btn-secondary" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? <Check className="ic" aria-hidden="true" /> : <LinkIcon className="ic" aria-hidden="true" />}
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
            </div>
          </section>
        )}

        <section aria-labelledby="seats-t">
          <div className="sec-h">
            <h2 className="sec-t" id="seats-t">Players</h2>
            <span className="sec-aux">{count} joined · at least 2 to start · no seat limit</span>
          </div>
          <ul className="seats">
            {players.map((p, i) => {
              const you = p.playerId === tournament.currentUserPlayerId;
              const rating = ratings?.get(p.playerId);
              const hostSeat = isCreator && you;
              return (
                <li key={p.playerId} className={`seat${you ? " me" : ""}`}>
                  {single ? <span className="no">{i + 1}</span> : null}
                  <RankGem tier={rating?.rank ?? "none"} size="lg" />
                  <span className="who">
                    <span className="nm">
                      <span className="t">{p.displayName}</span>
                      {you && <span className="youtag">you</span>}
                      {hostSeat && <span className="hosttag">host</span>}
                    </span>
                    {(rating || isCreator) && (
                      <span className="sub">
                        {rating && rating.elo !== UNRATED_ELO && <span className="elo">{rating.elo}</span>}
                        {isCreator && <DeckMarker participant={p} />}
                      </span>
                    )}
                  </span>
                  {isCreator && !you && (
                    <button
                      type="button"
                      className="x"
                      aria-label={`Remove ${p.displayName}`}
                      disabled={busy === `kick-${p.playerId}`}
                      onClick={() => call(`kick-${p.playerId}`, `${base}/kick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: p.playerId }) }, "Failed to remove")}
                    >
                      <X className="ic sm" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
            {Array.from({ length: Math.max(0, needed) }).map((_, i) => (
              <li key={`open-${i}`} className="seat open"><UserPlus className="ic" aria-hidden="true" /><span>Open seat · needed to start</span></li>
            ))}
          </ul>
          {single && count > 1 && <p className="small">Round 1 pairs 1 with {count % 2 === 0 ? count : count - 1}{count >= 4 ? " and 2 with " + (count % 2 === 0 ? count - 1 : count - 2) : ""}. With an odd count, seat 1 gets the bye.</p>}
          {isParticipant && isCreator && (
            <div className="inline-note">
              <p>Hosting and playing in this tournament.</p>
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy === "leave"} onClick={() => post("leave", "/leave", "Failed to leave")}>
                <LogOut className="ic sm" aria-hidden="true" />Leave as participant
              </button>
            </div>
          )}
        </section>

        {isParticipant && (
          <section id="my-deck" aria-label="Your deck">
            <MyDeckPanel tournament={tournament} tournamentSlug={tournamentSlug} onChanged={onChanged} />
          </section>
        )}
      </div>

      <aside className="t-rail" aria-label="Tournament details">
        {isCreator && (
          <SheetPanel title="Start" aside={<small>only you see this</small>} bodyClassName="start">
            <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!canStart || busy === "start"} title={!canStart ? "Need at least 2 participants to start" : undefined} onClick={() => call("start", base, { method: "POST" }, "Failed to start")}>
              Start tournament
            </button>
            {canStart ? (
              <p className="small">Makes <b>{matchCount(tournament.format, count)} matches over {roundsOf(tournament.format, count)} rounds</b> for the {count} players here. Nobody can join after this. Players without a deck can still register one after the start.</p>
            ) : (
              <p className="small">Need {needed} more {needed === 1 ? "player" : "players"} to start.</p>
            )}
            {process.env.NODE_ENV !== "production" && (
              <button type="button" className="btn btn-secondary btn-sm btn-block" disabled={busy === "add-bot"} onClick={() => post("add-bot", "/join-bot", "Failed to add bot")}>
                <UserPlus className="ic sm" aria-hidden="true" />Add bot
              </button>
            )}
          </SheetPanel>
        )}
        <RulesPanel tournament={tournament} tournamentSlug={tournamentSlug} isHost={isCreator} onChanged={onChanged} />
        {isCreator && (
          <DangerZone title="Ending early">
            {confirmCancel ? (
              <ConfirmPanel
                title="Cancel this tournament?"
                confirmLabel="Yes, cancel"
                cancelLabel="Go back"
                busy={busy === "cancel"}
                onCancel={() => setConfirmCancel(false)}
                onConfirm={() => call("cancel", base, { method: "DELETE" }, "Failed to cancel", () => setConfirmCancel(false))}
              >
                It is removed for the {count} {count === 1 ? "player" : "players"} who joined. Nothing has been played yet.
              </ConfirmPanel>
            ) : (
              <DangerRow
                title="Cancel tournament"
                description={`Removes it for the ${count} ${count === 1 ? "player" : "players"} who joined. Nothing has been played yet.`}
                action={<button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmCancel(true)}><X className="ic sm" aria-hidden="true" />Cancel</button>}
              />
            )}
          </DangerZone>
        )}
      </aside>
    </div>
  );
}
