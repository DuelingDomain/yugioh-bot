"use client";

import * as React from "react";
import type { DraftAllowedCube, DraftLobbyResponse, LobbySnapshot } from "@yugidraft/shared/types";
import { InviteModal } from "../lobby/invite-modal";
import { useLobbyController } from "../lobby/lobby-actions";
import {
  fallbackLobby,
  newerLobby,
  normalizePlayers,
  plural,
  seatSlots,
  type RosterInput,
} from "../lobby/lobby-model";
import { PoolDrawer } from "../lobby/pool-drawer";
import { ThemeBox } from "./theme-box";
import { ThemeOval, ThemeSeats } from "./theme-seat";
import { draftLine, ThemeTableCard } from "./theme-table-card";
import { useCubePreview, useThemeTable, type ThemeTableConfig } from "./use-theme-table";
import styles from "./theme-table.module.css";

export interface ThemeTableLobbyProps {
  /** The draft slug. Every request of the table goes to `/api/drafts/[slug]/...`. */
  slug: string;
  draft: {
    name: string;
    /** The theme rules; any other config field is ignored. */
    config: ThemeTableConfig;
    /** The lobby snapshot from the draft response. Without it the table shows a legacy snapshot and no seat target. */
    lobby?: LobbySnapshot;
    players: RosterInput[];
    seats?: Array<{ playerId: number; isCurrentPlayer: boolean }>;
    allowedCubes?: DraftAllowedCube[];
  };
  /** The viewer is the host. Only the host edits the rules and the box. */
  isCreator: boolean;
  /** The viewer holds a seat. */
  isParticipant: boolean;
  /** Join stays with the page, as it also reloads the draft. */
  onJoin?: () => Promise<void>;
  onAddBot?: () => Promise<void>;
  /** Show Add bot. The server decides; the table never reads the environment. */
  botsEnabled?: boolean;
  /** The Discord bot is on (the draft API's `discordEnabled`). When false there is no Nudge, no Post to Discord and no Discord text. */
  discordEnabled?: boolean;
  /** The viewer's user id. The box uses it to say whose library a Delete leaves. */
  viewerUserId?: string | null;
  /** The page refetches the draft. Called after a join, a leave, a claim, an attach or a stale answer. */
  onChanged?: () => void;
}

/**
 * The Theme Table: where each player picks, or sees, the theme pool they will draft from. It is only the lobby step.
 * After Start the normal theme draft runs, each player alone from their own pool. The component renders the body only;
 * the page puts it in its frame.
 */
export function ThemeTableLobby({ slug, draft, isCreator, isParticipant, onJoin, onAddBot, botsEnabled, discordEnabled = false, viewerUserId, onChanged }: ThemeTableLobbyProps) {
  const youIds = React.useMemo(
    () => new Set((draft.seats ?? []).filter((s) => s.isCurrentPlayer).map((s) => s.playerId)),
    [draft.seats],
  );
  const roster = React.useMemo(() => normalizePlayers(draft.players, { youIds, isCreator }), [draft.players, youIds, isCreator]);
  const [answer, setAnswer] = React.useState<DraftLobbyResponse | null>(null);
  const lobbyFallback = React.useMemo(() => fallbackLobby(roster, Date.now()), [roster]);
  const view: DraftLobbyResponse = draft.lobby
    ? answer && answer.lobby.revision > draft.lobby.revision
      ? answer
      : { lobby: draft.lobby, players: roster }
    : { lobby: lobbyFallback, players: roster };
  const { lobby, players } = view;
  const rosterSize = React.useRef(roster.length);
  React.useEffect(() => { rosterSize.current = players.length; });
  const refetch = React.useCallback(() => onChanged?.(), [onChanged]);

  const controller = useLobbyController({
    slug,
    lobby,
    onResponse: React.useCallback((response: DraftLobbyResponse) => {
      setAnswer((current) => newerLobby(current, response));
      if (response.players.length !== rosterSize.current) onChanged?.();
    }, [onChanged]),
    onRefetch: refetch,
  });

  const cubes = draft.allowedCubes ?? [];
  const table = useThemeTable({ slug, lobby, players, config: draft.config, allowedCubes: cubes, controller, onChanged: refetch });
  const { preview, open: openPreview, close: closePreview } = useCubePreview();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const inviteButton = React.useRef<HTMLButtonElement>(null);

  const me = players.find((p) => p.isYou) ?? null;
  const slots = seatSlots(players, lobby.targetSeats);
  const previewCube = preview ? cubes.find((c) => c.id === preview.cubeId) : undefined;

  // Start waits for the pieces only the theme step knows: a theme for every seat when the host gives them out,
  // a theme for every human when players pick (the server checks the same, so this only explains the button).
  let blocker: string | null = null;
  if (cubes.length === 0) blocker = "Add at least one theme to the box.";
  else if (table.preflight.errors.length > 0) blocker = table.preflight.errors[0];
  else if (table.selection === "host_assigned" && table.unassigned.length > 0) {
    blocker = `Give ${plural(table.unassigned.length, "seat")} a theme.`;
  }

  return (
    <div className={styles.page} data-seats={slots.length}>
      <div className={styles.layout}>
        <div className={styles.tableCol}>
          <ThemeOval
            slots={slots}
            table={table}
            cubes={cubes}
            centre={
              <>
                <span className={styles.discTheme}>{lobby.targetSeats ? `${lobby.joined} of ${lobby.targetSeats} seats` : plural(lobby.joined, "player")}</span>
                <span className={styles.matLine}>{draftLine(draft.config)}</span>
              </>
            }
          />
          <ThemeSeats
            players={players}
            lobby={lobby}
            table={table}
            cubes={cubes}
            controller={controller}
            isHost={isCreator}
            isMember={isParticipant}
            onInvite={() => setInviteOpen(true)}
            onAddBot={onAddBot}
            botsEnabled={botsEnabled}
            discordEnabled={discordEnabled}
            inviteRef={inviteButton}
          />
        </div>
        <ThemeBox
          slug={slug}
          cubes={cubes}
          table={table}
          controller={controller}
          isHost={isCreator}
          canTake={isParticipant && table.selection === "player_pick" && lobby.start === null}
          yourCubeId={me ? table.cubeOf(me.playerId) : null}
          onPreview={openPreview}
          onChanged={refetch}
          viewerUserId={viewerUserId}
        />
        <ThemeTableCard
          slug={slug}
          name={draft.name}
          config={draft.config}
          lobby={lobby}
          players={players}
          cubeIds={cubes.map((c) => c.id)}
          table={table}
          controller={controller}
          isHost={isCreator}
          isMember={isParticipant}
          blocker={blocker}
          onJoin={onJoin}
          onExpire={refetch}
          onInvite={() => setInviteOpen(true)}
        />
      </div>

      {preview && (
        <PoolDrawer
          cards={preview.cards}
          extraCards={preview.extraCards}
          loading={preview.cards === null && !preview.error}
          error={preview.error}
          title={previewCube?.name ?? "Theme"}
          detail="The cards a player gets to pick from with this theme"
          onClose={closePreview}
        />
      )}
      {inviteOpen && (
        <InviteModal slug={slug} onClose={() => setInviteOpen(false)} controller={controller} canPost={isCreator} discordEnabled={discordEnabled} returnFocusRef={inviteButton} />
      )}
    </div>
  );
}
