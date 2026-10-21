"use client";

import { ownClockSeat } from "./clock-beep";
import { useLowClockBeep } from "./use-low-clock-beep";
import { tableTextStyle, useCardTextSize, useTableTextScale } from "./card-text-size";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { Ban, Circle, Diamond, ExternalLink, Eye, Flag, Radio, Volume2, VolumeX } from "lucide-react";
import { isCustomDomain, seatCountFor, type DuelAnswer, type DuelCard, type DuelCardInfo, type DuelChainLink, type DuelDeck, type DuelEvent, type DuelPromptOption, type DuelRoom, type DuelSeatView } from "@yugidraft/shared/duels";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SurrenderModal } from "./surrender-modal";
import { useTestDuelQuit } from "./test-duel-quit";
import { forgetTestDuelReturn, testDuelReturnPath } from "@/components/decks/test-duel";
import { DeckSurrenderContext, type DeckSurrenderValue } from "./deck-surrender";
import { BugReportHeaderButton } from "../bug-report/bug-report-header-button";
import { HeaderToolLabel } from "./header-tool-label";
import { BugReportMenuButton } from "../bug-report/bug-report-menu-button";
import { useBugReportRoom } from "../bug-report/room-store";
import { connectionLabel as labelForConnection } from "./connection-label";
import { Sheet } from "@/components/ui/sheet";
import { useDuelWebsocket } from "@/lib/hooks/use-duel-websocket";
import { createEchoWindow } from "@/lib/duel-echo-window";
import { applyAnswerResult } from "./answer-result";
import { useChainModeControl } from "./use-chain-mode";
import { useDuelRoomActivity } from "@/lib/hooks/use-duel-room-activity";
import { useDuelLeaveGuard } from "@/lib/hooks/use-duel-leave-guard";
import { useBlockBrowserContextMenu } from "@/lib/hooks/use-block-browser-context-menu";
import {
  acceptDuelInvite,
  addPracticeBot,
  chooseOpeningOrder,
  pickOpeningMove,
  removePracticeBot,
  archiveDuel,
  cancelDuel,
  cancelReplayFork,
  duelRoomKey,
  getDuelRoom,
  isDuelAccessError,
  takeDuelSeat,
  leaveDuel,
  markDuelReady,
  markDuelUnready,
  sendDuelAction,
  setDuelDeck,
  restartReplayFork,
  startDuel,
  setChainResponseMode,
  surrenderDuel,
  type ForkViewControl,
} from "./api";
import { ReplayForkBar, ReplayForkResult, sourceReplayHref } from "./replay-fork-bar";
import { ForkSearchContext, followSeat, forkRoomState, forkViewSettled, livingSeats, useForkViewState } from "./replay-fork-control";
import { RoomEdgeLayer } from "./room-edge-layer";
import { RoomLobby } from "./room-lobby";
import { ReportButton } from "./report-button";
import { OpeningScreen } from "./opening";
import { StartingDuel, startingVariant } from "./starting-duel";
import { DeckMasterRail, DuelField } from "./field";
import { EXIT_CRUMBLE_MS, EXIT_CRUMBLE_REDUCED_MS } from "./table/rival-field";
import { FieldCracksScope } from "./field-cracks/context";
import { TableShell, type TableShellProps } from "./table/table-shell";
import type { ReplayCarry } from "./table/replay-mode";
import { ForkLabelsContext } from "./table/fork-labels";
import { MasterSeatsContext } from "./master-place";
import { MasterBadgeContext, SeatMasterBadge, type MasterBadgeSource } from "./master-badge";
import { TagShell } from "./tag/tag-shell";
import { fieldWaitsForReveal } from "./field-gate";
import { defaultTeamNames } from "./tag/live-tag";
import { useLiveTableController } from "./table/use-live-table-controller";
import { eliminationOrder } from "@/lib/duel/elimination-order";
import { duelActionErrorText } from "@/lib/duel/action-errors";
import { MultiSeatStage } from "./multi-seat-stage";
import { genesysLabel, genesysOf, sessionBoardRule } from "./genesys";
import { engineFormat, focusOpponentSeat, foeSeats, formatLabel, isMultiSeat, isOpponentPick, leavingOnlySeats, outOrLeavingSeats, outSeatOptionIds, seatPickFor, seatNamer, winnerLabel } from "./multi-seat";
import { resolveEquipLinks } from "./equip-links";
import styles from "./room.module.css";
import hudStyles from "./table/grid-hud.module.css";
import { hudPreview } from "./table/hud-preview";
import { GridHoverPreview } from "./table/grid-preview";
import { RowPreviewBoundary, useHudEscape, useHudPane, useDrawerPin, usePinFollowsHover, usePinSync, useRowPreview } from "./table/hud-layer";
import { clockStrip, hudClockBank, hudMasterProps, stationTrackProps } from "./table/hud-shared";
import { SEAT_TONE_HEX } from "./table/types";
import { AttackConfirm, CardActionMenu, PickRefusalHint, shakeRefusedCard, confirmSide, materialsMenu, targetName, zoneAnchor, type CardMenuState } from "./card-interactions";
import { DestroyFx } from "./destroy-fx";
import { FxBoundary, MoveSourceBoundary } from "./fx-boundary";
import { BattleFx, type BattleAim } from "./battle-fx";
import fxStyles from "./battle-fx.module.css";
import { DuelFeedback } from "./feedback";
import { duelFontClasses } from "./fonts";
import { DUEL_SHAKE_LABEL, DUEL_SHAKE_LEVELS, useDuelPreferences } from "./preferences";
import { DuelAnimationSpeedControl, useDuelAnimationSpeed } from "./animation-speed-control";
import { DuelCardTextSizeControl } from "./card-text-size-control";
import { DuelDiceSkinControl } from "./dice-skin-control";
import { CardInspector, cardScrollerProps, type InspectTarget } from "./inspector";
import {
  activatePromptFromField,
  isAttackTargetPrompt,
  isAttackDuelistPrompt,
  isDirectAttackPrompt,
  optionsForCard,
  optionZoneKeys,
  PromptTray,
  promptLegalKeys,
  promptSelectedKeys,
  usePromptDraft,
  type PromptAim,
} from "./prompts";
import { isBattlePhase, phaseTitle, zoneKey } from "./constants";
import { DuelResultScreen } from "./duel-result";
import { closeDuelWindow, duelWindowName, duelWindowPath, exitDuelWindow, isDuelWindow, liveDuelWindow, openDuelWindow, renameDuelWindow } from "./duel-window";
import { ownWindowGateVisible } from "./start-flow";
import { neutralStartBlocked, withoutNeutralStartBlocked } from "./start-blocked";
import { SeriesBanner, SeriesGameLabel } from "./series-banner";
import { BetweenGamesScreen, isStartingNextGame, NextGameStarting } from "./between-games";
import { isBetweenGames, isSeriesOpen, nextGameTarget, seriesPlayerIndex } from "./series-model";
import { SheetButton } from "./sheet-ui";
import { DuelClockDisplay, DuelSettingsSummary, DuelSoundControls, RoomInvite } from "./room-settings";
import { battleStepLabel, resolveBattleStep, StationTrack, type BattleStep } from "./station-track";
import { PhaseHub } from "./phase-hub";
import { MasterReturnFx } from "./master-return-fx";
import { MoveFx } from "./move-fx";
import { fxLayersUp, useStartBeats } from "./use-start-beats";
import { PositionFx } from "./position-fx";
import { ChainFx } from "./chain-fx";
import { ownPromptOpen } from "./chain-narrate";
import { CoinTossFx } from "./coin-toss-fx";
import { isCoinTossActive, useCoinTossLocked } from "./coin-toss-lock";
import { SummonFx } from "./summon-fx";
import { DuelHistoryRail } from "./history-rail";
import { centerKind, PromptCenter } from "./prompt-center";
import { skipsAnswerableWait, usePickContinuation } from "./pick-continuation";
import { usePromptAnswerable, usePromptReveal } from "./prompt-reveal";
import { boardQuietNow, useResultGate } from "./result-reveal";
import { useBoardView, type BoardMode } from "./board-view";
import { useQuietViewChange } from "./quiet-view-change";
import type { SolidRoomProps } from "./solid/solid-room";
import { buildAttackPreview } from "./solid/attack-preview";
import { useLiveChainLinks } from "./pile-chain-marks";
import { PileViewer } from "./pile-viewer";
import { livePileCards, livePileTitle, shouldClosePileForPrompt, type PileView } from "./pile-focus";
import { MatchSheetLog } from "./text-log";
import { withDestroyCards } from "./destroy-cards";
import { usePreviousSeats, withMasterSummonMoves } from "./master-summon-moves";
import {
  CardTabEmpty, DEFAULT_SIDE_PANE, DESKTOP_PANES, desktopPane, mobilePanes, SidePanel, SideTabs, useIsNarrow, type SidePane,
} from "./side-panel";


// The 3D mode look loads on demand: classic users never download it. The fallback is the table's own colour,
// inline because no solid CSS has loaded yet.
const SolidRoom = dynamic<SolidRoomProps>(() => import("./solid/solid-room").then((module) => module.SolidRoom), {
  ssr: false,
  loading: () => <div style={{ minHeight: "100dvh", background: "#04060b" }} />,
});

/** Slack after the crumble ends before an eliminated viewer switches to spectating. */
const NO_SEATS: readonly DuelSeatView[] = [];
const NO_CHAIN_EVENTS: readonly DuelEvent[] = [];
const NO_CHAIN_LINKS: readonly DuelChainLink[] = [];
const SPECTATE_AFTER_CRUMBLE_MS = 200;
/** The Card/Log/Settings sheet in 3D mode is a solid panel (the tokens come from the 3D mode root, which holds the sheet). */
const SOLID_SHEET_CLASS = "bg-[color:var(--ink-1)] border-t border-[color:var(--gold-b)] rounded-t-[16px] md:rounded-t-none";

/** The attack target the player pointed at; only the confirm submits it. */
type AimLock = { promptId: string; optionId: string; key: string; anchor: HTMLElement; name: string };


