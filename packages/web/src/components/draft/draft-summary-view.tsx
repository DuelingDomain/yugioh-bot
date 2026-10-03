"use client";

import * as React from "react";
import Image from "next/image";
import { ChevronDown, Layers } from "lucide-react";
import {
  Mono,
  SectionHead,
  StageLine,
  StatusLine,
  SvButton,
  SheetPortal,
  YouPill,
  ringColour,
  svButtonClass,
  type StageStep,
} from "@/components/sheet";
import { CardHoverPopup } from "@/components/draft/card-hover-popup";
import { PoolBreakdown } from "@/components/draft/pool-breakdown";
import { formatPickSeconds } from "./pick-time";
import { CardPoolPanel } from "@/components/cards/card-pool-panel";
import type { CardSummary } from "@/lib/card-types";
import type { DraftCardDetail } from "@/lib/stores/draft-store";
import { buildLevelsModel } from "./summary/levels";
import { groupPool, kindTally, type PoolGroup } from "./summary/groups";
import { formatDuration, formatEnded, formatStamp, plural } from "./summary/format";
import styles from "./summary/summary.module.css";
import { getPopupPosition } from "@/lib/card-popup-position";
import { DangerConfirm } from "./danger-confirm";
import { DraftFrame, DraftLayout, DraftMain, DraftRail, Gem, Pieces, RailNote, RailSection, Rules } from "./draft-frame";
import { useInlineConfirm } from "./use-inline-confirm";

interface DraftSummaryViewProps {
  draft: {
    id: number;
    name: string;
    status: string;
    createdByUserId: string;
    createdAt: string;
    startedAt?: string;
    endedAt?: string;
    config: {
      mode?: "booster" | "theme";
      packSize?: number;
      packsPerPlayer?: number;
      cardsPerPlayer?: number;
      pickSeconds?: number;
      setNames?: string[];
      themePackSize?: number;
      themeSelection?: string;
      uniqueThemes?: boolean;
      extraDeckEnabled?: boolean;
      extraDeckSize?: number;
    };
    players: Array<{
      playerId: number;
      displayName: string;
      seatIndex?: number;
      pickCount: number;
      finishedAt?: string;
      joinedAt: string;
    }>;
    seats?: Array<{ playerId: number; isCurrentPlayer: boolean }>;
    playerCount: number;
    participantPickCount?: number;
    tournamentId?: number | null;
    /** The viewer's saved draft deck, when they have built one. */
    myDeckId?: number | null;
  };
  slug: string;
  isParticipant: boolean;
  isCreator: boolean;
  onExportYdk: () => Promise<string>;
  onDelete: () => Promise<void>;
  myPool?: DraftCardDetail[];
}

const GROUP_PREVIEW = 12;
const GROUP_PHONE_PREVIEW = 7;

