import Link from "next/link";
import { FloorRow, LiveDot, LocatorStrip, Mono, ringColour } from "@/components/sheet";
import type { TournamentRounds } from "@/components/dashboard/tournament-rounds";
import type { Participant } from "./types";
import { TournamentRowAction } from "./tournament-row-actions";
import {
  buildRoundStrip,
  currentRoundOf,
  formatLabel,
  leaderOf,
  playersLabel,
  rowAction,
  tournamentHref,
  type TournamentListItem,
} from "./tournaments-list-model";
import styles from "./tournament-row.module.css";

const STACK_MAX = 5;

/** The players shown in an open row's stack: the viewer first, then in join order. */
function joinedStack(participants: Participant[], viewerId: number | null): Participant[] {
  const me = participants.filter((p) => p.playerId === viewerId);
  const rest = participants.filter((p) => p.playerId !== viewerId);
  return [...me, ...rest].slice(0, STACK_MAX);
}

export interface TournamentRowProps {
  tournament: TournamentListItem;
  variant: "running" | "open";
  /** Pairings of this tournament. Without them the row shows no strip and no duel action. */
  rounds?: TournamentRounds;
  /** The signed-in player, or null when they have no player yet. */
  viewerId?: number | null;
  /** Forces the "you" underlay when `rounds` is not given. */
  you?: boolean;
  /** Leads the row with the viewer's own ring (the dashboard does; the tournaments list does not). */
  showYou?: boolean;
  className?: string;
}

/**
 * One running or open tournament as a floor row: the name (the whole row is its link),
 * a live round label, a strip of round slots, and the one duel action the viewer has.
 * Render inside a `SheetRoot`.
 */
export function TournamentRow({ tournament, variant, rounds, viewerId = null, you: youProp, showYou = false, className }: TournamentRowProps) {
  const href = tournamentHref(tournament);
  const input = rounds ? { format: tournament.format, status: tournament.status, participants: rounds.participants, matches: rounds.matches } : null;
  const you = youProp ?? (viewerId !== null && !!rounds?.participants.some((p) => p.playerId === viewerId));
  const running = variant === "running";
  const viewerName = rounds?.participants.find((p) => p.playerId === viewerId)?.displayName ?? "You";

  // The strip is the viewer's own rounds; a viewer who is not in the tournament sees the leader's.
  const leader = input && !you && running ? leaderOf(input) : null;
  const stripPlayerId = you ? viewerId : (leader?.playerId ?? null);
  const strip = input && running ? buildRoundStrip(input, stripPlayerId) : null;
  const joined = rounds && !running ? joinedStack(rounds.participants, viewerId) : [];
  const progress = input && running ? currentRoundOf(input) : null;
  const action = input && running ? rowAction(input, viewerId) : null;
  const liveCount = rounds?.liveCount ?? 0;

  const stripLabel = you ? "Your rounds" : leader ? `${leader.displayName}, the leader, rounds` : "Rounds";
  const rangeLabel = strip && strip.total > strip.slots.length ? `${stripLabel}, ${strip.from} to ${strip.to} of ${strip.total}` : stripLabel;

  return (
    <FloorRow
      you={you}
      className={`${styles.row}${showYou ? ` ${styles.withLead}` : ""}${className ? ` ${className}` : ""}`}
      cols={showYou ? "36px minmax(0, 1fr) auto auto" : "minmax(0, 1fr) auto auto"}
      phoneCols={showYou ? "36px minmax(0, 1fr)" : "minmax(0, 1fr)"}
      phoneAreas={showYou ? '"lead id" "lead strip" "lead act"' : '"id" "strip" "act"'}
    >
      {showYou && (
        <span className={styles.lead}>
          <Mono name={viewerName} you />
        </span>
      )}
      <div className={styles.id}>
        <Link href={href} className={styles.name}>
          {tournament.name}
        </Link>
        <p className={styles.meta}>
          {running ? (
            <LiveDot label={progress ? `Round ${progress.round} of ${progress.total}` : "In progress"} />
          ) : (
            <span>Open to join</span>
          )}
          <span>{formatLabel(tournament.format)}</span>
          <span>{running ? playersLabel(tournament.participantCount) : `${tournament.participantCount} joined`}</span>
          {liveCount > 0 && <span>{liveCount === 1 ? "1 duel live" : `${liveCount} duels live`}</span>}
        </p>
      </div>
      {strip && strip.slots.length > 0 && (
        <div className={styles.strip}>
          {leader && <Mono name={leader.displayName} size="sm" ring={ringColour(leader.playerId)} label={`${leader.displayName}, the leader`} />}
          <LocatorStrip slots={strip.slots} size="sm" label={rangeLabel} />
        </div>
      )}
      {joined.length > 0 && (
        <div className={styles.strip}>
          <span className={styles.stack} role="img" aria-label={`${tournament.participantCount} joined`}>
            {joined.map((p) => (
              <Mono key={p.playerId} name={p.displayName} size="sm" you={p.playerId === viewerId} ring={ringColour(p.playerId)} />
            ))}
            {tournament.participantCount > joined.length && (
              <span className={styles.stackMore}>+{tournament.participantCount - joined.length}</span>
            )}
          </span>
        </div>
      )}
      {action && (
        <div className={styles.act}>
          <TournamentRowAction action={action} tournamentSlug={rounds?.webSlug ?? tournament.webSlug ?? null} />
        </div>
      )}
    </FloorRow>
  );
}