export function DuelRoomView({ slug, inviteCode, windowed = false, legacyStage = false, spectate = false, actorPlayerId = null, viewOverride }: {
  slug: string; inviteCode?: string; windowed?: boolean; legacyStage?: boolean; spectate?: boolean; actorPlayerId?: number | null;
  /** The page query `?view=3d|classic`: wins over the saved board look for this visit and is not saved. */
  viewOverride?: BoardMode;
}) {
  // Every live surface (1v1, FFA tables, Tag, spectating) renders under this component.
  useBlockBrowserContextMenu();
  useTableTextScale();
  const textSize = useCardTextSize();
  const router = useRouter();
  const admitted = useRef<{ slug: string; inviteCode: string } | null>(null);
  // Replay forks only: Follow prompt, Reveal hands and the seat the creator picked. Ordinary tables never leave the defaults,
  // and the room key then stays the plain one.
  const { mutate: purgeCache } = useSWRConfig();
  // Each fork view (seat and Reveal choice) has its own cache key. All of them go together, so a key used earlier
  // never shows its old room when it is asked for again.
  // A purge with `revalidate` on also drops the shared in-flight request of a key, so a view asked for again while its first
  // request is still running starts a new one (that request began before the purge stamp and SWR would discard it). The key on
  // screen is the one mounted hook: it is left out, or it would send a second request.
  const forkViewNow = useRef<ForkViewControl | null>(null);
  const purgeForkViews = useCallback(() => {
    const own = `/api/duels/${slug}`;
    const shown = duelRoomKey(slug, spectate, forkViewNow.current);
    return purgeCache((key) => typeof key === "string" && (key === own || key.startsWith(`${own}?`)), undefined,
      { revalidate: (_data: unknown, key: unknown) => key !== shown });
  }, [purgeCache, slug, spectate]);
  const forkView = useForkViewState(() => { void purgeForkViews(); });
  forkViewNow.current = forkView.view;
  const forkSeenFor = useRef<string | null>(null);
  const [forkSheetOpen, setForkSheetOpen] = useState(false);
  // Set while a fork view is refused (access lost). It holds until a room that arrived after the refusal is on screen, so a
  // cached or laggy view never comes back by itself.
  const [accessLostAt, setAccessLostAt] = useState<{ slug: string; at: number } | null>(null);
  const { data: rawData, error, isLoading, mutate } = useSWR(
    slug ? duelRoomKey(slug, spectate, forkView.view) : null,
    async () => {
      let admitError: unknown = null;
      if (inviteCode && (admitted.current?.slug !== slug || admitted.current.inviteCode !== inviteCode)) {
        // Try each invite once. A public table, a stale code or an existing grant must not block
        // the room: the normal GET below enforces access on its own.
        admitted.current = { slug, inviteCode };
        const url = new URL(window.location.href);
        url.searchParams.delete("invite");
        window.history.replaceState(window.history.state, "", url);
        try {
          await acceptDuelInvite(slug, inviteCode);
        } catch (err) {
          admitError = err;
        }
      }
      try {
        return await getDuelRoom(slug, spectate, forkView.view);
      } catch (err) {
        throw admitError ?? err;
      }
    },
    // A fork changes its key when the creator picks a seat; the old view stays up until the new one arrives (and answers wait for it).
    // Never after access was lost: SWR would hand the private view of the old key back.
    { revalidateOnFocus: false, revalidateOnReconnect: false,
      keepPreviousData: forkSeenFor.current === slug && !(accessLostAt != null && accessLostAt.slug === slug),
      // A fork view is asked for with a new key, and the purge above stamps a newer mutation time on it: SWR throws away a
      // request that started before that stamp. A finished request that is still shared (the default is 2 s) would be reused
      // for the same view asked for again and then discarded, and the table would stay on "catching up". So in a fork a finished
      // request is never reused (one still in flight is). This is also the only request a view change makes. Ordinary rooms
      // keep the default.
      dedupingInterval: forkSeenFor.current === slug ? 0 : undefined },
  );
  const idleDeadline = useDuelRoomActivity(rawData?.session.kind === "play" && rawData.session.status === "lobby"
    && rawData.mySeat != null && rawData.opening == null ? slug : null);
  const refreshRoom = useCallback(
    () => mutate(() => getDuelRoom(slug, spectate, forkView.view), { revalidate: false }),
    [mutate, slug, spectate, forkView.view],
  );
  // A replay fork keeps the creator's identity at seat 0 (the websocket, the token) and plays every seat. The table below
  // reads `data.mySeat` as the seat that acts, so it gets the acting seat; only the websocket keeps the stored one.
  const forkRefused = isDuelAccessError(error) && (rawData?.session.kind === "replay-fork" || forkSeenFor.current === slug);
  const forkAccessLost = forkRefused
    || (accessLostAt != null && accessLostAt.slug === slug && !(rawData != null && rawData.receivedAt > accessLostAt.at));
  const visibleRoom = forkAccessLost ? undefined : rawData;
  useEffect(() => {
    if (!forkRefused) return;
    setAccessLostAt((current) => (current?.slug === slug ? current : { slug, at: performance.now() }));
    // Every cached view of this table goes (each seat and Reveal choice has its own key), not only the one on screen.
    void purgeForkViews();
    void mutate(undefined, { revalidate: false });
  }, [forkRefused, slug, purgeForkViews, mutate]);
  // Access is back: a room that arrived after the refusal is on screen, so a later view change must not flash the
  // "no access" screen again while the next room loads.
  useEffect(() => {
    if (accessLostAt == null || forkRefused || rawData == null || rawData.receivedAt <= accessLostAt.at) return;
    setAccessLostAt(null);
  }, [accessLostAt, forkRefused, rawData]);
  const roomState = forkRoomState(visibleRoom);
  const forkControl = roomState.kind === "fork" ? roomState.control : null;
  const forkMode = forkControl != null;
  if (forkMode) forkSeenFor.current = slug;
  // The seat the board is drawn from. A fork keeps it at the stored seat whoever acts: the camera never moves by itself,
  // so a seat switch (by hand or by Follow prompt) changes who answers, not which way the board faces.
  const cameraSeat = forkControl ? forkControl.identitySeat : null;
  // What a remounted shell starts from, so a new fork view keeps the camera and the open panel.
  const forkCarry = useRef<ReplayCarry>({});
  const data = useMemo(
    () => (visibleRoom && forkControl ? { ...visibleRoom, mySeat: forkControl.actingSeat } : visibleRoom),
    [visibleRoom, forkControl],
  );
  const forkSettled = roomState.kind !== "unusable" && (forkControl == null
    || forkViewSettled(forkControl, forkView.view, { receivedAt: rawData?.receivedAt, changedAt: forkView.changedAt() }));
  // The duel host answers with the last view it built when its queue is blocked (stale). Ask again until it is fresh.
  const roomStale = data?.stale === true;
  useEffect(() => {
    if (!roomStale) return;
    const timer = setInterval(() => void refreshRoom(), 2000);
    return () => clearInterval(timer);
  }, [roomStale, refreshRoom]);
  // The change notice that an answer of this player causes is not a reason to shut the prompts (see duel-echo-window.ts).
  const echo = useMemo(() => createEchoWindow(), []);
  const realtime = useDuelWebsocket(slug, visibleRoom?.mySeat, refreshRoom, spectate, echo.quiet);
  // Only a recovering connection holds the buttons. A routine re-read (a change notice that is not the player's echo,
  // a window focus, a clock tick) does not: it shut the button between the press and the release, and the click was lost.
  // The server still refuses a stale answer by prompt id and revision.
  const syncing = realtime.recovering;
  const liveFormat = engineFormat(data?.engine);
  // The seat views one update back: a Deck Master summon flies out of its plate only when the view shows it leaving.
  const previousSeats = usePreviousSeats(data?.engine?.seats);
  // Live tables: FFA mounts TableShell, Tag 2v2 mounts the Rooftop (TagShell). ?stage=legacy keeps MultiSeatStage for both.
  const liveTagTable = isMultiSeat(data?.engine) && liveFormat === "tag" && !legacyStage;
  const liveTable = (isMultiSeat(data?.engine) && (liveFormat === "ffa3" || liveFormat === "ffa4") && !legacyStage) || liveTagTable;
  // A fork names its seats after the source duel's players, so the creator knows whose turn each seat plays (the fork's own seats are the creator and bots).
  const playerName = seatNamer((data?.session.seats ?? []).map((entry) => ({
    ...entry, displayName: forkControl?.origin.sourceSeats.find((source) => source.seat === entry.seat)?.displayName ?? entry.displayName,
  })));
  // A test duel from the deck editor has its own Quit dialog and returns to the editor when it ends.
  const testDuel = data?.session.testDuel === true;
  const duelLive = !forkMode && data?.session.status === "active" && !data.engine?.result &&
    (!isMultiSeat(data?.engine) || !data.engine?.seats.some((seat) => seat.seat === data.mySeat && (seat.eliminated || seat.pendingElimination)));
  useDuelLeaveGuard({ slug, active: duelLive && !testDuel, role: data?.mySeat == null ? "spectator" : "player" });
  const exitRef = useRef<() => void>(() => router.replace("/duels"));
  const testQuit = useTestDuelQuit({ slug, active: duelLive && testDuel && data?.mySeat != null, onQuit: () => exitRef.current() });
  const [busy, setBusy] = useState(false);
  const [forkChainBusy, setForkChainBusy] = useState(false);
  const inFlight = useRef(false);
  // Counts every request that changes the room (an action or a chain response switch change). A reply is put on the board
  // only if no later request was sent after it: a slow reply must not bring back an older room over a newer one.
  const mutationSeq = useRef(0);
  // Set when an answer is sent; the next prompt then decides whether an open pile viewer stays.
  const pileAnswered = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  const [pane, setPane] = useState<SidePane>(DEFAULT_SIDE_PANE);
  // Log rows that arrived while the Log tab was out of view (the badge on the tab).
  const [logUnread, setLogUnread] = useState(0);
  const narrow = useIsNarrow();
  const [mobileInspect, setMobileInspect] = useState(false);
  // The shells without the HUD (phone, 3D, live table): a click or tap on a card pins it in the same left drawer as the HUD shells.
  const [pinnedCard, setPinnedCard] = useState<DuelCard | DuelCardInfo | null>(null);
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // The Surrender menu on your own deck is open: prompt keys and the right-click decline wait for it.
  const [deckMenuOpen, setDeckMenuOpen] = useState(false);
  const [hideResult, setHideResult] = useState(false);
  // The next game of a series waits in its lobby for a moment; "Open the table" shows that lobby anyway.
  const [showTable, setShowTable] = useState(false);
  // Read after mount: the server render cannot know whether this is the duel window.
  const [inDuelWindow, setInDuelWindow] = useState(windowed);
  const [playHere, setPlayHere] = useState(false);
  const [windowOpened, setWindowOpened] = useState(false);
  // Start duel was clicked and the server has not answered yet.
  const [starting, setStarting] = useState(false);
  const popup = useRef<Window | null>(null);
  const openWindow = () => {
    const opened = openDuelWindow(slug);
    popup.current = opened;
    setWindowOpened(opened != null);
    return opened;
  };
  // Pop out: the board moves to the duel window, this tab shows where it went.
  const [popBlocked, setPopBlocked] = useState(false);
  const popOut = () => {
    setPlayHere(false);
    setPopBlocked(openWindow() == null);
  };
  useEffect(() => {
    if (!popBlocked) return undefined;
    const timer = window.setTimeout(() => setPopBlocked(false), 4000);
    return () => window.clearTimeout(timer);
  }, [popBlocked]);
  // A remount (the next game of a series, or back from the tables list) must not show a second board
  // for a seat whose duel window this page still has open.
  useEffect(() => {
    if (isDuelWindow(slug)) return;
    const existing = liveDuelWindow(slug);
    if (!existing) return;
    popup.current = existing;
    setWindowOpened(true);
  }, [slug]);
  useEffect(() => {
    if (!isDuelWindow(slug)) return;
    setInDuelWindow(true);
    // The name lets a later open of this duel find this window and focus it.
    try { window.name = duelWindowName(slug); } catch { /* a read-only name only costs the focus-reuse */ }
  }, [slug]);
  // The player closed the duel window: the duel continues in this tab.
  useEffect(() => {
    if (!windowOpened) return undefined;
    const timer = window.setInterval(() => {
      if (popup.current?.closed) {
        popup.current = null;
        setWindowOpened(false);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [windowOpened]);
  const [menu, setMenu] = useState<CardMenuState | null>(null);
  const [hover, setHover] = useState<{ card: DuelCard; anchor: HTMLElement } | null>(null);
  // A click the pick refused (full): a short note on the card, which also shakes.
  const [pickHint, setPickHint] = useState<{ anchor: HTMLElement; text: string; promptId: string } | null>(null);
  const clearPickHint = useCallback(() => setPickHint(null), []);
  const [pile, setPile] = useState<PileView | null>(null);
  // 3 and 4 seat tables: the opponent the player tapped to show large (null = follow the action).
  const [pinnedFocus, setPinnedFocus] = useState<number | null>(null);
  const preferences = useDuelPreferences();
  // A coin toss is playing: no answer, surrender or other action goes out (also blocked at window level).
  const tossLocked = useCoinTossLocked();
  useDuelAnimationSpeed(preferences.reducedMotion);
  const view = useBoardView(viewOverride);
  // The chunk of the 3D look starts loading before the room data arrives, so the table appears at once.
  useEffect(() => {
    if (view.mode === "3d") void import("./solid/solid-room");
  }, [view.mode]);
  const viewerOut = isMultiSeat(data?.engine) && data?.engine?.seats.some((seat) =>
    seat.seat === data.mySeat && (seat.eliminated === true || (!forkMode && seat.pendingElimination === true))) === true;
  // The server flips to active before it answers Start duel; the pop-up already has the duel then.
  const ownWindowGate = data && !viewerOut ? ownWindowGateVisible({
    status: data.session.status, mySeat: data.mySeat, inDuelWindow, playHere,
    hasResult: Boolean(data.engine?.result), starting, windowOpened,
  }) : false;
  // The turn-start phases (and the opening deal) play one beat at a time; nothing can be answered meanwhile.
  const startBeats = useStartBeats({
    engine: data?.engine ?? null,
    clock: data?.clock,
    duelKey: slug,
    reducedMotion: preferences.reducedMotion,
    ready: Boolean(data?.engine) && data?.session.status !== "lobby" && !ownWindowGate && !error,
    recovering: realtime.recovering,
    skipOpening: testDuel,
  });
  // The card layers go while the connection recovers (their events are history when they return), except while
  // the opening deal plays: a focus or a socket retry in those seconds must not drop the cards still in flight.
  const fxUp = fxLayersUp(!error, realtime.recovering, startBeats.dealing);
  // One minute left on the viewer's own clock beeps once (never for a spectator or a finished duel).
  useLowClockBeep({
    clock: data?.clock,
    seat: ownClockSeat({
      mySeat: data?.mySeat,
      spectator: spectate || data?.role === "spectator",
      replay: data?.session.status !== "active" || Boolean(data?.engine?.result) || viewerOut,
    }),
    soundEnabled: preferences.soundEnabled,
  });
  const catchingUp = syncing || startBeats.active || !forkSettled || forkChainBusy;
  // The engine drops its prompt when the duel ends; guard here too, so no answer path can open between the end and the result screen.
  const prompt = data?.engine?.result ? null : (data?.engine?.prompt ?? null);
  const forkDraftKey = forkControl
    ? `${forkControl.actingSeat}:${forkControl.revealHands}:${forkView.seat ?? "follow"}:${forkView.reveal}`
    : undefined;
  const draft = usePromptDraft(prompt, forkDraftKey);
  const legalKeys = useMemo(() => promptLegalKeys(prompt), [prompt]);
  const selectedKeys = useMemo(() => promptSelectedKeys(prompt, draft.selected), [draft.selected, prompt]);
  const closeMenu = useCallback(() => setMenu(null), []);
  const pickHintShown = pickHint != null && pickHint.promptId === prompt?.id && !menu && pickHint.anchor.isConnected;
  const boardRef = useRef<HTMLDivElement>(null);
  // 3D mode and Tilt|Flat change the look only when the board is quiet (see quiet-view-change.ts).
  const boardQuiet = useCallback(() => boardQuietNow(boardRef.current), []);
  const beforeViewChange = useCallback(() => { closeMenu(); setHover(null); }, [closeMenu]);
  const changeView = useQuietViewChange(boardQuiet, beforeViewChange);
  // The result screen waits for the last attack, LP roll and card flights to finish, then a short human pause.
  const resultReady = useResultGate({
    slug,
    status: data?.session.status,
    hasResult: data?.engine?.result != null,
    reason: data?.engine?.result?.reason ?? data?.session.resultReason,
    reducedMotion: preferences.reducedMotion,
    board: boardRef,
  });
  const viewerSeat = data?.engine?.seats.find((seat) => seat.seat === data.mySeat);
  const viewerLeaving = viewerOut && viewerSeat?.eliminated !== true && viewerSeat?.pendingElimination === true;
  // Auto-spectate only watches the REMAINING duel; once it is over the eliminated seat keeps its own result screen.
  const duelOver = data?.session.status !== "active" || data?.engine?.result != null;
  // The chain as the pile viewer marks it (the card a link activated from), live while the viewer is open.
  const pileChainLinks = useLiveChainLinks(data?.engine?.events ?? NO_CHAIN_EVENTS, data?.engine?.chain ?? NO_CHAIN_LINKS, duelOver);
  // A fork plays every seat: one that is out is not a viewer who goes to spectate.
  const viewerEliminated = !forkMode && (liveFormat === "ffa3" || liveFormat === "ffa4") && viewerSeat?.eliminated === true && !duelOver;
  // The own crumble plays on the table first: the spectate switch re-keys the room and would unmount it at once.
  // A seat that was already out on load (a reload) has no crumble to wait for, and neither has the legacy stage.
  const sawViewerIn = useRef(false);
  // Set by Leave room: its replace to /duels is pending and the spectate switch must not override it.
  const leavingRoom = useRef(false);
  useEffect(() => {
    if (viewerSeat != null && viewerSeat.eliminated !== true) sawViewerIn.current = true;
  }, [viewerSeat]);
  useEffect(() => {
    if (!viewerEliminated || spectate) return;
    const query = new URLSearchParams(window.location.search);
    query.set("spectate", "1");
    if (inDuelWindow) query.set("window", "1");
    const target = `/duels/${encodeURIComponent(slug)}?${query}`;
    if (!sawViewerIn.current || legacyStage) {
      router.replace(target);
      return;
    }
    const wait = (preferences.reducedMotion ? EXIT_CRUMBLE_REDUCED_MS : EXIT_CRUMBLE_MS) + SPECTATE_AFTER_CRUMBLE_MS;
    const timer = setTimeout(() => { if (!leavingRoom.current) router.replace(target); }, wait);
    return () => clearTimeout(timer);
  }, [viewerEliminated, spectate, inDuelWindow, legacyStage, preferences.reducedMotion, router, slug]);
  const promptMine = prompt != null && data?.mySeat != null && prompt.seat === data.mySeat && data.session.status === "active" && !viewerOut;
  // Every prompt except your own action menu is answered in the middle of the board (PromptCenter):
  // a floating panel for responses, an instruction bar for picks on the field. The left dock keeps
  // only the action prompt's Cancel / Finish and the live region; unknown kinds fall back to the old tray.
  const centered = promptMine && centerKind(prompt) != null;
  // The centred panel waits a human beat and the board FX before it shows; until then nothing answers it.
  // It also waits until the room can take an answer (the last answer finished, no re-sync): until then every button
  // is disabled, so a panel shown early looks ready and is dead.
  // A follow-up of the player's own material pick skips both waits and shows at once (its buttons stay off while busy).
  // Between the click and that prompt the last bar stays up (pick.waiting), buttons off.
  const pick = usePickContinuation(prompt, data?.engine?.revision);
  const revealBeat = usePromptReveal({ promptId: centered ? prompt.id : null, board: boardRef, reducedMotion: preferences.reducedMotion, skip: pick.continuing });
  const answerable = usePromptAnswerable(centered ? prompt.id : null, !busy && !error && !catchingUp, skipsAnswerableWait(pick.continuing, catchingUp));
  const revealed = revealBeat && answerable;
  const fieldHeld = fieldWaitsForReveal(prompt, revealed);
  const fieldLegalKeys = useMemo(() => fieldHeld ? new Set<string>() : legalKeys, [fieldHeld, legalKeys]);
  const activeMenu = !fieldHeld && !viewerOut && !busy && !error && !catchingUp && menu?.promptId === prompt?.id &&
    menu?.revision === data?.engine?.revision ? menu : null;
  // A wide 1v1 table swaps the bars and side panes for the floating HUD (table/hud-layer.tsx). The 3D mode keeps its own
  // look, and the 3 and 4 seat tables and the Tag table have their own shells.
  const hud = !narrow && data?.engine != null && !isMultiSeat(data.engine) && !liveTable && view.mode !== "3d";
  const hudState = useHudPane();
  const closeHud = hudState.close;
  const closePrivateHud = hudState.closePrivate;
  // The panes are edge drawers that close themselves (Esc, a press outside, the tab). Only the pinned peek goes through the HUD's own dismiss.
  useHudEscape({ ...hudState, pane: null }, hud, Boolean(activeMenu) || Boolean(pile?.open) || deckMenuOpen);
  usePinSync(hudState, data?.engine?.seats);
  usePinFollowsHover(hud, hudState.pinned, hover?.card, hudState.pinCard);
  usePinFollowsHover(!hud, pinnedCard, hover?.card, setPinnedCard);
  // A new prompt for this seat lets the pinned peek go: it must not cover the cards the prompt asks for.
  const promptId = prompt?.id ?? null;
  useEffect(() => {
    if (promptId != null && promptMine) hudState.pinCard(null);
    // Only a new prompt decides this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptId]);
  // The drawer pin of the shells without the HUD: Esc, a press outside, a new prompt and the board sync (see useDrawerPin).
  const drawerPinned = !hud && pinnedCard != null;
  useDrawerPin(hud ? null : pinnedCard, setPinnedCard, {
    seats: data?.engine?.seats, suspended: Boolean(activeMenu) || Boolean(pile?.open) || deckMenuOpen, promptId, promptMine,
  });
    const promptMenuOpen = Boolean(activeMenu) || deckMenuOpen;
  // An open flyout or a pinned card holds only Esc (it closes it); the other prompt keys keep answering.
  const hudFlyoutOpen = hud && (hudState.pane != null || hudState.pinned != null);
  const rowPreview = useRowPreview(prompt?.id ?? null);

  // Human attack flow: pick the attacker in the menu (preview arrow), aim at a target, confirm.
  const [pendingAttack, setPendingAttack] = useState<{ key: string; direct: boolean } | null>(null);
  const [actionPreview, setActionPreview] = useState<{ from: string; direct: boolean } | null>(null);
  const [aimHoverKey, setAimHoverKey] = useState<string | null>(null);
  const [aimLock, setAimLock] = useState<AimLock | null>(null);
  const myPrompt = promptMine;
  const attackTargetActive = myPrompt && isAttackTargetPrompt(prompt, pendingAttack != null);
  const directPromptActive = myPrompt && isDirectAttackPrompt(prompt);
  const attackTargets = useMemo(() => {
    const map = new Map<string, DuelPromptOption>();
    if (!attackTargetActive || !prompt) return map;
    for (const option of prompt.options) {
      const [key] = optionZoneKeys(option);
      if (key) map.set(key, option);
    }
    return map;
  }, [attackTargetActive, prompt]);

  useEffect(() => {
    setMenu(null);
    setHover(null);
    setAimLock(null);
    setAimHoverKey(null);
  }, [prompt?.id, data?.engine?.revision, realtime.recovering]);

  useEffect(() => {
    if (!activeMenu) setActionPreview(null);
  }, [activeMenu]);

  // A new prompt that wants cards outside the open pile (summon materials on the field) must not stay hidden
  // behind the pile viewer's scrim. A prompt that wants cards inside the pile keeps it open.
  useEffect(() => {
    const engine = data?.engine;
    if (!engine) return;
    const answered = pileAnswered.current;
    pileAnswered.current = false;
    if (!prompt) {
      // Answered and now waiting (no prompt for anyone yet): let the player watch the board, not the pile.
      if (answered) setPile((current) => (current?.open ? { ...current, open: false } : current));
      return;
    }
    const seat = data?.mySeat ?? 0;
    setPile((current) => {
      if (!current?.open) return current;
      const cards = livePileCards(current, engine, seat);
      return shouldClosePileForPrompt(cards, promptLegalKeys(prompt), promptMine, answered) ? { ...current, open: false } : current;
    });
    // Only a new prompt decides this; later revisions of the same prompt must not close a pile the player opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt?.id]);

  // Hovering or focusing a legal target on the board aims the arrow at it.
  useEffect(() => {
    if (liveTable || !attackTargetActive) {
      setAimHoverKey(null);
      return;
    }
    const keyOf = (target: EventTarget | null): string | null => {
      const zone = target instanceof Element ? target.closest("[data-zones]") : null;
      const keys = zone?.getAttribute("data-zones")?.split(" ") ?? [];
      return keys.find((key) => attackTargets.has(key)) ?? null;
    };
    const enter = (event: Event) => {
      const key = keyOf(event.target);
      if (key) setAimHoverKey(key);
    };
    const leave = (event: Event) => {
      if (keyOf(event.target) && keyOf((event as PointerEvent | FocusEvent).relatedTarget) == null) setAimHoverKey(null);
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("focusout", leave);
    return () => {
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("focusout", leave);
    };
  }, [liveTable, attackTargetActive, attackTargets]);

  useEffect(() => {
    setInspect(null);
    closeHud();
    setPile(null);
    setHideResult(false);
    setShowTable(false);
    setMobileInspect(false);
    setLogUnread(0);
    setActionError(null);
    setStarting(false);
  }, [slug, closeHud]);

  // The room says this viewer no longer plays (role "spectator" or no seat): drop everything private to the seat.
  // The role stays "player" after a result (a draw, a Tag surrender), so a finished duel never clears the screen here.
  const watchingOnly = data != null && (data.role === "spectator" || data.mySeat == null);
  useEffect(() => {
    if (!watchingOnly && !forkAccessLost) return;
    setInspect(null);
    closePrivateHud();
    setPile(null);
    setMobileInspect(false);
    setMenu(null);
    setHover(null);
    setPinnedFocus(null);
    setAimLock(null);
    setPickHint(null);
    setActionError(null);
  }, [watchingOnly, forkAccessLost, closeHud]);

  // A requested or received fork view has its own selections, piles, inspector and attack state.
  useEffect(() => {
    if (forkDraftKey === undefined) return;
    setInspect(null);
    closeHud();
    setPile(null);
    setMobileInspect(false);
    setMenu(null);
    setHover(null);
    setPinnedFocus(null);
    setAimLock(null);
    setPickHint(null);
    setPendingAttack(null);
    setActionPreview(null);
    setAimHoverKey(null);
  }, [forkDraftKey, closePrivateHud]);

  // A fork reply is projected for the seat that acted, with every hand shown. When the creator chose another seat or
  // hid the hands, the reply is not the view on screen: it is dropped and the current view is read again. It never
  // reaches the board and the table is never left waiting for it.
  const applyReply = useCallback(async (result: Parameters<typeof applyAnswerResult>[1]) => {
    if (result && "engine" in result && result.fork && !forkViewSettled(result.fork, forkViewNow.current)) {
      await mutate();
      return;
    }
    await applyAnswerResult(mutate, result);
  }, [mutate]);
  const run = useCallback(
    async (work: () => Promise<DuelRoom | { session: unknown } | void>, kind?: "seat-pick") => {
      // A coin toss is playing: nothing is sent, and the open menu stays as it is.
      if (isCoinTossActive()) return;
      // React's busy state alone cannot reject two clicks within one render.
      if (inFlight.current) return;
      inFlight.current = true;
      const seq = ++mutationSeq.current;
      echo.begin();
      setBusy(true);
      setMenu(null);
      setHover(null);
      setActionError(null);
      try {
        const result = await work();
        // The neutral line comes from the room (`startBlockedByOther`), not from this answer. The string is
        // dropped before the room is cached; it stood in place of this player's own blocker object, so a full
        // room is read again. Any other answer already makes a room read in `applyAnswerResult`.
        const neutral = neutralStartBlocked(result);
        // A full room with the neutral string is a Start that another seat's deck blocked: show the line at once.
        const answer: typeof result = neutral && result && "engine" in result
          ? { ...withoutNeutralStartBlocked(result), startBlockedByOther: true as const }
          : withoutNeutralStartBlocked(result);
        if (seq === mutationSeq.current) await applyReply(answer);
        if (neutral && result && "engine" in result && seq === mutationSeq.current) await mutate();
      } catch (err) {
        setActionError(duelActionErrorText(err, { seatPick: kind === "seat-pick" }));
        await mutate();
      } finally {
        inFlight.current = false;
        echo.end();
        setBusy(false);
      }
    },
    [mutate, echo, applyReply],
  );

  // A series moves on to its next game by itself: follow it, keeping the duel window. Players always
  // follow. A spectator follows once they have watched this game while it was the series' current
  // game, so the end screen of game 1 hands them to game 2; one who opens an older game stays on it.
  const [watchedLive, setWatchedLive] = useState<string | null>(null);
  const watchingCurrent = data?.series != null && isSeriesOpen(data.series) && data.series.currentDuelSlug === slug;
  useEffect(() => {
    if (watchingCurrent) setWatchedLive(slug);
  }, [watchingCurrent, slug]);
  const nextTarget = data ? nextGameTarget(data, slug, { followAsSpectator: watchedLive === slug }) : null;
  const goToGame = useCallback((next: string) => {
    // The window this tab opened follows the series on its own; name it for the next game now, so the
    // next room finds it before the window has finished moving.
    if (!inDuelWindow && popup.current && !popup.current.closed) renameDuelWindow(popup.current, next);
    const path = inDuelWindow ? duelWindowPath(next) : `/duels/${encodeURIComponent(next)}`;
    router.replace(legacyStage ? `${path}${inDuelWindow ? "&" : "?"}stage=legacy` : path);
  }, [router, inDuelWindow, legacyStage]);
  useEffect(() => {
    if (nextTarget) goToGame(nextTarget);
  }, [nextTarget, goToGame]);

  // The side deck window and the next game start on the server; poll in case the socket misses it.
  const seriesWaiting = data?.series != null && isSeriesOpen(data.series) && data.session.status !== "active"
    && data.session.status !== "lobby";
  useEffect(() => {
    if (!seriesWaiting) return undefined;
    const timer = window.setInterval(() => void refreshRoom(), 2000);
    return () => window.clearInterval(timer);
  }, [seriesWaiting, refreshRoom]);

  // The rock-paper-scissors opening runs on the server clock; poll in case the socket misses a step.
  const openingRunning = data?.opening != null && data.session.status === "lobby";
  useEffect(() => {
    if (!openingRunning) return undefined;
    const timer = window.setInterval(() => void refreshRoom(), 1500);
    return () => window.clearInterval(timer);
  }, [openingRunning, refreshRoom]);

  const onSubmitAnswer = useCallback(
    (answer: DuelAnswer) => {
      if (isCoinTossActive()) return;
      if (!data?.engine || !prompt || fieldHeld || error || catchingUp || data.mySeat !== prompt.seat ||
          data.session.status !== "active" || viewerOut || inFlight.current) return;
      const command = { promptId: prompt.id, revision: data.engine.revision, answer };
      // The answer is on its way (e.g. an Extra Deck summon picked in the pile viewer): the next prompt decides
      // whether the viewer stays (it wants a card in the pile) or closes (materials on the field must not sit behind it).
      pileAnswered.current = true;
      pick.noteAnswer(prompt, answer);
      // Remember the declared attacker so the target step can draw the arrow from it.
      const attack = prompt.context?.type === "action" && answer.choice?.startsWith("attack:")
        ? prompt.options.find((option) => option.id === answer.choice) : undefined;
      setPendingAttack(attack && attack.controller != null && attack.location != null && attack.sequence != null
        ? { key: zoneKey(attack.controller, attack.location, attack.sequence), direct: /directly/i.test(attack.label) }
        : null);
      // Only an opponent or direct-attack pick gets the general "pick again" notice on a 400 (a seat may have left).
      // A refused answer (a stale choice, a rejected move) is no cause for a follow-up: forget it, so the next prompt keeps its beat.
      void run(async () => {
        try {
          return await (forkControl ? sendDuelAction(slug, command, forkControl.actingSeat) : sendDuelAction(slug, command));
        } catch (err) {
          pick.clearAnswer();
          throw err;
        }
      }, isOpponentPick(prompt) || isAttackDuelistPrompt(prompt) ? "seat-pick" : undefined);
    },
    [data, prompt, fieldHeld, error, catchingUp, run, slug, pick.noteAnswer, pick.clearAnswer, viewerOut, forkControl?.actingSeat],
  );

  /** A prompt tile or response row under the pointer: show the card in the inspector, as board cards do. */
  function inspectInfo(card: DuelCardInfo) {
    // The HUD shows it in the hover preview: the Card flyout would cover the prompt.
    if (hud) rowPreview.show(card);
    else if (pane === "card") setInspect({ type: "info", card });
  }

  function showInspector(target: InspectTarget, mobile = false, reveal = false) {
    if (target.type === "pile") {
      // Piles open in the centred viewer over the board, never in the inspector (whose state it does not share).
      const seat = data?.mySeat ?? 0;
      const first = target.cards[0];
      const owner: "you" | "opp" = first ? (first.controller === seat ? "you" : "opp")
        : target.title.toLowerCase().startsWith(playerNameOf(seat).toLowerCase()) ? "you" : "opp";
      setHover(null);
      setMobileInspect(false);
      if (hud) hudState.pinCard(null);
      // Tables of 3 or 4 seats: the owner is the controller of the pile's cards, not "the other seat".
      const pileSeat = first && isMultiSeat(data?.engine) ? first.controller : undefined;
      setPile({ title: target.title, owner, cards: target.cards, open: true, seat: pileSeat, host: target.host });
      return;
    }
    setInspect(target);
    // Every shell without the HUD pins a clicked card in the same left drawer; a log row (reveal) still goes to the Card tab.
    if (!hud && !reveal) {
      setPinnedCard(target.card);
      return;
    }
    // The HUD opens its Card flyout here: only a click, Inspect or a log row gets this far, never a hover.
    if (hud) hudState.openCard();
    // A board click on the Log tab keeps the log (the hover card already shows it). A click on a log row (reveal),
    // or any click from Settings or the narrow layout, goes to the Card tab. The log keeps its place.
    else if (reveal || pane !== "log" || narrow) setPane("card");
    if (mobile && narrow) setMobileInspect(true);
  }

  function playerNameOf(seat: number): string {
    return data?.session.seats.find((player) => player.seat === seat)?.displayName ?? `Player ${seat + 1}`;
  }

  const closePile = useCallback(() => setPile((current) => (current ? { ...current, open: false } : null)), []);

  /** Point the arrow at a legal target and open the confirm. Nothing is submitted yet. */
  function lockTarget(option: DuelPromptOption, anchor: HTMLElement | null) {
    if (!prompt) return;
    const [key] = optionZoneKeys(option);
    const el = anchor ?? (key ? zoneAnchor(key) : null);
    if (!key || !el) {
      onSubmitAnswer({ selected: [option.id] });
      return;
    }
    setMenu(null);
    setHover(null);
    setAimLock({ promptId: prompt.id, optionId: option.id, key, anchor: el, name: targetName(option) });
  }

  function confirmAim() {
    if (!aimLock || aimLock.promptId !== prompt?.id) return;
    const { optionId } = aimLock;
    setAimLock(null);
    onSubmitAnswer({ selected: [optionId] });
  }

  function onMenuOptionHover(option: DuelPromptOption | null) {
    if (!option || !option.id.startsWith("attack:") || option.controller == null || option.location == null ||
        option.sequence == null) {
      setActionPreview(null);
      return;
    }
    setActionPreview({ from: zoneKey(option.controller, option.location, option.sequence), direct: /directly/i.test(option.label) });
  }

  function onHoverCard(card: DuelCard | null, anchor: HTMLElement | null) {
    if (!card || !anchor || card.code == null) {
      setHover(null);
      return;
    }
    setHover({ card, anchor });
    // The HUD's Card flyout opens on a click, never on a hover.
    if (pane === "card" && !hud && (view.mode !== "3d" || narrow)) setInspect({ type: "card", card });
  }

  function onFieldActivate(keys: string[], card: DuelCard | null, anchor: HTMLElement, preserveInspector = false) {
    // TableShell owns card menus and field picks. Its adapter still routes every answer through onSubmitAnswer.
    if (liveTable) return;
    setHover(null);
    // The pin goes with any click on a zone; the HUD pins the card again at the end, when no prompt took the click.
    if (hud && !preserveInspector) hudState.pinCard(null);
    // The HUD pins the card in the left peek only when no prompt took the click (below): a pick or a menu keeps the board clear.
    if (card && !preserveInspector && !hud) showInspector({ type: "card", card });
    if (busy || error || catchingUp || fieldHeld) {
      if (card && !preserveInspector && hud) pinClicked(card, anchor);
      return;
    }
    const mine = prompt != null && data?.mySeat != null && prompt.seat === data.mySeat;
    if (mine && (prompt.kind === "choice" || prompt.kind === "toggle")) {
      const options = optionsForCard(prompt, card, keys);
      if (prompt.kind === "toggle" && options.length === 1) {
        onSubmitAnswer({ choice: options[0].id });
        return;
      }
      if (options.length && data?.engine) {
        setMenu({
          anchor,
          title: card?.name ?? "Card",
          card,
          options,
          promptId: prompt.id,
          revision: data.engine.revision,
          tone: prompt.context?.type === "chain" ? "chain" : "action",
        });
        return;
      }
    }
    if (mine && isAttackTargetPrompt(prompt, pendingAttack != null)) {
      const targets = optionsForCard(prompt, card, keys);
      if (targets.length === 1) {
        lockTarget(targets[0], anchor);
        return;
      }
    }
    closeMenu();
    const handled = activatePromptFromField(prompt, Boolean(mine), keys, card, draft, onSubmitAnswer, (refusal) => {
      if (!prompt) return;
      shakeRefusedCard(anchor, preferences.reducedMotion);
      setPickHint({ anchor, text: refusal.text, promptId: prompt.id });
    });
    if (card && !handled) {
      if (hud && !preserveInspector) pinClicked(card, anchor);
      else showInspector({ type: "card", card }, true);
    }
  }

  /** A click on a board card that no prompt took, in the HUD: the card is pinned in the left peek, not opened in the Card flyout. */
  function pinClicked(card: DuelCard, anchor: HTMLElement) {
    setInspect({ type: "card", card });
    hudState.pinCard(card, anchor);
  }

  function onInspectorActivate(card: DuelCard, anchor: HTMLElement) {
    onFieldActivate([zoneKey(card.controller, card.location, card.sequence)], card, anchor, true);
  }

  const liveController = useLiveTableController({
    room: data, cameraSeat, nameOf: playerName, prompt, canAct: promptMine, busy, error, catchingUp, revealed,
    draft, legalKeys, selectedKeys, aim: null, reducedMotion: preferences.reducedMotion,
    onAnswer: onSubmitAnswer, onActivate: onFieldActivate, onInspect: showInspector,
  });

  // The chain response switch. The server reports a mode only in the seated player's own view of a live duel; a spectator,
  // a replay or a scenario table gets none, and then there is nothing to draw.
  // The send callback of the chain switch is made once; a fork binds each call to the seat, revision and prompt on screen.
  const latestRoom = useRef(data);
  latestRoom.current = data;
  const chainMode = useChainModeControl({
    slug,
    // A fork keeps each seat's own mode in the journal (and shows it from the room): a browser-wide memory would apply one
    // seat's choice to every seat the creator plays.
    remember: !forkMode,
    serverMode: data?.engine?.chainMode,
    enabled: data?.mySeat != null && !spectate && !viewerOut && !ownWindowGate && data.session.status === "active" && !data.engine?.result && forkSettled,
    suspended: confirmSurrender || confirmCancel || deckMenuOpen || (forkMode && (busy || catchingUp || Boolean(error))),
    send: async (mode) => {
      const now = latestRoom.current;
      // Only a room that is a fork by its stored kind and its seat control sends a seat: a stray field on an ordinary room never does.
      const fork = now && forkRoomState(now).kind === "fork" ? now.fork : undefined;
      if (fork && (busy || catchingUp || error || !forkViewSettled(fork, forkView.view, { receivedAt: (now as { receivedAt?: number }).receivedAt, changedAt: forkView.changedAt() }))) return;
      const seq = ++mutationSeq.current;
      if (fork) setForkChainBusy(true);
      try {
        const binding = fork && now?.engine
          ? { as: fork.actingSeat, revision: now.engine.revision, ...(now.engine.prompt ? { promptId: now.engine.prompt.id } : {}) }
          : undefined;
        const result = await (binding ? setChainResponseMode(slug, mode, binding) : setChainResponseMode(slug, mode));
        if (seq === mutationSeq.current) await applyReply(result);
      } catch (err) {
        // An answer that was sent meanwhile may have had its reply dropped for this request: read the room again.
        void mutate().catch(() => {});
        throw err;
      } finally {
        if (fork) setForkChainBusy(false);
      }
    },
    onError: setActionError,
  });

  // ---- Replay fork: the seat on screen, Follow prompt, ask-all and the two destructive actions ----
  const forkEngine = data?.engine ?? null;
  const forkLiving = useMemo(() => (forkControl ? livingSeats(forkEngine, forkControl.manualSeats) : []), [forkControl, forkEngine]);
  // On primitives, so a new reading of the same prompt keeps the same binding and does not restart the card search.
  const forkActingSeat = forkControl?.actingSeat ?? null;
  const forkPromptId = forkEngine?.prompt?.id ?? null;
  const forkRevision = forkEngine?.revision ?? null;
  const forkSearch = useMemo(
    () => (forkActingSeat != null && forkPromptId != null && forkRevision != null
      ? { as: forkActingSeat, promptId: forkPromptId, revision: forkRevision } : null),
    [forkActingSeat, forkPromptId, forkRevision],
  );
  // Follow prompt: an answer can hand the prompt to another seat; the host picks that seat when the view names none.
  const followGuard = useRef<string | null>(null);
  const forkEngineRevision = forkEngine?.revision ?? null;
  useEffect(() => {
    if (!forkControl || !forkEngine || !forkView.follow || busy || forkChainBusy || !forkSettled) return;
    // A seat picked by hand holds only until the engine moves on.
    if (forkView.seat != null) return;
    const next = followSeat(forkEngine, forkControl.actingSeat);
    if (next == null) { followGuard.current = null; return; }
    const key = `${forkEngine.revision}:${next}:${forkControl.actingSeat}`;
    if (followGuard.current === key) return;
    followGuard.current = key;
    // A reply that is still on its way belongs to the seat that is being left.
    mutationSeq.current += 1;
    void refreshRoom();
  }, [forkControl, forkEngine, forkView.follow, forkView.seat, busy, forkChainBusy, forkSettled, refreshRoom]);
  const heldRevision = useRef<number | null>(null);
  useEffect(() => {
    if (forkView.seat == null) { heldRevision.current = null; return; }
    if (forkEngineRevision == null) return;
    if (heldRevision.current == null) { heldRevision.current = forkEngineRevision; return; }
    if (heldRevision.current !== forkEngineRevision && forkView.follow) {
      heldRevision.current = null;
      forkView.pickSeat(null);
    }
  }, [forkView, forkEngineRevision]);
  const pickForkSeat = (seat: number) => {
    // A reply that is still on its way belongs to the old seat.
    mutationSeq.current += 1;
    forkView.pickSeat(seat);
  };
  const askAllForks = () => {
    void run(async () => {
      const now = latestRoom.current;
      const fork = now && forkRoomState(now).kind === "fork" ? now.fork : undefined;
      if (!fork || !now?.engine) return;
      const acting = fork.actingSeat;
      // The acting seat goes last, so the reply that is put on the board is the view on screen. A seat that is out is left
      // out: the host would refuse it after the other seats had changed.
      const alive = livingSeats(now.engine, fork.manualSeats);
      const order = [...alive.filter((seat) => seat !== acting), ...(alive.includes(acting) ? [acting] : [])];
      let revision = now.engine.revision;
      let promptId: string | undefined = now.engine.prompt?.id;
      let last: DuelRoom | null = null;
      for (const seat of order) {
        const reply = await setChainResponseMode(slug, "always", {
          as: seat, revision, ...(seat === acting && promptId !== undefined ? { promptId } : {}),
        });
        // A mode change can pass a window; the next call must name the revision that is current now.
        if (reply.engine && reply.engine.revision !== revision) promptId = undefined;
        if (reply.engine) revision = reply.engine.revision;
        last = reply;
      }
      // The last reply belongs to the acting seat only when that seat took part. With the acting seat out, it is
      // another seat's view: it never goes on screen, and the room is read again instead.
      return last && last.fork?.actingSeat === acting ? last : undefined;
    });
  };
  const restartFork = () => {
    // With Follow prompt on, the host picks the seat again. With it off, the seat the restart opens on is kept as a hold,
    // so the toggle stays true to what it says.
    const hold = !forkView.follow;
    if (!hold) forkView.pickSeat(null);
    setHideResult(false);
    void run(async () => {
      const reply = await restartReplayFork(slug);
      if (hold && reply.fork) forkView.pickSeat(reply.fork.actingSeat);
      return reply;
    });
  };
  // The creator follows a link to the source replay: an open fork is closed on the way (best effort), so forks that
  // were left behind do not fill the limit of open forks.
  // It runs only after the creator confirms, and never for a click that opens a new tab (see `ForkSourceLink`).
  const leaveFork = () => {
    if (!forkControl || latestRoom.current?.session.status !== "active") return;
    leavingRoom.current = true;
    void cancelReplayFork(slug).catch(() => {});
  };
  const endFork = () => {
    if (!forkControl || inFlight.current) return;
    const target = sourceReplayHref(forkControl.origin);
    // A finished fork has nothing to cancel (the host refuses it): go back to the replay.
    if (latestRoom.current?.session.status !== "active") { leavingRoom.current = true; router.replace(target); return; }
    inFlight.current = true;
    mutationSeq.current += 1;
    setBusy(true);
    setActionError(null);
    // The room is not read again: a closed fork has no room to read.
    cancelReplayFork(slug)
      .then(() => { leavingRoom.current = true; router.replace(target); })
      .catch((err: unknown) => setActionError(duelActionErrorText(err)))
      .finally(() => { inFlight.current = false; setBusy(false); });
  };

  useBugReportRoom(forkMode ? null : data ?? null);
  // Access to a fork was lost: nothing private stays on screen. The viewer may ask again (a newer room is the only way back).
  if (forkAccessLost) {
    return (
      <div className="space-y-3 p-6" data-replay-fork-access-lost>
        <p className="text-sm text-accent-cta">You can no longer open this replay fork.</p>
        <Button type="button" size="sm" variant="secondary" onClick={() => void mutate()}>Retry</Button>
        <Link href="/duels" className="ml-3 text-sm text-text-secondary">Back to tables</Link>
      </div>
    );
  }
  if (isLoading && !data) return <div className="p-6 text-sm text-text-secondary">Loading table…</div>;
  if (error && !data) {
    const message = error instanceof Error ? error.message : "Could not load this table.";
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-accent-cta">{message}</p>
        <Button type="button" size="sm" variant="secondary" onClick={() => void mutate()}>Retry</Button>
        <Link href="/duels" className="ml-3 text-sm text-text-secondary">Back to tables</Link>
      </div>
    );
  }
  if (!data) return null;
  // A fork row without its control cannot be played safely (no acting seat): show nothing of the table.
  if (roomState.kind === "unusable") {
    return (
      <div className="space-y-3 p-6" data-replay-fork-unusable>
        <p className="text-sm text-accent-cta">This replay fork cannot be shown. Its seat control is missing.</p>
        <Link href="/duels" className="text-sm text-text-secondary">Back to tables</Link>
      </div>
    );
  }
  // The series already points at the next game and this room is about to follow: not the result of the game that is over.
  if (nextTarget && data.series) {
    return <NextGameStarting room={data} game={data.series.gameNumber} onShowTable={() => goToGame(nextTarget)} />;
  }
  // The next game of a Best of 3 is made in a lobby that starts by itself: no table settings between games.
  if (isStartingNextGame(data) && !showTable && !ownWindowGate) {
    return <NextGameStarting room={data} onShowTable={() => setShowTable(true)} />;
  }
  if (data.session.status === "lobby" && !ownWindowGate) {
    const opening = data.opening;
    const lobby = (
      <RoomLobby room={data} presence={realtime.presence} idleDeadline={idleDeadline} slug={slug} busy={busy} starting={starting} actionError={actionError}
        onDeckLocked={() => void refreshRoom()}
        onTakeSeat={(seat) => void run(() => takeDuelSeat(slug, seat))}
        onAddBot={(seat) => void run(() => addPracticeBot(slug, seat))}
        onRemoveBot={(seat) => void run(() => removePracticeBot(slug, seat))}
        onReady={(deck) => void run(() => setDuelDeck(slug, deck))}
        onMarkReady={() => void run(() => markDuelReady(slug))}
        onMarkUnready={() => void run(() => markDuelUnready(slug))}
        onStart={() => {
          // Inside the click, so pop-up blockers allow it. Seated players on other devices get the prompt below.
          if (inFlight.current) return;
          const opened = inDuelWindow ? null : openWindow();
          setStarting(true);
          // Back to the lobby: the pop-up has nothing to show.
          const backToLobby = () => {
            setStarting(false);
            setWindowOpened(false);
            popup.current = null;
            try { opened?.close(); } catch { /* the browser keeps it open */ }
          };
          void run(async () => {
            try {
              const answer = await startDuel(slug);
              // Another seat's deck blocked the start: the answer is not an error, but no duel is starting.
              if (neutralStartBlocked(answer)) backToLobby();
              return answer;
            } catch (err) {
              backToLobby();
              throw err;
            }
          });
        }}
        onCancel={() => void run(() => cancelDuel(slug))}
        onLeave={() => void run(() => leaveDuel(slug))}
      />
    );
    const startingNow = startingVariant(data);
    if (!opening) {
      return startingNow ? <>{lobby}<StartingDuel room={data} variant={startingNow} reducedMotion={preferences.reducedMotion} /></> : lobby;
    }
    const seatName = (seat: number) => data.session.seats.find((entry) => entry.seat === seat)?.displayName ?? `Player ${seat + 1}`;
    return (
      <>
        {lobby}
        <OpeningScreen opening={opening} receivedAt={data.receivedAt} mySeat={data.mySeat} names={Array.from({ length: seatCountFor(data.session.format) }, (_, seat) => seatName(seat))} busy={busy} error={actionError} reducedMotion={preferences.reducedMotion}
          onPick={(move) => void run(() => pickOpeningMove(slug, move))}
          onChoose={(choice) => void run(() => chooseOpeningOrder(slug, choice))} />
        {startingNow ? <StartingDuel room={data} variant={startingNow} reducedMotion={preferences.reducedMotion} /> : null}
      </>
    );
  }

  // Active, but the first engine view is not here yet: say so instead of drawing an empty field.
  if (!forkMode && startingVariant(data) === "card") {
    return <StartingDuel room={data} variant="card" reducedMotion={preferences.reducedMotion} />;
  }
  const engine = data.engine;
  // The acting seat (`data.mySeat`) owns prompts and answers; the camera seat decides which side of the board is the bottom.
  const localSeat = cameraSeat ?? data.mySeat ?? 0;
  const bottom = engine?.seats.find((seat) => seat.seat === localSeat);
  const multi = isMultiSeat(engine);
  const format = engineFormat(engine);
  const focusSeat = multi && engine ? focusOpponentSeat({ engine, mySeat: data.mySeat, legalKeys, pinned: pinnedFocus }) : null;
  const top = multi ? engine?.seats.find((seat) => seat.seat === focusSeat)
    : engine?.seats.find((seat) => seat.seat !== localSeat);
  const mine = prompt != null && prompt.seat === data.mySeat;
  const canAct = mine && !busy && !error && !catchingUp && data.session.status === "active" && !viewerOut;
  // An opponent pick also answers by tapping the offered seat on the table (after the same human beat as the panel).
  const seatPick = multi && canAct && revealed ? seatPickFor(prompt, engine, onSubmitAnswer) : null;
  const canSurrender = !forkMode && data.session.status === "active" && data.mySeat != null && !engine?.result && !viewerOut;
  const terminal = data.session.status !== "active";
  const isOrganizer = actorPlayerId === data.session.organizerPlayerId || data.session.seats.some((seat) =>
    seat.seat === data.mySeat && seat.playerId === data.session.organizerPlayerId);
  const canCancel = !forkMode && !terminal && isOrganizer && !data.session.ranked && data.session.seriesId == null && data.series == null;
  const canArchive = !forkMode && terminal && isOrganizer && !data.session.archivedAt;
  const series = data.series ?? null;
  const myIndex = series ? seriesPlayerIndex(data, series) : null;
  const hasResult = engine?.result != null || terminal;
  // A series player sees the side deck screen, not the result screen, once the last game has played out.
  const betweenGames = series != null && myIndex != null && isBetweenGames(data, slug);
  const showBetweenGames = !forkMode && betweenGames && resultReady && hasResult;
  const showResult = !forkMode && !hideResult && !showBetweenGames && resultReady && (engine?.result != null || terminal);
  const exitDuel = () => {
    // A fork is not left open behind the creator: leaving it closes it and goes back to the replay.
    if (forkControl) { endFork(); return; }
    leavingRoom.current = true;
    const home = testDuel ? testDuelReturnPath(slug) : "/duels";
    if (testDuel) forgetTestDuelReturn(slug);
    if (inDuelWindow) exitDuelWindow(slug, () => router.replace(home));
    else router.replace(home);
  };
  exitRef.current = exitDuel;
  // The Surrender confirm is a modal: the HUD flyout that held the button closes, so the modal owns Esc.
  const askSurrender = () => { hudState.close(); setConfirmSurrender(true); };
  // The Cancel duel confirm is a modal too: the flyout closes the same way.
  const askCancel = () => { hudState.close(); setConfirmCancel(true); };
  const surrenderOpen = confirmSurrender && canSurrender;
  const surrenderModal = <SurrenderModal open={surrenderOpen} busy={busy || tossLocked} multiplayer={multi && (format === "ffa3" || format === "ffa4")} tag={multi && format === "tag"}
    onClose={() => setConfirmSurrender(false)} onConfirm={() => {
      if (!canSurrender || isCoinTossActive()) return;
      setConfirmSurrender(false);
      void run(() => surrenderDuel(slug));
    }} />;
  const cancelOpen = confirmCancel && canCancel;
  const cancelModal = <Modal open={cancelOpen} onClose={() => setConfirmCancel(false)} title="Cancel duel">
    <p className="text-sm text-text-secondary">This ends the duel for every player without a winner.</p>
    <div className="mt-4 flex gap-2">
      <Button type="button" variant="danger" loading={busy} disabled={busy || tossLocked} onClick={() => {
        if (!canCancel || isCoinTossActive()) return;
        setConfirmCancel(false);
        void run(() => cancelDuel(slug));
      }}>Cancel duel</Button>
      <Button type="button" variant="ghost" onClick={() => setConfirmCancel(false)}>Keep playing</Button>
    </div>
  </Modal>;
  // Your own deck opens a Surrender menu. It uses the same confirm and the same surrender call as the header button.
  const deckSurrender: DeckSurrenderValue = {
    seat: data.mySeat, available: canSurrender, busy: busy || catchingUp || Boolean(error),
    onSurrender: () => { if (!isCoinTossActive()) askSurrender(); }, onMenuOpenChange: setDeckMenuOpen,
    scope: `${prompt?.id ?? ""}|${data.engine?.turnSeat ?? ""}`,
  };
  // The series has moved on to its next game and this room is about to follow it (the effect on nextTarget).
  // The old game's result is history by now: do not flash "You win" for the second the next room takes to
  // open. Show the starting screen of the next game, then its field and its opening deal.
  if (nextTarget != null && data.series) {
    const upcoming = { ...data, session: { ...data.session, gameNumber: data.series.gameNumber } };
    return <NextGameStarting room={upcoming} onShowTable={() => goToGame(nextTarget)} />;
  }
  if (showBetweenGames) {
    return <BetweenGamesScreen room={data} slug={slug} onChanged={refreshRoom} onNavigate={goToGame} />;
  }
  const leavingNotice = viewerLeaving ? <p className={styles.leavingNotice} role="status" data-testid="self-leaving">
    Leaving — you leave the duel when the current chain finishes
  </p> : null;
  const popOutControl = !forkMode && data.mySeat != null && !viewerOut && !inDuelWindow && data.session.status === "active" && !engine?.result ?
    <>
      <button type="button" className={styles.tool} onClick={popOut}>Pop out</button>
      {popBlocked ? <span className={styles.tool} role="status">Your browser blocked the window.</span> : null}
    </> : null;
  const leaveControl = !forkMode && (data.mySeat == null || viewerOut) ?
    <button type="button" className={styles.tool} onClick={exitDuel}>Leave room</button> : null;
  const testQuitControl = testDuel && canSurrender ?
    <button type="button" className={styles.tool} data-testid="test-duel-quit" disabled={testQuit.busy || busy} onClick={testQuit.quit}>Quit</button> : null;
  const forkBusy = busy || catchingUp || Boolean(error);
  // A fork has no clock: the host sends none, and the table draws none even if one were sent.
  const shownClock = forkMode ? null : data.clock;
  const forkBar = forkControl ? (
    <ReplayForkBar
      fork={forkControl} seatName={playerName} living={forkLiving} waitingSeat={engine?.prioritySeat ?? null}
      follow={forkView.follow} reveal={forkView.reveal} disabled={forkBusy}
      open={forkSheetOpen} onOpenChange={setForkSheetOpen}
      onPickSeat={pickForkSeat}
      onFollow={(next) => forkView.setFollow(next, forkControl.actingSeat)}
      onReveal={forkView.setReveal}
      onAskAll={askAllForks} onRestart={restartFork} onEnd={endFork}
      ended={terminal} onLeave={leaveFork} held={forkView.seat != null}
      onShowResult={liveTable && hasResult && hideResult ? () => setHideResult(false) : undefined}
    />
  ) : null;
  const forkWinner = engine?.result ? winnerLabel(engine, playerName) : null;
  const forkResult = forkControl && hasResult && resultReady && !hideResult ? (
    <ReplayForkResult
      headline={engine?.result ? (forkWinner ? `${forkWinner} won` : "The duel is a draw") : "The fork has ended"}
      reason={engine?.result?.reason ?? data.session.resultReason ?? null}
      sourceHref={sourceReplayHref(forkControl.origin)} disabled={forkBusy}
      onRestart={restartFork} onClose={() => setHideResult(true)} onLeave={leaveFork} ended={terminal}
    />
  ) : null;
  if (ownWindowGate) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 text-center"
        data-testid="duel-window-gate">
        <h1 className="text-xl font-semibold text-text-primary">Duel is open in its own window</h1>
        <p className="text-sm text-text-secondary">
          The duel runs in a separate window so Back and Forward cannot pull you out of it. Closing that window brings the duel back here.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <SheetButton kind="primary" size="lg" onClick={openWindow}>
            <ExternalLink size={16} strokeWidth={1.6} aria-hidden />Focus window
          </SheetButton>
          <SheetButton kind="quiet" onClick={() => {
            // One board per seat: the duel window closes, the duel continues in this tab.
            closeDuelWindow(popup.current);
            popup.current = null;
            setWindowOpened(false);
            setPlayHere(true);
          }}>Open here instead</SheetButton>
        </div>
      </div>
    );
  }
  // Every board of this duel (live tables, 3D, flat) cracks from the same scope: duel id for the seed, starting LP of one side.
  const withCracks = (node: ReactNode) => (
    <FieldCracksScope duelKey={slug} format={data.session.format} settings={data.session.settings} replay={forkMode}>{node}</FieldCracksScope>
  );
  if (liveTable && liveController) {
    // One seam set for both live shells, so the room stays one code path.
    const shellProps: TableShellProps = {
      controller: liveController, fillViewport: true, boardRef, pickContinuation: pick, preferences,
      inputSuspended: surrenderOpen || cancelOpen || deckMenuOpen,
      chainMode,
      fxActive: !error && !realtime.recovering, busy: busy || Boolean(error) || catchingUp,
      initialOutOrder: eliminationOrder(liveController.engine),
      connection: { ...realtime, stale: roomStale, error: Boolean(error), actionBusy: busy },
      actions: { onExit: exitDuel, onSeriesChanged: () => void refreshRoom(), onNavigate: goToGame },
      ...(forkMode ? { noResultScreen: true, replayCarry: forkCarry, resetKey: forkDraftKey } : {}),
      headerTools: <>
        {forkBar}
        {forkMode ? null : <BugReportHeaderButton room={data} />}
        {forkMode ? null : <ReportButton slug={slug} />}
        {popOutControl}
        {leaveControl}
        {testQuitControl}
        {canSurrender ? <Button type="button" variant="danger" size="sm" disabled={busy || catchingUp || Boolean(error) || tossLocked}
          onClick={askSurrender} title="Surrender"><HeaderToolLabel icon={Flag}>Surrender</HeaderToolLabel></Button> : null}
        {canCancel ? <Button type="button" variant="secondary" size="sm" disabled={busy || catchingUp || Boolean(error) || tossLocked}
          onClick={askCancel} title="Cancel duel"><HeaderToolLabel icon={Ban}>Cancel duel</HeaderToolLabel></Button> : null}
      </>,
      settingsTools: canArchive ? <Button type="button" variant="secondary" size="sm" disabled={busy}
        onClick={() => void run(() => archiveDuel(slug))}>Archive table</Button> : null,
      notices: <>
        {leavingNotice}
        {error ? <div className={styles.error} role="alert">Connection lost. Actions paused until reconnected.
          <button type="button" onClick={() => void mutate()}>Retry</button></div> : null}
        {actionError ? <div className={styles.error} role="alert">{actionError}</div> : null}
        {data.error ? <div className={styles.error} role="alert">{data.error}</div> : null}
      </>,
      modals: <>
        {surrenderModal}
        {cancelModal}
      </>,
    };
    // The shells keep their own piles, inspector and menus. A spectator view remounts them. A fork never does: a seat
    // switch, a Follow switch or a Reveal change clears them through `resetKey`, and the camera, the grid focus and the
    // zoom stay where the creator put them.
    const shellKey = forkMode ? `${slug}:fork` : watchingOnly ? `${slug}:watching` : slug;
    return withCracks(<ForkLabelsContext.Provider value={forkMode}><ForkSearchContext.Provider value={forkSearch}><DeckSurrenderContext.Provider value={deckSurrender}>
      <MasterSeatsContext.Provider value={data?.engine?.seats ?? NO_SEATS}>
      {liveTagTable ? <TagShell key={shellKey} {...shellProps} teamNames={defaultTeamNames()} /> : <TableShell key={shellKey} {...shellProps} />}
      </MasterSeatsContext.Provider>
      {forkResult}
    </DeckSurrenderContext.Provider></ForkSearchContext.Provider></ForkLabelsContext.Provider>);
  }
  const connectionLabel = labelForConnection(terminal, { ...realtime, stale: roomStale, error });
  const domain = data.session.mode === "domain";
  const actionOptions = prompt?.context?.type === "action" ? prompt.options : [];
  const spectator = data.mySeat == null;
  // While the turn-start phases pass one by one, the bar and the header show the beat, not the engine's phase.
  const shownPhase = startBeats.phase === undefined ? engine?.phase : startBeats.phase;
  const battle = isBattlePhase(engine?.phase);
  // engine.battleStep is a round-4 contract field; read it defensively until every shared build carries it.
  const engineStep = (engine as { battleStep?: BattleStep | null } | null)?.battleStep ?? null;
  const battleStep = battle ? resolveBattleStep(engine?.phase, engineStep) : null;
  const stepName = battleStepLabel(battleStep);
  const headerPhase = battle ? `Battle Phase${stepName ? ` · ${stepName}` : ""}` : shownPhase === null ? "Dealing hands" : phaseTitle(shownPhase);
  const turnSeat = engine?.turnSeat;
  const myTurn = !spectator && turnSeat === data.mySeat;
  const turnText = turnSeat == null ? null : myTurn && !forkMode ? "Your turn" : `${playerName(turnSeat)}'s turn`;
  const soundLabel = preferences.soundEnabled ? "On" : "Off";

  const isActionPrompt = prompt?.kind === "choice" && prompt.context?.type === "action";
  // idle: nothing to answer here (the field, the station track or the centre layer answer it);
  // float: a short action-prompt control over the lower left sheet;
  // flow: fallback list for a prompt kind the centre layer does not know.
  const dockMode = !promptMine || prompt == null || centered ? "idle"
    : isActionPrompt ? (prompt.cancelable || prompt.finishable ? "float" : "idle")
      : "flow";
  const trackCaption = data.session.status !== "active" ? "Duel finished" : prompt == null ? null
    : promptMine ? (isActionPrompt ? null : prompt.title)
      : `${playerName(prompt.seat)} is choosing…`;

  // The arrow the player is steering: a dim preview from the menu, the aimed arrow, or a locked one.
  const oppSeat = top?.seat ?? 1 - localSeat;
  const attackerKey = pendingAttack?.key ?? null;
  let battleAim: BattleAim | null = null;
  if (attackTargetActive && attackerKey) {
    const key = aimLock?.key ?? aimHoverKey;
    if (key) battleAim = { mode: aimLock ? "locked" : "aim", from: attackerKey, to: { zones: [key] } };
  } else if (directPromptActive && attackerKey) {
    battleAim = { mode: "aim", from: attackerKey, to: { lpSeat: oppSeat } };
  } else if (actionPreview && activeMenu) {
    const foeViews = multi ? (engine?.seats ?? []).filter((seat) => foeSeats(format, data.mySeat).includes(seat.seat))
      : top ? [top] : [];
    const foes = foeViews.flatMap((view) => view.monsters).filter((card): card is DuelCard => card != null)
      .map((card) => zoneKey(card.controller, card.location, card.sequence));
    battleAim = actionPreview.direct
      ? { mode: "preview", from: actionPreview.from, to: { lpSeat: oppSeat } }
      : { mode: "preview", from: actionPreview.from, to: { zones: foes } };
  }
  const promptAim: PromptAim | undefined = attackTargetActive
    ? {
        lockedId: aimLock?.optionId ?? null,
        onAim: (option) => lockTarget(option, null),
        onHover: (option) => setAimHoverKey(option ? optionZoneKeys(option)[0] ?? null : null),
      }
    : undefined;

  const inspector = (
    <CardInspector target={inspect}
      onInspectCard={(card) => setInspect({ type: "card", card })}
      onActivateCard={onInspectorActivate}
      onViewMaterials={(target) => showInspector(target)}
      equipLinks={engine ? resolveEquipLinks(engine.seats) : undefined}
    />
  );
  // The Deck Master actions: the rail (both looks) and the 3D mode chip offer the very same ones.
  const legalActionsFor = (card: DuelCard | null, keys: string[]) =>
    canAct && prompt?.kind === "choice" && prompt.context?.type === "action"
      ? optionsForCard(prompt, card, keys)
      : [];
  const onChooseAction = (option: DuelPromptOption) => {
    setMobileInspect(false);
    onSubmitAnswer({ choice: option.id });
  };
  // A fork names the docks by seat: the dock is the acting seat's, and "Your"/"Opponent" would be wrong for the camera's seat.
  const forkMasterTitles = data.mySeat != null ? {
    selfTitle: `${playerName(data.mySeat)}'s Master`,
    ...(multi ? {} : { rivals: [{ seat: 1 - data.mySeat, title: `${playerName(1 - data.mySeat)}'s Master` }] }),
  } : {};
  const masterRail = domain && engine ? (
    <DeckMasterRail engine={engine} mySeat={data.mySeat} legalKeys={fieldLegalKeys}
      selectedKeys={selectedKeys} canAct={canAct}
      legalActionsFor={legalActionsFor}
      onChooseAction={onChooseAction}
      onActivate={onFieldActivate} topSeat={multi ? focusSeat : undefined}
      {...(forkMode ? forkMasterTitles : {})}
      onHoverCard={onHoverCard} onInspect={(target) => showInspector(target, true)} showInUse />
  ) : null;
  // The Log list stays mounted behind the other tabs (SidePanel keepMounted), so it keeps the rows it has built.
  // Only the instance in the column counts unread rows; the narrow sheet gets its own, uncounted copy.
  const logVisible = hud ? hudState.pane === "log" : pane === "log" && (!narrow || mobileInspect);
  const logPanel = (counted: boolean) => (
    <div className={styles.logPane}>
      {engine ? <DuelHistoryRail key={slug} events={engine.events} engine={engine} mySeat={data.mySeat} playerName={playerName}
        onInspectCard={(card) => showInspector("location" in card ? { type: "card", card } : { type: "info", card }, false, true)}
        reducedMotion={preferences.reducedMotion}
        active={counted ? logVisible : true} onUnread={counted ? setLogUnread : undefined} /> : null}
      <details className={styles.textLog}>
        <summary>Text log</summary>
        <MatchSheetLog entries={engine?.log ?? []} playerName={playerName}
          players={data.session.seats.map((seat) => seat.displayName).join(" v ")} />
      </details>
    </div>
  );
  const cardPanel = inspect ? inspector : <CardTabEmpty />;
  const mastersPanel = <div className={styles.mastersSheet}>{masterRail}</div>;
  const settingsPanel = (
    <div className={styles.options}>
      {forkMode ? null : <DuelSettingsSummary session={data.session} />}
      {forkMode ? null : <RoomInvite room={data} slug={slug} />}
      <h2>Presentation</h2>
      <DuelAnimationSpeedControl />
      <DuelCardTextSizeControl />
      <DuelDiceSkinControl />
      <DuelSoundControls enabled={preferences.soundEnabled} volume={preferences.soundVolume}
        onEnabledChange={preferences.setSoundEnabled} onVolumeChange={preferences.setSoundVolume} />
      <label className="flex flex-col gap-2">Motion
        <select value={preferences.motion}
          onChange={(event) => preferences.setMotion(event.target.value as typeof preferences.motion)}>
          <option value="system">Use device setting</option>
          <option value="reduced">Reduced motion</option>
          <option value="full">Full motion</option>
        </select>
      </label>
      <div className={`${fxStyles.shakeRow} ${duelFontClasses}`}>
        <span>Screen shake</span>
        <div className={fxStyles.segment} role="group" aria-label="Screen shake">
          {DUEL_SHAKE_LEVELS.map((level) => (
            <button key={level} type="button" aria-pressed={preferences.shake === level}
              onClick={() => preferences.setShake(level)}>{DUEL_SHAKE_LABEL[level]}</button>
          ))}
        </div>
        <p className={fxStyles.shakeNote}>How hard heavy summons rattle the field.</p>
      </div>
      {multi ? null : (
        <>
          <label className="flex items-center justify-between gap-3">3D mode
            <input type="checkbox" role="switch" checked={view.mode === "3d"}
              onChange={(event) => { const next = event.target.checked ? "3d" : "classic"; changeView(() => view.setMode(next)); }} />
          </label>
          <p>Tilted Solid Vision table for 1v1 duels</p>
          {view.mode === "3d" ? (
            <div className={`${fxStyles.shakeRow} ${duelFontClasses}`}>
              <span>Table view</span>
              <div className={fxStyles.segment} role="group" aria-label="Table view">
                {(["tilt", "flat"] as const).map((tilt) => (
                  <button key={tilt} type="button" aria-pressed={view.tilt === tilt}
                    onClick={() => changeView(() => view.setTilt(tilt))}>{tilt === "tilt" ? "Tilt" : "Flat"}</button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
      <p>Effects never pause the duel or submit a response.</p>
      {actionOptions.filter((option) => option.id === "shuffle").map((option) => (
        <Button key={option.id} type="button" size="sm" variant="secondary" disabled={!canAct}
          onClick={() => onSubmitAnswer({ choice: option.id })}>{option.label}</Button>
      ))}
      <h2>Connection</h2>
      <p role="status">{terminal ? "Showing the saved final state." : realtime.syncing
        ? "Catching up to the current duel. Actions resume when the latest state arrives."
        : realtime.connected ? "Live updates connected." : "Reconnecting live updates; polling for the latest state."}</p>
      {!terminal ? <Button type="button" size="sm" variant="secondary" disabled={busy || realtime.syncing}
        onClick={() => void realtime.resync().catch(() => setActionError("Could not catch up. Check your connection and retry."))}>
        Catch up now
      </Button> : null}
      {data.mySeat == null ? <p>Watching only. Both players’ hidden cards remain private.</p> : null}
      {realtime.presence ? (
        <div>
          <p>{realtime.presence.spectatorCount} watching</p>
          {data.session.seats.map((seat) => (
            <p key={seat.seat}>{seat.displayName} · {seat.isBot ? "Bot" : realtime.presence?.onlineSeats.includes(seat.seat) ? "Connected" : "Disconnected"}</p>
          ))}
        </div>
      ) : null}
      {forkMode ? null : <BugReportMenuButton room={data} />}
      {canSurrender ? <Button type="button" variant="danger" size="sm" disabled={busy || tossLocked}
        onClick={askSurrender}>Surrender</Button> : null}
      {canCancel ? <Button type="button" variant="secondary" size="sm" disabled={busy || tossLocked}
        onClick={askCancel}>Cancel duel</Button> : null}
      {canArchive ? <Button type="button" variant="secondary" size="sm" disabled={busy}
        onClick={() => void run(() => archiveDuel(slug))}>Archive table</Button> : null}
      {!forkMode && (data.session.status === "completed" || data.session.status === "interrupted") ? (
        <>
          <p>Finished. This duel is in Match history.</p>
          <Link href={`/duels/${slug}/replay`}>Watch replay</Link>
        </>
      ) : null}
      <Link href="/duels">Back to tables</Link>
    </div>
  );
  const sidePanes = (inAside: boolean) => (
    <>
      <SidePanel pane="card" selected={inAside ? desktopPane(pane) : pane} semantic={inAside}>{cardPanel}</SidePanel>
      <SidePanel pane="log" selected={inAside ? desktopPane(pane) : pane} semantic={inAside} keepMounted>{logPanel(inAside)}</SidePanel>
      <SidePanel pane="settings" selected={inAside ? desktopPane(pane) : pane} semantic={inAside}>{settingsPanel}</SidePanel>
      {inAside ? null : <SidePanel pane="masters" selected={pane} semantic={false}>{mastersPanel}</SidePanel>}
    </>
  );
  const tabs = (mobile = false) => (
    <SideTabs panes={mobile ? mobilePanes(domain) : DESKTOP_PANES} selected={mobile ? pane : desktopPane(pane)}
      unread={logUnread} mobile={mobile}
      onSelect={(tab) => { setPane(tab); if (mobile) setMobileInspect(true); }} />
  );

  const solid = view.mode === "3d" && !multi && !liveTable;

  // The HUD's Deck Master plates read the same seat views and legal actions as the rail of the classic page.
  const hudSeatTones = new Map<number, { main: string; ink: string }>(
    (engine?.seats ?? []).map((seat) => [seat.seat, seat.seat === localSeat ? SEAT_TONE_HEX.ice : SEAT_TONE_HEX.rose]),
  );
  // The drawer of the shells without the HUD: the same hover / pin / row logic, with the pin held here.
  const drawerPreview = hud || mobileInspect || pile?.open ? null : hudPreview(
    hover?.card ?? null, activeMenu?.card, rowPreview.card,
    (card) => ({ name: playerName(card.controller), ...(hudSeatTones.get(card.controller) ?? SEAT_TONE_HEX.ice) }), pinnedCard);
  const hudMaster = (seatView: NonNullable<typeof engine>["seats"][number] | undefined, local: boolean, title: string) =>
    hudMasterProps({ legalKeys: fieldLegalKeys, selectedKeys, canAct, prompt, onAnswer: onSubmitAnswer, onActivate: onFieldActivate, onHoverCard }, seatView, local, title, true);
  // The Deck Master badges (name plates of the 1v1 board and the 3D room) read the master of their seat from here.
  const masterBadges: MasterBadgeSource | null = domain && engine && !multi ? {
    forSeat: (seat) => {
      const seatView = engine.seats.find((entry) => entry.seat === seat);
      const mine = seat === localSeat;
      return hudMaster(seatView, mine && !spectator, mine ? (spectator || forkMode ? `${playerName(seat)}'s Master` : "Your Master") : `${playerName(seat)}'s Master`);
    },
    onInspect: (target) => showInspector(target, true),
  } : null;

  // The pieces of the flat page, built once so the classic page and the 3D mode page (SolidRoom) show the same nodes.
  const wordmark = <Link href="/duels" replace={inDuelWindow}>Dueling Domain</Link>;
  const spectatorTag = spectator ? <strong className={styles.viewerRole} title="You are watching. Both players' hidden cards remain private.">
    <Eye size={15} strokeWidth={1.5} aria-hidden /> You are spectating
  </strong> : null;
  const modeText = genesysLabel(data.session.mode, genesysOf(data.session), domain && isCustomDomain(data.session.masterRule, data.session.settings))
    ?? (domain ? isCustomDomain(data.session.masterRule, data.session.settings) ? "Custom Domain" : "Domain" : `MR${data.session.masterRule}`);
  const formatText = `${modeText} · ${formatLabel(format)}`;
  const headerIdentity = (
    <div className={styles.identity}>
      {wordmark}
      {spectatorTag}
      <span className={styles.format}>{formatText}</span>
    </div>
  );
  const headerTurn = (
    <div className={styles.turn}>
      <strong>Turn {engine?.turn ?? "—"}</strong><span className={styles.phaseName} data-step={battleStep ?? undefined}>{headerPhase}</span>
      {turnText ? (
        <span className={styles.whoPill} data-turn={spectator ? "watch" : myTurn ? "you" : "opp"}>
          {spectator ? <Eye size={13} strokeWidth={1.75} aria-hidden /> : myTurn
            ? <Diamond size={13} strokeWidth={1.75} fill="currentColor" aria-hidden />
            : <Circle size={13} strokeWidth={1.75} aria-hidden />}
          {turnText}
        </span>
      ) : null}
    </div>
  );
  const connectionStatus = (
    <span className={styles.connectionStatus} role="status" aria-live="polite" data-live={connectionLabel === "Live"}>
      {connectionLabel === "Live" ? <i className={styles.liveDot} aria-hidden /> : <Radio size={15} strokeWidth={1.75} aria-hidden />}
      <span className={styles.connectionText}>
        {connectionLabel === "Live" ? (spectator ? "Live duel · watching" : "Live duel") : connectionLabel}
      </span>
    </span>
  );
  const headerTools = (
    <>
      {forkBar}
      {forkMode ? null : <BugReportHeaderButton room={data} />}
      {forkMode ? null : <ReportButton slug={slug} />}
      {popOutControl}
      {leaveControl}
      {testQuitControl}
      {hasResult && hideResult ? (
        <button type="button" className={styles.tool} onClick={() => setHideResult(false)}>
          <span>Show result</span>
        </button>
      ) : null}
      {hasResult && resultReady ? (
        <button type="button" className={styles.tool} onClick={exitDuel}>
          <span>Exit duel</span>
        </button>
      ) : null}
      <button type="button" className={`${styles.tool} ${styles.pref}`}
        aria-label={`Sound effects ${soundLabel.toLowerCase()}`}
        onClick={() => preferences.setSoundEnabled(!preferences.soundEnabled)}>
        {preferences.soundEnabled ? <Volume2 size={16} strokeWidth={1.75} aria-hidden /> : <VolumeX size={16} strokeWidth={1.75} aria-hidden />}
        <span>Sound <b>{soundLabel}</b></span>
      </button>
    </>
  );
  const seriesBanner = series && !showResult && !(betweenGames && myIndex != null) ? (
    <SeriesBanner room={data} slug={slug} onChanged={() => void refreshRoom()} onNavigate={goToGame} />
  ) : null;
  const noticesNode = error || actionError || data.error || viewerLeaving ? (
    <div className={styles.notices} data-prompt-surface="">
      {leavingNotice}
      {error ? <div className={styles.error} role="alert">Connection lost. Actions paused until reconnected.
        <button type="button" onClick={() => void mutate()}>Retry</button></div> : null}
      {actionError ? <div className={styles.error} role="alert">{actionError}</div> : null}
      {data.error ? <div className={styles.error} role="alert">{data.error}</div> : null}
    </div>
  ) : null;
  const inspectorNode = (
    <>
      {tabs()}
      <div className={styles.sideContent} {...cardScrollerProps(desktopPane(pane) === "card")}>{sidePanes(true)}</div>
    </>
  );
  const promptDockNode = (
    <div
      className={styles.promptDock}
      data-mode={dockMode}
      data-tone={prompt?.context?.type === "chain" ? "chain" : "action"}
      data-idle={dockMode === "idle" ? "true" : "false"}
      data-prompt-surface={dockMode === "idle" ? undefined : ""}
    >
      <PromptTray prompt={prompt} mySeat={data.mySeat} slug={slug} busy={busy || Boolean(error) || catchingUp}
        draft={draft} onSubmit={onSubmitAnswer} menuOpen={promptMenuOpen} escapeHeld={hudFlyoutOpen || drawerPinned}
        active={data.session.status === "active" && !viewerOut} aim={promptAim} headless={centered} suspended={centered && !revealed}
        waitingName={(multi || forkMode) && prompt ? playerName(prompt.seat) : null}
        disabledIds={engine ? outSeatOptionIds(prompt, outOrLeavingSeats(engine.seats)) : undefined} />
    </div>
  );
  // What DuelField (classic) and SolidField (3D mode) take: one object, so both looks drive the same logic.
  // Classic 1v1: the phases live on the board, in the free cells of the Extra Monster Zone row. The bar keeps the caption, the clock
  // and the Responses + turn group. The 3D board, the legacy multiseat stage and the tag table keep the phases in the bar.
  const phaseHub = Boolean(engine) && !solid && !multi && !liveTable;
  const hubNode = phaseHub && engine ? (
    <PhaseHub
      variant="band"
      phase={shownPhase}
      revision={engine.revision}
      battleStep={battleStep}
      turn={engine.turn}
      turnSeat={engine.turnSeat}
      mySeat={data.mySeat}
      playerName={playerName}
      actionOptions={mine ? actionOptions : []}
      canAct={canAct}
      onChoose={(id) => onSubmitAnswer({ choice: id })}
      reducedMotion={preferences.reducedMotion}
    />
  ) : null;
  const fieldProps = engine ? {
    engine, mySeat: data.mySeat, bottomSeat: cameraSeat, masterRule: sessionBoardRule(data.session, engine),
    reducedMotion: preferences.reducedMotion,
    priorityLive: !busy && !error && !realtime.recovering && !catchingUp &&
      (data.mySeat == null || (engine.prioritySeat ?? prompt?.seat) !== data.mySeat || revealed),
    legalKeys: fieldLegalKeys, selectedKeys, onActivate: onFieldActivate,
    onHoverCard, onInspect: (target: InspectTarget) => showInspector(target, true),
    named: forkMode,
    bottomName: playerName(localSeat),
    topName: playerName(top?.seat ?? 1 - localSeat),
    hub: hubNode,
    masterBadge: masterBadges ? (seat: number, side: "opp" | "you") => <SeatMasterBadge seat={seat} side={side} shortcut={seat === localSeat && !spectator} /> : undefined,
  } : null;
  // The board: the field (given by the caller), the FX layers as flat siblings of it, the prompt layer and the pile viewer.
  const renderBoard = (field: ReactNode): ReactNode => engine ? (
    <MoveSourceBoundary events={withMasterSummonMoves(engine.events, previousSeats, engine.seats)} duelKey={slug} root={boardRef}>
      {field}
      <FxBoundary>
      {fxUp ? <CoinTossFx events={engine.events} duelKey={slug} reducedMotion={preferences.reducedMotion}
        replayFrom={startBeats.replayFrom} skipThrough={startBeats.skipThrough} /> : null}
      {fxUp ? <DuelFeedback events={engine.events} duelKey={slug} replayFrom={startBeats.replayFrom} skipThrough={startBeats.skipThrough}
        soundEnabled={preferences.soundEnabled} soundVolume={preferences.soundVolume} reducedMotion={preferences.reducedMotion} /> : null}
      {fxUp ? <SummonFx seats={engine.seats} events={withMasterSummonMoves(withDestroyCards(engine.events), previousSeats, engine.seats)} duelKey={slug}
        reducedMotion={preferences.reducedMotion} shake={preferences.shake} /> : null}
      {fxUp ? <MoveFx events={withMasterSummonMoves(withDestroyCards(engine.events), previousSeats, engine.seats)} duelKey={slug} reducedMotion={preferences.reducedMotion} replayFrom={startBeats.replayFrom} skipThrough={startBeats.skipThrough} /> : null}
      {fxUp ? <PositionFx events={engine.events} duelKey={slug} reducedMotion={preferences.reducedMotion} /> : null}
      {fxUp ? <ChainFx events={withDestroyCards(engine.events)} chain={engine.chain} duelKey={slug}
        reducedMotion={preferences.reducedMotion} mySeat={data.mySeat} playerName={playerName} ended={duelOver} seats={engine.seats} promptOpen={promptMine && ownPromptOpen(prompt, data.mySeat)} /> : null}
      {fxUp ? <MasterReturnFx events={engine.events} seats={engine.seats} duelKey={slug}
        reducedMotion={preferences.reducedMotion} mySeat={data.mySeat} /> : null}
      <BattleFx key={`battle-${slug}`} events={withDestroyCards(engine.events)} seats={engine.seats} reducedMotion={preferences.reducedMotion}
        active={fxUp} aim={solid ? null : battleAim} result={engine.result} battleStep={battleStep} nameOf={playerName} />
      <DestroyFx key={`destroy-${slug}`} events={withDestroyCards(engine.events)} reducedMotion={preferences.reducedMotion}
        active={fxUp} mySeat={localSeat} />
      </FxBoundary>
      <RowPreviewBoundary row={rowPreview} enabled>
        <PromptCenter prompt={prompt ?? pick.waiting} mySeat={data.mySeat} active={data.session.status === "active" && !viewerOut} slug={slug}
        busy={busy || Boolean(error) || catchingUp || (prompt == null && pick.waiting != null)} offline={Boolean(error)} draft={draft} onSubmit={onSubmitAnswer}
        menuOpen={promptMenuOpen} escapeHeld={hudFlyoutOpen || drawerPinned} chain={engine.chain} aim={promptAim}
        aimLocked={aimLock != null && aimLock.promptId === prompt?.id}
        reducedMotion={preferences.reducedMotion} revision={engine.revision} battleStep={battleStep}
        outSeats={outOrLeavingSeats(engine.seats)} leavingSeats={leavingOnlySeats(engine.seats)}
        revealed={revealed} onInspectCard={inspectInfo} onHoverCard={rowPreview.show} nameOf={playerName} />
      </RowPreviewBoundary>
      {pile ? (
        <PileViewer title={livePileTitle(pile, livePileCards(pile, engine, localSeat))} owner={pile.owner} open={pile.open}
          cards={livePileCards(pile, engine, localSeat)} onClose={closePile}
          onInspectCard={(card) => { setInspect({ type: "card", card }); if (pane !== "log") setPane("card"); }}
          onHoverCard={(card) => rowPreview.show(card?.code != null ? card : null)}
          onActivateCard={onInspectorActivate}
          legalKeys={fieldLegalKeys} selectedKeys={selectedKeys} chainLinks={pileChainLinks}
          reducedMotion={preferences.reducedMotion} />
      ) : null}
    </MoveSourceBoundary>
  ) : <p className="p-4">{data.session.status === "active" ? "Waiting for engine view…" : "No saved final board is available for this record."}</p>;
  const trackNode = (
    <StationTrack
      {...stationTrackProps({
        phase: shownPhase,
        battleStep,
        turn: engine?.turn,
        turnSeat: engine?.turnSeat,
        mySeat: data.mySeat,
        playerName,
        promptMine: mine,
        actionOptions,
        canAct,
        onAnswer: onSubmitAnswer,
        caption: trackCaption,
        reducedMotion: preferences.reducedMotion,
        chainMode,
      })}
      clock={null}
      phases={phaseHub ? "hub" : "bar"}
      compact={hud}
    />
  );
  const mobileTabs = tabs(true);
  const overlaysNode = (
    <>
      {activeMenu ? <CardActionMenu anchor={activeMenu.anchor} title={activeMenu.title}
        options={activeMenu.options} busy={busy} onClose={closeMenu}
        tone={activeMenu.tone}
        materials={materialsMenu(activeMenu.card, (target) => { closeMenu(); showInspector(target); })}
        onOptionHover={onMenuOptionHover}
        onChoose={(option) => {
          if (activeMenu.promptId !== prompt?.id || activeMenu.revision !== engine?.revision) return;
          closeMenu();
          onSubmitAnswer({ choice: option.id });
        }} /> : null}
      {attackTargetActive && aimLock && aimLock.promptId === prompt?.id && !busy && !error && !catchingUp ? (
        <AttackConfirm anchor={aimLock.anchor} targetName={aimLock.name} busy={busy}
          preview={solid && engine ? buildAttackPreview(engine, attackerKey, aimLock.key, playerName) : undefined}
          prefer={confirmSide(attackerKey, aimLock.anchor)} onConfirm={confirmAim}
          onBack={() => setAimLock(null)} />
      ) : null}
      {pickHintShown && pickHint ? <PickRefusalHint anchor={pickHint.anchor} text={pickHint.text} onDone={clearPickHint} /> : null}
      {!hud ? (
        <GridHoverPreview card={drawerPreview?.card ?? null} owner={drawerPreview?.owner ?? null} reducedMotion={preferences.reducedMotion}
          pinned={drawerPreview?.pinned === true} onClose={() => setPinnedCard(null)} />
      ) : null}
      <Sheet open={mobileInspect} onClose={() => setMobileInspect(false)}
        className={solid ? SOLID_SHEET_CLASS : undefined}
        title={pane === "card" ? "Card" : pane === "log" ? "Duel log" : pane === "masters" ? "Deck Masters" : "Settings"}>
        {sidePanes(false)}
      </Sheet>
      {surrenderModal}
      {cancelModal}
      {testQuit.dialog}
      {showResult ? (
        <DuelResultScreen room={data} slug={slug} reducedMotion={preferences.reducedMotion}
          soundEnabled={preferences.soundEnabled} onClose={() => setHideResult(true)} onExit={exitDuel}
          onSeriesChanged={() => void refreshRoom()} onNavigate={goToGame} />
      ) : null}
      {forkResult}
    </>
  );

  if (solid) {
    return withCracks(
      <ForkSearchContext.Provider value={forkSearch}><DeckSurrenderContext.Provider value={deckSurrender}><MasterBadgeContext.Provider value={masterBadges}>
        <SolidRoom
          slug={slug}
          boardRef={boardRef}
          dealWait={startBeats.waiting}
          domain={domain}
          battle={battle}
          spectator={spectator}
          myTurn={myTurn}
          reducedMotion={preferences.reducedMotion}
          view={view}
          preferences={preferences}
          engine={engine ?? null}
          previousSeats={previousSeats}
          mySeat={cameraSeat ?? data.mySeat}
          playerName={playerName}
          format={formatText}
          turnText={turnText}
          headerPhase={headerPhase}
          battleStep={battleStep}
          connectionStatus={connectionStatus}
          wordmark={wordmark}
          spectatorTag={spectatorTag}
          seriesLabel={<SeriesGameLabel room={data} />}
          headerTools={headerTools}
          seriesBanner={seriesBanner}
          noticesNode={noticesNode}
          inspectorNode={inspectorNode}
          logUnread={logUnread}
          promptDockNode={promptDockNode}
          battleAim={battleAim}
          trackNode={trackNode}
          mobileTabs={mobileTabs}
          overlaysNode={overlaysNode}
          fieldProps={fieldProps}
          renderBoard={renderBoard}
          renderClock={(seat) => shownClock ? <DuelClockDisplay key={shownClock.serverNow} clock={shownClock} session={data.session} reducedMotion={preferences.reducedMotion} seats={[seat]} /> : null}
          inspect={inspect}
          pane={pane}
          setPane={setPane}
          setMobileInspect={setMobileInspect}
          boardQuiet={boardQuiet}
          onBeforeViewChange={beforeViewChange}
        />
      </MasterBadgeContext.Provider></DeckSurrenderContext.Provider></ForkSearchContext.Provider>,
    );
  }

  return withCracks(
    <ForkLabelsContext.Provider value={forkMode}><ForkSearchContext.Provider value={forkSearch}><DeckSurrenderContext.Provider value={deckSurrender}><MasterBadgeContext.Provider value={masterBadges}>
    <div className={`${styles.shell} ${duelFontClasses} -mx-4 -my-4 sm:-mx-6 sm:-my-6 lg:-mx-8 lg:-my-8`}
      data-duel-fx-speed-root data-domain={domain} data-fit="true" data-phase={battle ? "battle" : undefined}
      data-hud={hud ? "room" : undefined}
      data-turn={spectator ? "watch" : myTurn ? "you" : "opp"}
      data-reduced={preferences.reducedMotion ? "true" : "false"} style={tableTextStyle(textSize)}>
      {hud ? (
        <header className={`${hudStyles.top} ${styles.hudBar}`} data-testid="hud-top">
          <div className={hudStyles.topLeft}>{headerIdentity}</div>
          {hudClockBank(shownClock, data.session, preferences.reducedMotion)}
          <div className={hudStyles.topMid}>{headerTurn}</div>
          <div className={hudStyles.topRight}>
            <SeriesGameLabel room={data} />
            {connectionStatus}
            {headerTools}
          </div>
        </header>
      ) : (
        <header className={styles.header}>
          {headerIdentity}
          {headerTurn}
          <div className={styles.status}>
            <SeriesGameLabel room={data} />
            {connectionStatus}
            {headerTools}
          </div>
        </header>
      )}
      {hud ? null : clockStrip(shownClock, data.session, preferences.reducedMotion)}
      {seriesBanner}
      <div className={styles.layout}>
        {/* Notices float over the top of the layout. In flow they would take height from the board
            and shrink it for as long as the notice shows. */}
        {noticesNode}
        {hud ? null : (
          <aside className={styles.inspector}>
            {inspectorNode}
          </aside>
        )}
        {hud ? null : promptDockNode}
        <section className={styles.boardColumn} aria-label="Duel field">
          <div className={styles.board} ref={boardRef} data-deal-wait={startBeats.waiting ? "true" : undefined}>
            {renderBoard(multi ? (
              <MultiSeatStage key={slug} engine={engine!} mySeat={data.mySeat} masterRule={sessionBoardRule(data.session, engine)}
                reducedMotion={preferences.reducedMotion}
                legalKeys={fieldLegalKeys} selectedKeys={selectedKeys} onActivate={onFieldActivate}
                onHoverCard={onHoverCard} onInspect={(target) => showInspector(target, true)}
                nameOf={playerName} promptSeat={prompt?.seat ?? null}
                focusSeat={focusSeat} onFocusSeat={setPinnedFocus} seatPick={seatPick} />
            ) : fieldProps ? <DuelField key={slug} {...fieldProps} /> : null)}
          </div>
        </section>
        {masterRail && !hud ? <aside className={styles.masters} aria-label="Deck Masters">{masterRail}</aside> : null}
      </div>
      {hud ? (
        <div className={hudStyles.corner} data-hud-corner="" data-testid="hud-corner">
          {promptDockNode}
          {trackNode}
        </div>
      ) : (
        <div className={styles.track}>
          {trackNode}
        </div>
      )}
      <div className={styles.mobileBar}>{mobileTabs}</div>
      {hud && engine ? (
        <RoomEdgeLayer
          hud={hudState}
          panels={{ card: cardPanel, log: logPanel(true), settings: settingsPanel }}
          chain={engine.chain}
          chainOpen={engine.chain.length > 0 && !terminal}
          nameOf={playerName}
          seatTones={hudSeatTones}
          logUnread={logUnread}
          preview={hudPreview(hover?.card ?? null, activeMenu?.card, rowPreview.card, (card) => ({ name: playerName(card.controller), ...(hudSeatTones.get(card.controller) ?? SEAT_TONE_HEX.ice) }), hudState.pinned)}
          equipLinks={resolveEquipLinks(engine.seats)}
          previewHidden={pickHintShown}
          reducedMotion={preferences.reducedMotion}
        />
      ) : null}
      {overlaysNode}
    </div>
    </MasterBadgeContext.Provider></DeckSurrenderContext.Provider></ForkSearchContext.Provider></ForkLabelsContext.Provider>,
  );
}
