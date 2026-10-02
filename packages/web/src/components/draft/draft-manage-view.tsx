"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, Pencil, UserPlus, X } from "lucide-react";
import { ConfirmPanel, DangerRow, DangerZone, SheetPanel, SheetRoot, StationTrack } from "@/components/sheet";
import { CubeDraftBuilder } from "@/components/cubes/cube-draft-builder";
import { CubeLobbyPanel } from "@/components/cubes/cube-lobby-panel";
import {
  DraftConfigFields,
  type DraftConfigFieldsValue,
  configFromFields,
  validateFields,
  fieldsFromConfig,
} from "./draft-config-fields";
import { CardPoolPanel } from "@/components/cards/card-pool-panel";
import { parseCustomCardIds } from "@/lib/custom-card-pool";
import type { CardSummary } from "@/lib/card-types";
import { InvitePanel } from "./lobby/invite-panel";
import { LobbySeats } from "./lobby/lobby-seats";
import {
  plural,
  poolSources,
  setupRows,
  startBlocker,
  startSummary,
  themeExtraOn,
  packsOf,
} from "./lobby/lobby-model";
import styles from "./lobby/lobby.module.css";
import { useInlineConfirm } from "./use-inline-confirm";
import { MetaLine } from "./meta-line";

interface DraftManageViewProps {
  draft: {
    id: number;
    name: string;
    status: string;
    createdByUserId: string;
    createdAt: string;
    config: {
      packSize?: number;
      packsPerPlayer?: number;
      cardsPerPlayer?: number;
      pickSeconds?: number;
      setNames?: string[];
      customCardIds?: number[];
      alternatePassDirection?: boolean;
      randomizeSeats?: boolean;
      mode?: "booster" | "theme";
      themeSelection?: "host_assigned" | "random" | "player_pick";
      uniqueThemes?: boolean;
      themePackSize?: number;
      extraDeckEnabled?: boolean;
      extraDeckSize?: number;
      burnUnpicked?: boolean;
    };
    seats?: Array<{ playerId: number; isCurrentPlayer: boolean }>;
    allowedCubes?: Array<{
      id: number;
      name: string;
      archetype: string | null;
      mainCount: number;
      extraCount: number;
      sampleImages: string[];
    }>;
    players: Array<{
      playerId: number;
      displayName: string;
      seatIndex?: number;
      pickCount: number;
      finishedAt?: string;
      joinedAt: string;
    }>;
    playerCount: number;
  };
  isCreator: boolean;
  isParticipant: boolean;
  onStart: () => Promise<void>;
  onCancel: () => Promise<void>;
  onUpdate: (data: { name?: string; config?: unknown }) => Promise<void>;
  onJoin: () => Promise<void>;
  onAddBot?: () => Promise<void>;
  isDev?: boolean;
  slug?: string;
  /** Called after a theme is added, detached, deleted or claimed, so the page can refetch the draft. */
  onChanged?: () => void;
}

