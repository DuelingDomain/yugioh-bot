"use client";

import * as React from "react";
import { Pencil, UserPlus } from "lucide-react";
import type { DraftLobbyResponse, DraftVisibility, LobbySnapshot } from "@yugidraft/shared/types";
import { Mono, SectionHead, StageLine, StatusLine, SvButton, SvCheck, svButtonClass, type StageStep } from "@/components/sheet";
import { CubeDraftBuilder } from "@/components/cubes/cube-draft-builder";
import { CubeLobbyPanel } from "@/components/cubes/cube-lobby-panel";
import {
  PackFields,
  type DraftConfigFieldsValue,
  configFromFields,
  validateFields,
  fieldsFromConfig,
} from "./draft-config-fields";
import { PoolEditor } from "./pool/pool-editor";
import { ExtraNote, PoolRailText, PoolRailValue, SeatNote } from "./pool/pool-rail";
import { usePoolEditor } from "./pool/use-pool-editor";
import { CardPoolPanel } from "@/components/cards/card-pool-panel";
import type { CardSummary } from "@/lib/card-types";
import { InvitePanel } from "./lobby/invite-panel";
import { InviteModal } from "./lobby/invite-modal";
import { HostInviteControls } from "./visibility/host-invite-controls";
import { LobbyBarSub } from "./visibility/visibility-badge";
import { LobbyActions, LobbyAutoStart, useLobbyController } from "./lobby/lobby-actions";
import { LobbySeats, SeatMeter, SeatSlots } from "./lobby/lobby-seats";
import {
  fallbackLobby,
  newerLobby,
  normalizePlayers,
  plural,
  setupRows,
  startBlocker,
  startSummary,
  themeExtraOn,
  packsOf,
  type RosterInput,
} from "./lobby/lobby-model";
import { PoolDrawer } from "./lobby/pool-drawer";
import styles from "./lobby/lobby.module.css";
import sf from "./lobby/seats-first.module.css";
import { rulesSummary } from "./setup/rules-model";
import { DangerConfirm } from "./danger-confirm";
import { formatPickSeconds } from "./pick-time";
import { useInlineConfirm } from "./use-inline-confirm";
import { DraftFrame, DraftLayout, DraftMain, DraftRail, Gem, Pieces, RailNote, RailSection, Rules } from "./draft-frame";

interface DraftManageViewProps {
  draft: {
    id: number;
    name: string;
    status: string;
    createdByUserId: number;
    createdAt: string;
    /** Who can see and join. Absent from an older server: the lobby then shows no badge and treats the invite as open. */
    visibility?: DraftVisibility;
    /** The server's verdict on taking a seat. Join and Take a seat show only when it is true; absent means allowed. */
    canJoin?: boolean;
    /** Present (true) only for the host: the invite link, the switch and Reset are theirs. */
    canManageInvite?: boolean;
    config: {
      packSize?: number;
      packsPerPlayer?: number;
      cardsPerPlayer?: number;
      pickSeconds?: number;
      setNames?: string[];
      customCardIds?: number[];
      /** The cube the pool started from. Absent for a pool built for this draft. */
      poolSource?: { cubeId: number; cubeName: string };
      alternatePassDirection?: boolean;
      randomizeSeats?: boolean;
      copyLimit?: boolean;
      mode?: "booster" | "theme";
      themeSelection?: "host_assigned" | "random" | "player_pick";
      uniqueThemes?: boolean;
      themePackSize?: number;
      extraDeckEnabled?: boolean;
      extraDeckSize?: number;
      burnUnpicked?: boolean;
      lobbySeats?: number;
    };
    /** The lobby snapshot of a server that has lobbies. Without it the view keeps the legacy list and manual start. */
    lobby?: LobbySnapshot;
    seats?: Array<{ playerId: number; isCurrentPlayer: boolean }>;
    allowedCubes?: Array<{
      id: number;
      name: string;
      archetype: string | null;
      mainCount: number;
      extraCount: number;
      sampleImages: string[];
    }>;
    players: Array<RosterInput & { pickCount: number; joinedAt: string }>;
    playerCount: number;
  };
  isCreator: boolean;
  isParticipant: boolean;
  onStart: () => Promise<void>;
  onCancel: () => Promise<void>;
  onUpdate: (data: { name?: string; config?: unknown; revision?: number }) => Promise<void>;
  onJoin: () => Promise<void>;
  onAddBot?: () => Promise<void>;
  /** Show Add bot. The server decides (see draftTestBotsEnabled); the view never reads the environment. */
  botsEnabled?: boolean;
  /** The Discord bot is on (the draft API's `discordEnabled`). When false there is no Nudge, no Post to Discord and no Discord text. Default off. */
  discordEnabled?: boolean;
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
  discordEnabled = false,
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
  // A server with lobbies sends `lobby`: the normal draft then gets Seats First. Without it, or for a theme draft,
  // the older list and manual start stay.
  const seatsFirst = !isTheme && Boolean(draft.lobby);

