"use client";

import * as React from "react";
import { Pencil, UserPlus } from "lucide-react";
import { Mono, SectionHead, StageLine, StatusLine, SvButton, svButtonClass, type StageStep } from "@/components/sheet";
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
import { DangerConfirm } from "./danger-confirm";
import { formatPickSeconds } from "./pick-time";
import { useInlineConfirm } from "./use-inline-confirm";
import { DraftFrame, DraftLayout, DraftMain, DraftRail, Gem, Pieces, RailNote, RailSection, Rules } from "./draft-frame";

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
  /** Show Add bot. The server decides (see draftTestBotsEnabled); the view never reads the environment. */
  botsEnabled?: boolean;
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
  botsEnabled,
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

  const [boosterPreflight, setBoosterPreflight] = React.useState<{ errors: string[]; warnings: string[] } | null>(null);
  const boosterPreflightKey = JSON.stringify([draft.config, draft.players.map((player) => player.playerId)]);
  React.useEffect(() => {
    let live = true;
    setBoosterPreflight(null);
    if (!slug || isTheme) return;
    fetch(`/api/drafts/${slug}/preflight`)
      .then((res) => res.ok ? res.json() : { errors: [], warnings: [] })
      .then((data) => {
        if (live) setBoosterPreflight({ errors: data.errors ?? [], warnings: data.warnings ?? [] });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [slug, isTheme, boosterPreflightKey]);

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
  ].filter(Boolean).join(", ");

  const stages: StageStep[] = isTheme
    ? [
        { label: "Lobby", state: "now" },
        { label: "Main deck", state: "next" },
        ...(themeExtraOn(draft.config) ? [{ label: "Extra deck", state: "next" as const }] : []),
        { label: "Build deck", state: "next" },
      ]
    : [
        { label: "Lobby", state: "now" },
        { label: "Draft", state: "next" },
        { label: "Build deck", state: "next" },
      ];

  const poolDetail = isEditingConfig
    ? poolSources(editFields.setNames.length, parseCustomCardIds(editFields.customCardText).cardIds.length)
    : poolSources(draft.config.setNames?.length ?? 0, draft.config.customCardIds?.length ?? 0);

  const kind = isTheme ? "Theme draft" : "Cube draft";
  const isGuest = !isCreator && !isParticipant;

  const joinPieces = [
    { content: kind, strong: true },
    ...(isTheme
      ? [
          { content: `${draft.config.cardsPerPlayer ?? 40} main deck picks` },
          ...(themeExtraOn(draft.config) ? [{ content: `${draft.config.extraDeckSize ?? 15} Extra deck picks` }] : []),
        ]
      : [{ content: `${plural(packsOf(draft.config), "pack")} of ${draft.config.packSize ?? 15}` }]),
    ...(draft.config.pickSeconds ? [{ content: `${formatPickSeconds(draft.config.pickSeconds)} a pick` }] : []),
    { content: `${plural(playerCount, "player")} so far` },
  ];

  const actions = (
    <>
      {error && (
        <div role="alert">
          <StatusLine tone="block">{error}</StatusLine>
        </div>
      )}
      {isGuest && (
        <SvButton variant="primary" big wide disabled={joining} aria-busy={joining || undefined} onClick={handleJoin}>
          <UserPlus size={18} aria-hidden="true" />Join draft
        </SvButton>
      )}
      {isCreator && (
        <>
          <SvButton
            variant="primary"
            big
            wide
            disabled={blocker !== null || starting}
            aria-busy={starting || undefined}
            aria-describedby={reasonId}
            onClick={handleStart}
          >
            Start draft
          </SvButton>
          <p className={styles.start} id={reasonId}>
            {blocker ? (
              <span className={styles.reason}>{blocker}</span>
            ) : (
              <>
                {summary.before}<b>{summary.strong}</b>{summary.after}
              </>
            )}
          </p>
          {botsEnabled && onAddBot && (
            <SvButton variant="ghost" wide disabled={addingBot} aria-busy={addingBot || undefined} onClick={handleAddBot}>
              <UserPlus size={16} aria-hidden="true" />Add bot
            </SvButton>
          )}
        </>
      )}
    </>
  );
  const hasActions = isGuest || isCreator || Boolean(error);

  return (
    <DraftFrame
      title={draft.name}
      back={{ href: "/drafts", label: "All drafts" }}
      actions={
        isCreator && !editing ? (
          <button type="button" className={styles.ren} onClick={() => setEditing(true)} aria-label="Rename draft" title="Rename draft">
            <Pencil size={17} aria-hidden="true" />
          </button>
        ) : undefined
      }
    >
      <DraftLayout>
        <DraftMain>
          {editing && isCreator && (
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
              <SvButton variant="ghost" disabled={saving} aria-busy={saving || undefined} onClick={handleSaveName}>
                Save
              </SvButton>
              <SvButton
                variant="quiet"
                onClick={() => {
                  setNameValue(draft.name);
                  setEditing(false);
                }}
              >
                Cancel
              </SvButton>
            </div>
          )}

          {!isTheme && boosterPreflight?.errors.map((message) => (
            <div role="alert" key={message}>
              <StatusLine tone="block">{message}</StatusLine>
            </div>
          ))}
          {!isTheme && boosterPreflight?.warnings.map((message) => (
            <div role="status" key={message}>
              <StatusLine tone="warn">{message}</StatusLine>
            </div>
          ))}

          {isGuest ? (
            <section className={styles.join} aria-labelledby="lobby-join-t">
              <Mono name="" dashed you size="big" />
              <div>
                <h2 className={styles.joinT} id="lobby-join-t">Join {draft.name}</h2>
                <Pieces items={joinPieces} />
              </div>
            </section>
          ) : (
            <div className={styles.lead}>
              <StageLine steps={stages} label="Draft progress" />
              <Pieces
                items={[
                  { content: <><Gem />Waiting to start</>, strong: true },
                  { content: kind },
                  ...(isCreator ? [{ content: "Hosted by you" }] : []),
                  ...(created ? [{ content: `Created ${created}` }] : []),
                ]}
              />
            </div>
          )}

          {!isCreator && isParticipant && (
            <StatusLine tone="neutral">
              {isTheme && themeSelection === "player_pick"
                ? "You're in. Claim a theme before the host starts."
                : "You're in. Waiting for the host to start."}
            </StatusLine>
          )}

          {(isCreator || isParticipant) && slug && <InvitePanel slug={slug} />}

          <LobbySeats players={draft.players} youIds={youIds} isCreator={isCreator} aux={playersAux} />

          {isEditingConfig && !isTheme && (
            <section className={styles.edit} aria-labelledby="lobby-edit-t">
              <SectionHead title={<span id="lobby-edit-t">Edit setup</span>} note="The pool below updates as you go" />
              {editError && (
                <div role="alert">
                  <StatusLine tone="block">{editError}</StatusLine>
                </div>
              )}
              <DraftConfigFields
                value={editFields}
                onChange={setEditFields}
                poolBuilderShowPreview={false}
                onPool={handleEditPool}
              />
              <div className={styles.editActs}>
                <SvButton variant="ghost" disabled={configSaving} aria-busy={configSaving || undefined} onClick={handleSaveConfig}>
                  Save setup
                </SvButton>
                <SvButton variant="quiet" onClick={handleCancelEditConfig} disabled={configSaving}>
                  Cancel
                </SvButton>
              </div>
            </section>
          )}

          {!isTheme &&
            (isEditingConfig ? (
              <div className={styles.poolWrap}>
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
              </div>
            ) : (
              slug && (
                <div className={styles.poolWrap}>
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
                </div>
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
        </DraftMain>

        <DraftRail aria-label="Draft details" actions={hasActions ? actions : undefined}>
          <RailSection title="Setup" id="lobby-setup-t">
            <Rules rows={rows.map((row) => ({ label: row.label, value: row.value }))} />
            {sets.length > 0 && (
              <div className={styles.sets}>
                <p>Sets</p>
                <ul>{sets.map((name) => <li key={name} className="chip">{name}</li>)}</ul>
              </div>
            )}
            {isCreator && !isTheme && !isEditingConfig && (
              <SvButton variant="quiet" className={styles.editBtn} onClick={handleStartEditConfig}>Edit setup</SvButton>
            )}
            {isCreator && isTheme && <RailNote>Can&apos;t be changed here.</RailNote>}
          </RailSection>

          {isCreator && (
            <RailSection>
              {showCancelConfirm ? (
                <div onKeyDown={cancelConfirm.onKeyDown}>
                  <DangerConfirm
                    title="Cancel this draft?"
                    confirmLabel="Yes, cancel"
                    busy={cancelling}
                    consequence={`It ends for the ${plural(playerCount, "player")} who joined. Nothing has been dealt yet.`}
                    onBack={() => setShowCancelConfirm(false)}
                    onConfirm={handleCancel}
                  />
                </div>
              ) : (
                <>
                  <button
                    ref={cancelConfirm.triggerRef}
                    type="button"
                    className={svButtonClass("danger", { wide: true })}
                    onClick={() => setShowCancelConfirm(true)}
                  >
                    Cancel draft
                  </button>
                  <RailNote>Ends it for the {plural(playerCount, "player")} who joined. Nothing has been dealt yet.</RailNote>
                </>
              )}
            </RailSection>
          )}
        </DraftRail>
      </DraftLayout>
    </DraftFrame>
  );
}