function formatCreated(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function DraftManageView({
  draft,
  isCreator,
  isParticipant,
  onStart,
  onCancel,
  onUpdate,
  onJoin,
  onAddBot,
  isDev,
  slug,
  onChanged,
}: DraftManageViewProps) {
  const [editing, setEditing] = React.useState(false);
  const [nameValue, setNameValue] = React.useState(draft.name);
  const [saving, setSaving] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [joining, setJoining] = React.useState(false);
  const [addingBot, setAddingBot] = React.useState(false);
  const cancelConfirm = useInlineConfirm(cancelling);
  const showCancelConfirm = cancelConfirm.open;
  const setShowCancelConfirm = cancelConfirm.setOpen;
  const [error, setError] = React.useState<string | null>(null);

  // Theme drafts have no single shared card pool — each player drafts from their
  // own theme cube — so the pool preview / booster config don't apply.
  const isTheme = draft.config?.mode === "theme";

  // Card pool (booster only)
  const [poolCards, setPoolCards] = React.useState<CardSummary[] | null>(null);
  const [poolError, setPoolError] = React.useState(false);
  const loadPool = React.useCallback(() => {
    if (!slug || isTheme) return;
    setPoolCards(null);
    setPoolError(false);
    fetch(`/api/drafts/${slug}/pool`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { cards: CardSummary[] }) => setPoolCards(data.cards))
      .catch(() => setPoolError(true));
  }, [slug, isTheme]);
  React.useEffect(() => { loadPool(); }, [loadPool]);
  const onUpdateWithPoolRefresh = React.useCallback(async (data: { name?: string; config?: unknown }) => {
    await onUpdate(data);
    if (data.config !== undefined) loadPool();
  }, [onUpdate, loadPool]);

  // Config edit mode
  const [isEditingConfig, setIsEditingConfig] = React.useState(false);
  const [editFields, setEditFields] = React.useState<DraftConfigFieldsValue>(() =>
    fieldsFromConfig(draft.config, draft.config.customCardIds),
  );
  const [editError, setEditError] = React.useState<string | null>(null);
  const [configSaving, setConfigSaving] = React.useState(false);

  // Live pool resolved from the in-progress edit fields. The left card pool
  // pane mirrors this while editing (the inline "Pool preview" is hidden), so
  // there's a single synced view of the cards.
  const [editPoolCards, setEditPoolCards] = React.useState<CardSummary[]>([]);
  const [editPoolUnknownIds, setEditPoolUnknownIds] = React.useState<number[]>([]);
  const [editPoolLoading, setEditPoolLoading] = React.useState(false);
  const handleEditPool = React.useCallback(
    (cards: CardSummary[], unknownIds: number[], loading: boolean) => {
      setEditPoolCards(cards);
      setEditPoolUnknownIds(unknownIds);
      setEditPoolLoading(loading);
    },
    [],
  );
  const editCardActionLabel = React.useCallback(
    (card: CardSummary) => `Remove ${card.name} from pool`,
    [],
  );
  // Remove one copy of a card from the pool by editing the underlying fields.
  // When sets are active they're first materialized into explicit passcodes so
  // the removal sticks (mirrors the cube editor).
  const removeOneFromEditPool = React.useCallback(
    (card: CardSummary) => {
      setEditFields((prev) => {
        if (prev.setNames.length > 0) {
          const expandedIds = editPoolCards.flatMap((c) => Array(c.qty ?? 1).fill(c.id));
          const idx = expandedIds.indexOf(card.id);
          if (idx === -1) return prev;
          expandedIds.splice(idx, 1);
          return { ...prev, setNames: [], customCardText: expandedIds.join("\n") };
        }
        const { cardIds } = parseCustomCardIds(prev.customCardText);
        const idx = cardIds.indexOf(card.id);
        if (idx === -1) return prev;
        cardIds.splice(idx, 1);
        return { ...prev, customCardText: cardIds.join("\n") };
      });
    },
    [editPoolCards],
  );

  const handleSaveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await onUpdateWithPoolRefresh({ name: trimmed });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update name");
    } finally {
      setSaving(false);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      await onStart();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start draft");
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    setError(null);
    try {
      await onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel draft");
    } finally {
      setCancelling(false);
      setShowCancelConfirm(false);
    }
  };

  const handleJoin = async () => {
    setJoining(true);
    setError(null);
    try {
      await onJoin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join draft");
    } finally {
      setJoining(false);
    }
  };

  const handleAddBot = async () => {
    if (!onAddBot) return;
    setAddingBot(true);
    setError(null);
    try {
      await onAddBot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add bot");
    } finally {
      setAddingBot(false);
    }
  };

  const handleStartEditConfig = () => {
    setEditFields(fieldsFromConfig(draft.config, draft.config.customCardIds));
    setEditError(null);
    setIsEditingConfig(true);
  };

  const handleCancelEditConfig = () => {
    setIsEditingConfig(false);
    setEditFields(fieldsFromConfig(draft.config, draft.config.customCardIds));
    setEditError(null);
  };

  const handleSaveConfig = async () => {
    setEditError(null);
    const err = validateFields(editFields);
    if (err) { setEditError(err); return; }

    setConfigSaving(true);
    try {
      await onUpdateWithPoolRefresh({ config: configFromFields(editFields) });
      setIsEditingConfig(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setConfigSaving(false);
    }
  };


  const playerCount = draft.players.length;
  const youIds = React.useMemo(
    () => new Set((draft.seats ?? []).filter((s) => s.isCurrentPlayer).map((s) => s.playerId)),
    [draft.seats],
  );
  const allowedCubes = draft.allowedCubes ?? [];
  const uniqueThemes = draft.config.uniqueThemes ?? true;
  const themeSelection = draft.config.themeSelection ?? "player_pick";
  const created = formatCreated(draft.createdAt);
  const blocker = startBlocker({ playerCount, isTheme, themeCount: allowedCubes.length, uniqueThemes });
  const summary = startSummary(draft.config, playerCount);
  const rows = setupRows(draft.config);
  const sets = !isTheme ? draft.config.setNames ?? [] : [];
  const reasonId = "lobby-start-reason";
  const playersAux = [
    `${playerCount} joined`,
    "at least 2 to start",
    !isTheme && draft.config.randomizeSeats !== false ? "seats are shuffled at the start" : null,
  ].filter(Boolean).join(" · ");

  const stations = isTheme
    ? [
        { code: "LB", name: "Lobby" },
        { code: "MN", name: "Main deck" },
        ...(themeExtraOn(draft.config) ? [{ code: "EX", name: "Extra deck" }] : []),
        { code: "DK", name: "Decks" },
      ]
    : [
        { code: "LB", name: "Lobby" },
        { code: "DR", name: plural(packsOf(draft.config), "pack") },
        { code: "DK", name: "Decks" },
      ];

  const poolDetail = isEditingConfig
    ? poolSources(editFields.setNames.length, parseCustomCardIds(editFields.customCardText).cardIds.length)
    : poolSources(draft.config.setNames?.length ?? 0, draft.config.customCardIds?.length ?? 0);

  return (
    <SheetRoot>
      <Link href="/drafts" className="crumb"><ChevronLeft className="ic sm" aria-hidden="true" />All drafts</Link>

      <header className="t-head sheet-head">
        <div>
          {editing && isCreator ? (
            <div className={styles.rename}>
              <input
                type="text"
                className="input"
                aria-label="Draft name"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") {
                    setNameValue(draft.name);
                    setEditing(false);
                  }
                }}
              />
              <button type="button" className="btn btn-primary btn-sm" disabled={saving} aria-busy={saving || undefined} onClick={handleSaveName}>
                Save
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => {
                  setNameValue(draft.name);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <h1 className={`t-title ${styles.title}`}>
              {draft.name}
              {isCreator && (
                <button type="button" className={styles.ren} onClick={() => setEditing(true)} aria-label="Rename draft" title="Rename draft">
                  <Pencil className="ic sm" aria-hidden="true" />
                </button>
              )}
            </h1>
          )}
          <MetaLine className="t-meta" items={[
            { content: <span className="status"><span className="lamp" data-s="open" aria-hidden="true" />Waiting to start</span> },
            { content: <span>{isTheme ? "Theme draft" : "Cube draft"}</span> },
            ...(isCreator ? [{ content: <span>Hosted by you</span> }] : []),
            ...(created ? [{ content: <span>Created {created}</span> }] : []),
          ]} />
        </div>
        <StationTrack
          stations={stations}
          current={0}
          tone={isCreator ? "mine" : "theirs"}
          label="Draft progress"
          caption={
            <>
              <span className="at">Lobby</span>
              <span className="sep">·</span>
              {playerCount} joined
              <span className="sep">·</span>
              {isCreator ? "starts when you press Start" : "waiting on the host"}
            </>
          }
        />
      </header>

      <div className="t-grid">
        <div className="t-main">
          {error && <div className="banner banner-bad" role="alert"><p>{error}</p></div>}

          {!isCreator && !isParticipant && (
            <div className="join">
              <div>
                <h2>Join {draft.name}</h2>
                <p>
                  {isTheme ? "Theme draft" : "Cube draft"}
                  {isTheme
                    ? ` · ${draft.config.cardsPerPlayer ?? 40} main deck picks${themeExtraOn(draft.config) ? ` and ${draft.config.extraDeckSize ?? 15} Extra deck` : ""}`
                    : ` · ${plural(packsOf(draft.config), "pack")} of ${draft.config.packSize ?? "—"}`}
                  {draft.config.pickSeconds ? ` · ${draft.config.pickSeconds} s a pick` : ""}. {plural(playerCount, "player")} so far.
                </p>
              </div>
              <button type="button" className="btn btn-primary btn-lg" disabled={joining} aria-busy={joining || undefined} onClick={handleJoin}>
                <UserPlus className="ic" aria-hidden="true" />Join draft
              </button>
            </div>
          )}

          {!isCreator && isParticipant && (
            <div className="inline-note">
              <p>
                {isTheme && themeSelection === "player_pick"
                  ? "You're in. Claim a theme before the host starts."
                  : "You're in. Waiting for the host to start."}
              </p>
            </div>
          )}

          {(isCreator || isParticipant) && slug && <InvitePanel slug={slug} />}

          <LobbySeats players={draft.players} youIds={youIds} isCreator={isCreator} aux={playersAux} />

          {isEditingConfig && !isTheme && (
            <section className="panel panel-pad" aria-labelledby="lobby-edit-t">
              <div className={styles.edit}>
                <h3 className="panel-t"><span id="lobby-edit-t">Edit setup</span><small>the pool below updates as you go</small></h3>
                {editError && <div className="banner banner-bad" role="alert"><p>{editError}</p></div>}
                <DraftConfigFields
                  value={editFields}
                  onChange={setEditFields}
                  poolBuilderShowPreview={false}
                  onPool={handleEditPool}
                />
                <div className={styles.editActs}>
                  <button type="button" className="btn btn-primary btn-sm" disabled={configSaving} aria-busy={configSaving || undefined} onClick={handleSaveConfig}>
                    Save setup
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={handleCancelEditConfig} disabled={configSaving}>
                    Cancel
                  </button>
                </div>
              </div>
            </section>
          )}

          {!isTheme &&
            (isEditingConfig ? (
              <CardPoolPanel
                variant="sheet"
                title="Card pool"
                cards={editPoolCards}
                unknownIds={editPoolUnknownIds}
                loading={editPoolLoading}
                emptyMessage="Add sets or card IDs to build the pool."
                countMode="copies"
                detail={poolDetail}
                onCardClick={removeOneFromEditPool}
                cardActionLabel={editCardActionLabel}
              />
            ) : (
              slug && (
                <CardPoolPanel
                  variant="sheet"
                  title="Card pool"
                  cards={poolCards ?? []}
                  loading={poolCards === null && !poolError}
                  error={poolError ? "Couldn't load the pool." : null}
                  emptyMessage="This draft's pool hasn't been resolved yet."
                  countMode="copies"
                  detail={poolDetail}
                />
              )
            ))}

          {isTheme && slug && (
            isCreator ? (
              <CubeDraftBuilder
                slug={slug}
                allowedCubes={allowedCubes}
                uniqueThemes={uniqueThemes}
                themeSelection={themeSelection}
                canClaim={isParticipant}
                onChanged={() => onChanged?.()}
              />
            ) : (
              <CubeLobbyPanel
                slug={slug}
                allowedCubes={allowedCubes}
                themeSelection={themeSelection}
                uniqueThemes={uniqueThemes}
                canClaim={isParticipant}
                onClaimed={() => onChanged?.()}
              />
            )
          )}
        </div>

        <aside className="t-rail" aria-label="Draft details">
          {isCreator && (
            <SheetPanel title="Start" aside="only you see this" bodyClassName="start">
              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                disabled={blocker !== null || starting}
                aria-busy={starting || undefined}
                aria-describedby={reasonId}
                onClick={handleStart}
              >
                Start draft
              </button>
              <p className="small" id={reasonId}>
                {blocker ?? (
                  <>
                    {summary.before}<b>{summary.strong}</b>{summary.after}
                  </>
                )}
              </p>
              {isDev && onAddBot && (
                <button type="button" className="btn btn-secondary btn-sm btn-block" disabled={addingBot} aria-busy={addingBot || undefined} onClick={handleAddBot}>
                  <UserPlus className="ic sm" aria-hidden="true" />Add bot
                </button>
              )}
            </SheetPanel>
          )}

          <SheetPanel
            title="Setup"
            aside={
              isCreator && !isTheme && !isEditingConfig ? (
                <button type="button" className="edit-cap" onClick={handleStartEditConfig}>Edit setup</button>
              ) : isCreator && isTheme ? (
                "can't be changed here"
              ) : undefined
            }
          >
            <dl className="rows">
              {rows.map((row) => (
                <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
              ))}
            </dl>
            {sets.length > 0 && (
              <div className={styles.sets}>
                <p>Sets</p>
                <ul>{sets.map((name) => <li key={name} className="chip">{name}</li>)}</ul>
              </div>
            )}
          </SheetPanel>

          {isCreator && (
            <DangerZone title="Ending early">
              {showCancelConfirm ? (
                <div onKeyDown={cancelConfirm.onKeyDown}>
                <ConfirmPanel
                  title="Cancel this draft?"
                  confirmLabel="Yes, cancel"
                  cancelLabel="Go back"
                  busy={cancelling}
                  onCancel={() => setShowCancelConfirm(false)}
                  onConfirm={handleCancel}
                >
                  <p className="small">It ends for the {plural(playerCount, "player")} who joined. Nothing has been dealt yet.</p>
                </ConfirmPanel>
                </div>
              ) : (
                <DangerRow
                  title="Cancel draft"
                  description={`Ends it for the ${plural(playerCount, "player")} who joined. Nothing has been dealt yet.`}
                  action={
                    <button ref={cancelConfirm.triggerRef} type="button" className="btn btn-danger btn-sm" aria-label="Cancel draft" onClick={() => setShowCancelConfirm(true)}>
                      <X className="ic sm" aria-hidden="true" />Cancel
                    </button>
                  }
                />
              )}
            </DangerZone>
          )}
        </aside>
      </div>
    </SheetRoot>
  );
}