  const [boosterPreflight, setBoosterPreflight] = React.useState<{ errors: string[]; warnings: string[] } | null>(null);
  const boosterPreflightKey = JSON.stringify([draft.config, draft.players.map((player) => player.playerId)]);
  React.useEffect(() => {
    let live = true;
    setBoosterPreflight(null);
    if (!slug || isTheme || draft.lobby) return;
    fetch(`/api/drafts/${slug}/preflight`)
      .then((res) => res.ok ? res.json() : { errors: [], warnings: [] })
      .then((data) => {
        if (live) setBoosterPreflight({ errors: data.errors ?? [], warnings: data.warnings ?? [] });
      })
      .catch(() => {});
    return () => { live = false; };
    // `draft.lobby` only decides whether to ask; the key already follows the config and the players.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isTheme, boosterPreflightKey]);

  // Card pool (booster only)
  const [poolCards, setPoolCards] = React.useState<CardSummary[] | null>(null);
  const [poolExtra, setPoolExtra] = React.useState<CardSummary[]>([]);
  const [poolError, setPoolError] = React.useState(false);
  const loadPool = React.useCallback(() => {
    if (!slug || isTheme) return;
    setPoolCards(null);
    setPoolError(false);
    fetch(`/api/drafts/${slug}/pool`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { cards: CardSummary[]; extraCards?: CardSummary[] }) => {
        setPoolCards(data.cards);
        setPoolExtra(data.extraCards ?? []);
      })
      .catch(() => setPoolError(true));
  }, [slug, isTheme]);
  React.useEffect(() => { loadPool(); }, [loadPool]);
  // The newest lobby revision this view saw (set below, after the Seats First state), so a save after the host's own
  // Ready does not send the page's older revision.
  const lobbyRevision = React.useRef<number | undefined>(undefined);
  const onUpdateWithPoolRefresh = React.useCallback(async (data: { name?: string; config?: unknown }) => {
    await onUpdate({ ...data, revision: lobbyRevision.current });
    if (data.config !== undefined) loadPool();
  }, [onUpdate, loadPool]);

  // Config edit mode. The pool is the shared pool editor's; the pack fields are plain text fields.
  const [isEditingConfig, setIsEditingConfig] = React.useState(false);
  const [editFields, setEditFields] = React.useState<DraftConfigFieldsValue>(() => fieldsFromConfig(draft.config));
  const [editError, setEditError] = React.useState<string | null>(null);
  const [configSaving, setConfigSaving] = React.useState(false);
  const poolEditor = usePoolEditor({
    variant: "lobby",
    slug: slug ?? "",
    poolSource: draft.config.poolSource ?? null,
    enabled: isEditingConfig && !isTheme && Boolean(slug),
  });

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
    setEditFields(fieldsFromConfig(draft.config));
    setEditError(null);
    setIsEditingConfig(true);
  };

  const handleCancelEditConfig = () => {
    setIsEditingConfig(false);
    setEditFields(fieldsFromConfig(draft.config));
    setEditError(null);
  };