function PoolGroupView({
  group,
  onHover,
  onLeave,
  onTap,
  failed,
  onFail,
}: {
  group: PoolGroup;
  onHover: (card: CardSummary, rect: DOMRect) => void;
  onLeave: () => void;
  onTap: (card: CardSummary, rect: DOMRect) => void;
  failed: Set<number>;
  onFail: (id: number) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded ? group.cards : group.cards.slice(0, GROUP_PREVIEW);
  const hidden = group.cards.length - shown.length;
  const phoneHidden = expanded ? 0 : Math.max(0, group.cards.length - GROUP_PHONE_PREVIEW);
  return (
    <div className={styles.group}>
      <p className={styles.groupHead}>
        {group.title} <b>{group.cards.length}</b>
      </p>
      <ul className={styles.cards}>
        {shown.map((card, i) => (
          <li key={`${card.id}-${i}`} className={!expanded && i >= GROUP_PHONE_PREVIEW ? styles.desktopCard : undefined}>
            <button
              type="button"
              aria-label={card.name}
              onClick={(e) => onTap(card, e.currentTarget.getBoundingClientRect())}
              onMouseEnter={(e) => onHover(card, e.currentTarget.getBoundingClientRect())}
              onMouseLeave={onLeave}
              onFocus={(e) => onHover(card, e.currentTarget.getBoundingClientRect())}
              onBlur={onLeave}
            >
              {failed.has(card.id) ? (
                <span className={styles.missing}>{card.name}</span>
              ) : (
                <Image
                  src={card.imageUrlSmall || card.imageUrl}
                  alt=""
                  width={421}
                  height={614}
                  sizes="96px"
                  onError={() => onFail(card.id)}
                />
              )}
            </button>
          </li>
        ))}
        {hidden > 0 && (
          <li className={`${styles.more} ${styles.desktopMore}`}>
            <button type="button" aria-expanded={false} onClick={() => setExpanded(true)}>
              {hidden} more
            </button>
          </li>
        )}
        {phoneHidden > 0 && (
          <li className={`${styles.more} ${styles.phoneMore}`}>
            <button type="button" aria-expanded={false} onClick={() => setExpanded(true)}>
              {phoneHidden} more
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

export function DraftSummaryView({
  draft,
  slug,
  isParticipant,
  isCreator,
  onExportYdk,
  onDelete,
  myPool,
}: DraftSummaryViewProps) {
  const [exporting, setExporting] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const deleteConfirm = useInlineConfirm(deleting);
  const confirmOpen = deleteConfirm.open;
  const setConfirmOpen = deleteConfirm.setOpen;
  const [error, setError] = React.useState<string | null>(null);
  const [hoveredCard, setHoveredCard] = React.useState<CardSummary | null>(null);
  // A tapped card stays open until closed, so phones (no hover) can read it too.
  const [tapped, setTapped] = React.useState<{ card: CardSummary; position: { left: number; top: number } } | null>(null);
  const [popupPosition, setPopupPosition] = React.useState<{ left: number; top: number } | null>(null);
  const [imageErrors, setImageErrors] = React.useState<Set<number>>(new Set());
  const [tournamentFormat, setTournamentFormat] = React.useState<"round_robin" | "single_elim">("round_robin");
  const [tournamentBestOf, setTournamentBestOf] = React.useState<1 | 3>(3);
  const [creatingTournament, setCreatingTournament] = React.useState(false);
  const [tournamentError, setTournamentError] = React.useState<string | null>(null);
  const [linkedTournament, setLinkedTournament] = React.useState<{ id: number; name: string; webSlug: string | null } | null>(null);
  const [poolOpen, setPoolOpen] = React.useState(false);
  const [fullPool, setFullPool] = React.useState<CardSummary[] | null>(null);
  const [poolLoading, setPoolLoading] = React.useState(false);

  const toggleFullPool = React.useCallback(async () => {
    const next = !poolOpen;
    setPoolOpen(next);
    if (next && fullPool === null) {
      setPoolLoading(true);
      try {
        const res = await fetch(`/api/drafts/${slug}/pool`);
        if (res.ok) {
          const data = (await res.json()) as { cards: CardSummary[] };
          setFullPool(data.cards ?? []);
        }
      } finally {
        setPoolLoading(false);
      }
    }
  }, [poolOpen, fullPool, slug]);

  const handleCardHover = React.useCallback((card: CardSummary, rect: DOMRect) => {
    setHoveredCard(card);
    setPopupPosition(getPopupPosition(rect));
  }, []);

  const handleCardTap = React.useCallback((card: CardSummary, rect: DOMRect) => {
    setTapped({ card, position: getPopupPosition(rect) });
  }, []);

  const handleCardLeave = React.useCallback(() => {
    setHoveredCard(null);
    setPopupPosition(null);
  }, []);

  const markFailed = React.useCallback((id: number) => {
    setImageErrors((prev) => new Set(prev).add(id));
  }, []);

  const isCompleted = draft.status === "completed";
  const isTheme = draft.config.mode === "theme";
  const participantPickCount = draft.participantPickCount ?? 0;
  const canExportYdk = isCompleted && isParticipant && participantPickCount >= 40;
  // The export writes the first 40 picks as the main deck and nothing else.
  const ydkCards = participantPickCount > 40 ? "your first 40 picks" : "your picks";
  const canBuildDeck = isCompleted && isParticipant && participantPickCount > 0;
  const hasDeck = draft.myDeckId != null;

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const ydkContent = await onExportYdk();
      const blob = new Blob([ydkContent], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${draft.name.replace(/\s+/g, "_")}.ydk`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export YDK");
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete draft");
      setDeleting(false);
    }
  };

  const handleCreateTournament = async () => {
    setCreatingTournament(true);
    setTournamentError(null);
    try {
      const res = await fetch(`/api/drafts/${slug}/tournament`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: tournamentFormat, bestOf: tournamentBestOf }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.webSlug) {
          setLinkedTournament({ id: data.id, name: data.name, webSlug: data.webSlug });
          return;
        }
        throw new Error(data.error ?? "Failed to create tournament");
      }
      setLinkedTournament({ id: data.id, name: data.name, webSlug: data.webSlug });
    } catch (err) {
      setTournamentError(err instanceof Error ? err.message : "Failed to create tournament");
    } finally {
      setCreatingTournament(false);
    }
  };

  const sortedPlayers = [...draft.players].sort((a, b) => {
    if (a.seatIndex !== undefined && b.seatIndex !== undefined) {
      return a.seatIndex - b.seatIndex;
    }
    return 0;
  });
  const myPlayerIds = new Set((draft.seats ?? []).filter((s) => s.isCurrentPlayer).map((s) => s.playerId));

  // Everything before the last stop is done; building a deck is where you go next.
  const cfg = draft.config;
  const stages: StageStep[] = isTheme
    ? [
        { label: "Lobby", state: "done" },
        { label: "Main deck", state: "done" },
        ...(cfg.extraDeckEnabled ? [{ label: "Extra deck", state: "done" as const }] : []),
        { label: "Build deck", state: "now" },
      ]
    : [
        { label: "Lobby", state: "done" },
        { label: "Draft", state: "done" },
        { label: "Build deck", state: "now" },
      ];

  const duration = formatDuration(draft.startedAt, draft.endedAt);

  const pool = isParticipant && myPool && myPool.length > 0 ? myPool : null;
  const tally = pool ? kindTally(pool) : null;
  const levels = pool ? buildLevelsModel(pool) : null;
  const groups = pool ? groupPool(pool, isTheme ? "theme" : "cube") : [];

  const selectionLabel =
    cfg.themeSelection === "player_pick" ? "Players pick" : cfg.themeSelection === "random" ? "Random" : cfg.themeSelection === "host_assigned" ? "Host assigns" : null;

  const setupRows: Array<[string, string]> = [];
  if (isTheme) {
    if (selectionLabel) setupRows.push(["Themes", cfg.uniqueThemes ? `${selectionLabel}, all different` : selectionLabel]);
    if (cfg.cardsPerPlayer) setupRows.push(["Main deck", plural(cfg.cardsPerPlayer, "card")]);
    if (cfg.extraDeckEnabled !== undefined) {
      setupRows.push(["Extra deck", cfg.extraDeckEnabled && cfg.extraDeckSize ? plural(cfg.extraDeckSize, "card") : "Off"]);
    }
    if (cfg.themePackSize) setupRows.push(["Each pick", `1 of ${cfg.themePackSize}`]);
  } else {
    const each = cfg.cardsPerPlayer ?? (cfg.packSize && cfg.packsPerPlayer ? cfg.packSize * cfg.packsPerPlayer : undefined);
    if (each) setupRows.push(["Each player", plural(each, "card")]);
    if (cfg.packsPerPlayer && cfg.packSize) setupRows.push(["Packs", `${plural(cfg.packsPerPlayer, "pack")} of ${cfg.packSize}`]);
  }
  if (cfg.pickSeconds) setupRows.push(["Pick duration", formatPickSeconds(cfg.pickSeconds)]);
  if (draft.startedAt) setupRows.push(["Started", formatStamp(draft.startedAt)]);
  if (draft.endedAt) setupRows.push(["Ended", formatStamp(draft.endedAt)]);

  const showMakeTournament = isCompleted && isCreator && !linkedTournament && !draft.tournamentId;
  const showTournamentPanel = isCompleted && (linkedTournament != null || draft.tournamentId != null);


  const kind = isTheme ? "Theme draft" : "Cube draft";
  const hasActions = canBuildDeck || canExportYdk || Boolean(error);
  const actions = (
    <>
      {error && (
        <div role="alert">
          <StatusLine tone="block">{error}</StatusLine>
        </div>
      )}
      {canBuildDeck && (
        <SvButton as="a" href={`/decks/draft/${slug}`} variant={hasDeck ? "ghost" : "primary"} big wide>
          <Layers size={18} aria-hidden="true" />
          {hasDeck ? "Edit your deck" : "Build your deck"}
        </SvButton>
      )}
      {canExportYdk && (
        <SvButton variant="ghost" wide disabled={exporting} aria-busy={exporting || undefined} onClick={handleExport}>
          {exporting ? "Exporting…" : "Export YDK"}
        </SvButton>
      )}
    </>
  );

  return (
    <DraftFrame title={draft.name} back={{ href: "/drafts", label: "All drafts" }}>
      <DraftLayout>
        <DraftMain>
          <div className={styles.lead}>
            {isCompleted && <StageLine steps={stages} label="Draft progress" />}
            <Pieces
              items={[
                { content: <><Gem fill={isCompleted} tone={isCompleted ? undefined : "dim"} />{isCompleted ? "Finished" : "Cancelled"}</>, strong: true },
                { content: kind },
                { content: plural(draft.playerCount, "player") },
                ...(draft.endedAt ? [{ content: `Ended ${formatEnded(draft.endedAt)}` }] : []),
                ...(duration ? [{ content: `Took ${duration}` }] : []),
              ]}
            />
            {!isCompleted && (
              <StatusLine tone="neutral">The host cancelled this draft before it finished.</StatusLine>
            )}
            {canBuildDeck && (
              <div className={styles.next} role="group" aria-labelledby="df-next-t">
                <h2 className={styles.nextT} id="df-next-t">
                  {hasDeck ? "Your deck is ready" : `Your ${plural(participantPickCount, "card")} ${participantPickCount === 1 ? "is" : "are"} ready`}
                </h2>
                <p className={styles.nextP}>
                  {canExportYdk
                    ? hasDeck
                      ? `It is saved in My decks. Editing it is optional. You can also export ${ydkCards} as a YDK file.`
                      : `Build a deck from them on the web, or take ${ydkCards === "your picks" ? "them" : ydkCards} to another sim as a YDK file.`
                    : hasDeck
                      ? `It is saved in My decks. Editing it is optional. Export needs at least 40 picks. You made ${participantPickCount}.`
                      : `Export needs at least 40 picks. You made ${participantPickCount}, so build your deck here instead.`}
                </p>
              </div>
            )}
          </div>

          {pool && tally && levels && (
            <section aria-labelledby="df-pool-t">
              <SectionHead title="Your pool" id="df-pool-t" note={`${plural(pool.length, "card")}, tap a card to read it`} />
              <div className={styles.poolHead}>
                <p className={styles.tally}>
                  <span data-k="monster"><b>{tally.monster}</b>Monsters</span>
                  <span data-k="spell"><b>{tally.spell}</b>Spells</span>
                  <span data-k="trap"><b>{tally.trap}</b>Traps</span>
                  <span data-k="extra"><b>{tally.extra}</b>Extra deck</span>
                </p>
                <div className={styles.chipRow}>
                  <PoolBreakdown cards={pool} variant="sheet" />
                </div>
                <div className={styles.lv} role="img" aria-label={levels.ariaLabel}>
                  <p className={styles.lvHead}><span>Monster levels</span><small>Main deck, by stars</small></p>
                  <div className={styles.lvChart}>
                    {levels.bands.map((band) => (
                      <div
                        key={band.tributes}
                        className={styles.band}
                        data-t={band.tributes || undefined}
                        style={{ "--cols": band.bars.length } as React.CSSProperties}
                      >
                        <span className={styles.bars}>
                          {band.bars.map((bar) => (
                            <span
                              key={bar.label}
                              data-zero={bar.count === 0 ? "" : undefined}
                              style={{ "--h": bar.height } as React.CSSProperties}
                            >
                              <b>{bar.count}</b>
                              <small>{bar.label}</small>
                            </span>
                          ))}
                        </span>
                        <span className={styles.bandTotal}>{band.label} <b>{band.total}</b></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {groups.map((group) => (
                <PoolGroupView
                  key={group.key}
                  group={group}
                  onHover={handleCardHover}
                  onLeave={handleCardLeave}
                  onTap={handleCardTap}
                  failed={imageErrors}
                  onFail={markFailed}
                />
              ))}
              {hoveredCard && popupPosition && !tapped && (
                <SheetPortal>
                  <CardHoverPopup
                    card={hoveredCard}
                    position={popupPosition}
                    imageError={imageErrors.has(hoveredCard.id)}
                    onImageError={() => markFailed(hoveredCard.id)}
                  />
                </SheetPortal>
              )}
              {tapped && (
                <SheetPortal>
                  <CardHoverPopup
                    card={tapped.card}
                    position={tapped.position}
                    imageError={imageErrors.has(tapped.card.id)}
                    onImageError={() => markFailed(tapped.card.id)}
                    dismissible
                    onDismiss={() => setTapped(null)}
                  />
                </SheetPortal>
              )}
            </section>
          )}

          <section aria-labelledby="df-players-t">
            <SectionHead title="Players" id="df-players-t" note="In seat order" />
            {draft.players.length === 0 ? (
              <p className={styles.empty}>No players were in this draft.</p>
            ) : (
              <ol className={styles.seats}>
                {sortedPlayers.map((player, i) => {
                  const mine = myPlayerIds.has(player.playerId);
                  return (
                    <li key={player.playerId} data-you={mine ? "true" : undefined}>
                      <span className={styles.no}>{(player.seatIndex ?? i) + 1}</span>
                      <Mono name={player.displayName} you={mine} ring={mine ? undefined : ringColour(player.playerId)} />
                      <span className={styles.nm}>
                        <span className={styles.nmText}>{player.displayName}</span>
                        {mine && <YouPill />}
                      </span>
                      <span className={styles.pk}>
                        <b>{player.pickCount}</b> {player.pickCount === 1 ? "pick" : "picks"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {!isTheme && (
            <details className={styles.full} open={poolOpen}>
              <summary
                onClick={(e) => {
                  e.preventDefault();
                  void toggleFullPool();
                }}
              >
                <span>Every card in the pool</span>
                <small>
                  {fullPool ? `${fullPool.reduce((n, c) => n + (c.qty ?? 1), 0)} cards. ` : ""}What the packs were dealt from
                </small>
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              {poolOpen && (
                <div className={styles.fullBody}>
                  <CardPoolPanel
                    title="Full pool"
                    cards={fullPool ?? []}
                    loading={poolLoading}
                    countMode="copies"
                    showSummary
                    emptyMessage="No pool data."
                    variant="sheet"
                  />
                </div>
              )}
            </details>
          )}
        </DraftMain>

        <DraftRail aria-label="Draft details" actions={hasActions ? actions : undefined}>
          {showMakeTournament && (
            <RailSection title="Make it a tournament" id="df-tour-t">
              <RailNote>The {draft.playerCount} drafters become its players, in seat order.</RailNote>
              {tournamentError && (
                <div role="alert" className={styles.tourErr}>
                  <StatusLine tone="block">{tournamentError}</StatusLine>
                </div>
              )}
              <div className={styles.tourFields}>
                <div>
                  <label className="label" htmlFor="tournament-format">Format</label>
                  <select
                    id="tournament-format"
                    className="input select"
                    value={tournamentFormat}
                    onChange={(e) => setTournamentFormat(e.target.value as "round_robin" | "single_elim")}
                  >
                    <option value="round_robin">Round robin</option>
                    <option value="single_elim">Single elimination</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="tournament-best-of">Match length</label>
                  <select
                    id="tournament-best-of"
                    className="input select"
                    value={tournamentBestOf}
                    onChange={(e) => setTournamentBestOf(e.target.value === "1" ? 1 : 3)}
                  >
                    <option value={3}>Best of 3</option>
                    <option value={1}>Best of 1</option>
                  </select>
                </div>
              </div>
              <SvButton variant="ghost" wide className={styles.tourBtn} disabled={creatingTournament} aria-busy={creatingTournament || undefined} onClick={handleCreateTournament}>
                Create tournament
              </SvButton>
            </RailSection>
          )}

          {showTournamentPanel && (
            <RailSection title="Tournament" id="df-tour-t">
              {linkedTournament?.webSlug ? (
                <>
                  <RailNote>Made from this draft.</RailNote>
                  <SvButton as="a" href={`/tournament/${linkedTournament.webSlug}`} variant="ghost" wide className={styles.tourBtn}>
                    Open {linkedTournament.name}
                  </SvButton>
                </>
              ) : (
                <>
                  <RailNote>A tournament was made from this draft.</RailNote>
                  <SvButton as="a" href="/tournaments" variant="quiet" className={styles.tourBtn}>
                    Find it on Tournaments
                  </SvButton>
                </>
              )}
            </RailSection>
          )}

          <RailSection title="Setup" id="df-setup-t">
            {setupRows.length > 0 && <Rules rows={setupRows.map(([label, value]) => ({ label, value }))} />}
            {!isTheme && cfg.setNames && cfg.setNames.length > 0 && (
              <div className={styles.sets}>
                <p>Sets</p>
                <ul>
                  {cfg.setNames.map((setName) => (
                    <li key={setName} className="chip">{setName}</li>
                  ))}
                </ul>
              </div>
            )}
          </RailSection>

          {isCreator && (
            <RailSection>
              {confirmOpen ? (
                <div onKeyDown={deleteConfirm.onKeyDown}>
                  <DangerConfirm
                    title={`Delete ${draft.name}?`}
                    confirmLabel="Yes, delete"
                    busy={deleting}
                    consequence={
                      draft.playerCount > 1
                        ? `Every pick is removed for all ${draft.playerCount} players. This can't be undone.`
                        : "Every pick is removed. This can't be undone."
                    }
                    onBack={() => setConfirmOpen(false)}
                    onConfirm={handleDelete}
                  />
                </div>
              ) : (
                <>
                  <button ref={deleteConfirm.triggerRef} type="button" className={svButtonClass("danger", { wide: true })} onClick={() => setConfirmOpen(true)}>
                    Delete draft
                  </button>
                  <RailNote>
                    {draft.playerCount > 1
                      ? `Removes it and every pick for all ${draft.playerCount} players.`
                      : "Removes it and every pick."}
                  </RailNote>
                </>
              )}
            </RailSection>
          )}
        </DraftRail>
      </DraftLayout>
    </DraftFrame>
  );
}