  const handleSaveConfig = async () => {
    setEditError(null);
    if (poolEditor.loading) return;
    if (!poolEditor.ready || poolEditor.loadError) { setEditError("The pool hasn't loaded yet."); return; }
    if (poolEditor.pool.size === 0 && poolEditor.extra.size === 0) { setEditError("Add cards to the pool first"); return; }
    const err = validateFields(editFields);
    if (err) { setEditError(err); return; }

    setConfigSaving(true);
    try {
      // Sets are always written out as cards (setNames []), and a pool with no cube behind it clears poolSource (null).
      await onUpdateWithPoolRefresh({
        config: { ...configFromFields(editFields), ...poolEditor.config(), includeNames: [], excludeNames: [] },
      });
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

  // Seats First state. The newest lobby answer wins: a mutation answer stands until the page's own data has caught up.
  const roster = React.useMemo(() => normalizePlayers(draft.players, { youIds, isCreator }), [draft.players, youIds, isCreator]);
  const [answer, setAnswer] = React.useState<DraftLobbyResponse | null>(null);
  const lobbyView: DraftLobbyResponse | null = draft.lobby
    ? answer && answer.lobby.revision > draft.lobby.revision
      ? answer
      : { lobby: draft.lobby, players: roster }
    : null;
  const lobbyFallback = React.useMemo(() => fallbackLobby(roster, Date.now()), [roster]);
  const rosterSize = React.useRef(roster.length);
  React.useEffect(() => {
    rosterSize.current = lobbyView?.players.length ?? roster.length;
    lobbyRevision.current = lobbyView?.lobby.revision;
  });
  const controller = useLobbyController({
    slug: slug ?? "",
    lobby: lobbyView?.lobby ?? lobbyFallback,
    onResponse: React.useCallback((response: DraftLobbyResponse) => {
      setAnswer((current) => newerLobby(current, response));
      // A seat joined or left: the page's own data (who is a participant) has to follow.
      if (response.players.length !== rosterSize.current) onChanged?.();
    }, [onChanged]),
    onRefetch: onChanged,
  });
  const [poolOpen, setPoolOpen] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const poolButton = React.useRef<HTMLButtonElement>(null);
  const inviteButton = React.useRef<HTMLButtonElement>(null);
  const editSection = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (seatsFirst && isEditingConfig) editSection.current?.focus();
  }, [seatsFirst, isEditingConfig]);
  const allowedCubes = draft.allowedCubes ?? [];
  const uniqueThemes = draft.config.uniqueThemes ?? true;
  const themeSelection = draft.config.themeSelection ?? "player_pick";
  const created = formatCreated(draft.createdAt);
  const blocker = startBlocker({ playerCount, isTheme, themeCount: allowedCubes.length, uniqueThemes });
  const summary = startSummary(draft.config, playerCount);
  const savedPoolName = draft.config.poolSource?.cubeName ?? null;
  const poolDetail = savedPoolName ? `From ${savedPoolName}` : "Built for this draft";
  const editConfig = configFromFields(editFields);
  const editPerPlayer = editConfig.packsPerPlayer * editConfig.packSize;
  const livePool = isEditingConfig && poolEditor.ready && !poolEditor.loadError;
  const sets = !isTheme ? draft.config.setNames ?? [] : [];
  const savedTotal = poolCards ? poolCards.reduce((sum, card) => sum + (card.qty ?? 1), 0) : 0;
  const rows: Array<{ label: string; value: React.ReactNode }> = setupRows(draft.config);
  if (!isTheme) {
    rows.unshift({
      label: "Pool",
      value: isEditingConfig && poolEditor.loading ? (
        <PoolRailValue ctl={poolEditor} />
      ) : livePool ? (
        <PoolRailValue ctl={poolEditor} />
      ) : poolCards ? (
        <PoolRailText baseName={savedPoolName} edited={false} total={savedTotal} empty={poolCards.length === 0} />
      ) : (
        savedPoolName ?? "Built for this draft"
      ),
    });
  }
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


  const kind = isTheme ? "Theme draft" : "Cube draft";
  const isGuest = !isCreator && !isParticipant;
  // Join is the server's call (`canJoin`), not the page's guess from seats.
  const canJoin = draft.canJoin ?? true;
  const canManageInvite = draft.canManageInvite === true;
  // A private draft has no link a seated player can pass on: only the host holds the invite.
  const inviteShareable = draft.visibility !== "private" || canManageInvite;
  const pendingNow = draft.status === "pending";
  const barSub = <LobbyBarSub visibility={draft.visibility} />;

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
      {isGuest && canJoin && (
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
  const hasActions = (isGuest && canJoin) || isCreator || Boolean(error);

  const editPanel = (className: string) => (
    <section className={className} aria-labelledby="lobby-edit-t" ref={editSection} tabIndex={-1}>
      <SectionHead title={<span id="lobby-edit-t">Edit setup</span>} note="Changes apply when you save" />
      {editError && (
        <div role="alert">
          <StatusLine tone="block">{editError}</StatusLine>
        </div>
      )}
      <PoolEditor ctl={poolEditor} extraRound={editConfig.extraDeckEnabled} />
      <PackFields value={editFields} onChange={setEditFields}>
        {editConfig.extraDeckEnabled && livePool && (
          <ExtraNote className="wide" size={editConfig.extraDeckSize} total={poolEditor.extraTotal} players={Math.max(2, playerCount)} />
        )}
      </PackFields>
      <div className={styles.editActs}>
        <SvButton variant="ghost" disabled={configSaving || poolEditor.loading} aria-busy={configSaving || poolEditor.loading || undefined} onClick={handleSaveConfig}>
          Save setup
        </SvButton>
        <SvButton variant="quiet" onClick={handleCancelEditConfig} disabled={configSaving}>
          Cancel
        </SvButton>
      </div>
    </section>
  );
  const cancelNode = (
    showCancelConfirm ? (
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
    )
  );

  if (seatsFirst && lobbyView) {
    const { lobby, players } = lobbyView;
    const seatsLine = lobby.targetSeats ? `${lobby.joined} of ${lobby.targetSeats} seats` : plural(lobby.joined, "player");
    const poolTotalText = poolCards ? `${savedTotal} ${savedTotal === 1 ? "card" : "cards"}` : poolError ? "Not loaded" : "Loading";
    return (
      <DraftFrame
        title={draft.name}
        sub={barSub}
        back={{ href: "/drafts", label: "All drafts" }}
        actions={
          isCreator && !editing ? (
            <button type="button" className={styles.ren} onClick={() => setEditing(true)} aria-label="Rename draft" title="Rename draft">
              <Pencil size={17} aria-hidden="true" />
            </button>
          ) : undefined
        }
      >
        <div className={sf.page}>
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
              <SvButton variant="quiet" onClick={() => { setNameValue(draft.name); setEditing(false); }}>
                Cancel
              </SvButton>
            </div>
          )}
          {error && (
            <div role="alert">
              <StatusLine tone="block">{error}</StatusLine>
            </div>
          )}

          {isGuest && canJoin ? (
            <section className={sf.join} aria-labelledby="lobby-join-t">
              <Mono name="" dashed you size="big" />
              <div>
                <h2 className={sf.joinT} id="lobby-join-t">Join {draft.name}</h2>
                <Pieces items={joinPieces} />
              </div>
            </section>
          ) : (
            <div className={sf.lead}>
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

          {(lobby.errors.length > 0 || lobby.warnings.length > 0) && (
            <div className={sf.problems}>
              {lobby.errors.map((message) => (
                <div role="alert" key={`e-${message}`}><StatusLine tone="block">{message}</StatusLine></div>
              ))}
              {lobby.warnings.map((message) => (
                <div role="status" key={`w-${message}`}><StatusLine tone="warn">{message}</StatusLine></div>
              ))}
            </div>
          )}

          <section className={sf.seatsSec} aria-labelledby="lobby-seats-t">
            <SectionHead title={<span id="lobby-seats-t">Seats</span>} note={seatsLine} />
            <SeatSlots
              players={players}
              lobby={lobby}
              controller={controller}
              isHost={isCreator}
              isMember={isCreator || isParticipant}
              botsEnabled={botsEnabled}
              discordEnabled={discordEnabled}
              onAddBot={onAddBot}
              onInvite={inviteShareable ? () => setInviteOpen(true) : undefined}
              inviteRef={inviteButton}
            />
          </section>

          <div className={sf.launch}>
            <SeatMeter lobby={lobby} className={sf.meter} />
            <LobbyAutoStart lobby={lobby} controller={controller} isHost={isCreator} className={sf.auto} />
            <LobbyActions
              lobby={lobby}
              players={players}
              controller={controller}
              isHost={isCreator}
              isMember={isParticipant}
              onJoin={onJoin}
              canJoin={canJoin}
              onExpire={onChanged}
            />
          </div>

          <ul className={sf.cards}>
            <li className={sf.card}>
              <h3 className={sf.cardT}>Card pool</h3>
              <p className={sf.cardV}>{poolTotalText}</p>
              <p className={sf.cardNote}>{poolDetail}</p>
              <button ref={poolButton} type="button" className={svButtonClass("ghost", {}) + " " + sf.cardBtn} onClick={() => setPoolOpen(true)}>View pool</button>
            </li>
            <li className={sf.card}>
              <h3 className={sf.cardT}>Rules</h3>
              <p className={sf.cardV}>{rulesSummary(fieldsFromConfig(draft.config))}</p>
              <Rules className={sf.rulesList} rows={setupRows(draft.config)} />
              {isCreator && !isEditingConfig && (
                <SvButton variant="quiet" className={sf.cardBtn} onClick={handleStartEditConfig}>Edit setup</SvButton>
              )}
            </li>
            {canManageInvite && draft.visibility && slug ? (
              <li className={sf.card}>
                <h3 className={sf.cardT}>Invite</h3>
                <HostInviteControls slug={slug} visibility={draft.visibility} pending={pendingNow} onChanged={onChanged} />
              </li>
            ) : inviteShareable ? (
              <li className={sf.card}>
                <h3 className={sf.cardT}>Invite</h3>
                <p className={sf.cardV}>Share the link</p>
                <p className={sf.cardNote}>Anyone in the server can join.</p>
                <SvButton variant="ghost" className={sf.cardBtn} onClick={() => setInviteOpen(true)}>Invite players</SvButton>
              </li>
            ) : null}
          </ul>

          {isEditingConfig && editPanel(sf.edit)}

          {isCreator && <div className={sf.danger}>{cancelNode}</div>}
        </div>

        {poolOpen && (
          <PoolDrawer
            cards={poolCards}
            extraCards={poolExtra}
            loading={poolCards === null && !poolError}
            error={poolError ? "Couldn't load the pool." : null}
            detail={poolDetail}
            onClose={() => setPoolOpen(false)}
            onEdit={isCreator && !isEditingConfig ? () => { setPoolOpen(false); handleStartEditConfig(); } : undefined}
            returnFocusRef={poolButton}
          />
        )}
        {inviteOpen && slug && (
          <InviteModal
            slug={slug}
            access={{ visibility: draft.visibility, canManage: canManageInvite, pending: pendingNow, onChanged }}
            onClose={() => setInviteOpen(false)}
            controller={controller}
            canPost={isCreator}
            discordEnabled={discordEnabled}
            returnFocusRef={inviteButton}
          />
        )}
      </DraftFrame>
    );
  }

  return (
    <DraftFrame
      title={draft.name}
      sub={barSub}
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

          {isGuest && canJoin ? (
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

          {(isCreator || isParticipant) && slug && inviteShareable && (
            <InvitePanel slug={slug} discordEnabled={discordEnabled} visibility={draft.visibility} canManageInvite={canManageInvite} pending={pendingNow} onChanged={onChanged} />
          )}

          <LobbySeats players={draft.players} youIds={youIds} isCreator={isCreator} aux={playersAux} />

          {isEditingConfig && !isTheme && editPanel(styles.edit)}

          {!isTheme && !isEditingConfig && slug && (
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
          )}

          {isTheme && slug && (
            isCreator ? (
              <CubeDraftBuilder
                slug={slug}
                copyLimit={draft.config.copyLimit ?? true}
                allowedCubes={allowedCubes}
                uniqueThemes={uniqueThemes}
                themeSelection={themeSelection}
                canClaim={isParticipant}
                onChanged={() => onChanged?.()}
              />
            ) : (
              <CubeLobbyPanel
                slug={slug}
                copyLimit={draft.config.copyLimit ?? true}
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
            {!isTheme && (
              <SeatNote
                total={livePool ? poolEditor.total : savedTotal}
                perPlayer={livePool ? editPerPlayer : (draft.config.packsPerPlayer ?? 3) * (draft.config.packSize ?? 15)}
              />
            )}
            {sets.length > 0 && (
              <div className={styles.sets}>
                <p>Sets</p>
                <ul>{sets.map((name) => <li key={name} className="chip">{name}</li>)}</ul>
              </div>
            )}
            {isCreator && !isTheme && !isEditingConfig && (
              <SvButton variant="quiet" className={styles.editBtn} onClick={handleStartEditConfig}>Edit setup</SvButton>
            )}
            {isCreator && isTheme && (
              <SvCheck
                compact
                className={styles.copyLimit}
                label="Limit 3 copies per card"
                checked={draft.config.copyLimit ?? true}
                onChange={(e) => void onUpdateWithPoolRefresh({ config: { copyLimit: e.target.checked } })}
              />
            )}
          </RailSection>

          {isCreator && <RailSection>{cancelNode}</RailSection>}
        </DraftRail>
      </DraftLayout>
    </DraftFrame>
  );
}
