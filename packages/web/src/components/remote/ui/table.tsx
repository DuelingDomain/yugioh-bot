"use client";

import {announceNotACard} from '@/lib/remote/set-card-diagnostics';
import { REMOTE_TABLE_TALK } from "@/lib/remote/table-talk";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { REMOTE_FORMATS, REMOTE_HAND_SUGGESTION_EVENT, type RemoteHandSuggestionEvent, matchCardsByName, previousYgoPhase, normalizeRemoteFormat, remoteOwnFirstPending, remoteRecognitionRef, remoteRecognitionRefs, type RemoteActionProposal, type RemoteEvent, type RemoteRoom, type RemoteUndoEntry } from "@yugidraft/shared/remote";
import { useSeatFocus } from "./seat-focus";
import { cardInfo, isLinkInfo, isMonsterInfo, loadCards, searchCards, useCardInfo } from "./catalog";
import { EffectControls, EffectPicker } from "./effect-controls";
import { DuelTimer, LpStrip, TopBar, AdminWatchStrip, type Player } from "./chrome";
import { BottomBar } from "./bottom-bar";
import { PhaseTrack, usePhaseAsk } from "./phase-track";
import { CardPopover, InspectorBody, type CardActions, type CardEdit, type CardSource, type Subject } from "./card-view";
import { ActivateRow, OkBanner, ThinkingCallout, useOkHold } from "./think";
import { CoinDieControl, RollOverlay, useRollHold } from "./coin-die";
import { activatable, aliveSeats, CHAIN_GAP_MS, chainOf, maySignal, onField, recentlyPlaced, thinkingSeats } from "./think-model";
/** The client sends Thinking and OK this far apart: a little over the server rule of one a second. */
const SIGNAL_GAP_MS = 1050;
import { VoxSection, type Proposal } from "./dock";
import { useMicChoice } from "./mic-choice";
import { describeEvent, undoLabel, type LogKind } from "./describe";
import { ownUndoEntries, phaseBackAction, shortUndoLabel } from "./undo-ui";
import { DeckFlagPopover } from "./deck-flag";
import { Banner, IdleBanner, type HealthExtra, HistoryPopover, InspectorDrawer, Peek, Toasts, type LogEntry, type PeekState, type ToastItem } from "./drawers";
import { LogCardPreview, TableDrawer, type DrawerTab } from "./table-drawer";
import { buildLog, type LogRow } from "./log-model";
import { AdminTab, SettingsTab } from "./drawer-settings";
import { useAdminAccess } from "./admin-watch-list";
import type { BoardReading, FeedHit, FeedMark, FeedPoint, FeedReticle, FeedStart } from "./feed";
import type { PopAt, Rect, Tier } from "./popup";
import { canFlipSummon, interpret, type MoveIntent, type VoiceIntent } from "./grammar";
import type { FieldDrag } from "./holo-field";
import { judgeMove, landingForCell, landingLabel, type Landing } from "./placement";
import { announceManualMove, onManualZoneRequest } from "@/lib/remote/manual-moves";
import { beginManualCorrection } from "@/lib/remote/manual-corrections";
import { ZoneActions } from './zone-actions';
import { zonePlacement, zoneSet, zoneCardAction, type ZonePick } from './zone-placement';
import { RecentDepartures } from './recent-departures';
import { COLORS, battleMath, leavePosition, pileEntryFace, cardCode, cellsFor, zoneLabel, isPile, sameObservedCard, cardName, cellKeyOf, deckFlag, deckIdsOf, voiceCardNames, facingSeat, foundationZone, hasDeck, hasExtraZones, mirrorEmz, PHASES, PHASE_LONG, readCardOf, placedTwin, sg, type TwinCard, type ZoneKey } from "./model";
import { findTwinGroups } from "./twins";
import { PileViewer, type PileZone } from "./pile-viewer";
import { NotifyDock } from "./notify-dock";
import { RecognitionTray, type Pick, type TrayState } from "./recognition-tray";
import { VisionFeedbackSetting } from "@/components/settings/vision-feedback-setting";
import { isBestMatch, isClearRead, setFeedbackCapture, type FeedbackSource, type Guess } from "./recognizer";
import { SeatPanel } from "./seat-panel";
import type { RescanResult } from "@/lib/remote/video-protocol";
import { RemoteFx } from "./remote-fx";
import { HandActivation } from "./hand-activation";
import { isPushedLayer, useLayers } from "./use-layers";
import { remoteApi, serverNow } from "./api";
import { useRemoteRoom, type RoomController } from "./use-remote-room";
import { useVoice, type MicState } from "./use-voice";
import { useVoiceDiagnostics } from "./use-voice-diagnostics";
import { VoiceControls } from "./voice-controls";
import type { CameraMenuSetup } from "./camera-tools-menu";
import { decideVoice } from "./voice/decision";
import type { VoiceFinal } from "./voice/live-client";
import { utteranceRecord, voiceCommands, type VoiceContext, type VoiceDecision, type VoiceMethod } from "@/lib/remote/voice-diagnostics";
import { faceDownInFrame, tapMemoryFor, type TapSpot } from '@/lib/remote/tap-memory';
import { VideoHubProvider, useVideoHub } from "./video-hub";
import { gpuLossReason, setHybridReaderEnabled, useRecognitionBackend } from "./recognition-backend";
import { cameraPermissionGranted, cameraWanted, rememberCameraWanted, takeCameraReady } from "./camera-choice";
import { RemoteLobbyRoom } from "./lobby";
import { REMOTE_RETENTION_NOTICE } from "./retention-notice";
import { SpectatorScreen } from "./spectator-table";
import { duelFontClasses } from "@/components/duel/fonts";
import type { FeedbackPreference } from "@/components/settings/vision-feedback-setting";
import { Icon } from "./icons";
import { DeclareConfirm, DeclarePending, MatchResultScreen, SidingScreen, declareChoices } from "./match-ui";
import { OpeningRollScreen } from "./opening-roll";
import { matchOf } from "./match-model";
import { DeckMenu, LeaveDock, SurrenderConfirm } from "./surrender";
import { RemoteResultSlot } from "@/components/tournament/matches/remote-result-panel";
import type { RemoteTournamentLink } from "@/lib/remote-tournament-link";
import { PhoneScanReview } from "../phone/scan-review";
import s from "./remote-ui.module.css";
import matchStyles from "./match-ui.module.css";

const WEBCAM_ONLY_KEY = "dd-remote-webcam-only";
const SEAT_BOARD_KEY = "dd-remote-board-hidden";
import {publicTrackedTwin, trackedRereadTarget} from '@/lib/remote/field-track-cache';
import { AutoFieldWatcher } from "../field-watcher";
import { isTournamentTable, stateMode, seatBoardOff } from "@/lib/remote/tournament-detection";
import {manualFieldZoneWarning,projectFieldZone,tokenInCell,becomesTrapMonster,equipSourceOnField,fieldZoneCheck} from '@/lib/remote/field-legality';
import {fieldOrientation,fieldZoneAt,fieldZoneLocation,mapFieldZone,onMat,type FieldFormat} from '@yugidraft/vision';
import {useCardDetection,resolveWebcamOnly,useZoneGrid,useTapToIdentify,tapToIdentifyNow,currentZoneGrid,setFieldDeveloper,runFieldScan,useFieldWatcherError,readGridPref,writeGridPref} from '@/lib/remote/zone-grid';
import {distinctFieldQuads,fieldReadingPlaceholder,rememberFieldObservation} from '@/lib/remote/field-proposals';
import {SUMMON_WINDOW_MS} from '@/lib/remote/field-summons';
import { useCardMenu } from "./card-menu";
import { FeedCardsProvider } from "./feed-cards";
import { ChainBadges, chainMarksOf } from "./chain-marks";
import { useTokens } from "./token-ui";
import { useControlChange } from "./control-ui";
import { useNextStep } from "./next-step-chip";
import { quickMoves } from "./quick-moves";
import { controlOffer, equipsItself } from "@/lib/remote/card-logic";
import { handAdd, handCount, handCountOf, handReveal, knownHandOf, openSearch, SEARCH_WINDOW_MS, type HandBy, type HandCandidate, type HandSource, type HandSuggestion, type KnownHandCard } from "./reveal-model";
import type { HandProps } from "./hand-ui";
import { isTypingTarget } from "@/lib/typing-target";
import { playerStamp } from "@/lib/remote/field-timing";
const REMOTE_IDLE_CLOSE_MS = 10 * 60_000; // the server closes a table after 10 idle minutes (shared services constant)

const MARK_LIFE_MS = 4000; // an outline and its label on the feed fade after this, unless its popup is open
/** The small mark on the camera between a click and the end of the card search. */
const BEGIN_RETICLE = "begin";
const FIND_LIMIT_MS = 15_000; // a click search for the card under the pointer
const READ_LIMIT_MS = 75_000; // a card read: longer than the 60 s wait for a paired phone in video-hub.tsx
const fmtTime = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const typing = isTypingTarget;

type ReadCtx = { from?: CardSource; cardRef?: string; seat: number; x: number; y: number; quad?: { x: number; y: number }[]; at: PopAt; id: number; ref?:string; frozenFrame?:HTMLCanvasElement; copyWitnesses?:FeedHit["copyWitnesses"]; capturedAt?:number; tier?: Tier; covered?: boolean; token?: number; guesses?: Guess[]; bestMatch?: boolean; placedRef?: string; invalidatePreread?: () => void;
  /** Tap to identify: the spot of this click in the local memory. */ spot?: TapSpot;
  /** The open card comes from the local memory, so a correction stays in this browser too. */ hidden?: boolean;
  /** The click was on a Set card of the table: nothing from this read may tell the table. */ setClick?: boolean };
type Pending = Proposal & { requestId?: string; run: () => void };

/** The tapped cell, so the picker opens beside it and leaves the rest of the board in view. */
function zoneRect(seat: number, key: ZoneKey): { left: number; top: number; right: number; bottom: number } | null {
  if (typeof document === 'undefined') return null;
  const box = document.querySelector(`[data-testid="field-${seat}"] [data-zone="${key}"]`)?.getBoundingClientRect();
  return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null;
}

/** Entry point of /duels/remote/[slug]: the lobby room before the start, the table after it. */
export function RemoteTableScreen({ slug, tournament = null, watchAsAdmin = false, hybridEnabled }: { slug: string; /** Set when the viewer is one of the two paired players of a tournament match on this table. */ tournament?: RemoteTournamentLink | null;
  /** The admin list's Watch button: open the table as a spectator, a private one too (the server checks the owner list). */ watchAsAdmin?: boolean;
  hybridEnabled: boolean }) {
  useLayoutEffect(() => {
    setHybridReaderEnabled(hybridEnabled);
    return () => setHybridReaderEnabled(false);
  }, [hybridEnabled]);
  const ctl = useRemoteRoom(slug, { watchAsAdmin });
  const room = ctl.room;
  const router = useRouter();
  // The host closed a table that never started: a seated guest (not the host, who is already on the way) goes back to the tables list with a short notice, not to a dead table.
  const closedByHost = !!room && !tournament && !room.spectator && room.status === "ended" && room.startedAt === null && room.endReason === "creator-left"
    && room.seats.find(seat => seat.seat === room.mySeat)?.userId !== room.createdBy;
  useEffect(() => { if (closedByHost) router.replace("/duels?notice=closed"); }, [closedByHost, router]);
  const isDeveloper = room?.isDeveloper === true;
  useEffect(() => { setFieldDeveloper(isDeveloper); return () => setFieldDeveloper(false); }, [isDeveloper]);
  if (!room) return <div className={`${duelFontClasses} ${s.app}`} data-mode="1v1"><div className={s.shell} style={{ display: "grid", placeItems: "center", alignContent: "center", gap: 12 }}>
    <p role="status" data-testid="remote-load-note" style={{ color: "var(--ink2)", maxWidth: 520, padding: "0 16px", textAlign: "center" }}>{ctl.loadError ? `${ctl.loadError.message.replace(/\.$/, "")}. Join an open seat to enter.` : "Loading table…"}</p>
    {ctl.loadError ? <p style={{ color: "var(--ink2)", fontSize: 13, lineHeight: 1.55, maxWidth: 520, padding: "0 16px", textAlign: "center" }}>{REMOTE_RETENTION_NOTICE}</p> : null}
    {ctl.loadError ? <button type="button" className={`${s.btn} ${s.go}`} disabled={ctl.busy} onClick={() => void ctl.operation("seat")}>Join available seat</button> : null}
    {ctl.error ? <p role="alert" style={{ color: "var(--loss)" }}>{ctl.error}</p> : null}</div></div>;
  // No VideoHubProvider for a spectator: it holds the camera and the card reader.
  if (room.spectator) return <SpectatorScreen ctl={ctl} room={room} />;
  return <VideoHubProvider room={room}>{room.status === "lobby" ? <RemoteLobbyRoom ctl={ctl} room={room} voiceRecognition={room.voiceEnabled === true} tournament={tournament} /> : <Table ctl={ctl} room={room} tournament={tournament} />}<PhoneScanReview ctl={ctl} room={room} /></VideoHubProvider>;
}

/** One plain sentence on why a table ended. */
/** What the Rescan button shows after the other seat answered. */
const rescanText = (result: RescanResult) => result === "started" ? "Rescan sent" : result === "off" ? "Their Auto-detect is off" : result === "busy" ? "Their scan is already running" : result === "paused" ? "Their Auto-detect is paused" : result === "limited" ? "Wait a few seconds" : "Could not reach them";

function endedWhy(room: RemoteRoom, winner: string | null) {
  if (room.endReason === "idle") return "It closed after 10 minutes without activity.";
  if (room.endReason === "creator-left") return "The host closed the table.";
  if (room.endReason === "account-deleted") return "A player deleted their account.";
  if (room.endReason === "forfeit") return winner ? `A player left the match. ${winner} won.` : "A player left the match.";
  return winner ? `${winner} won.` : "The game is over.";
}

function Table({ ctl, room, tournament }: { ctl: RoomController; room: RemoteRoom; tournament: RemoteTournamentLink | null }) {
  const voiceRecognition = room.voiceEnabled === true && room.mySeat >= 0;
  const sayItsName = "";
  const hub = useVideoHub();
  // A pick or a prompt (chip, attack target, E row) owns Escape even while the pushed drawer is open.
  const escapeBusy = useRef(false);
  const layers = useLayers(() => escapeBusy.current);
  // On a wide screen the table drawer pushes the table aside and does not block it (keys, hand search, the E row).
  const [wideScreen, setWideScreen] = useState(false);
  useEffect(() => { const query = window.matchMedia("(min-width: 1100px)"); const sync = () => setWideScreen(query.matches); sync(); query.addEventListener("change", sync); return () => query.removeEventListener("change", sync); }, []);
  const tableBlocked = !!layers.layer && !(layers.layer === "log" && wideScreen);
  const state = room.state; const mySeat = room.mySeat; const solo = room.solo;
  const match = matchOf(room); const inMatchBreak = match.phase !== "duel";
  const live = room.status === "active" && !state.ended && !inMatchBreak;
  const prereadScope = !room.spectator && mySeat >= 0 && !state.seats[mySeat]?.eliminated ? `${room.slug}:${state.match.games.length}` : undefined;
  const seatCount = room.seatCount;
  const seatIds = useMemo(() => room.seats.map(seat => seat.seat), [room.seats]);
  const name = useCallback((seat: number) => room.seats.find(item => item.seat === seat)?.displayName ?? `Seat ${seat + 1}`, [room.seats]);
  const lpOf = (seat: number) => state.seats[seat]?.resources.lp ?? 0;
  const startingLp = room.format?.settings.startingLP ?? 8000;
  const extraZones = hasExtraZones(room.format?.id);
  const turnActor = solo ? state.turnSeat : mySeat;
  const myTurn = solo || mySeat === state.turnSeat;
  const [feedbackPref, setFeedbackPref] = useState<FeedbackPreference | null>(null);
  const [aiAllowed, setAiAllowed] = useState(false);
  const onFeedbackPref = useCallback((pref: FeedbackPreference) => { setFeedbackPref(pref); setFeedbackCapture(pref.enabled && pref.collectionEnabled); }, []);
  const R = useRef({ room, state, layer: layers.layer, feedbackAdmin: false }); R.current = { room, state, layer: layers.layer, feedbackAdmin: !!feedbackPref?.isAdmin };

  // ---- card facts ----
  const twinCodes = state.seats.flatMap(item => item.twin.map(card => cardCode(card) ?? card.token?.artId));
  const deckCodes = seatIds.flatMap(seat => deckIdsOf(room, seat));
  const [subject, setSubject] = useState<Subject | null>(null);
  const [zonePicker, setZonePicker] = useState<{ seat: number; key: ZoneKey; requestId: number; targetRef?: string; initialFaceUp?:boolean; startPicker?:boolean; tokenOnly?:boolean } | null>(null);
  const [zoneBusy, setZoneBusy] = useState(false), [zoneError, setZoneError] = useState('');
  const [flagSeat, setFlagSeat] = useState(0);
  const info = useCardInfo([...twinCodes, ...deckCodes, subject?.cardId || undefined]);
  const nameOfCard = (id: number | undefined) => info(id)?.name;
  /** The public name of a twin card by seat and ref, for log lines (summon materials). */
  const refNameOf = (seat: number, ref: string) => { const c = state.seats[seat]?.twin.find(item => item.ref === ref); return c && (c.faceUp || c.publicIdentity || ["material", "graveyard", "banished"].includes(c.zone)) ? c.name ?? info(cardCode(c))?.name : undefined; };

  // ---- toasts, banner, peek ----
  // One notification slot per seat panel, beside that player's own feed or field.
  const [seatDocks, setSeatDocks] = useState<Record<number, HTMLElement | null>>({});
  const onSeatDock = useCallback((seat: number, node: HTMLElement | null) => setSeatDocks(old => old[seat] === node ? old : { ...old, [seat]: node }), []);
  const [toasts, setToasts] = useState<ToastItem[]>([]); const toastId = useRef(0);
  const toast = useCallback((text: ReactNode, ms = 2800) => { const id = ++toastId.current; setToasts(list => [...list.slice(-2), { id, text }]); setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), ms); }, []);
  const [banner, setBanner] = useState<{ id: number; small: string; big: string } | null>(null);
  // Thinking, OK and chain links come from the room events, so every screen shows the same.
  const okHold = useOkHold(room.events);
  const rollHold = useRollHold(room.events);
  const thinking = useMemo(() => thinkingSeats(room.events, live), [room.events, live]);
  // What this client just asked for, until the room events echo it. Two fast T presses then toggle correctly.
  const [pendingThink, setPendingThink] = useState<ReadonlyMap<number, boolean>>(() => new Map());
  const pendingRef = useRef(pendingThink); pendingRef.current = pendingThink;
  useEffect(() => {
    if (!pendingThink.size) return;
    const next = new Map(pendingThink); for (const [seat, on] of pendingThink) if (thinking.has(seat) === on) next.delete(seat);
    if (next.size !== pendingThink.size) { setPendingThink(next); return; }
    const timer = setTimeout(() => setPendingThink(new Map()), 5000);
    return () => clearTimeout(timer);
  }, [pendingThink, thinking]);
  const chain = useMemo(() => chainOf(room.events, aliveSeats(state)), [room.events, state]);
  const chainMarks = useMemo(() => chainMarksOf(chain), [chain]);
  const [peek, setPeek] = useState<PeekState>(null); const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showPeek = useCallback((kind: LogKind, text: ReactNode) => {
    if (R.current.layer === "log") return;
    setPeek({ id: Date.now(), kind, text });
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(null), 3400);
  }, []);
  useEffect(() => {
    let alive = true;
    void fetch("/api/remote-vision/ai", { cache: "no-store" }).then(reply => reply.ok ? reply.json() : { allowed: false }).then(body => { if (alive) setAiAllowed(body.allowed === true); }).catch(() => undefined);
    return () => { alive = false; setFeedbackCapture(false); };
  }, []);
  // A refused action shows as a toast. Over the result or siding screen (which cover toasts' place) it shows inside that screen instead.
  // The clock check `side.timeout` is quiet: the server may already have started the next game, which is not an error.
  const quietError = useRef(false);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const overlayUp = inMatchBreak;
  useEffect(() => {
    if (!ctl.error) return;
    if (!quietError.current) { if (overlayUp) setOverlayError(ctl.error); else toast(ctl.error, 4200); }
    ctl.setError("");
  }, [ctl, ctl.error, toast, overlayUp]);
  useEffect(() => { setOverlayError(null); }, [match.phase, match.games.length]);
  useEffect(() => { if (hub.error) toast(hub.error, 4200); }, [hub.error, toast]);
  // One calm notice while the server is out of reach (a restart): writes retry by themselves, so nothing else is shown.
  const toastItems = useMemo(() => ctl.reconnecting ? [...toasts, { id: -1, text: "Reconnecting…" }] : toasts, [toasts, ctl.reconnecting]);
  // A webcam player whose lobby preview worked gets the table camera without another click.
  const handoff = useRef(false);
  useEffect(() => {
    if (handoff.current || !live || !hub.rosterReady) return;
    handoff.current = true;
    const fromLobby = takeCameraReady(room.slug);
    if (!(fromLobby || cameraWanted(room.slug)) || hub.manual(mySeat) || hub.phones.some(item => item.seat === mySeat) || hub.cameraOn) return;
    if (fromLobby) { void hub.enableCamera(); return; }
    // A reload: the camera was on in this tab, so it comes back by itself when the browser already allows it. Otherwise the Turn camera on button stays.
    void cameraPermissionGranted().then(granted => { if (granted) void hub.enableCamera(); });
  }, [live, hub, room.slug, mySeat]);
  useEffect(() => { if (hub.cameraOn) rememberCameraWanted(room.slug, true); }, [hub.cameraOn, room.slug]);

  // Nobody has the turn until the opening die roll is decided: no turn glow, tag or banner before that.
  // "Roll your own dice" tables wait the same way, with no dice screen: the bottom bar asks who goes first.
  const ownFirst = match.phase === "duel" ? match.ownFirst : undefined;
  const ownFirstPending = remoteOwnFirstPending(match);
  const turnShown = match.phase === "duel" && (match.opening && match.opening.chosenSeat === undefined || ownFirstPending) ? -1 : state.turnSeat;
  const seen = useRef<{ phase: string; turn: number; seat: number } | null>(null);
  const [turnIn, setTurnIn] = useState(false);
  useEffect(() => {
    const before = seen.current; seen.current = { phase: state.phase, turn: state.turn, seat: turnShown };
    if (!before || !live) return;
    if (turnShown >= 0 && (before.turn !== state.turn || before.seat !== turnShown)) {
      const mineNow = !solo && mySeat === turnShown;
      setBanner({ id: Date.now(), small: `Turn ${state.turn} · ${PHASE_LONG[state.phase] ?? state.phase}`, big: mineNow ? "Your turn" : `${name(turnShown)}'s turn` });
      showPeek("PH", mineNow ? <>It is <b>your turn</b></> : <>Turn passed to <b>{name(turnShown)}</b></>);
      setTurnIn(true); const timer = setTimeout(() => setTurnIn(false), 1400); return () => clearTimeout(timer);
    } else if (turnShown >= 0 && before.phase !== state.phase) {
      setBanner({ id: Date.now(), small: `${name(state.turnSeat)} · Turn ${state.turn}`, big: PHASE_LONG[state.phase] ?? state.phase });
      showPeek("PH", <><b>{name(state.turnSeat)}</b> to <b>{PHASE_LONG[state.phase] ?? state.phase}</b></>);
    }
  }, [state.phase, state.turn, turnShown, live, solo, mySeat, name, showPeek]);

  // ---- log ----
  const [voiceLog, setVoiceLog] = useState<LogEntry[]>([]);
  const firstSeq = useRef(room.lastSeq);
  const entries = useMemo<LogEntry[]>(() => {
    const described = [...room.events].sort((a, b) => b.seq - a.seq).flatMap(event => {
      const line = describeEvent(event, name, nameOfCard, refNameOf, chain.links.get(event.id)); return line ? [{ id: event.id, time: fmtTime(event.at), kind: line.kind, text: line.text, fresh: event.seq > firstSeq.current, at: event.at }] : [];
    });
    return [...described, ...voiceLog.map(entry => ({ ...entry, at: Number(entry.id.split(":")[1]) }))].sort((a, b) => b.at - a.at).map(({ at: _at, ...entry }) => entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.events, voiceLog, name, info, chain]);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("log");
  const adminAccess = useAdminAccess();
  // The Admin tab keeps only the table-wide tools (Watch a table). The camera tools moved into the webcam "..." menu.
  const showAdmin = adminAccess === true;
  // The card picture next to the drawer: hover shows it, a click pins it.
  const [logCard, setLogCard] = useState<{ row: LogRow; pinned: boolean } | null>(null);
  const previewLogCard = useCallback((row: LogRow, mode: "hover" | "pin" | "leave") => {
    setLogCard(cur => mode === "pin" ? (cur?.pinned && cur.row.cardId === row.cardId ? null : { row, pinned: true }) : cur?.pinned ? cur : mode === "hover" ? { row, pinned: false } : null);
  }, []);
  const openDrawer = useCallback((tab: DrawerTab, from?: HTMLElement | null) => { setDrawerTab(tab); layers.open("log", from); }, [layers]);
  // The Log and Settings buttons: a press on the tab that is open closes the drawer, a press on another tab switches to it.
  const toggleDrawerTab = useCallback((tab: DrawerTab, from?: HTMLElement | null) => { if (layers.layer === "log" && drawerTab === tab) layers.close("log"); else openDrawer(tab, from); }, [layers, drawerTab, openDrawer]);
  const logTurns = useMemo(() => layers.layer !== "log" || drawerTab !== "log" ? [] : buildLog({
    events: room.events, turn: state.turn, turnSeat: state.turnSeat, name, cardName: nameOfCard, refName: refNameOf, chain: chain.links, lpNow: lpOf, room, fmtTime, firstSeq: firstSeq.current,
    publicCode: (seat, ref) => { const card = state.seats[seat]?.twin.find(item => item.ref === ref); return card && (card.faceUp || card.publicIdentity || ["material", "graveyard", "banished"].includes(card.zone)) ? cardCode(card) : undefined; },
    voice: voiceLog,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [layers.layer, drawerTab, room.events, voiceLog, name, info, chain, state.turn, state.turnSeat, state.seats, room]);
  const [unread, setUnread] = useState(false); const lastSeq = useRef(room.lastSeq);
  useEffect(() => { if (room.lastSeq !== lastSeq.current) { lastSeq.current = room.lastSeq; if (layers.layer !== "log") setUnread(true); } }, [room.lastSeq, layers.layer]);
  useEffect(() => { if (layers.layer === "log") setUnread(false); }, [layers.layer]);
  // The popup for a card closed: its outline on the feed goes with it.
  const heldBefore = useRef(false);
  useEffect(() => {
    const held = layers.layer === "card" || layers.layer === "tray";
    popupHeld.current = held ? ctx.current?.seat ?? null : null;
    if (heldBefore.current && !held) { setMarks({}); setReticles({}); }
    heldBefore.current = held;
  }, [layers.layer]);
  const addVoiceLog = useCallback((text: string) => setVoiceLog(list => [...list.slice(-30), { id: `vx:${Date.now()}`, time: fmtTime(Date.now()), kind: "VX" as const, text, fresh: true }]), []);

  // ---- actions ----
  const controlOfferRef = useRef<((seat: number, wanted: ReturnType<typeof controlOffer>) => void) | undefined>(undefined);
  const act = useCallback(async(input:RemoteActionProposal, idempotencyKey?: string)=>{
    let warning:string|undefined,proposal=input;
    if(input.type==='twin.move'){
      const card=R.current.room.state.seats[input.seat]?.twin.find(item=>item.ref===input.cardRef),code=card?cardCode(card):undefined;
      const twins=R.current.room.state.seats[input.seat]?.twin??[];
      if(input.source!=='auto')warning=manualFieldZoneWarning(cardInfo(code),input.zone,input.slot,{faceDown:input.faceUp===false||input.faceUp===undefined&&card?.faceUp===false,equipped:!!card?.equippedTo,equipSource:equipSourceOnField(twins,c=>cardInfo(cardCode(c)))});
      // A Trap moved from S/T to a Monster Zone is a Trap Monster: it keeps its S/T zone (docs/remote-duels/zone-rules.md).
      if(input.trapMonster===undefined&&becomesTrapMonster(card,cardInfo(code),input.zone))proposal={...input,trapMonster:true};
    }
    const quiet=proposal.type==='side.timeout';
    if(quiet)quietError.current=true;else setOverlayError(null);
    const updated=await ctl.action(proposal, idempotencyKey);
    if(quiet)setTimeout(()=>{quietError.current=false;},150);
    if(updated&&warning)toast(warning,5000);
    // An activated card that takes control (card logic) asks which card it took. After the card popup closes, so the picker stays open.
    if(updated&&proposal.type==='effect.activated'&&proposal.source.cardId){const wanted=controlOffer(proposal.source.cardId),seat=proposal.actorSeat;if(wanted)setTimeout(()=>controlOfferRef.current?.(seat,wanted),0);}
    // After a table action the old selection is spent (a read of the cameras keeps it).
    if(updated&&proposal.type!=='cards.identified'){setSelected(null);camHover.current=null;}
    return updated;
  },[ctl.action,toast]);
  /** `tokenOnly`: an empty Main Monster Zone of another player's field. Its menu has just "Add token", and the view stays as it is. */
  const openZonePicker = (seat: number, key: ZoneKey, targetRef?: string, initialFaceUp=true, startPicker=false, tokenOnly=false) => {
    if (!live || !(solo || seat === mySeat || tokenOnly && mySeat >= 0 && !room.spectator) || state.seats[seat]?.eliminated || isPile(key)) return;
    layers.open('zone'); setZoneError(''); setZonePicker(previous => ({ seat, key, targetRef, initialFaceUp, startPicker, tokenOnly: tokenOnly || undefined, requestId: (previous?.requestId ?? 0) + 1 }));
  };
  useEffect(() => onManualZoneRequest(request => {
    const key = request.zone.startsWith('EMZ') ? `e${request.zone.slice(3)}` : request.zone === 'FIELD' ? 'f' : request.zone.toLowerCase();
    if (!['m1','m2','m3','m4','m5','s1','s2','s3','s4','s5','e1','e2','f'].includes(key)) return;
    const card = R.current.state.seats[request.seat]?.twin.find(c => c.ref === request.ref);
    openZonePicker(request.seat, key as ZoneKey, request.actions ? undefined : card?.ref, request.faceDown ? false : card?.faceUp ?? true, !request.actions);
  }), [live, solo, mySeat]);
  const saveZoneActions = async (build: (room: RemoteRoom) => RemoteActionProposal[], keepOpen = false) => {
    if (zoneBusy) return;
    setZoneBusy(true); setZoneError('');
    let rollback = () => {}; let wrote = false;
    try {
      const initial = build(R.current.room);
      const restores = initial.map(a => beginManualCorrection(R.current.room, a)); rollback = () => [...restores].reverse().forEach(f => f());
      const saved = await ctl.transaction(async (latest, apply) => {
        let updated: RemoteRoom | null = latest;
        for (const action of build(latest)) { updated = await apply(action); if (!updated) return null; wrote = true; }
        return updated;
      });
      if (!saved) { if (!wrote) rollback(); setZoneError(wrote ? 'Only part of the change saved. Use Undo in the dock before trying again.' : 'Could not save. Choose the card again.'); return; }
      if (!keepOpen) { setZonePicker(null); layers.close('zone'); }
    } catch (error) { if (!wrote) rollback(); setZoneError(wrote ? 'Only part of the change saved. Use Undo in the dock before trying again.' : error instanceof Error ? error.message : 'Could not place this card.'); }
    finally { setZoneBusy(false); }
  };
  const placeInZone = (pick: ZonePick) => { const ref = crypto.randomUUID(); return saveZoneActions(latest => zonePlacement(latest, pick, ref)); };
  const tokens = useTokens({ act, room, live, extraZones, layers, info, toast });
  const control = useControlChange({ act, room, live, extraZones, layers, info, name, toast });
  const nextStep = useNextStep({ room, live, tokens, control, layers });
  controlOfferRef.current = control.offer;
  // A monster that equips itself (Union, Agnumday-style) and sits face up in my Spell & Trap Zone: ask which monster it equips. No link is made without a click.
  const equipNudged = useRef(new Set<string>());
  useEffect(() => {
    if (!live || (!solo && mySeat < 0)) return;
    for (const seat of solo ? state.seats.map(item => item.seat) : [mySeat]) for (const card of state.seats[seat]?.twin ?? []) {
      const id = cardCode(card);
      if (card.zone !== "spell-trap" || !card.faceUp || !id || card.equippedTo || !equipsItself(id) || equipNudged.current.has(card.ref)) continue;
      if (control.askEquip(seat, card)) equipNudged.current.add(card.ref);
      return;
    }
  }, [state.seats, live, solo, mySeat, control]);
  const setPhase = (phase: string) => { if (live && myTurn && phase !== state.phase) void act({ type: "phase.set", actorSeat: turnActor, phase }); };
  const phaseBack = (phase: string) => { if (live && myTurn) void act(phaseBackAction(turnActor, phase)); };
  const passTurn = () => { if (live && myTurn) void act({ type: "turn.end", actorSeat: turnActor }); };
  // Going back to an earlier phase asks first. One question serves every phase box and the Back button.
  const phaseAsk = usePhaseAsk(state.phase, state.turn, turnShown, setPhase);
  // ---- match: result, declare, side decking ----
  const router = useRouter();
  // Everyone agreed to the rematch: go to the new table.
  const rematchSlug = room.rematch?.slug;
  useEffect(() => { if (rematchSlug && room.mySeat >= 0) router.push(`/duels/remote/${encodeURIComponent(rematchSlug)}`); }, [rematchSlug, room.mySeat, router]);
  const matchSeat = mySeat >= 0 ? mySeat : 0;
  const [matchBusy, setMatchBusy] = useState(false);
  const [boardView, setBoardView] = useState(false);
  // "View board" lasts for the game it was pressed in: a new result or phase shows its screen again.
  useEffect(() => { setBoardView(false); }, [match.phase, match.games.length]);
  // A declared result that disappears without ending the game was refused by another player.
  const lastPending = useRef(match.pendingResult);
  const gamesBefore = useRef(match.games.length);
  useEffect(() => {
    const before = lastPending.current;
    if (before && !match.pendingResult && mySeat >= 0 && before.confirmed.includes(mySeat) && match.phase === "duel" && match.games.length === gamesBefore.current) {
      toast("A player did not agree to the result. The game goes on.", 5000);
    }
    lastPending.current = match.pendingResult; gamesBefore.current = match.games.length;
  }, [match.pendingResult, match.phase, match.games.length, mySeat, toast]);
  const matchStep = (action: RemoteActionProposal) => { setMatchBusy(true); void act(action).finally(() => setMatchBusy(false)); };
  const declareResult = !solo && mySeat >= 0 && live ? {
    choices: declareChoices(room.seats.map(seat => ({ seat: seat.seat, name: seat.displayName, out: !!state.seats[seat.seat]?.eliminated })), mySeat),
    waiting: match.pendingResult ? (match.pendingResult.confirmed.includes(mySeat) ? "Waiting for the other players to agree." : null) : null,
    onDeclare: (winnerSeat: number | null) => matchStep({ type: "match.declare", actorSeat: mySeat, winnerSeat }),
  } : undefined;
  // Surrender: a seated, living player in a live game. A solo test table has no other player, so the seat whose turn it is gives up.
  // Not during the opening die roll and first-player choice. On a solo table the Deck menu gives up the seat whose Deck was clicked.
  const openingPending = turnShown < 0;
  // Own dice: anyone seated may say who goes first, and change it until the first turn action locks it.
  const [changingFirst, setChangingFirst] = useState(false);
  const [firstBusy, setFirstBusy] = useState(false);
  const chooseFirst = (seat: number) => { setFirstBusy(true); void act({ type: "match.first", actorSeat: mySeat, seatGoesFirst: seat }).then(() => setChangingFirst(false)).catch(() => {}).finally(() => setFirstBusy(false)); };
  const firstPick = ownFirst && !ownFirst.locked && room.status === "active" && !state.ended ? (() => {
    const canPick = mySeat >= 0 && !room.spectator && !state.seats[mySeat]?.eliminated;
    const other = seatCount === 2 ? (mySeat === 0 ? 1 : 0) : -1;
    const chosen = ownFirst.chosenSeat;
    const picking = chosen === undefined || changingFirst;
    return <div className={s.firstpick} data-done={picking ? undefined : ""} data-testid="first-pick" role="group" aria-label="Who goes first">
      {picking
        ? <><span className={s.firstq}>{canPick ? "Roll your dice on camera — who goes first?" : "Waiting for the players to say who goes first."}</span>
          {canPick ? <>
            <button type="button" className={`${s.btn} ${s.sm}`} aria-pressed={chosen === mySeat} disabled={firstBusy} onClick={() => chooseFirst(mySeat)} data-testid="first-me">I go first</button>
            {other >= 0 ? <button type="button" className={`${s.btn} ${s.sm}`} aria-pressed={chosen === other} disabled={firstBusy} onClick={() => chooseFirst(other)} data-testid="first-second">I go second</button> : null}
          </> : null}
          {chosen !== undefined && canPick ? <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => setChangingFirst(false)} data-testid="first-keep">Keep</button> : null}</>
        : <><span className={s.firstq} data-testid="first-chosen"><b>{name(chosen)}</b> goes first</span>
          {canPick ? <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => setChangingFirst(true)} data-testid="first-change">Change</button> : null}</>}
    </div>;
  })() : null;
  // The die roll still allows it: the game is live from the first moment.
  const surrenderable = (seat: number) => live && !!state.seats[seat] && !state.seats[seat].eliminated;
  const [deckAt, setDeckAt] = useState<{ seat: number; rect: Rect } | null>(null);
  const [surrenderPick, setSurrenderPick] = useState<number | null>(null);
  const surrenderSeat = solo ? (surrenderPick ?? state.turnSeat) : mySeat;
  const canSurrender = (solo || mySeat >= 0) && surrenderable(surrenderSeat);
  const surrender = () => matchStep({ type: "player.concede", actorSeat: surrenderSeat });
  // Quit the match: a seated player between games (side decking, a result), or an FFA seat already out of this game. During a game Surrender is the way out, and it only loses that game.
  // A solo test table has nobody to forfeit to.
  const canQuit = !solo && (!live || !!state.seats[mySeat]?.eliminated) && mySeat >= 0 && room.status === "active" && match.phase !== "done" && !!state.seats[mySeat] && !state.seats[mySeat].accountDeleted;
  // Best of 3, two players: this surrender decides the match when the other player already has the game wins that are left to take.
  const surrenderEndsMatch = !solo && seatCount === 2 && match.bestOf === 3 && match.games.some(game => game.winnerSeat != null && game.winnerSeat !== surrenderSeat);
  // A seat that left the match watches the rest of it: it cannot ready, continue or choose.
  const leftMatch = mySeat >= 0 && !!state.seats[mySeat]?.accountDeleted;
  const [leaveMode, setLeaveMode] = useState<"game" | "match">("game");
  const quit = () => { void act({ type: "player.leave", actorSeat: mySeat }).then(done => { if (done) router.push(tournament ? `/tournament/${encodeURIComponent(tournament.tournamentSlug)}` : "/duels"); }); };
  const openingShown = match.phase === "duel" && !!match.opening && (match.opening.chosenSeat === undefined || !!match.opening.auto) && !state.ended && room.status === "active";
  // The opening screen can end by itself (a bot roll) while `openingShown` stays true. Its dock then must go, or two Surrender buttons overlap.
  const [openingCovers, setOpeningCovers] = useState(false);
  const openLeave = (mode: "game" | "match", el: HTMLElement) => { setSurrenderPick(null); setLeaveMode(mode); layers.toggle("surrender", el); };
  // Any way the question closes (Cancel, Escape, a press outside) forgets which seat was picked.
  useEffect(() => { if (layers.layer !== "surrender") { setSurrenderPick(null); setLeaveMode("game"); } }, [layers.layer]);
  // The question no longer applies (the game ended, I left, the table ended): close it.
  useEffect(() => { if (!(layers.layer === "surrender" && leaveMode === "match" ? canQuit : canSurrender) && (layers.layer === "surrender" || layers.layer === "deck")) layers.close(); }, [canSurrender, canQuit, leaveMode, layers]);
  const changeLp = (seat: number, delta: number, reason = "Manual adjustment") => { if (live && delta) return act({ type: "lp.change", actorSeat: mySeat, seat, delta, reason }); return Promise.resolve(null); };
  const nextSeat = (() => { if (turnShown < 0) return -1; for (let i = 1; i <= seatCount; i++) { const seat = (state.turnSeat + i) % seatCount; if (!state.seats[seat]?.eliminated) return seat; } return state.turnSeat; })();
  const players: Player[] = seatIds.map(seat => ({ seat, name: name(seat), color: COLORS[seat], eliminated: !!state.seats[seat]?.eliminated }));

  // ---- undo ----
  const [clock, setClock] = useState(0); const [flash, setFlash] = useState(0);
  const idleOn = room.idleWarningAt !== null;
  useEffect(() => { if (!idleOn) return; const timer = setInterval(() => setClock(n => n + 1), 250); return () => clearInterval(timer); }, [idleOn]);
  void clock;
  // The server closes a table after 10 minutes without activity. Playing with the camera on makes no table actions,
  // so tell the server once a minute that a seated player is still here: camera or phone video on, or recent input.
  const cameraLive = hub.cameraOn || hub.phones.some(p => p.seat === mySeat);
  const cameraLiveRef = useRef(cameraLive); cameraLiveRef.current = cameraLive;
  const slugOfTable = room.slug;
  useEffect(() => {
    if (room.status !== "active" || mySeat < 0) return;
    let lastInput = Date.now();
    const mark = () => { lastInput = Date.now(); };
    window.addEventListener("pointerdown", mark, true); window.addEventListener("keydown", mark, true);
    const ping = () => {
      if (!cameraLiveRef.current && Date.now() - lastInput > 5 * 60_000) return;
      void remoteApi(`/${slugOfTable}/activity`, {}).catch(() => {});
    };
    const timer = setInterval(ping, 60_000);
    return () => { clearInterval(timer); window.removeEventListener("pointerdown", mark, true); window.removeEventListener("keydown", mark, true); };
  }, [room.status, mySeat, slugOfTable]);
  // The server keeps the player's own last 20 actions (this turn and the one before) with a rejection reason when one cannot be undone now.
  const ownUndo = ownUndoEntries(state, solo, mySeat);
  const newestUndo = ownUndo[0];
  const canUndo = !!newestUndo && (room.status === "active" || room.status === "ended");
  const cardLabel = (seat: number, ref: string) => { const card = state.seats[seat]?.twin.find(item => item.ref === ref); return card ? cardName(card, info(cardCode(card))) : undefined; };
  const entryText = (entry: RemoteUndoEntry) => { const event = room.events.find(item => item.id === entry.actionId); return undoLabel(describeEvent(event ?? { id: entry.actionId, seq: 0, actorSeat: entry.actorSeat, action: entry.action, messages: [] } as unknown as RemoteEvent, name, nameOfCard, refNameOf)?.text ?? "last action"); };
  // Short label for the field Undo button ("Dark Magician → M3"). The dock keeps the longer log line.
  const entryShort = (entry: RemoteUndoEntry) => undoLabel(shortUndoLabel(entry, cardLabel, name) ?? entryText(entry));
  const undoText = newestUndo ? entryText(newestUndo) : "last action";
  const undoShort = newestUndo ? entryShort(newestUndo) : "last action";
  const history = ownUndo.slice(0, 20).map(entry => ({ id: entry.actionId, label: entryShort(entry), reason: entry.reason }));
  /** Undo one of my own actions. No entry means the newest. A rejected undo shows the server's reason. */
  const doUndo = useCallback(async (entry?: RemoteUndoEntry) => {
    const { state: current, room: now } = R.current;
    const target = entry ?? ownUndoEntries(current, now.solo, now.mySeat)[0]; if (!target) return;
    if (target.reason) { toast(target.reason, 4200); return; }
    const done = await act({ type: "undo", actorSeat: now.solo ? target.actorSeat : now.mySeat, targetActionId: target.actionId });
    if (done) { setFlash(n => n + 1); toast(<>Undid <b>{shortUndoLabel(target, (seat, ref) => { const card = current.seats[seat]?.twin.find(item => item.ref === ref); return card ? cardName(card, info(cardCode(card))) : undefined; }, name) ?? "last action"}</b></>); }
  }, [act, toast, name, info]);

  // ---- feed marks, recognition ----
  const [marks, setMarks] = useState<Record<number, FeedMark[]>>({});
  const popupHeld = useRef<number | null>(null);
  const resetFeed = useCallback((seat: number) => {
    setMarks(all => (all[seat]?.length ? { ...all, [seat]: [] } : all)); setReticles(all => (all[seat]?.length ? { ...all, [seat]: [] } : all));
  }, []); const [reticles, setReticles] = useState<Record<number, FeedReticle[]>>({});
  const [tray, setTray] = useState<TrayState | null>(null); const ctx = useRef<ReadCtx | null>(null); const readCounter = useRef(0);
  const [popAt, setPopAt] = useState<PopAt>({ anchor: null, feed: null }); const beginId = useRef(0); const [adding, setAdding] = useState(false); const [fresh, setFresh] = useState<string | undefined>();
  const [rv, setRv] = useState<Record<number, ZoneKey>>({}); const [selected, setSelected] = useState<{ seat: number; ref: string } | null>(null);
  const [effectOrigin,setEffectOrigin]=useState<string|null>(null);
  const [picking, setPicking] = useState<{ seat: number; ref: string } | null>(null);
  // Webcam only: the virtual fields (beta) are hidden by default, so the camera feeds get the space. The toggle or W turns the board on;
  // the choice, either way, is remembered in this browser. A seat that needs the board (see `needsBoard`) keeps it.
  const detection = useCardDetection();
  const [choice, setChoice] = useState<boolean | null>(null);
  useLayoutEffect(() => { try { const stored = localStorage.getItem(WEBCAM_ONLY_KEY); setChoice(stored === null ? null : stored !== "0"); localStorage.removeItem("dd-remote-webcam-only-mode"); } catch { /* storage blocked: the default */ } }, []);
  // A 3-way or 4-way table shows only the cameras: no virtual field, no toggle, no W. The board state is still built; it is only not drawn.
  const multi = seatCount > 2;
  const webcamOnly = multi || resolveWebcamOnly(choice);
  // 1v1: each seat can also hide its own board (the opponent's, mine, or both). The seats listed here have no board; the board logic keeps running.
  const [hiddenBoards, setHiddenBoards] = useState<number[]>([]);
  // Remembered by role ("me" / "opp"), not by seat number: my own board must stay mine when the next table seats me in seat 1. A spectator has no role, so it keeps seat numbers ("s0").
  const boardRole = useCallback((seat: number) => (mySeat < 0 ? `s${seat}` : seat === mySeat ? "me" : "opp"), [mySeat]);
  useLayoutEffect(() => {
    try {
      const saved = (localStorage.getItem(SEAT_BOARD_KEY) ?? "").split(",").filter(Boolean);
      setHiddenBoards(seatIds.filter(seat => saved.includes(boardRole(seat))));
    } catch { /* storage blocked: all boards shown */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardRole, seatIds.join(",")]);
  const keepHiddenBoards = useCallback((next: number[]) => {
    setHiddenBoards(next);
    const roles = next.map(boardRole);
    try { if (roles.length) localStorage.setItem(SEAT_BOARD_KEY, roles.join(",")); else localStorage.removeItem(SEAT_BOARD_KEY); } catch { /* storage blocked: not remembered */ }
  }, [boardRole]);
  // The W switch and the top bar are the master: Both brings every board back.
  const setWebcamOnly = useCallback((next: boolean) => {
    setChoice(next); if (!next) keepHiddenBoards([]);
    try { localStorage.setItem(WEBCAM_ONLY_KEY, next ? "1" : "0"); } catch { /* storage blocked: not remembered */ }
  }, [keepHiddenBoards]);
  /** The board of this seat is hidden by the table (Webcam only) or by its own switch (1v1). Webcam only leaves the board of a seat that needs it (no camera, a zone click).
   *  The seat's own switch also hides a seat with no camera (a bot, manual play): its panel then shows the no-camera message and the cards list. Only a zone click (token, give control) brings the board back. */
  const seatWebcam = (seat: number) => (webcamOnly && !needsBoard(seat)) || (!multi && hiddenBoards.includes(seat) && !(tokens.placing || control.giving));
  const setSeatBoard = (seat: number, on: boolean) => {
    if (multi) return;
    const seats = seatIds;
    // Webcam only hid every seat that did not need its board; turning one board on keeps the others hidden.
    // Webcam only already hid the other seats too: hiding one board must not bring the other one back.
    const hidden = seats.filter(item => on ? item !== seat && (hiddenBoards.includes(item) || (webcamOnly && !needsBoard(item))) : item === seat || hiddenBoards.includes(item) || (webcamOnly && !needsBoard(item)));
    keepHiddenBoards(hidden);
    const all = hidden.length >= seats.length;
    if (all !== webcamOnly) { setChoice(all); try { localStorage.setItem(WEBCAM_ONLY_KEY, all ? "1" : "0"); } catch { /* storage blocked */ } }
  };
  // A seat in Tap mode has its board off for everyone: the camera does not keep the board up to date.
  // Another player: any of the signals (see `seatBoardOff`). My own seat: my own switch, and only with my camera on, so a player with no camera keeps the board.
  const subscribeTap = useCallback((listener: () => void) => { const a = hub.subscribeFieldBacks(listener), b = hub.subscribePeerVision(listener); return () => { a(); b(); }; }, [hub.subscribeFieldBacks, hub.subscribePeerVision]);
  const tapSeats = useSyncExternalStore(subscribeTap, () => room.seats.filter(item => item.seat !== room.mySeat && seatBoardOff({ stateMode: stateMode(room.state, item.seat), tracksTap: hub.tapMode(item.seat), visionTap: hub.peerVision(item.seat)?.detect === "tap" })).map(item => item.seat).join(","), () => "");
  const ownBoardOff = room.mySeat >= 0 && !!detection && !detection.autoDetect && hub.cameraOn;
  const zoneGrid = useZoneGrid();
  /** A bot, manual or Scan mode seat has no camera to read: its board twin is the only view of its cards, so it stays on at a 1v1 table. So does every board while a zone click is the next step (token, give control).
   *  A 3-way or 4-way table never shows a virtual board: a seat without a camera shows the no-camera panel and its list of cards. */
  const noCamera = (seat: number) => !!room.seats.find(item => item.seat === seat)?.bot || hub.manual(seat) || hub.health(seat).label === "Scan mode";
  const needsBoard = (seat: number) => !multi && (noCamera(seat) || tokens.placing || control.giving);
  const seatFocus = useSeatFocus({ seatCount, mySeat, turnSeat: turnShown, nextSeat, turn: state.turn, seats: seatIds, hasCamera: seat => !noCamera(seat), eliminated: seat => !!state.seats[seat]?.eliminated, playing: seat => !!hub.sourceFor(seat) });
  const boardOff = (seat: number) => !needsBoard(seat) && (seat === room.mySeat ? ownBoardOff : tapSeats.split(",").includes(String(seat)));
  const flagFor = (seat: number, id: number) => hasDeck(room, seat) ? !deckIdsOf(room, seat).includes(id) : null;
  const reticle = (seat: number, next: FeedReticle | null, id: string) => setReticles(all => ({ ...all, [seat]: [...(all[seat] ?? []).filter(item => item.id !== id), ...(next ? [next] : [])] }));
  /** The read in progress. No popup is open for it, so Esc, another layer and the time limit stop it here. */
  const inFlight = useRef<{ seat: number; start?: FeedStart; rid?: string; force?: boolean } | null>(null);
  const cancelRead = useCallback(() => {
    const read = inFlight.current; if (!read) return;
    inFlight.current = null; readCounter.current++;
    // A stopped "Wrong card?" read must not leave its target for the next read.
    if (read.force && ctx.current) delete ctx.current.cardRef;
    reticle(read.seat, null, BEGIN_RETICLE); if (read.rid) reticle(read.seat, null, read.rid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const stopLateRead = useCallback(() => { if (!inFlight.current) return; cancelRead(); toast("The card read did not finish. Click the card again.", 4200); }, [cancelRead, toast]);

  /** Where a new card goes on a field: its row, the first free slot and a fresh ref. */
  const layoutFor = (seat: number, cardId: number, found: ReturnType<typeof cardInfo>, current=R.current.room) => {
    const projected=projectFieldZone({zone:'M1',facts:found,twins:current.state.seats[seat].twin,format:current.format?.id??current.state.deckChecks.format.id});
    if(!projected.zone)return;
    const location=fieldZoneLocation(projected.zone);
    return {row:location.zone,slot:location.slot,ref:`c${seat}-${cardId}-${Date.now().toString(36)}`};
  };
  /** A free Extra Monster Zone for this seat: not used by its own cards and not taken by the facing seat, which shares the row (my zone 1 is their zone 2). */
  const freeEmzSlot = (seat: number, seats: readonly { twin: readonly TwinCard[] }[], also: ReadonlySet<number> = new Set()) => {
    const other = facingSeat(seat, seatCount);
    const used = new Set<number>(also);
    for (const card of seats[seat]?.twin ?? []) if (card.zone === "extra-monster" && card.slot) used.add(card.slot);
    if (other !== null) for (const card of seats[other]?.twin ?? []) if (card.zone === "extra-monster" && card.slot) used.add(mirrorEmz(card.slot));
    return [1, 2].find(n => !used.has(n));
  };
  const saveSample = useCallback((token: number | undefined, cardId: number, source: FeedbackSource | undefined) => {
    if (token === undefined || !source) return;
    void hub.recordFeedback(token, cardId, source).then(result => { if (result.ok && R.current.feedbackAdmin) toast("Saved to the training set"); else if (result.note) toast(result.note); });
  }, [hub, toast]);

  const tapMemory = (seat: number) => tapMemoryFor(`${R.current.room.slug}:${R.current.state.match.games.length + 1}`, seat, (R.current.room.format?.id ?? R.current.state.deckChecks.format.id) as FieldFormat, hub);
  /** A webcam-only click on a Set card that this browser remembers goes on to a read. That read must stay in this browser. */
  const setCardClick = useRef<number | null>(null);
  /** A card from the local memory: local state only. No action, no data message, no board change, and no tag for the other players. */
  const showRemembered = (seat: number, card: { cardId: number; name?: string; at?: number }, at: PopAt) => {
    setTray(null); layers.close("tray");
    setSubject({ from: "camera", remembered: true, rememberedAt: card.at ?? Date.now(), cardId: card.cardId, seat, name: card.name, notInDecklist: flagFor(seat, card.cardId), addErrors: [], via: "memory" });
    setPopAt(at); layers.open("card");
  };
  /** Tap to identify: opens what this browser remembers at the spot of a card that shows no face now. */
  const recallCard = (seat: number, x: number, y: number, quad: ReadCtx["quad"], at: PopAt, setClick: boolean) => {
    const memory = tapMemory(seat), spot = memory?.spot(x, y, quad), entry = spot && memory?.recall(spot);
    if (!entry) return false;
    ctx.current = { seat, x, y, ...(quad ? { quad } : {}), at, id: ++readCounter.current, spot, hidden: true, ...(setClick ? { setClick } : {}) };
    showRemembered(seat, entry, at); return true;
  };

  const identify = useCallback(async (pick: Pick, source: "click" | "auto" | "voice" | "typed") => {
    const at = ctx.current; if (!at) return;
    const { seat } = at;
    if (at.hidden) {
      // A voice name with no open search is not an answer to this card.
      if (source === "voice" && R.current.layer !== "tray") { toast("Use Wrong card? to change this card."); return; }
      if (at.spot) tapMemory(seat)?.remember(at.spot, pick);
      showRemembered(seat, pick, at.at); return;
    }
    const zoneGrid = currentZoneGrid();
    // The popup stays (as a "card found" state) until the card is placed, then the card popup replaces it.
    // The table refused the card (for example it closed meanwhile). Say so: a popup that only vanishes looks like a bug.
    const bail = () => { layers.close("tray"); setTray(null); toast("The table did not accept this card. Nothing was placed.", 4200); };
    await loadCards([pick.cardId]);
    const found = cardInfo(pick.cardId);
    const verifiedWitnesses=await at.copyWitnesses?.(R.current.state.seats[seat].twin.filter(c=>sameObservedCard(c,{cardId:pick.cardId,name:pick.name})&&['monster','spell-trap','extra-monster','field','pendulum'].includes(c.zone)));
    const outcome=await ctl.transaction(async(current,apply)=>{
      const owns = current.solo || seat === current.mySeat;
      // Keep explicit private-origin targeting inside the shared mutation queue.
      const targetRef = at.ref ?? at.cardRef;
      const revealRef = owns ? remoteRecognitionRef(current.state, seat, pick.cardId, targetRef) : undefined;
      let same = owns ? current.state.seats[seat].twin.find(card => card.ref === targetRef)
        ?? current.state.seats[seat].twin.find(card => card.ref === revealRef) : undefined;
      // Tap to identify: the board does not follow the camera, so a read names the card and adds nothing. A card the player asked to name keeps its ref.
      const tap=owns&&tapToIdentifyNow(seat);
      const physical=!tap&&at.quad?.length===4&&zoneGrid.ownSeat===seat&&zoneGrid.calibration?.orientation?
        mapFieldZone({quad:at.quad,kind:'face-up',confidence:1,partial:false},zoneGrid.calibration,[],zoneGrid.format).zone:undefined;
      if(owns&&!same&&physical){const location=fieldZoneLocation(physical);same=current.state.seats[seat].twin.find(c=>c.zone===location.zone&&c.slot===location.slot&&sameObservedCard(c,{cardId:pick.cardId,name:pick.name}));}
      const reading=owns&&!same&&physical?fieldReadingPlaceholder(current.state.seats[seat].twin,physical):undefined;
      same??=reading;
      const projected=physical?projectFieldZone({zone:physical,facts:found,twins:current.state.seats[seat].twin,ref:same?.ref,format:current.state.deckChecks.format.id}):undefined;
      // A token holds that cell: no card is placed over it or moved aside. The player removes the token or picks another zone.
      if(owns&&!same&&projected?.zone&&tokenInCell(current.state.seats[seat].twin,projected.zone)){toast(`A token is in ${projected.zone}. Remove the token first, or choose another zone.`,5000);return {updated:null,owns,ref:undefined,row:undefined,slot:undefined};}
      const mapped=projected?.zone?fieldZoneLocation(projected.zone):undefined;
      // A read below "sure" adds a card only to the zone where it was seen. Any other zone may be a phantom, so the person chooses.
      if(owns&&at.bestMatch&&!same&&physical&&(projected?.zone!==physical||projected.moved))return {updated:null,owns,ref:undefined,row:undefined,slot:undefined,askFirst:true};
      const spot=owns&&!(tap&&!same)?(reading&&mapped?{row:mapped.zone,slot:mapped.slot,ref:reading.ref}:same?{row:same.zone,slot:same.slot,ref:same.ref}:mapped?{row:mapped.zone,slot:mapped.slot,ref:crypto.randomUUID()}:layoutFor(seat,pick.cardId,found,current)):undefined;
      if(owns&&!spot&&!tap){toast('Card type or a free legal zone is unavailable. Check the card before placing it.',5000);return {updated:null,owns,ref:undefined,row:undefined,slot:undefined};}
      let updated:RemoteRoom|null=null;
      const witnesses=verifiedWitnesses?.filter(w=>sameObservedCard(w,{cardId:pick.cardId,name:pick.name})&&current.state.seats[seat].twin.some(c=>c.ref===w.ref&&['monster','spell-trap','extra-monster','field','pendulum'].includes(c.zone)))??[];
      const copyProof=witnesses.length?{simultaneousQuads:witnesses.length+1,at:Math.floor(serverNow()-999-Math.max(0,performance.now()-(at.capturedAt??performance.now())))}:undefined;
      if(owns&&spot&&!same)updated=await apply({type:'twin.place',source:'auto',actorSeat:current.solo?seat:current.mySeat,seat,zone:spot.row,...(copyProof?{copyProof}:{}),card:{ref:spot.ref,cardId:pick.cardId,name:pick.name,...(spot.slot?{slot:spot.slot}:{}),...(at.bestMatch?{bestMatch:true}:{}),faceUp:true,position:physical&&(spot.row==='monster'||spot.row==='extra-monster')&&at.quad?.length===4&&zoneGrid.calibration?fieldOrientation({quad:at.quad,kind:'face-up',confidence:1,partial:false},1,1,zoneGrid.calibration):'attack'}});
      else updated=await apply({type:'card.identified',actorSeat:current.mySeat,seat,cardId:pick.cardId,name:pick.name,source,...(at.bestMatch?{bestMatch:true}:{}),...(spot?{cardRef:spot.ref,zone:spot.row,...(spot.slot?{slot:spot.slot}:{})}:{})});
      const savedReading=reading&&updated?.state.seats[seat].twin.find(card=>card.ref===reading.ref);
      if(savedReading&&spot&&(savedReading.zone!==spot.row||savedReading.slot!==spot.slot))updated=await apply({type:'twin.move',actorSeat:current.solo?seat:current.mySeat,seat,cardRef:savedReading.ref,zone:spot.row,...(spot.slot?{slot:spot.slot}:{})});
      const ref=updated&&owns&&spot ? placedTwin(updated.state.seats[seat].twin,{...spot,zone:spot.row,cardId:pick.cardId})?.ref : spot?.ref;
      if(updated&&owns&&ref&&physical)rememberFieldObservation(current.slug,seat,ref,physical);
      return {updated,owns,ref,row:spot?.row,slot:spot?.slot,requestRef:spot?.ref,placed:!!(owns&&spot&&!same)};
    });
    if("askFirst" in outcome){
      if(ctx.current===at){ delete at.bestMatch; setTray({ seat, ownerName: name(seat), status: "guesses", guesses: at.guesses ?? [], note: "", reader: "vision", at: at.at, tier: at.tier, aiToken: at.token, best: true }); layers.open("tray"); }
      return;
    }
    const {updated,owns,ref}=outcome;
    if("placed" in outcome&&outcome.placed&&ref)at.placedRef=ref;
    if (!updated) { bail(); return; }
    // A voice name with no open search is not an answer to this click.
    if (at.spot && (source !== "voice" || R.current.layer === "tray")) tapMemory(seat)?.remember(at.spot, pick);
    if(owns&&ref)setFresh(ref);
    saveSample(at.token, pick.cardId, pick.feedback);
    const identified=updated.state.identified?.seat===seat&&(updated.state.identified.cardId??updated.state.identified.passcode)===pick.cardId?updated.state.identified:undefined;
    // The answer to a read or a search: it only shows the card. Its controls are on the board, or one step away in the inspector.
    setSubject({ from: at.from ?? "camera", cardId: pick.cardId, seat, ...(at.bestMatch ? { bestMatch: true } : at.tier ? { tier: at.tier } : {}), ...(at.covered ? { covered: true } : {}), ...(owns ? { ref } : {}), name: pick.name, notInDecklist: identified?.notInDecklist ?? flagFor(seat, pick.cardId), addErrors: identified?.addErrors ?? [], via: source });
    const not = identified?.notInDecklist ?? flagFor(seat, pick.cardId) ?? false;
    const markId = `m${at.id}`;
    // One outline per card, and one active selection at a time: a new read replaces the older outlines on this feed.
    setMarks(all => ({ ...all, [seat]: [{ id: markId, x: at.x, y: at.y, label: pick.name, notInDecklist: !!not, show: true, cardCode: pick.cardId, quad: at.quad, canAdd: owns && !(identified?.addErrors?.length) }] }));
    setTimeout(() => setMarks(all => ({ ...all, [seat]: (all[seat] ?? []).map(mark => mark.id === markId ? { ...mark, show: false } : mark) })), 2600);
    // The outline expires after a few seconds, unless the popup for this card is still open.
    const expire = () => { if (popupHeld.current === seat) { setTimeout(expire, 2000); return; } setMarks(all => (all[seat] ?? []).some(mark => mark.id === markId) ? { ...all, [seat]: (all[seat] ?? []).filter(mark => mark.id !== markId) } : all); };
    setTimeout(expire, MARK_LIFE_MS);
    setPopAt(at.at); layers.open("card");
    if(ctx.current) { delete ctx.current.cardRef; delete ctx.current.from; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.transaction, layers, hub, saveSample, toast]);

  /** The person says the board holds one more copy of the open card: it goes on the field as a second card. */
  const anotherCopy = async () => {
    const sub = subject; if (!sub || !live || !(solo || sub.seat === mySeat)) return;
    const found=cardInfo(sub.cardId),spot=layoutFor(sub.seat,sub.cardId,found);
    if(!spot){toast('Card type or a free legal zone is unavailable. Check the card before placing it.',5000);return;}
    const {row,slot,ref}=spot;
    const place = await act({ type: "twin.place", source: "auto", anotherCopy: true, actorSeat: solo ? sub.seat : mySeat, seat: sub.seat, zone: row, card: { ref, cardId: sub.cardId, name: sub.name, ...(slot ? { slot } : {}), faceUp: true, position: "attack" } });
    if (!place) return;
    await act({ type: "card.identified", actorSeat: mySeat, seat: sub.seat, cardId: sub.cardId, name: sub.name, source: "click", cardRef: ref, zone: row, ...(slot ? { slot } : {}) });
    setFresh(ref); setSubject({ ...sub, ref }); setSelected({ seat: sub.seat, ref });
    toast(<>Second copy of <b>{sub.name ?? found?.name ?? `Card ${sub.cardId}`}</b> placed</>);
  };

  /**
   * A click landed on a live feed. Nothing opens yet: the camera shows a small mark at the click, and any older popup closes.
   * The notification stack opens only when the read ends with a choice for the person.
   */
  const beginRead = useCallback((seat: number, start: FeedStart): number => {
    // On a closed table no card can be placed, so a read would end with a popup that closes by itself. Say it at once.
    const now = R.current.room;
    if (now.status !== "active" || now.state.ended) { readCounter.current++; toast("The table is closed. Cards cannot be read here.", 4200); return 0; }
    cancelRead(); // an older read, maybe in another seat, takes its marks with it
    const id = ++readCounter.current; beginId.current = id;
    inFlight.current = { seat, start };
    setTimeout(() => { if (readCounter.current === id) stopLateRead(); }, FIND_LIMIT_MS);
    const at: PopAt = { anchor: start.anchor, feed: start.feed };
    ctx.current = { seat, x: start.x, y: start.y, at, id, ...(ctx.current?.seat===seat && ctx.current.cardRef ? {cardRef:ctx.current.cardRef} : {}) };
    setTray(null); layers.close("tray"); layers.close("card");
    reticle(seat, { id: BEGIN_RETICLE, x: start.x, y: start.y, state: "reading", text: "Reading…" }, BEGIN_RETICLE);
    return id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, toast]);
  const readLive = useCallback((id: number) => readCounter.current === id, []);
  const abortRead = useCallback((_seat: number, id: number) => { if (readCounter.current === id) cancelRead(); }, [cancelRead]);

  /** A click found no card. Nothing opened for it; the feed shows a small "No card here" note. */
  const noCard = useCallback((seat: number, point?: { x: number; y: number }) => {
    const memory = point ? tapMemory(seat) : null; if (memory && point) memory.forget(memory.spot(point.x, point.y));
    if (ctx.current?.seat === seat) delete ctx.current.cardRef;
    cancelRead(); readCounter.current++; setTray(null); layers.close("tray"); reticle(seat, null, BEGIN_RETICLE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, hub]);
  /** "Search card" on that note: the popup with only the search box, at the click. */
  const searchHere = useCallback((seat: number, start: FeedStart) => {
    const id = ++readCounter.current; beginId.current = id;
    const at: PopAt = { anchor: start.anchor, feed: start.feed };
    const spot = tapMemory(seat)?.spot(start.x, start.y);
    ctx.current = { seat, x: start.x, y: start.y, at, id, ...(spot ? { spot } : {}) };
    setTray({ seat, ownerName: name(seat), status: "empty", guesses: [], note: `Search for the card${sayItsName}.`, reader: "none", at });
    layers.open("tray");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, name, hub]);

  const startRead = useCallback(async (seat: number, x: number, y: number, found?: { hit?: FeedHit; point?: FeedPoint; force?:boolean;ref?:string;hidden?:boolean }) => {
    // An older read with its own mark is stopped. A click still at its first step is this read, so only its mark goes.
    const old = inFlight.current;
    if (old?.rid) cancelRead(); else if (old) { reticle(old.seat, null, BEGIN_RETICLE); inFlight.current = null; }
    reticle(seat, null, BEGIN_RETICLE);
    let hit = found?.hit; const extra = hit ?? found?.point;
    const setClick = !!found?.hidden || setCardClick.current === seat; setCardClick.current = null;
    { const now = R.current.room; if (now.status !== "active" || now.state.ended) { if (!extra?.live) toast("The table is closed. Cards cannot be read here.", 4200); return; } }
    const cached=hit?.cached&&!found?.force?publicTrackedTwin(hit.cached,R.current.room.state.seats[seat].twin):undefined;
    // A stale transport quad must not steer a fresh read or bind its old ref.
    if(hit?.cached&&!cached)hit=undefined;
    if(hit?.kind==="face-down") {
      const origins=R.current.state.effectTracking?.origins.filter(o=>o.seat===seat && o.destination==="set" && R.current.state.seats[seat].twin.some(c=>c.ref===o.ref && !c.faceUp)) ?? [];
      if(origins.length && (R.current.room.solo || seat===R.current.room.mySeat)) {
        setEffectOrigin(origins[0].id); setPopAt({anchor:hit.anchor,feed:hit.feed}); layers.open("effect");
        ctx.current={seat,x,y,quad:hit.quad,at:{anchor:hit.anchor,feed:hit.feed},id:++readCounter.current};
        return;
      }
      if ((!extra?.live || readCounter.current === beginId.current) && faceDownInFrame(extra?.frames?.[0], hit.quad) && recallCard(seat, x, y, hit.quad, { anchor: hit.anchor, feed: hit.feed }, setClick)) return;
      toast(origins.length ? origins.map(o=>"Face-down · Set by "+o.source.name).join("; ") : "Face-down card"); layers.close(); return;
    }
    // A live click that was closed (Esc, outside press) while the card was being found is dropped.
    if (extra?.live && readCounter.current !== beginId.current) return;
    const id = ++readCounter.current; const owner = name(seat);
    const at: PopAt = { anchor: extra?.anchor ?? ctx.current?.at.anchor ?? null, feed: extra?.feed ?? ctx.current?.at.feed ?? null };
    const spot = tapMemory(seat)?.spot(x, y, hit?.quad);
    if (hit?.preread && !found?.force) {
      const { cardId, name, invalidate } = hit.preread;
      ctx.current = { seat, x, y, at, id, hidden: true, invalidatePreread: invalidate };
      setTray(null); setSelected(null); setPopAt(at);
      setSubject({ from: "camera", cardId, name, seat, tier: "sure", notInDecklist: flagFor(seat, cardId), addErrors: [], via: "preread" });
      layers.open("card");
      return;
    }
    ctx.current = { seat, x, y, quad: hit?.quad, ...(spot ? { spot } : {}), ...(setClick ? { hidden: true, setClick } : {}), copyWitnesses:hit?.copyWitnesses,capturedAt:hit?.capturedAt,at, id,...(ctx.current?.seat===seat && ctx.current.cardRef ? {cardRef:ctx.current.cardRef} : {}),ref:found?.ref??hit?.cached?.ref,frozenFrame:hit?.frozenFrame, ...(hit?.covered ? { covered: true } : {}) };
    if(cached){
      setTray(null);setSubject({from:'camera',cardId:cached.cardId,seat,ref:cached.ref,name:cached.name,bestMatch:state.seats[seat].twin.find(c=>c.ref===cached.ref)?.bestMatch,tier:state.seats[seat].twin.find(c=>c.ref===cached.ref)?.bestMatch?'not sure':'sure',notInDecklist:flagFor(seat,cached.cardId),addErrors:[],via:'tracked'});
      setSelected({seat,ref:cached.ref});setPopAt(at);layers.open('card');return;
    }
    if (extra?.live) beginId.current = id;
    if (hit?.covered) toast("This card is partly covered by another card. The read may be wrong. Check the guess.", 4200);
    const rid = `r${id}`; reticle(seat, { id: rid, x, y, state: "reading", text: "Reading…", quad: hit?.quad }, rid);
    inFlight.current = { seat, rid, force: !!found?.force, ...(at.anchor && at.feed ? { start: { x, y, anchor: at.anchor, feed: at.feed } } : {}) };
    setTimeout(() => { if (readCounter.current === id) stopLateRead(); }, READ_LIMIT_MS);
    // Only a result that needs the person opens the stack.
    const ask = (next: Omit<TrayState, "seat" | "ownerName" | "at">) => {
      if (readCounter.current !== id) return;
      inFlight.current = null; setTray({ seat, ownerName: owner, at, ...next }); layers.open("tray");
    };
    let result: Awaited<ReturnType<typeof hub.read>>;
    try { result = await hub.read(seat, x, y, hit ? readCardOf(hit) : undefined, (found?.hit?.cached&&!cached?undefined:extra?.frames),found?.force); }
    catch {
      // The read failed or was cut off. Never leave the popup on "Reading…".
      if (readCounter.current !== id) return;
      reticle(seat, { id: rid, x, y, state: "fail", text: "No match", quad: hit?.quad }, rid);
      setTimeout(() => reticle(seat, null, rid), 1800);
      ask({ status: "empty", guesses: [], note: `The read did not finish. Search for the card${sayItsName}.`, reader: "none" });
      return;
    }
    if (readCounter.current !== id) return;
    const top = result.guesses[0];
    if (ctx.current && ctx.current.id === id) { if (result.tier) ctx.current.tier = result.tier; ctx.current.token = result.aiToken; ctx.current.guesses = result.guesses; }
    const clear = isClearRead(result);
    // A read for a named card (Wrong card? still open) must not rename it by itself: the person chooses.
    const targeted = !!(ctx.current?.ref || ctx.current?.cardRef);
    // The reader saw a back or found no real match, and the pixels agree it shows no face: the card this browser saw here, if any.
    if (!clear && !found?.force && !targeted && !hit?.covered && !result.covered && result.reader === "vision" && (result.faceDown || !result.guesses.length || result.tier === "low match") && hit?.quad && faceDownInFrame(extra?.frames?.[0], hit.quad) && recallCard(seat, x, y, hit.quad, at, setClick)) {
      reticle(seat, null, rid); inFlight.current = null; return;
    }
    // "Wrong card?" always asks: an own webcam read can return the same wrong card as sure.
    if ((result.tier === "sure" || clear) && top && result.reader === "vision" && !hit?.covered && !result.covered && !found?.force && !targeted) {
      if (clear && ctx.current && ctx.current.id === id) ctx.current.bestMatch = true;
      await loadCards([top.cardId]);
      if (readCounter.current !== id) return;
      reticle(seat, { id: rid, x, y, state: "done", text: top.name || cardInfo(top.cardId)?.name || "Card", quad: hit?.quad }, rid);
      setTimeout(() => reticle(seat, null, rid), 1500);
      inFlight.current = null;
      void identify({ cardId: top.cardId, name: top.name || cardInfo(top.cardId)?.name || `Card ${top.cardId}`, via: "click" }, "auto");
      return;
    }
    // Not sure, but the frame is sharp and the top guess clearly leads: show it as the answer. Others still see "not sure".
    const best = isBestMatch(result) && !hit?.covered;
    if (best) await loadCards([top.cardId]);
    if (readCounter.current !== id) return;
    reticle(seat, { id: rid, x, y, state: result.guesses.length ? "done" : "fail", text: best ? "Best match" : result.guesses.length ? "Which card?" : "No match", quad: hit?.quad }, rid);
    setTimeout(() => reticle(seat, null, rid), 1800);
    ask({ status: result.guesses.length ? "guesses" : "empty", guesses: result.guesses, note: result.note, reader: result.reader, tier: result.tier, ...(setClick ? {} : { aiToken: result.aiToken }), ...(best ? { best: true } : {}), ...(hit?.covered || result.covered ? { covered: true } : {}), ...(result.faceDown ? { faceDown: true } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, identify, layers, name, toast]);
  const closeTray = () => { if(ctx.current) { delete ctx.current.cardRef; delete ctx.current.from; } readCounter.current++; setTray(null); layers.close("tray"); };
  useEffect(() => { if (layers.layer !== "tray" && tray) { if(ctx.current) { delete ctx.current.cardRef; delete ctx.current.from; } readCounter.current++; setTray(null); } }, [layers.layer, tray]);
  // Esc stops a read in progress.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") cancelRead(); };
    window.addEventListener("keydown", onKey, true); return () => window.removeEventListener("keydown", onKey, true);
  }, [cancelRead]);
  // Another layer stops it too. A drawer or pile says so, with the search one click away. Closing the card that asked for a new read also stops that read.
  const lastLayer = useRef(layers.layer);
  useEffect(() => {
    const before = lastLayer.current; const now = layers.layer; lastLayer.current = now;
    // The local-only state ends with its popup. A read that was just started keeps its own.
    if ((before === "card" || before === "tray") && now !== "card" && now !== "tray" && !inFlight.current && ctx.current) { delete ctx.current.hidden; delete ctx.current.setClick; }
    const read = inFlight.current; if (before === now || !read) return;
    if (!now) { if (before === "card" && read.force) cancelRead(); return; }
    cancelRead();
    const start = read.start;
    if (now !== "card" && now !== "tray") toast(start ? <>Card read stopped.<button type="button" data-testid="read-stopped-search" onClick={() => searchHere(read.seat, start)}>Search card</button></> : "Card read stopped.", 6000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.layer]);

  const addToDeck = async (seat: number, id: number | undefined) => {
    if (!id || !live) return; setAdding(true);
    const done = await act({ type: "deck.add", actorSeat: solo ? seat : mySeat, seat, cardId: id });
    setAdding(false);
    if (done) {
      toast(<><b>{cardInfo(id)?.name ?? `Card ${id}`}</b> added to {name(seat)}&apos;s decklist</>);
      setMarks(all => ({ ...all, [seat]: (all[seat] ?? []).map(mark => mark.cardCode === id ? { ...mark, notInDecklist: false } : mark) }));
      setSubject(old => old && old.cardId === id && old.seat === seat ? { ...old, notInDecklist: false, addErrors: [] } : old);
    }
  };

  // ---- read the whole board of one feed ----
  const readBoardInto = useCallback(async (seat: number, reading: BoardReading): Promise<string> => {
    const { room: now, state: current } = R.current;
    // Tap to identify: a board read names the cards and places nothing, with no zone claim.
    const tap = (now.solo || seat === now.mySeat) && tapToIdentifyNow(seat); const owns = (now.solo || seat === now.mySeat) && !tap;
    const mine = reading.near.length ? reading.near : reading.far;
    const hidden = mine.filter(card => card.faceDown).length;
    const usable = mine.filter(card => !card.faceDown && !card.error && card.cardId && card.name);
    const sure = usable.filter(card => card.tier === "sure" && !card.covered);
    const unsure = mine.length - hidden - sure.length;
    await loadCards(sure.map(card => card.cardId!));
    const onField = current.seats[seat].twin.filter(c => ["monster","spell-trap","extra-monster","field","pendulum"].includes(c.zone));
    const revealRefs=remoteRecognitionRefs(current,seat,sure.map(card=>card.cardId!));
    const reveals=sure.flatMap((card,index)=>{
      const ref=revealRefs[index];
      const twin=ref ? current.seats[seat].twin.find(c=>c.ref===ref) : undefined;
      return twin ? [{ref:twin.ref,card,zone:twin.zone,slot:twin.slot}] : [];
    });
    const grid=currentZoneGrid(),calibration=grid.ownSeat===seat?grid.calibration:hub.trackedCalibration?.(seat);
    const locationOf=(card:(typeof sure)[number])=>calibration?.orientation?fieldZoneLocation(mapFieldZone({quad:card.quad,kind:'face-up',confidence:1,partial:false},calibration,[],current.deckChecks.format.id).zone):undefined;
    const fresh = sure.filter(card => !reveals.some(item=>item.card===card))
      .filter(card=>{
        if(calibration?.orientation||current.seats[seat].twin.some(c=>sameObservedCard(c,card)&&['graveyard','banished'].includes(c.zone)))return true;
        const index=onField.findIndex(c=>sameObservedCard(c,card));
        if(index<0)return true;onField.splice(index,1);return false;
      }).sort((a,b)=>a.quad.reduce((n,p)=>n+p.x,0)-b.quad.reduce((n,p)=>n+p.x,0));
    const planned=[...current.seats[seat].twin];
    const placed: { ref: string; card: (typeof fresh)[number]; zone: string; slot?: number;copyProof?:{simultaneousQuads:number;at:number};position?:'attack'|'defense' }[] = [];
    // The turn the scan saw for a card in a Monster Zone; otherwise the position the board already holds. A scan never turns a Defense card back to Attack.
    const positionOf=(card:(typeof sure)[number],zone:string,existing?:TwinCard):'attack'|'defense'=>calibration?.orientation&&(zone==='monster'||zone==='extra-monster')&&card.quad?.length===4?fieldOrientation({quad:card.quad,kind:'face-up',confidence:1,partial:false},1,1,calibration):existing?.position??'attack';
    if (tap) for (const card of sure) placed.push({ ref: `b${seat}-${card.cardId}-${placed.length}-${Date.now().toString(36)}`, card, zone: "" });
    const tokenCells: string[] = [];
    for (const card of tap ? [] : fresh) {
      const observed=locationOf(card);
      const existing=observed?current.seats[seat].twin.find(c=>c.zone===observed.zone&&c.slot===observed.slot&&sameObservedCard(c,card)):undefined;
      const physical=calibration?.orientation?mapFieldZone({quad:card.quad,kind:'face-up',confidence:1,partial:false},calibration,[],current.deckChecks.format.id).zone:'M1';
      const projected=projectFieldZone({zone:physical,facts:cardInfo(card.cardId),twins:planned,ref:existing?.ref,format:now.format?.id??current.deckChecks.format.id});
      if(!projected.zone)continue;
      if(owns&&!existing&&tokenInCell(planned,projected.zone)){tokenCells.push(projected.zone);continue;}
      const {zone,slot}=fieldZoneLocation(projected.zone),ref=existing?.ref??`b${seat}-${card.cardId}-${placed.length}-${Date.now().toString(36)}`;
      const witnesses=sure.filter(other=>{
        if(other===card||!sameObservedCard(other,card)||!distinctFieldQuads(other.quad,card.quad))return false;
        const at=locationOf(other);
        return !!at&&onField.some(c=>sameObservedCard(c,other)&&c.zone===at.zone&&c.slot===at.slot);
      });
      const copyProof=witnesses.length?{simultaneousQuads:witnesses.length+1,at:Math.floor(serverNow()-999)}:undefined;
      const position=positionOf(card,zone,existing);
      if(!existing)planned.push({ref,zone,slot,cardId:card.cardId,faceUp:true,position});
      placed.push({ref,card,zone,slot,copyProof,position});
    }
    if (tokenCells.length) toast(`A token is in ${tokenCells.join(", ")}. Remove the token first, or move the card to another zone.`, 5000);
    const done: typeof placed = [...reveals];
    if (owns) {
      for (const item of placed) {
        const acceptedWitnesses=done.filter(previous=>previous.card!==item.card&&sameObservedCard(previous.card,item.card)&&distinctFieldQuads(previous.card.quad,item.card.quad)&&['monster','spell-trap','extra-monster','field','pendulum'].includes(previous.zone));
        const copies=Math.max(item.copyProof?.simultaneousQuads??1,acceptedWitnesses.length+1);
        const copyProof=copies>=2?{simultaneousQuads:copies,at:Math.floor(serverNow()-999)}:undefined;
        const ok = await act({ type: "twin.place", source: "auto", actorSeat: now.solo ? seat : now.mySeat, seat, zone: item.zone, ...(copyProof?{copyProof}:{}), card: { ref: item.ref, cardId: item.card.cardId, name: item.card.name ?? undefined, ...(item.slot ? { slot: item.slot } : {}), faceUp: true, position: item.position ?? "attack" } });
        if (!ok) break;
        const canonical=placedTwin(ok.state.seats[seat].twin,{ref:item.ref,zone:item.zone,slot:item.slot,cardId:item.card.cardId});
        if(!canonical)break;
        const previous=done.findIndex(value=>value.ref===canonical.ref);if(previous>=0)done.splice(previous,1);
        done.push({...item,ref:canonical.ref,zone:canonical.zone,slot:canonical.slot});
      }
    }
    const seenNow = owns ? done : placed;
    for (let i = 0; i < seenNow.length; i += 20) {
      const chunk = seenNow.slice(i, i + 20);
      await act({ type: "cards.identified", actorSeat: now.mySeat, seat, source: "auto", cards: chunk.map((item, n) => ({ observationId: `${item.ref}-${i + n}`, cardId: item.card.cardId, name: item.card.name ?? undefined, ...(tap ? {} : { zone: item.zone }), ...(item.slot ? { slot: item.slot } : {}), ...(owns ? { cardRef: item.ref } : {}) })) });
    }
    if (done.length) setFresh(done[done.length - 1].ref);
    const bits = [tap ? `${seenNow.length} identified` : owns ? `${done.length} placed on ${name(seat)}'s field` : `${seenNow.length} identified. Only the field owner places cards`];
    if (!tap && onField.length !== current.seats[seat].twin.length && fresh.length < sure.length) bits.push(`${sure.length - fresh.length} already there`);
    if (unsure > 0) bits.push(`${unsure} unsure or covered, click to confirm`);
    if (hidden) bits.push(`${hidden} face-down`);
    bits.push(`${(reading.ms / 1000).toFixed(1)} s`);
    return bits.join(" · ");
  }, [act, name, hub, toast]);

  // ---- attacks ----
  const attackBlock = (seat: number, card?: TwinCard): string => {
    if (!live) return "The table is closed."; if (!card) return "No card selected.";
    if (card.zone !== "monster" && card.zone !== "extra-monster") return "Only monsters in a monster zone can attack.";
    if (seat !== state.turnSeat) return `Only ${name(state.turnSeat)}'s monsters can attack this turn.`;
    if (!myTurn) return "Wait for your turn.";
    if (state.phase !== "battle") return "Move to the Battle Phase first.";
    if (state.attack) return "Finish the current attack first."; return "";
  };
  /** A seat with its board hidden has a target list and Attack directly. A seat with its board shown has a name plate. */
  const boardHidden = (seat: number) => seatWebcam(seat) || boardOff(seat);
  const pickHint = (attackerSeat: number) => {
    const targets = state.seats.filter(item => item.seat !== attackerSeat && !item.eliminated).map(item => item.seat);
    if (targets.every(boardHidden)) return "Click a monster or pick one from the list on its seat, or press Attack directly.";
    if (!targets.some(boardHidden)) return "Click a monster or a name plate.";
    return "Click a monster or a name plate. A seat with no board has a list and Attack directly.";
  };
  const startAttack = (seat: number, card: TwinCard) => {
    const block = attackBlock(seat, card); if (block) { toast(block); return; }
    layers.close(); setPicking({ seat, ref: card.ref });
    toast(<>Pick a target for <b>{cardName(card, info(cardCode(card)))}</b>. {pickHint(seat)} <kbd>Esc</kbd> cancels.</>, 4200);
  };
  const declare = async (targetSeat: number, targetRef?: string) => {
    if (!picking) return; const at = picking; setPicking(null);
    await act({ type: "attack.declare", actorSeat: turnActor, attackerSeat: at.seat, attackerCardRef: at.ref, targetSeat, ...(targetRef ? { targetCardRef: targetRef } : { direct: true }) });
  };
  const findCard = (seat: number | undefined, ref: string | undefined) => seat === undefined || !ref ? undefined : state.seats[seat]?.twin.find(card => card.ref === ref);
  const attack = state.attack;
  // The ATK of my picked or selected monster. It fills the LP box when I click an opponent's LP in my Battle Phase.
  const attackerPick = picking ?? (selected?.seat === mySeat ? selected : null);
  const attackerCard = attackerPick ? findCard(attackerPick.seat, attackerPick.ref) : undefined;
  const directAtk = attackerCard && (attackerCard.zone === "monster" || attackerCard.zone === "extra-monster") ? info(cardCode(attackerCard))?.atk ?? undefined : undefined;
  const battle = useMemo(() => {
    if (!attack) return null;
    const a = findCard(attack.attackerSeat, attack.attackerCardRef); const t = findCard(attack.targetSeat, attack.targetCardRef);
    const ai = a ? info(cardCode(a)) : undefined; const ti = t ? info(cardCode(t)) : undefined;
    return battleMath({
      attacker: { name: a ? cardName(a, ai) : `${name(attack.attackerSeat)}'s monster`, atk: ai?.atk ?? null, seat: attack.attackerSeat },
      target: attack.direct || !t ? null : { name: cardName(t, ti), atk: ti?.atk ?? null, def: ti?.def ?? null, defense: t.position === "defense", seat: attack.targetSeat },
      targetSeat: attack.targetSeat, lp: lpOf, seatName: name,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attack, state.seats, info]);
  const mayResolve = !!attack && live && (solo || mySeat === attack.attackerSeat || mySeat === attack.targetSeat);
  const resolveActor = attack ? (solo ? attack.attackerSeat : mySeat) : mySeat;
  const destroy = async (seat: number, ref: string | undefined) => {
    const card = findCard(seat, ref); if (!card || !ref) return;
    if (solo || seat === mySeat) await act({ type: "twin.move", actorSeat: solo ? seat : mySeat, seat, zone: "graveyard", cardRef: ref });
    else await act({ type: "log.note", actorSeat: mySeat, text: `${cardName(card, info(cardCode(card)))} on ${name(seat)}'s field was destroyed` });
  };
  const confirmAttack = async () => {
    if (!attack || !battle || !mayResolve) return;
    // The LP change goes last, so one Undo takes the damage back (the part people get wrong most).
    const resolved = await act({ type: "attack.resolve", actorSeat: resolveActor, attackId: attack.id, outcome: "resolved" });
    if (!resolved) return;
    if (battle.destroyTarget) await destroy(attack.targetSeat, attack.targetCardRef);
    if (battle.destroyAttacker) await destroy(attack.attackerSeat, attack.attackerCardRef);
    if (battle.damageSeat !== null && battle.damage) {
      const hurt = await changeLp(battle.damageSeat, battle.damage, "Battle damage");
      if (hurt) toast("Undo restores the LP. Fix a card with the controls in its card view.", 4200);
    }
  };
  const cancelAttack = () => { if (attack && mayResolve) void act({ type: "attack.resolve", actorSeat: resolveActor, attackId: attack.id, outcome: "cancelled" }); };

  // ---- arrow ----
  // On a phone the voice dock is fixed, and the phase rail sticks right above it: the rail reads the dock's real height.
  const appRef = useRef<HTMLDivElement>(null); const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const app = appRef.current; const dock = dockRef.current; if (!app || !dock) return;
    const measure = () => app.style.setProperty("--dockh", `${Math.ceil(dock.getBoundingClientRect().height)}px`);
    measure(); if (typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(measure); watcher.observe(dock); return () => watcher.disconnect();
  }, []);
  const stage = useRef<HTMLElement>(null); const [arrow, setArrow] = useState<{ d: string; mx: number; my: number } | null>(null);
  useLayoutEffect(() => {
    const root = stage.current; if (!attack || !root) { setArrow(null); return; }
    const draw = () => {
      const place = (seat: number, ref?: string) => {
        const card = findCard(seat, ref); const key = card ? cellKeyOf(card, state.seats[seat]?.twin) : null;
        const found = (key && root.querySelector<HTMLElement>(`[data-seat="${seat}"][data-zone="${key}"]`)) || root.querySelector<HTMLElement>(`[data-plate="${seat}"]`);
        // A hidden board (Webcam only, Tap mode) leaves its zones in the page with no size: no arrow can point at them.
        const rect = found?.getBoundingClientRect(); return found && rect && (rect.width > 0 || rect.height > 0) ? found : null;
      };
      if (boardHidden(attack.attackerSeat) || boardHidden(attack.targetSeat)) { setArrow(null); return; }
      const a = place(attack.attackerSeat, attack.attackerCardRef); const b = place(attack.targetSeat, attack.direct ? undefined : attack.targetCardRef);
      if (!a || !b) { setArrow(null); return; }
      const st = root.getBoundingClientRect(); const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
      const x1 = ra.left + ra.width / 2 - st.left; const y1 = ra.top + ra.height / 2 - st.top; const x2 = rb.left + rb.width / 2 - st.left; const y2 = rb.top + rb.height / 2 - st.top;
      const mx = (x1 + x2) / 2; const my = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.12 - 20;
      setArrow({ d: `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`, mx: Math.max(8, Math.min(st.width - 170, mx - 60)), my: Math.max(8, my * 0.5 + Math.min(y1, y2) * 0.5 - 14) });
    };
    draw(); window.addEventListener("resize", draw); return () => window.removeEventListener("resize", draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attack, state.seats, tapSeats, ownBoardOff, webcamOnly, hiddenBoards]);

  // ---- moving cards by hand: drag, keyboard, voice ----
  /** One twin.move, one Undo. The auto-detect watcher is told first so the camera keeps the new place. */
  const moveCard = useCallback((seat: number, card: TwinCard, land: Landing, extra: { faceUp?: boolean; position?: "attack" | "defense" } = {}) => {
    const { room: now } = R.current;
    announceManualMove({ slug: now.slug, seat, ref: card.ref });
    const label = card.faceUp && extra.faceUp !== false ? card.name ?? cardInfo(cardCode(card))?.name : undefined;
    return act({ type: "twin.move", actorSeat: now.solo ? seat : now.mySeat, seat, zone: land.zone, cardRef: card.ref, ...(land.slot ? { slot: land.slot } : {}),
      ...(extra.position ? { position: extra.position } : leavePosition(card, land.zone)), ...(extra.faceUp !== undefined ? { faceUp: extra.faceUp } : {}), ...(label ? { name: label } : {}) });
  }, [act]);
  const judgeFor = (seat: number, card: TwinCard, land: Landing) => {
    const { state: cur, room: now } = R.current; const other = facingSeat(seat, now.seatCount);
    return judgeMove({ card, info: cardInfo(cardCode(card)), land, twin: cur.seats[seat]?.twin ?? [], extraZones: hasExtraZones(now.format?.id),
      facing: other === null || !cur.seats[other] ? null : { name: name(other), twin: cur.seats[other].twin } });
  };
  /** Drag, keyboard and voice share this: refuse says why, confirm asks once on the dock chip, ok moves with Undo. */
  const tryMove = (seat: number, card: TwinCard, land: Landing, extra: { faceUp?: boolean; position?: "attack" | "defense" } = {}, requestId?: string, direct = false): { done: boolean; text: string } => {
    const verdict = direct ? { kind: "ok" as const } : judgeFor(seat, card, land);
    // A card that enters a pile takes the face the rules give it (face down from the Deck or Extra Deck into Banished), unless the caller asks for one.
    const face = pileEntryFace(card.zone, land.zone);
    if (extra.faceUp === undefined && face !== undefined) extra = { ...extra, faceUp: face };
    const who = card.faceUp ? cardName(card, cardInfo(cardCode(card))) : "Face-down card";
    if (verdict.kind === "refuse") { toast(verdict.message); return { done: false, text: verdict.message }; }
    if (verdict.kind === "same" && extra.faceUp === undefined && !extra.position) return { done: false, text: "Already there" };
    if (verdict.kind === "confirm") {
      propose(`${who} to ${landingLabel(land)}`, verdict.message, "Place", () => void moveCard(seat, card, land, extra), requestId);
      return { done: true, text: "Needs a confirm" };
    }
    void moveCard(seat, card, land, extra);
    return { done: true, text: `${who} to ${landingLabel(land)}` };
  };
  /** A drop target is a grid cell, or the hand chip of the pile viewer (the hand has no cell). */
  const landOf = (card: TwinCard, key: ZoneKey | "hand"): Landing => key === "hand" ? { zone: "hand" } : landingForCell(key, cardInfo(cardCode(card)), extraZones);
  const fieldDrag = (seat: number): FieldDrag | undefined => !live || !(solo || seat === mySeat) ? undefined : {
    can: card => !picking && ["monster", "spell-trap", "field", "extra-monster", "pendulum", "graveyard", "banished"].includes(card.zone),
    judge: (card, key) => card.token ? tokens.judge(seat, card, key) : judgeFor(seat, card, landOf(card, key)),
    drop: (card, key) => { if (card.token) tokens.drop(seat, card, key); else tryMove(seat, card, landOf(card, key)); },
  };
  /** The card this seat placed or moved last, if it is still on the field. */
  const recentCard = (seat: number): TwinCard | undefined => {
    const { room: now, state: cur } = R.current; const twin = cur.seats[seat]?.twin ?? [];
    for (const event of [...now.events].sort((a, b) => b.seq - a.seq)) {
      const a = event.action as { type: string; seat?: number; cardRef?: string; card?: { ref: string } };
      const ref = a.type === "twin.place" ? a.card?.ref : a.type === "twin.move" || a.type === "card.identified" ? a.cardRef : undefined;
      if (!ref || a.seat !== seat) continue;
      const found = twin.find(card => card.ref === ref && ["monster", "spell-trap", "field", "extra-monster", "pendulum"].includes(card.zone));
      if (found) return found;
    }
    return undefined;
  };
  const spokenMove = (move: MoveIntent, requestId: string, text?: string): { text: string; ignored?: boolean } => {
    const { room: now, state: cur } = R.current; const seat = now.solo ? cur.turnSeat : now.mySeat; const twin = cur.seats[seat]?.twin ?? [];
    if (now.status !== "active" || cur.ended) return { text: "The table is not live", ignored: true };
    let card: TwinCard | undefined;
    if (move.query) {
      const matches = matchCardsByName(twin, move.query, item => item.name ?? cardInfo(cardCode(item))?.name);
      if (!matches.length) return { text: `No card named “${move.query}”`, ignored: true };
      if (matches[1] && matches[1].score >= matches[0].score - 0.05 && matches[1].card.zone === matches[0].card.zone) return { text: `Which ${cardName(matches[0].card, cardInfo(cardCode(matches[0].card)))}? ${matches.length} match`, ignored: true };
      card = matches[0].card;
    } else card = recentCard(seat);
    if (!card) return { text: "No card to move. Place one first.", ignored: true };
    if (move.flipSummon && !canFlipSummon(card)) return { text: "Flip summon needs a face-down monster in a Monster Zone", ignored: true };
    const dest = move.dest;
    // A card set to a Monster Zone goes in defense, face down. A move by voice never needs the card to be face up.
    const extraFor = (zone: string) => {
      const position = move.position ?? (move.faceUp === false && zone === "monster" ? "defense" as const : undefined);
      return { ...(move.faceUp !== undefined ? { faceUp: move.faceUp } : {}), ...(position ? { position } : {}) };
    };
    // A bare "set" (no card, no zone) must not move whatever card was placed last: the camera may have placed it. It asks first.
    if (!move.query && !dest) {
      const who = card.faceUp ? cardName(card, cardInfo(cardCode(card))) : "Face-down card";
      const title = move.flipSummon ? `Flip summon ${who}?` : move.faceUp === false ? `Set ${who} face down?` : move.faceUp === true ? `Turn ${who} face up?` : move.position ? `Put ${who} in ${move.position} position?` : `Change ${who}?`;
      const place = { ref: card.ref, zone: card.zone, slot: card.slot };
      propose(title, `Said: “${text ?? "set"}” with no card name. Say the name to skip this question.`, "Yes", () => {
        // The card may have moved while the chip was open: look it up again and stop if it is not where it was.
        const fresh = R.current.state.seats[seat]?.twin.find(item => item.ref === place.ref);
        if (!fresh || fresh.zone !== place.zone || fresh.slot !== place.slot) { toast("That card moved. Nothing was changed."); return; }
        void tryMove(seat, fresh, { zone: fresh.zone, ...(fresh.slot ? { slot: fresh.slot } : {}) }, extraFor(fresh.zone), undefined, true);
      }, requestId);
      return { text: "Needs a confirm" };
    }
    const emz = dest?.zone === "extra-monster" && !dest.slot ? freeEmzSlot(seat, cur.seats) : dest?.slot;
    const land: Landing = dest ? { zone: dest.zone, ...(dest.zone === "extra-monster" ? (emz ? { slot: emz } : {}) : dest.slot ? { slot: dest.slot } : {}) } : { zone: card.zone, ...(card.slot ? { slot: card.slot } : {}) };
    if (dest?.zone === "extra-monster" && !land.slot) return { text: "Both Extra Monster Zones are taken.", ignored: true };
    const result = tryMove(seat, card, land, extraFor(land.zone), requestId, !dest);
    return { text: result.text, ignored: !result.done };
  };

  // ---- voice ----
  const [muted, setMuted] = useState(true); const [ptt, setPtt] = useState(false); const [held, setHeld] = useState(false);
  const [transcript, setTranscript] = useState({ requestId: "", text: "", result: "", ignored: false });
  const [proposal, setProposal] = useState<Pending | null>(null); const proposalId = useRef(0);
  const micState: MicState = !voiceRecognition || !live ? "off" : muted ? "muted" : myTurn ? "listen" : "idle";
  const voiceAccept = useRef(false); voiceAccept.current = voiceRecognition && live && !muted;
  const diagnostics = useVoiceDiagnostics(voiceRecognition && room.voiceDiagnosticsEnabled === true, room.slug, room.events);
  const diagnosticsRef = useRef(diagnostics); diagnosticsRef.current = diagnostics;
  const setMic = hub.setMic; const micPublished = hub.micPublished;
  useEffect(() => { if (REMOTE_TABLE_TALK && !solo && micPublished === muted) setMic(!muted); }, [muted, solo, setMic, micPublished]);
  // With no talk and no voice commands there is no mic, so no control for one. PTT stays off, so the V key does nothing.
  const micSection = voiceRecognition || (REMOTE_TABLE_TALK && !solo);
  const cameraSetup: CameraMenuSetup = { room, isAdmin: adminAccess === true, collecting: feedbackPref?.isAdmin === true && feedbackPref.collectionEnabled, onFeedbackPref,
    onCameraOff: () => { rememberCameraWanted(room.slug, false); void hub.disableCamera(); } };

  const propose = (title: string, sub: string, confirmLabel: string, run: () => void, requestId?: string) => setProposal({ id: ++proposalId.current, title, sub, confirmLabel, run, requestId });
  const apply = useCallback((intent: VoiceIntent, text: string, requestId: string, voiceAction?: (proposal: RemoteActionProposal) => void) => {
    const { room: now, state: current } = R.current; const me = now.solo ? current.turnSeat : now.mySeat;
    const set = (result: string, ignored = false) => setTranscript(old => ({ ...old, result, ignored }));
    switch (intent.kind) {
      case "effect":
        if (intent.proposal.type !== "effect.activated" || !intent.proposal.source.cardRef) {
          setProposal(null); set("Which card? Say its name with ‘effect’, or activate it from its card view.", true); break;
        }
        // Through the voice action when there is one, so it is stamped, logged and recorded like phase.
        { const open = chainOf(now.events, aliveSeats(current)).open; const last = open[open.length - 1];
          set(`Activated · Chain ${last && last.actorSeat !== me && serverNow() - last.at <= CHAIN_GAP_MS ? open.length + 1 : 1}`); }
        if (voiceAction) voiceAction(intent.proposal); else void act(intent.proposal); break;
      case "undo": set("Undone"); void doUndo(); break;
      case "phase":
        if (!now.solo && now.mySeat !== current.turnSeat) { set(`Only ${name(current.turnSeat)} can change phase`, true); break; }
        set(`Phase: ${PHASE_LONG[intent.phase] ?? intent.phase}`);
        const phaseAction: RemoteActionProposal = { type: "phase.set", actorSeat: me, phase: intent.phase };
        if (voiceAction) voiceAction(phaseAction); else void act(phaseAction); break;
      case "turn":
        // The attack chip comes first: a spoken pass must not replace it.
        if (current.attack) { set("Resolve the attack first", true); break; }
        set("Needs a confirm"); propose("Pass the turn", `${name(current.turnSeat)} to ${name(nextSeat)}`, "Pass turn", () => { if (voiceAction) voiceAction({ type: "turn.end", actorSeat: me }); else passTurn(); }, requestId); break;
      case "lp": set("Needs a confirm"); propose(`${name(intent.seat)} ${sg(intent.delta)} LP`, `${lpOf(intent.seat)} to ${Math.max(0, lpOf(intent.seat) + intent.delta)}`, "Apply", () => { if (voiceAction) voiceAction({ type: "lp.change", actorSeat: now.mySeat, seat: intent.seat, delta: intent.delta, reason: "Voice adjustment" }); else void changeLp(intent.seat, intent.delta, "Voice adjustment"); }, requestId); break;
      case "attack": {
        const best = intent.resolution.candidates[0]; if (!best) { set("No attacker found", true); break; }
        set(intent.resolution.status === "unique" ? "Needs a confirm" : "Best of several matches");
        propose(`${best.attacker.name ?? "Monster"} attacks ${best.target?.name ?? name(best.proposal.targetSeat)}`, intent.resolution.status === "unique" ? `Said: “${text}”` : `${intent.resolution.candidates.length} matches. Best guess shown.`, "Declare", () => { if (voiceAction) voiceAction(best.proposal); else void act(best.proposal); }, requestId);
        break;
      }
      case "move": { const result = spokenMove(intent.move, requestId, text); set(result.text, result.ignored); break; }
      case "pick": set("Picked"); document.dispatchEvent(new CustomEvent("remote-tray-pick", { detail: intent.index })); break;
      default: set("Not understood", true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [act, doUndo, moveCard]);
  // Thinking and OK go out at most once a second (the server rule), in the order pressed: OK right after T still arrives.
  const signalQueue = useRef<(() => void)[]>([]); const signalTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const signalAt = useRef(0);
  const flushSignals = useCallback(() => {
    signalTimer.current = null;
    const job = signalQueue.current.shift(); if (!job) return;
    signalAt.current = Date.now(); job();
    if (signalQueue.current.length) signalTimer.current = setTimeout(flushSignals, SIGNAL_GAP_MS);
  }, []);
  const queueSignal = useCallback((job: () => void) => {
    signalQueue.current.push(job);
    if (signalTimer.current) return;
    const wait = signalAt.current + SIGNAL_GAP_MS - Date.now();
    if (wait <= 0) flushSignals(); else signalTimer.current = setTimeout(flushSignals, wait);
  }, [flushSignals]);
  useEffect(() => () => { if (signalTimer.current) clearTimeout(signalTimer.current); }, []);
  const setThink = (seat: number, on: boolean) => setPendingThink(map => new Map(map).set(seat, on));
  /** Is this seat thinking, counting what this client asked for and the room has not echoed yet. */
  const thinkingNow = (seat: number) => pendingRef.current.get(seat) ?? thinkingSeats(R.current.room.events, true).has(seat);
  /** The T key and the Thinking button: "I am deciding". Pressed again it cancels. No time limit. On a solo table it cancels any seat that thinks. */
  const thinkNow = useCallback(() => {
    const { room: now, state: current } = R.current; const me = now.solo ? current.turnSeat : now.mySeat;
    if (now.status !== "active" || now.spectator || !maySignal(current, me)) return;
    const ours = now.solo ? current.seats.map(item => item.seat) : [me];
    const active = ours.filter(thinkingNow);
    const send = (seat: number, on: boolean) => { setThink(seat, on); queueSignal(() => { if (R.current.room.status === "active") void act({ type: "chain.thinking", actorSeat: seat, on }); }); };
    if (active.length) active.forEach(seat => send(seat, false)); else send(me, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [act, queueSignal]);
  /** The Space key and the OK button: "OK, no response". It clears this player's Thinking. */
  /** A coin flip or die roll for a card effect: the server picks the result. */
  const rollNow = useCallback((kind: "coin" | "die") => {
    const { room: now, state: current } = R.current; const me = now.solo ? current.turnSeat : now.mySeat;
    if (now.status !== "active" || now.spectator || me < 0) return;
    void act({ type: "random.roll", actorSeat: me, kind });
  }, [act]);
  const okNow = useCallback(() => {
    const { room: now, state: current } = R.current; const me = now.solo ? current.turnSeat : now.mySeat;
    if (now.status !== "active" || now.spectator || !maySignal(current, me)) return;
    setThink(me, false);
    queueSignal(() => { if (R.current.room.status === "active") void act({ type: "chain.ok", actorSeat: me }); });
  }, [act, queueSignal]);
  /** The card under the pointer on a webcam (set by the hover label). The E key uses it when the pointer is over that camera. */
  const camHover = useRef<{ seat: number; ref: string; at: number } | null>(null);
  /** The pointer left the card or the camera (toolbar, ledge, "..." menu of the same feed): no card is under it any more. */
  const clearCamHover = useCallback(() => { camHover.current = null; }, []);
  /** A spoken "effect" may use the hovered card only when the pointer was on it a moment ago. */
  const CAM_HOVER_VOICE_MS = 1500;
  const freshCamHover = () => { const hover = camHover.current; return hover && Date.now() - hover.at < CAM_HOVER_VOICE_MS ? { seat: hover.seat, ref: hover.ref } : null; };
  // A selection or a hover from before a new turn or an action must not decide what a bare "effect" or E means.
  useEffect(() => { setSelected(null); camHover.current = null; }, [state.turn, state.turnSeat]);
  /** The E key: activate the card I mean. Under the pointer or focused first, then my newest placement of the last 10 s, else a numbered row. */
  const [activateRow, setActivateRow] = useState<{ seat: number; cards: TwinCard[] } | null>(null);
  useEffect(() => { if (activateRow && (!live || tableBlocked)) setActivateRow(null); }, [activateRow, live, tableBlocked]);
  const sendActivation = useCallback((seat: number, card: TwinCard) => {
    const cardId = cardCode(card); if (!cardId) return;
    setActivateRow(null);
    void act({ type: "effect.activated", actorSeat: seat, source: { cardId, cardRef: card.ref } });
  }, [act]);
  /** A number in the row: the card must still be on my field and face up, or the row closes with a note. */
  const pickFromRow = useCallback((seat: number, card: TwinCard) => {
    const fresh = R.current.state.seats[seat]?.twin.find(item => item.ref === card.ref);
    if (!fresh || !onField(fresh) || fresh.faceUp === false) { setActivateRow(null); toast("That card is not face up on the field any more. Press E again."); return; }
    sendActivation(seat, fresh);
  }, [sendActivation, toast]);
  const activateNow = useCallback(() => {
    const { room: now, state: current } = R.current;
    if (now.status !== "active" || now.spectator || current.ended) return;
    const own = (seat: number) => now.solo || seat === now.mySeat;
    // What the pointer or the focus is on. A card there is the answer, even when it cannot be activated: no guessing then.
    const classify = (el: Element | null | undefined) => {
      if (!el) return undefined;
      if (el.closest('[data-testid^="hand-strip-"]')) return { kind: "hand" } as const;
      const zone = el.closest<HTMLElement>("[data-zone][data-ref]"); if (!zone) return undefined;
      const seat = Number(zone.dataset.seat);
      const card = Number.isInteger(seat) ? current.seats[seat]?.twin.find(item => item.ref === zone.dataset.ref) : undefined;
      return card ? { kind: "card", seat, card } as const : undefined;
    };
    let hovered: Element | undefined; try { hovered = [...document.querySelectorAll(":hover")].pop(); } catch { /* no :hover support */ }
    const column = hovered?.closest<HTMLElement>('[data-testid^="feed-col-"]'); const cam = camHover.current;
    const camCard = column && cam && column.dataset.testid === `feed-col-${cam.seat}` ? current.seats[cam.seat]?.twin.find(item => item.ref === cam.ref) : undefined;
    const pointed = classify(hovered) ?? (cam && camCard ? { kind: "card", seat: cam.seat, card: camCard } as const : undefined) ?? classify(document.activeElement);
    if (pointed) {
      if (pointed.kind === "hand") { toast("E works on field cards. Activate a card from hand with its panel."); return; }
      if (!own(pointed.seat)) { toast("That is not your card."); return; }
      if (!onField(pointed.card)) { toast("E works on cards on the field."); return; }
      if (!cardCode(pointed.card)) { toast("Name this card first."); return; }
      sendActivation(pointed.seat, pointed.card); return;
    }
    const me = now.solo ? current.turnSeat : now.mySeat; if (me < 0) return;
    const placed = recentlyPlaced(now.events, current, me, serverNow());
    if (placed) { sendActivation(me, placed); return; }
    const cards = activatable(current, me);
    if (!cards.length) { toast("No face-up card to activate. Point at a card and press E."); return; }
    setActivateRow({ seat: me, cards });
  }, [sendActivation, toast]);
  /** The card a bare spoken "effect" means: the open card menu, else the selected card, else the card under the pointer on a webcam. Mine, face up, on the field, named. */
  const voicePick = useRef<{ seat: number; ref: string } | null>(null);
  voicePick.current = subject?.ref ? { seat: subject.seat, ref: subject.ref } : selected ?? freshCamHover();
  const voiceSelected = useCallback(() => {
    const { room: now, state: current } = R.current; const pick = voicePick.current; if (!pick || now.spectator) return undefined;
    if (!(now.solo || pick.seat === now.mySeat)) return undefined;
    const card = current.seats[pick.seat]?.twin.find(item => item.ref === pick.ref); const cardId = card ? cardCode(card) : undefined;
    return card && cardId && card.faceUp !== false && onField(card) ? { seat: pick.seat, ref: pick.ref, cardId } : undefined;
  }, []);
  const pendingVoice = useRef<{ id: string; method: VoiceFinal["method"]; context: VoiceContext } | null>(null);
  // Card names feed only the speech-model + names method; the other methods keep their own phrase lists.
  const voiceContext = (method?: VoiceMethod) => {
    const { room: now, state: current } = R.current;
    return { state: current, players: now.seats, me: now.solo ? current.turnSeat : now.mySeat, trayOpen: false,
      ...(method === "asr-names" ? { cardNames: voiceCardNames(now, id => { const card = info(id); return card ? { name: card.name } : undefined; }) } : {}) };
  };
  const onFinal = useCallback((final: VoiceFinal, gate: MicState) => {
    const { room: now, state: current } = R.current;
    const utteranceAt = Date.now();
    const context: VoiceContext = { turn: current.turn, phase: current.phase, turnSeat: current.turnSeat, ownSeat: now.mySeat };
    const decision = decideVoice(final, { state: current, players: now.seats, me: now.solo ? current.turnSeat : now.mySeat, trayOpen: false, selected: voiceSelected() }, voiceAccept.current && gate !== "muted" && gate !== "off");
    const record = (result: VoiceDecision) => diagnosticsRef.current.record(utteranceRecord({ at: utteranceAt, id: final.id, method: final.method, text: final.text, canonical: final.canonical, context, decision: result, utterance: final.utterance }));
    setTranscript({ requestId: final.id, text: final.text || "(no keyword)", result: decision.accepted ? "" : decision.reason, ignored: !decision.accepted });
    if (!decision.accepted) { record({ outcome: "rejected", reason: decision.reason, actionId: null }); return; }
    if (pendingVoice.current) { record({ outcome: "rejected", reason: "unconfirmed", actionId: null }); return; }
    const baseSeq = now.lastSeq;
    // Turn, LP and attack lines wait for a chip; their later outcome is a decision record. Only the turn chip locks out the next line.
    const chipLine = decision.intent.kind === "turn" || decision.intent.kind === "lp" || decision.intent.kind === "attack";
    if (chipLine) {
      if (decision.intent.kind === "turn") pendingVoice.current = { id: final.id, method: final.method, context };
      record({ outcome: "rejected", reason: "needs-confirm", actionId: null });
    }
    let submitted = false;
    apply(decision.intent, final.text, final.id, proposal => {
      if (submitted) return; submitted = true;
      if (decision.intent.kind === "turn") pendingVoice.current = null;
      const latest = R.current;
      // A confirm belongs to the position and microphone choice that produced it.
      const stillLegal = decideVoice(final, { state: latest.state, players: latest.room.seats, me: latest.room.solo ? latest.state.turnSeat : latest.room.mySeat, trayOpen: false, selected: voiceSelected() }, voiceAccept.current);
      // LP and attack chips may wait while other events arrive; the server still checks the action. Other lines keep the strict rule.
      if (decision.intent.kind !== "lp" && decision.intent.kind !== "attack" && (latest.room.lastSeq !== baseSeq || !stillLegal.accepted)) {
        const result: VoiceDecision = { outcome: "rejected", reason: stillLegal.accepted ? "unconfirmed" : stillLegal.reason, actionId: null };
        if (chipLine) diagnosticsRef.current.record({ kind: "decision", at: Date.now(), method: final.method, utteranceId: final.id, context, decision: result }); else record(result);
        setTranscript(old => ({ ...old, result: "Table changed. Say the command again.", ignored: true })); return;
      }
      const actionId = crypto.randomUUID();
      const sentAt = Date.now();
      void act({ ...proposal, cam: playerStamp("voice") }, actionId).then(updated => {
        const result: VoiceDecision = updated ? { outcome: "acted", reason: null, actionId } : { outcome: "rejected", reason: "other", actionId };
        if (chipLine) diagnosticsRef.current.record({ kind: "decision", at: sentAt, method: final.method, utteranceId: final.id, context, decision: result }); else record(result);
        if (updated) addVoiceLog(`${name(now.mySeat)} used voice: ${final.canonical}`);
        else setTranscript(old => old.requestId === final.id ? { ...old, result: "Command was not accepted", ignored: true } : old);
      });
    });
  }, [apply, act, addVoiceLog, name, toast, voiceSelected]);
  const mic = useMicChoice();
  const voice = useVoice({ enabled: voiceRecognition && live, state: micState, ptt, held, micId: mic.micId, context: voiceContext, onFinal,
    onPerf: room.voiceDiagnosticsEnabled ? record => diagnosticsRef.current.record(record) : undefined });
  const shownTranscript = { text: transcript.text, live: false, result: transcript.result, ignored: transcript.ignored };
  useEffect(() => {
    const pending = pendingVoice.current;
    if (!pending || (proposal?.requestId === pending.id && voiceAccept.current)) return;
    diagnosticsRef.current.record({ kind: "decision", at: Date.now(), method: pending.method, utteranceId: pending.id, context: pending.context,
      decision: { outcome: "rejected", reason: "unconfirmed", actionId: null } });
    pendingVoice.current = null;
    if (proposal?.requestId === pending.id) setProposal(null);
  }, [proposal, muted, live, voiceRecognition]);

  // ---- attack proposal (shared) and the voice proposal share the dock chip ----
  const attackChip: Pending | null = attack && battle && mayResolve ? { id: -1, title: battle.title, sub: battle.sub, confirmLabel: battle.result === "Resolve by hand" ? "Mark resolved" : `Confirm · ${battle.result}`, run: () => void confirmAttack() } : null;
  const chip = proposal ?? attackChip;
  const cancelChip = () => { if (proposal) setProposal(null); else cancelAttack(); };

  // ---- keyboard ----
  const toggleView = () => { if (!multi) setWebcamOnly(!webcamOnly); };
  const signalSeat = solo ? state.turnSeat : mySeat;
  const signalShown = live && (solo || mySeat >= 0) && maySignal(state, signalSeat);
  // The Think button shows pressed while any seat this client controls is thinking (a solo table controls every seat).
  const thinkOn = (solo ? state.seats.map(item => item.seat) : [signalSeat]).some(seat => pendingThink.get(seat) ?? thinking.has(seat));
  // Thinking, OK and E need a live duel; E also works before a card is placed.
  const think = signalShown ? thinkNow : null; const ok = signalShown ? okNow : null;
  const activate = live && (solo || mySeat >= 0) && !room.spectator ? activateNow : null;
  const latest = useRef({ chip, cancelChip, doUndo, picking, ptt, toggleView, think, ok, activate, activateRow, pickFromRow, toggleDrawerTab }); latest.current = { chip, cancelChip, doUndo, picking, ptt, toggleView, think, ok, activate, activateRow, pickFromRow, toggleDrawerTab }; escapeBusy.current = !!(chip || picking || activateRow);
  useEffect(() => {
    function down(event: KeyboardEvent) {
      const L = latest.current;
      if ((event.ctrlKey || event.metaKey) && (event.key === "z" || event.key === "Z") && !typing(event.target)) { event.preventDefault(); void L.doUndo(); return; }
      if (typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.key === "v" || event.key === "V") && L.ptt && !event.repeat) { setHeld(true); return; }
      // The table drawer that pushes the table (wide screens) does not block the table keys. Every other layer does.
      if (R.current.layer && !(R.current.layer === "log" && isPushedLayer("log"))) return;
      // T thinks, Space says OK, E activates. A modal dialog, a focused control or a held key keeps its own behavior.
      const modal = !!document.querySelector('[role="alertdialog"],[role="dialog"][aria-modal="true"]');
      // The comma key opens Settings (and closes it again), like the Settings button in the top bar.
      if (event.key === "," && !event.repeat && !event.shiftKey && !modal) { event.preventDefault(); L.toggleDrawerTab("settings"); return; }
      if (L.activateRow) {
        const row = L.activateRow;
        if (event.key === "Escape") { event.preventDefault(); setActivateRow(null); return; }
        const picked = /^[1-9]$/.test(event.key) ? row.cards[Number(event.key) - 1] : undefined;
        if (picked && !modal) { event.preventDefault(); L.pickFromRow(row.seat, picked); return; }
      }
      if (!event.repeat && !event.shiftKey && !event.defaultPrevented && !modal) {
        if ((event.key === "t" || event.key === "T") && L.think) { event.preventDefault(); L.think(); return; }
        if ((event.key === "e" || event.key === "E") && L.activate) { event.preventDefault(); L.activate(); return; }
        const control = (event.target as HTMLElement | null)?.closest?.('button,a,input,textarea,select,summary,[role="button"],[role="tab"],[contenteditable="true"]');
        if (event.key === " " && L.ok && !control) { event.preventDefault(); L.ok(); return; }
      }
      // S scans the field like the button beside the board. A confirm prompt or a modal dialog keeps the key (open popups set the layer above).
      if ((event.key === "s" || event.key === "S") && !event.repeat && !event.shiftKey && !event.defaultPrevented && !document.querySelector('[role="alertdialog"],[role="dialog"][aria-modal="true"]')) { if (runFieldScan()) event.preventDefault(); return; }
      // G shows or hides the zone grid on my own webcam (the same switch as "Show zone grid" in the camera "..." menu). Without my camera it does nothing.
      if ((event.key === "g" || event.key === "G") && !event.repeat && !event.shiftKey && !event.defaultPrevented && !modal) { if (currentZoneGrid().ownSeat !== null) { event.preventDefault(); writeGridPref(true, !readGridPref(true)); } return; }
      // W switches between Both and Webcam only (the focused element keeps Enter and Space).
      if ((event.key === "w" || event.key === "W") && !event.repeat) { event.preventDefault(); L.toggleView(); return; }
      // Enter confirms the chip only when nothing else took the key: a focused field cell, feed or button handles Enter itself.
      const plain = event.target === document.body || (event.target as HTMLElement | null)?.id === "stage";
      if (event.key === "Enter" && L.chip && !event.defaultPrevented && plain) { event.preventDefault(); L.chip.run(); setProposal(null); }
      else if (event.key === "Escape") { if (L.chip) { event.preventDefault(); L.cancelChip(); } else if (L.picking) { event.preventDefault(); setPicking(null); } }
    }
    function up(event: KeyboardEvent) { if (event.key === "v" || event.key === "V") setHeld(false); }
    document.addEventListener("keydown", down); document.addEventListener("keyup", up);
    return () => { document.removeEventListener("keydown", down); document.removeEventListener("keyup", up); };
  }, []);
  const trayPick = useRef<(index: number) => void>(() => undefined);
  useEffect(() => {
    const handler = (event: Event) => trayPick.current((event as CustomEvent<number>).detail);
    document.addEventListener("remote-tray-pick", handler); return () => document.removeEventListener("remote-tray-pick", handler);
  }, []);
  trayPick.current = index => {
    const guess = tray?.guesses[index]; if (!guess) return;
    void identify({ cardId: guess.cardId, name: guess.name || info(guess.cardId)?.name || `Card ${guess.cardId}`, via: "voice", feedback: guess.source === "ai" ? "ai" : "voice" }, "voice");
  };

  // ---- added to hand ----
  // A dismissed or finished chip stays gone after a reload (kept per table in this tab's session storage).
  const dismissKey = `remote-hand-dismissed:${room.slug}`;
  const [dismissedSearch, setDismissedSearchRaw] = useState<ReadonlySet<string>>(() => {
    try { return new Set<string>(JSON.parse(sessionStorage.getItem(dismissKey) ?? "[]")); } catch { return new Set<string>(); }
  });
  const setDismissedSearch = useCallback((update: (old: ReadonlySet<string>) => ReadonlySet<string>) => setDismissedSearchRaw(old => {
    const next = update(old);
    try { sessionStorage.setItem(dismissKey, JSON.stringify([...next].slice(-40))); } catch { /* storage can be blocked */ }
    return next;
  }), [dismissKey]);
  // The chip lives for the search window (2 minutes after the effect), then goes by itself.
  const [searchTick, setSearchTick] = useState(0);
  useEffect(() => { const timer = setInterval(() => setSearchTick(n => n + 1), 10_000); return () => clearInterval(timer); }, []);
  // The server writes the activation time on the origin (`at`). Old origins have none: use their event, which may be gone from the last 50.
  const searchFresh = useCallback((origin: { id: string; at?: number }) => {
    const at = origin.at ?? room.events.find(event => event.id === origin.id.replace(/:hand(:gy|:banish)?$/, ""))?.at;
    return at !== undefined && serverNow() - at < SEARCH_WINDOW_MS;
  }, [room.events, searchTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const addToHand = useCallback((seat: number, card: HandCandidate, source: HandSource, by?: HandBy, originId?: string) => {
    if (originId) setDismissedSearch(old => new Set([...old, originId]));
    void act(handAdd(seat, card, source, by));
  }, [act]);
  /** "Other..." and the card menu: the card search, then hand.add. */
  const searchForHand = useCallback((seat: number, originId?: string, by?: HandBy, source?: "deck" | "gy" | "banish") => {
    const at: PopAt = popAt;
    ctx.current = { seat, x: .5, y: .5, at, id: ++readCounter.current };
    setTray({ seat, ownerName: name(seat), status: "empty", guesses: [], note: "Search for the card to add to your hand.", reader: "none", at, intent: "hand", originId, by, source });
    layers.open("tray");
  }, [layers, name, popAt]);
  // The contract sends card ids only: load the names, then draw again.
  const [, setNames] = useState(0);
  const knownIds = state.seats.flatMap(item => ((item as unknown as { knownHand?: { cardId: number }[] }).knownHand ?? []).map(card => card.cardId)).join(",");
  useEffect(() => { if (knownIds) void loadCards(knownIds.split(",").map(Number)).then(() => setNames(n => n + 1)); }, [knownIds]);
  const openKnown = (seat: number, card: KnownHandCard) => {
    setSubject({ from: "hand", cardId: card.cardId, seat, name: card.name, notInDecklist: null, addErrors: [], via: "field" });
    layers.open("insp");
  };
  // A camera read without a search arrives as a local browser event. The owner decides; nothing is sent before a choice.
  const [suggestion, setSuggestion] = useState<HandSuggestion | null>(null);
  useEffect(() => {
    const onSuggest = (event: Event) => {
      const detail = (event as CustomEvent<RemoteHandSuggestionEvent & { slug: string; name: string }>).detail;
      if (!detail || detail.slug !== room.slug) return;
      setSuggestion({ id: detail.id, cardId: detail.cardId, name: detail.name, actorSeat: detail.actorSeat });
    };
    window.addEventListener(REMOTE_HAND_SUGGESTION_EVENT, onSuggest);
    return () => window.removeEventListener(REMOTE_HAND_SUGGESTION_EVENT, onSuggest);
  }, [room.slug]);
  useEffect(() => { if (!suggestion) return; const timer = setTimeout(() => setSuggestion(null), 30_000); return () => clearTimeout(timer); }, [suggestion]);
  const dismissSuggestion = useCallback((card: HandSuggestion) => { setDismissedSearch(old => new Set([...old, card.id])); setSuggestion(null); }, [setDismissedSearch]);
  // One chip at a time (a solo table has a chip for each bot seat), and none while a popover, drawer or tray is open.
  const chipSeat = tableBlocked ? undefined : state.seats.map(item => item.seat).find(seat => live && (solo || seat === mySeat) && openSearch(state, seat, dismissedSearch, searchFresh));
  const suggestSeat = !tableBlocked && chipSeat === undefined && suggestion && !dismissedSearch.has(suggestion.id) && live && (solo || suggestion.actorSeat === mySeat) &&
    !state.seats[suggestion.actorSeat]?.knownHand?.some(card => card.cardId === suggestion.cardId) ? suggestion.actorSeat : undefined;
  const handOf = (seat: number): HandProps | undefined => {
    const own = live && (solo || seat === mySeat);
    const search = own && seat === chipSeat ? openSearch(state, seat, dismissedSearch, searchFresh) : undefined;
    return {
      cards: knownHandOf(state, seat), count: handCountOf(state, seat), onInspect: card => openKnown(seat, card),
      ...(own ? { onCount: (delta: number) => void act(handCount(solo ? seat : mySeat, delta)) } : {}),
      ...(control.canGive && seat === mySeat ? { give: { active: control.giving, onGive: control.giveFromHand } } : {}),
      ...(suggestion && seat === suggestSeat ? { suggest: {
        card: suggestion, onDismiss: () => dismissSuggestion(suggestion),
        onAdd: (source: HandSource) => { dismissSuggestion(suggestion); void act(handAdd(seat, { cardId: suggestion.cardId, name: suggestion.name }, source)); },
        onReveal: () => { dismissSuggestion(suggestion); void act(handReveal(seat, suggestion.cardId)); },
      } } : {}),
      ...(search ? { search: {
        by: search.by, candidates: search.candidates, onPick: card => addToHand(seat, card, card.source ?? "deck", search.by, search.id),
        onOther: () => searchForHand(seat, search.id, search.by, search.candidates[0]?.source), onDismiss: () => setDismissedSearch(old => new Set([...old, search.id])),
      } } : {}),
    };
  };
  // A card another seat adds to its known hand gets a plain note. The own seat's held-card note (with Undo) comes from the field watcher.
  const handSeen = useRef<Map<number, Set<string>> | null>(null);
  useEffect(() => {
    const now = new Map(state.seats.map(item => [item.seat, new Set(knownHandOf(state, item.seat).map(card => card.id))] as const));
    const before = handSeen.current; handSeen.current = now;
    if (!before) return;
    for (const [seat, ids] of now) {
      if (seat === mySeat || solo) continue;
      const old = before.get(seat) ?? new Set<string>();
      for (const card of knownHandOf(state, seat)) {
        if (old.has(card.id) || !ids.has(card.id)) continue;
        // A card held up from the hand has its own reveal for every seat.
        if (room.events.some(event => event.id === card.id && event.action.type === "effect.activated")) continue;
        const text = card.source === "field" ? `${name(seat)} returned ${card.name} to hand` : card.source === "unknown" ? `${name(seat)} revealed ${card.name} in hand` : `${name(seat)} added ${card.name} to hand`;
        // A field card that left may still become a summon material. The note waits for that window and skips a card that is gone from the hand.
        if (card.source !== "field") { toast(text, 4200); continue; }
        const cardId = card.id;
        const timer = setTimeout(() => {
          returnTimers.current.delete(timer);
          if (knownHandOf(stateNow.current, seat).some(item => item.id === cardId)) toast(text, 4200);
        }, SUMMON_WINDOW_MS + 200);
        returnTimers.current.add(timer);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.seats]);
  const stateNow = useRef(state); stateNow.current = state;
  const returnTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => { const timers = returnTimers.current; return () => { timers.forEach(clearTimeout); timers.clear(); }; }, []);

  // ---- card actions ----
  const subjectCard = subject?.ref ? findCard(subject.seat, subject.ref) : undefined;
  const subjectDetails = subject ? { ...subject, revealed: !!subjectCard?.publicIdentity && subjectCard.faceUp === false } : null;
  const subjectInfo = subject ? info(subject.cardId) : undefined;
  const block = subject ? attackBlock(subject.seat, subjectCard) : "";
  const flagOf = (seat: number) => deckFlag(room, seat);
  const flagActor = solo ? (seatIds.find(seat => !state.seats[seat]?.eliminated) ?? mySeat) : mySeat;
  // "Undo last change to this card": a targeted undo of the newest own action that touched this card.
  const cardEntry = subject?.ref ? ownUndo.find(entry => entry.cards.includes(`${subject.seat}:${subject.ref}`)) : undefined;
  const cardUndo: CardActions["undo"] = cardEntry && live
    ? { label: entryShort(cardEntry), reason: cardEntry.reason, onUndo: () => { void doUndo(cardEntry); if (!cardEntry.reason) layers.close(); } } : undefined;
  /** The important card moves, shared by the board zone menu (`board`: with the battle position) and the webcam card menu. */
  const quickFor = (seat: number, card: TwinCard | undefined, board = false) => card ? quickMoves({ card, seat, mySeat, solo, live, board, isLink: isLinkInfo(info(cardCode(card))), canGive: control.canGive,
    ownerAlive: card.ownerSeat !== undefined && !state.seats[card.ownerSeat]?.eliminated, act, announce: (at, ref) => announceManualMove({ slug: room.slug, seat: at, ref }),
    give: item => { if (control.give(item)) { layers.close(); setSubject(null); } }, giveBack: control.giveBack }) : [];
  /** A new read from the camera at the spot of the open card. A face-up card that took this spot reaches the table through it. `hidden`: a private read of my own Set card. */
  const readAt = (hidden: boolean) => {
    const at = ctx.current; if (!subject || !at || !at.at.anchor || !at.at.feed) return;
    at.invalidatePreread?.(); cancelRead();
    void startRead(subject.seat, at.x, at.y, { point: { anchor: at.at.anchor, feed: at.at.feed }, force: true, ...(hidden ? { hidden } : {}) });
  };
  const readAgain = () => readAt(!!ctx.current?.setClick || subject?.via === "preread");
  /** Webcam card panel: a face-down or unnamed card is read (a Set card of mine privately). */
  const peekCard = () => readAt(subjectCard?.faceUp === false);
  /** Pin to inspector: the card moves from the webcam panel to the card drawer, with its board actions. */
  const pinCard = () => { if (subject?.from === "camera") setSubject({ ...subject, from: "board" }); layers.open("insp"); };
  /** The webcam panel shows a named face-up card's text itself, so only that card can be pinned. Others get "Read this card" instead. */
  const pinnable = !!subject?.cardId && subjectCard?.faceUp !== false && !subject.remembered && subject.via !== "preread";
  /** The short zone name of a card for the line under its name in the card menu ("M3", "S2", "EMZ", "Field"). */
  const whereIs = (seat: number, ref?: string) => {
    const key = ref ? (Object.entries(cellsFor(state.seats[seat]?.twin ?? [], extraZones)).find(([, cell]) => cell?.card?.ref === ref)?.[0] as ZoneKey | undefined) : undefined;
    return key ? zoneLabel(key) : undefined;
  };
  /** "Wrong card? Pick the right one": opens the search tray at `popAt`. Shared by the card panel and the board zone menu. */
  const wrongCard = (subject: Subject, popAt: PopAt) => {
    cancelRead();
    if (subject.via === "preread") ctx.current?.invalidatePreread?.();
    if(subject.via==='tracked'&&ctx.current&&ctx.current.ref&&ctx.current.ref===subject.ref){
      const at=ctx.current,frozen=(solo||subject.seat===mySeat)&&at.frozenFrame?{x:at.x,y:at.y,frame:at.frozenFrame}:undefined;
      const target=trackedRereadTarget(at.ref!,hub.trackedCards(subject.seat),frozen);
      if(target){void startRead(subject.seat,target.x,target.y,{point:{anchor:at.at.anchor!,feed:at.at.feed!,frames:target.frames},force:true,ref:subject.ref});return;}
    }
    // A card opened from its zone on the camera: read that spot again. It may be a new physical card.
    if(subject.via==='field'&&subject.ref&&ctx.current?.ref===subject.ref&&ctx.current.seat===subject.seat&&ctx.current.at.anchor&&ctx.current.at.feed){
      const at=ctx.current;at.cardRef=subject.ref;void startRead(subject.seat,at.x,at.y,{point:{anchor:at.at.anchor!,feed:at.at.feed!},force:true,ref:subject.ref});return;
    }
    const same=ctx.current?.seat===subject.seat?ctx.current:undefined;
    // A read accepted at once keeps its other guesses, so a wrong one costs no more than the tray did.
    // Only that read: a board card opened later must not get its guesses, or a pick saves its crop under the wrong card.
    const read=subject.via==="auto"&&same?.guesses?.[0]?.cardId===subject.cardId?same:undefined;
    const guesses=(read?.guesses??[]).filter(g=>g.cardId!==subject.cardId);
    const placedRef=subject.ref&&read?.placedRef===subject.ref?subject.ref:undefined;
    ctx.current={from:subject.from,seat:subject.seat,x:same?.x??.5,y:same?.y??.5,at:popAt,id:++readCounter.current,...(read?.token!==undefined?{token:read.token}:{}),...(subject.ref?{cardRef:subject.ref,ref:subject.ref}:{}),...(subject.from==="camera"&&same?.spot?{spot:same.spot}:{}),...(subject.remembered||subject.via==="preread"?{hidden:true}:{}),...(subject.remembered&&same?.setClick?{setClick:true}:{})};
    layers.close(); setTray({ seat: subject.seat, ownerName: name(subject.seat), status: guesses.length?"guesses":"empty", guesses, note: `Search for the right card${sayItsName}.`, reader: "", at: popAt, ...(read?.token!==undefined?{aiToken:read.token}:{}), ...(placedRef?{placedRef}:{}) }); layers.open("tray"); 
  };
  const actions: CardActions = {
    quick: quickFor(subject?.seat ?? mySeat, subjectCard),
    ...(subject?.from === "camera" ? { where: whereIs(subject.seat, subject.ref), onReadAgain: readAgain, ...(pinnable ? {} : { onPeek: peekCard }) } : {}),
    ...(subject && subjectCard && live && (solo || subject.seat === mySeat) ? (() => {
      const twins = state.seats[subject.seat].twin;
      const xyz = (c: TwinCard) => c.faceUp && ['monster','extra-monster'].includes(c.zone) && /xyz/i.test(info(cardCode(c))?.type ?? '');
      const material = (c: TwinCard) => !c.token && (['monster','extra-monster'].includes(c.zone) || ['hand','graveyard','banished','extra'].includes(c.zone) && !!c.departedFrom && ['monster','extra-monster'].includes(c.departedFrom.zone) && (c.zone === 'hand' || !!c.departedFrom.auto) && c.departedFrom.at !== undefined && serverNow() - c.departedFrom.at <= 30_000);
      const top = xyz(subjectCard), options = twins.filter(c => c.ref !== subjectCard.ref && (top ? material(c) : material(subjectCard) && xyz(c)));
      return { attach: { label: top ? 'Attach Xyz material' : 'Attach to Xyz', options: options.map(c => ({ ref: c.ref, label: `${c.faceUp || c.publicIdentity || solo || subject.seat === mySeat ? cardName(c,info(cardCode(c))) : 'Face-down card'} · ${c.zone} ${c.slot ?? ''}` })), onPick: (ref: string) => void act({type:'twin.attach',actorSeat:solo?subject.seat:mySeat,seat:subject.seat,cardRef:top?subjectCard.ref:ref,kind:'xyz',materialRefs:[top?ref:subjectCard.ref]}) } };
    })() : {}),
    // Any card on the field I can edit: mine, a token I placed on another field, or a proxy I gave there. Webcam cards, face-down and unnamed cards, proxies and tokens all show the row.
    ...(subject && subjectCard && live && (solo || subject.seat === mySeat || (subjectCard.token ? subjectCard.token.by === mySeat : subjectCard.ownerSeat === mySeat)) && ['monster', 'extra-monster', 'spell-trap', 'field', 'pendulum'].includes(subjectCard.zone)
      ? { counters: { count: subjectCard.counters ?? 0, onChange: (delta: 1 | -1) => void act({ type: 'twin.counters', actorSeat: solo ? subject.seat : mySeat, seat: subject.seat, cardRef: subjectCard.ref, delta }) } } : {}),
    canAdd: !!subject && live && (solo || subject.seat === mySeat) && !subject.addErrors.length, adding, onAdd: () => subject && void addToDeck(subject.seat, subject.cardId),
    voice: voiceRecognition,
    canAttack: !!subjectCard && !block, attackHint: block || "Pick this monster as the attacker", onAttack: () => subjectCard && subject && startAttack(subject.seat, subjectCard),
    onWrong: () => { if (subject) wrongCard(subject, popAt); },
    onActivate: subject && subject.cardId && live && subjectCard?.zone !== "deck" && subjectCard?.zone !== "extra" && (solo || subject.seat===mySeat) ? () => void act({type:"effect.activated",actorSeat:subject.seat,source:{cardId:subject.cardId,...(subject.ref ? {cardRef:subject.ref} : {})}}).then(done=>{if(done) layers.close();}) : undefined,
    onReveal: subject && subjectCard && !subjectCard.faceUp && (solo || subject.seat===mySeat) ? () => void act({type:"twin.flip",actorSeat:subject.seat,seat:subject.seat,cardRef:subjectCard.ref,faceUp:true}) : undefined,
    ...(subject?.from === "camera" && !pinnable ? {} : { onPin: pinCard }),
    // Control change: take an opponent's monster or revived card, or hand a taken card back. Never guessed; the player presses the button.
    ...(subject && subjectCard && live && !solo && subject.seat !== mySeat && mySeat >= 0 && ["monster", "extra-monster", "graveyard"].includes(subjectCard.zone) && subjectCard.ownerSeat !== mySeat ? { control: { label: "Take control", onClick: () => { control.take(mySeat, subject.seat, subjectCard); } } } : {}),
    // A card I gave away shows on the other field as my proxy: I can take it back to a free zone of mine.
    ...(subject && subjectCard && live && !solo && subject.seat !== mySeat && subjectCard.ownerSeat === mySeat ? { control: { label: "Take back", onClick: () => { control.giveBack(subject.seat, subjectCard); } } } : {}),
    // An owner who is out has no side to return to: the proxy stays like a token, and Remove (below) takes it off.
    ...(subject && subjectCard?.ownerSeat !== undefined && !state.seats[subjectCard.ownerSeat]?.eliminated && control.may(subject.seat) ? { control: { label: "Return control", onClick: () => { control.giveBack(subject.seat, subjectCard); } } } : {}),
    ...(subject && subjectCard && subject.seat === mySeat && !subjectCard.token && control.canGive && ["monster", "extra-monster", "spell-trap"].includes(subjectCard.zone) ? { give: { label: "Give to opponent", onClick: () => { if (control.give(subjectCard)) { layers.close(); setSubject(null); } } } } : {}),
    ...(live && (solo || mySeat >= 0) ? { onAddToHand: () => searchForHand(solo ? (subject?.seat ?? mySeat) : mySeat) } : {}),
    undo: cardUndo,
    ...(subject && subjectCard?.materials?.length ? { materials: subjectCard.materials.flatMap(ref => {
      const material = state.seats[subject.seat]?.twin.find(c => c.ref === ref); if (!material) return [];
      const owner = live && (solo || subject.seat === mySeat);
      return [{ ref, cardId: cardCode(material), name: cardName(material, info(cardCode(material))),
        ...(owner ? { onDetach: () => void act({ type: "twin.detach", actorSeat: solo ? subject.seat : mySeat, seat: subject.seat, cardRef: subjectCard.ref, materialRef: ref, zone: "graveyard" }) } : {}) }];
    }) } : {}),
    ...(subject && subjectCard && (subjectCard.faceUp || subjectCard.publicIdentity) && cardCode(subjectCard) ? (() => {
      const twins = state.seats[subject.seat]?.twin ?? [];
      const reason = fieldZoneCheck(info(cardCode(subjectCard)), subjectCard.zone, subjectCard.slot, { faceDown: !subjectCard.faceUp, equipped: !!subjectCard.equippedTo, equipSource: equipSourceOnField(twins, c => info(cardCode(c))) });
      return reason ? { zoneCheck: reason } : {};
    })() : {}),
    ...(subject && flagOf(subject.seat) ? { onFlag: (el: HTMLElement) => { setFlagSeat(subject.seat); layers.open("flag", el); } } : {}),
    // The owner of a proxy edits it on the other field too (position, move, send away).
    ...(subject && subjectCard && live && (solo || subject.seat === mySeat || subjectCard.ownerSeat === mySeat) ? { edit: {
      faceUp: subjectCard.faceUp !== false, zone: subjectCard.zone, slot: subjectCard.slot, extraZones,
      onCell: (key: ZoneKey) => { tryMove(subject.seat, subjectCard, landOf(subjectCard, key)); },
      onMove: (zone: string) => {
        // A move into the Extra Monster Zones picks a slot the facing seat has not taken. Pendulum Zones use the outer Spell/Trap cells.
        const slot = zone === "extra-monster" ? freeEmzSlot(subject.seat, state.seats) : zone === "pendulum" ? [1, 2].find(n => !state.seats[subject.seat].twin.some(c => c.zone === "pendulum" && c.slot === n)) : undefined;
        if (zone === "extra-monster" && !slot) { toast("Both Extra Monster Zones are taken."); return; }
        announceManualMove({ slug: room.slug, seat: subject.seat, ref: subjectCard.ref });
        void act({ type: "twin.move", actorSeat: solo ? subject.seat : mySeat, seat: subject.seat, zone, cardRef: subjectCard.ref, ...(slot ? { slot } : {}), ...(pileEntryFace(subjectCard.zone, zone) !== undefined ? { faceUp: pileEntryFace(subjectCard.zone, zone) } : {}), ...leavePosition(subjectCard, zone) });
      },
      // A card turned face down in a Monster Zone is a Set monster, in Defense (like the camera's face-down proposal).
      onFlip: () => void act({ type: "twin.flip", actorSeat: solo ? subject.seat : mySeat, seat: subject.seat, cardRef: subjectCard.ref, faceUp: subjectCard.faceUp === false,
        ...(subjectCard.faceUp !== false && (subjectCard.zone === "monster" || subjectCard.zone === "extra-monster") ? { position: "defense" as const } : {}) }),
      // Any face-up card in a Monster Zone has a battle position, a Trap Monster too. A Link monster stays in Attack, so it only offers the way back from Defense.
      ...(subjectCard.faceUp !== false && (subjectCard.zone === "monster" || subjectCard.zone === "extra-monster") && (subjectCard.position === "defense" || !isLinkInfo(info(cardCode(subjectCard)))) ? { position: {
        defense: subjectCard.position === "defense",
        onTurn: () => {
          // Read the card again: the camera may have turned it face down since the menu opened (never flip it face up from a stale menu).
          const { state: cur, room: now } = R.current; const latest = cur.seats[subject.seat]?.twin.find(c => c.ref === subjectCard.ref);
          if (!latest || latest.faceUp === false || (latest.zone !== "monster" && latest.zone !== "extra-monster")) return;
          announceManualMove({ slug: now.slug, seat: subject.seat, ref: latest.ref });
          void act({ type: "twin.flip", actorSeat: now.solo ? subject.seat : now.mySeat, seat: subject.seat, cardRef: latest.ref, faceUp: true, position: latest.position === "defense" ? "attack" : "defense" });
        } } } : {}),
      onRemove: () => { void act({ type: "twin.remove", actorSeat: solo ? subject.seat : mySeat, seat: subject.seat, cardRef: subjectCard.ref, cam: playerStamp("popup-remove") }); layers.close(); setSubject(null); },
      ...(!subjectCard.faceUp&&!subjectCard.token&&['monster','spell-trap','extra-monster','field','pendulum'].includes(subjectCard.zone)?{onNotACard:()=>{announceNotACard(room.slug,subject.seat,subjectCard.ref);void act({type:'twin.remove',actorSeat:solo?subject.seat:mySeat,seat:subject.seat,cardRef:subjectCard.ref,cam:playerStamp('not-a-card')});layers.close();setSubject(null);}}:{}),
      ...(subjectCard.faceUp !== false && subjectCard.zone === "spell-trap" && (solo || subject.seat === mySeat) ? { equip: equipChoice(subject.seat, subjectCard) } : {}),
    } } : {}),
  };
  /** Local camera identities open with the correction and reread actions. */
  const shownActions: CardActions = subject && (subject.remembered || subject.via === "preread") ? { canAdd: false, adding: false, onAdd: () => undefined, canAttack: false, attackHint: "", onAttack: () => undefined, onWrong: actions.onWrong,
    where: actions.where, onReadAgain: readAgain } : actions;
  /** "Equipped to" choices: every monster on any field. One twin.equip action, one Undo. */
  function equipChoice(seat: number, card: TwinCard): NonNullable<CardEdit["equip"]> {
    const options = state.seats.flatMap(other => other.eliminated ? [] : other.twin.filter(c => c.zone === "monster" || c.zone === "extra-monster").map(c => ({
      key: `${other.seat}:${c.ref}`,
      label: `${other.seat === seat ? "" : name(other.seat) + " · "}${c.faceUp || c.publicIdentity ? cardName(c, info(cardCode(c))) : "Face-down monster"} (${c.zone === "monster" ? "M" : "EMZ"}${c.slot ?? ""})`,
    })));
    return { current: card.equippedTo ? `${card.equippedTo.seat}:${card.equippedTo.ref}` : undefined, options,
      onEquip: key => { const [target, ref] = key ? [Number(key.split(":")[0]), key.slice(key.indexOf(":") + 1)] : [];
        void act({ type: "twin.equip", actorSeat: solo ? seat : mySeat, seat, cardRef: card.ref, target: key ? { seat: target!, ref: ref! } : null }); } };
  }
  const openSubject = (card: TwinCard, from: Exclude<CardSource, "hand"> = "board", anchor?: Rect) => {
    const seat = state.seats.findIndex(item => item.twin.some(c => c.ref === card.ref));
    if (card.token) { tokens.open(seat, card); return; }
    const origin=state.effectTracking?.origins.find(o=>o.seat===seat && o.ref===card.ref);
    if(!card.faceUp && origin && (solo || seat===mySeat)) {setEffectOrigin(origin.id); layers.open("effect"); return;}
    const id = cardCode(card);
    // Your own card with no name still gets its actions (move, flip, Graveyard, Wrong card?). cardId 0 = not identified.
    if (!id && !((solo || seat === mySeat) && (from === "camera" || (from === "board" && !anchor)))) { toast(card.setBy ? "Face-down · Set by "+card.setBy.name : card.faceUp?"This card is not identified yet. Click it on the camera feed.":"Face-down card"); return; }
    setSubject({ from, cardId: id ?? 0, seat, ref: card.ref, name: id ? card.name : card.faceUp ? "Unidentified card" : "Face-down card", bestMatch:card.bestMatch, notInDecklist: id && card.ownerSeat === undefined ? flagFor(seat, id) : null, addErrors: [], via: "field" });
    setSelected({ seat, ref: card.ref });
    // From a pile tile the popup points at the tile, so it opens over the viewer and the viewer stays.
    if (anchor) { setPopAt({ anchor, feed: null }); layers.open("card"); } else if (from === "board") layers.open("insp");
  };
  // ---- Graveyard and Banished piles ----
  const [pile, setPile] = useState<{ seat: number; zone: PileZone } | null>(null);
  const openPile = (seat: number, zone: PileZone, opener: HTMLElement | null) => {
    if (pile && pile.seat === seat && pile.zone === zone && layers.layer === "pile") { layers.close("pile"); return; }
    setPile({ seat, zone }); layers.open("pile", opener);
  };
  // The viewer stays while its card popup is open. Any other layer, Esc or a press outside closes it.
  useEffect(() => { if (pile && layers.layer !== "pile" && layers.layer !== "card") setPile(null); }, [pile, layers.layer]);
  // In a match break my Deck and Extra are not mine to read: close a viewer open on them.
  useEffect(() => { if (pile && !live && (pile.zone === "deck" || pile.zone === "extra")) { setPile(null); layers.close(); } }, [pile, live, layers]);

  // ---- health ----
  const healthRows = seatIds.map(seat => ({ seat, name: name(seat), color: COLORS[seat], health: hub.health(seat) }));
  // The summary shows the real worst state: a weak feed, a table video error, a card watcher that did not start, a reader that fell back to the CPU.
  const reader = useRecognitionBackend(), watcherError = useFieldWatcherError();
  const extras: HealthExtra[] = [
    ...(hub.error ? [{ key: "video", name: "Camera and table video", health: { q: "bad" as const, label: "Video error", detail: hub.error } }] : []),
    ...(watcherError ? [{ key: "watcher", name: "Auto-detect", health: { q: "bad" as const, label: "Reader off", detail: "The card reader is not running. Reload the page or use Tap to identify." } }] : []),
    // Auto mode on a browser without WebGPU always reads on the CPU: that is information, not a fault. Only a GPU that failed during this session warns.
    ...(reader.backend === "wasm" && reader.note ? [gpuLossReason()
      ? { key: "reader", name: "Card reader", health: { q: "warn" as const, label: "CPU reader", detail: "The GPU failed, so cards are read on the CPU. This is slower." }, tag: "Weak" }
      : { key: "reader", name: "Card reader", health: { q: "off" as const, label: "CPU reader", detail: "This browser reads cards on the CPU. It is a little slower." }, tag: "Info" }] : []),
  ];
  // Summary chip in the top bar (opens the Info tab): the worst state across the human feeds and the extra rows.
  const humans = healthRows.filter(row => !room.seats.find(item => item.seat === row.seat)?.bot);
  const weakFeeds = humans.filter(row => row.health.q === "bad" || row.health.q === "warn").length;
  const counted = extras.filter(item => item.health.q === "bad" || item.health.q === "warn");
  const allQ = [...humans.map(row => row.health.q), ...counted.map(item => item.health.q)];
  const worstQ = allQ.includes("bad") ? "bad" : allQ.includes("warn") ? "warn" : humans.every(row => row.health.q === "off") ? "off" : "good";
  const healthIssues = [...(weakFeeds ? [`${weakFeeds} feed${weakFeeds === 1 ? "" : "s"} weak`] : []), ...counted.map(item => item.health.label)];
  const healthSummary = healthIssues.length ? `${healthIssues[0]}${healthIssues.length > 1 ? ` +${healthIssues.length - 1}` : ""}` : worstQ === "off" ? "Cameras off" : "All feeds ok";
  const format = room.format ?? state.deckChecks?.format ?? normalizeRemoteFormat();
  const formatLabel = REMOTE_FORMATS.find(item => item.value === format.id)?.label ?? format.id;
  const mode = seatCount === 2 ? "1v1" : String(seatCount);
  const facing = (seat: number) => { const other = facingSeat(seat, seatCount); return other === null || !state.seats[other] ? null : { name: name(other), twin: state.seats[other].twin }; };
  const warnRefs = (seat: number) => new Set(state.seats[seat]?.twin.filter(card => { const code = cardCode(card); return code && card.ownerSeat === undefined && flagFor(seat, code) === true; }).map(card => card.ref) ?? []);
  const twinCounts = (seat: number) => new Map(findTwinGroups(state.seats[seat]?.twin ?? []).flatMap(group => group.cards.map(card => [card.ref, group.cards.length] as const)));
  const draftPhase = PHASES.length;
  void draftPhase;

  // ---- camera card info and card actions ----
  const tapOwnSeat = useTapToIdentify(mySeat);
  const gridFormat = (room.format?.id ?? state.deckChecks.format.id) as FieldFormat;
  /** The mat zone under a point on a camera feed ("M1", "GY", "BANISHED" ...). Needs the feed's confirmed mat grid. */
  const zoneAtPoint = (seat: number, x: number, y: number): string | undefined => {
    const calibration = zoneGrid.ownSeat === seat ? zoneGrid.calibration : hub.trackedCalibration?.(seat);
    if (!calibration?.orientation) return undefined;
    const mat = onMat({ x, y }, calibration);
    return fieldZoneAt(mat, calibration, gridFormat);
  };
  const pileAt = (zone: string | undefined): PileZone | null => zone === "GY" ? "graveyard" : zone === "BANISHED" ? "banished" : null;
  /** The card the table holds in the zone under a point. Only the camera's own mat counts: a facing player's Extra Monster Zone is not on this mat. */
  const twinAtPoint = (seat: number, x: number, y: number): TwinCard | undefined => {
    const zone = zoneAtPoint(seat, x, y);
    const key = !zone ? null : zone === "FIELD" ? "f" : zone.startsWith("EMZ") ? `e${zone.slice(-1)}` : /^[MS][1-5]$/.test(zone) ? zone.toLowerCase() : null;
    return key ? cellsFor(state.seats[seat]?.twin ?? [], extraZones)[key as ZoneKey]?.card : undefined;
  };
  /** The card under a point: an outlined (identified) card first, then the card the table holds in that zone. */
  const cardAtPoint = (seat: number, x: number, y: number): TwinCard | undefined => {
    const tracked = hub.trackedAt(seat, x, y);
    const twin = tracked ? publicTrackedTwin(tracked, state.seats[seat]?.twin ?? []) : undefined;
    return (twin && findCard(seat, twin.ref)) ?? twinAtPoint(seat, x, y);
  };
  const statLine = (id: number | undefined) => { const facts = info(id); return facts && isMonsterInfo(facts) ? `ATK ${facts.atk ?? "?"}${facts.def !== undefined && facts.def !== null ? ` / DEF ${facts.def}` : ""}` : facts?.type; };
  const pileCount = (seat: number, zone: PileZone) => (state.seats[seat]?.twin ?? []).filter(card => card.zone === zone).length;
  /** Webcam only: the name under the pointer. Outlined cards first, then the card the table holds in that zone. A hidden card shows as a Set card. */
  const hoverTip = (seat: number, x: number, y: number): { label: string; detail?: string; hint?: string } | null => {
    camHover.current = null;
    if (tapOwnSeat && seat === mySeat) return null;
    const under = cardAtPoint(seat, x, y); if (under) camHover.current = { seat, ref: under.ref, at: Date.now() };
    // The "E Activate" hint shows on my own face-up named card on the field.
    const hint = under && (solo || seat === mySeat) && under.faceUp !== false && cardCode(under) && onField(under) ? "Activate" : undefined;
    const tracked = hub.trackedAt(seat, x, y);
    if (tracked) return { label: tracked.name ?? info(tracked.cardId)?.name ?? "Card", detail: statLine(tracked.cardId), hint };
    const card = twinAtPoint(seat, x, y);
    if (!card) { const pile = pileAt(zoneAtPoint(seat, x, y)); return pile ? { label: pile === "graveyard" ? "Graveyard" : "Banished", detail: `${pileCount(seat, pile)} cards` } : null; }
    const id = cardCode(card);
    if (id) return { label: cardName(card, info(id)), detail: card.faceUp ? statLine(id) : "Set", hint };
    return card.faceUp ? null : { label: "Set card" };
  };
  /** The webcam card menu (a click, a right click or a long press on a card of a camera feed). It points at the pointer and keeps the read context for Read again. */
  const openCameraMenu = (card: TwinCard, at: { x: number; y: number; anchor: Rect; feed: Rect }) => {
    const seat = state.seats.findIndex(item => item.twin.some(c => c.ref === card.ref));
    cancelRead(); openSubject(card, "camera", at.anchor);
    ctx.current = { seat, x: at.x, y: at.y, at: { anchor: at.anchor, feed: at.feed }, id: ++readCounter.current, ref: card.ref };
  };
  /** Webcam only: a click where no card is outlined. A card the table knows there opens its info. A hidden card says "Set card". The Graveyard and Banished open their pile. */
  const onZoneCard = (seat: number, at: { x: number; y: number; anchor: Rect; feed: Rect }) => {
    // 3-way and 4-way: placing a token or giving a card is a click on a free zone of the camera's zone grid (no board is shown).
    if (multi && (tokens.placing || control.giving)) {
      const zone = zoneAtPoint(seat, at.x, at.y), key = zone && /^[MS][1-5]$/.test(zone) ? zone.toLowerCase() as ZoneKey : undefined;
      if (key && (tokens.placeAt(seat, key, twinAtPoint(seat, at.x, at.y)) || control.giveAt(seat, key, twinAtPoint(seat, at.x, at.y)))) { cancelRead(); return true; }
    }
    // Tap to identify: the board does not follow this camera, so its zones can be out of date. The click reads the frame.
    if (tapOwnSeat && seat === mySeat) return false;
    const card = twinAtPoint(seat, at.x, at.y);
    if (card?.token) { cancelRead(); tokens.open(seat, card); return true; }
    // The table already knows this card: its details open in both views, with no read.
    if (card && cardCode(card)) {
      openCameraMenu(card, at); return true;
    }
    if (!seatWebcam(seat) && !boardOff(seat)) return false;
    if (!card) { const pile = pileAt(zoneAtPoint(seat, at.x, at.y)); if (!pile) return false; cancelRead(); openPile(seat, pile, null); return true; }
    // A Set card this browser remembers takes the click read, which ends in the local popup. No name shows until then.
    const memory = tapMemory(seat);
    if (card.faceUp) return false;
    if (memory?.recall(memory.spot(at.x, at.y))) { setCardClick.current = seat; return false; }
    cancelRead(); toast("Set card"); layers.close(); return true;
  };
  /** While a target is picked for an attack: a click on a monster of another seat declares it. */
  const onCamPick = (seat: number, x: number, y: number) => {
    if (!picking || seat === picking.seat) return false;
    const card = cardAtPoint(seat, x, y);
    // No monster under the click: tell the player. A read here would hide the pick.
    if (!card || (card.zone !== "monster" && card.zone !== "extra-monster")) { toast(boardHidden(seat) ? "No monster there. Pick one from the list on this seat, or press Attack directly." : "No monster there. Click a monster or a name plate."); return true; }
    void declare(seat, card.ref); return true;
  };
  /** Right click or long press on a card: its actions in the card drawer (move, flip, position, Graveyard, Wrong card?, Undo). True when something opened. */
  const openCardActions = (card: TwinCard): boolean => {
    const seat = state.seats.findIndex(item => item.twin.some(c => c.ref === card.ref));
    if (card.token) { tokens.open(seat, card); return true; }
    if (!cardCode(card) && !card.faceUp && !(solo || seat === mySeat)) { toast("Set card"); return true; }
    openSubject(card, "board"); return true;
  };
  /** The feed handler runs first and the table handler after it, in the same event. This tells the table handler what the feed did. */
  const feedMenu = useRef(false);
  const onCardMenu = (seat: number, at: { x: number; y: number }, mouse: boolean, where: { anchor: Rect; feed: Rect }) => {
    const card = cardAtPoint(seat, at.x, at.y);
    // A webcam seat gets the short webcam card menu; the virtual board (and the drawer) keep the full card actions.
    if (card && boardHidden(seat) && !card.token && (cardCode(card) || solo || seat === mySeat)) { openCameraMenu(card, { ...at, ...where }); feedMenu.current = true; return; }
    if (card) { feedMenu.current = openCardActions(card); return; }
    const zone = zoneAtPoint(seat, at.x, at.y), pile = pileAt(zone);
    if (pile) { openPile(seat, pile, null); feedMenu.current = true; return; }
    // Right click (a mouse only: a slow tap on a phone is a card read, never a menu) on a Monster or Spell & Trap Zone of a camera feed that has no card:
    // the same menu as a click on that empty zone of the board (a trusted board only).
    const mine = solo || seat === mySeat, key = zone?.toLowerCase() as ZoneKey | undefined;
    if (!mouse || !key || !/^[ms][1-5]$/.test(key) || boardOff(seat)) return;
    const held = cellsFor(state.seats[seat].twin, extraZones)[key]?.card;
    if (held) { feedMenu.current = openCardActions(held); return; }
    if (mine || /^m/.test(key) || control.canGive) { openZonePicker(seat, key, undefined, true, false, !mine); feedMenu.current = true; }
  };
  const cardMenu = useCardMenu(target => {
    if (target.closest("[data-remote-seat]")) { const done = feedMenu.current; feedMenu.current = false; return done; }
    const cell = target.closest<HTMLElement>("[data-zone][data-seat]"); if (!cell) return false;
    const key = cell.dataset.zone as ZoneKey; const seat = Number(cell.dataset.seat);
    if (key === "gy" || key === "ban") { openPile(seat, key === "gy" ? "graveyard" : "banished", cell); return true; }
    if (isPile(key)) return false;
    const card = cellsFor(state.seats[seat]?.twin ?? [], extraZones)[key]?.card; return card ? openCardActions(card) : tokens.create(seat, key);
  });
  return <FeedCardsProvider seats={state.seats} info={info} marks={chainMarks}><div ref={appRef} className={`${duelFontClasses} ${s.app}`} data-drawer={layers.layer === "log" ? drawerTab : undefined} data-mode={mode} data-wc={webcamOnly ? "1" : undefined} data-testid="remote-table" data-status={room.status} {...cardMenu}>
    <AutoFieldWatcher dock={seatDocks[mySeat] ?? null} room={room} transaction={ctl.transaction} diagnosticsAllowed={feedbackPref?.isAdmin===true && feedbackPref.collectionEnabled} />
    <a className={s.skip} href="#stage">Skip to the table</a>
    <div className={s.shell}>
      <TopBar crumb={`Table ${room.slug.slice(0, 8)}`} startedAt={room.startedAt} endedAt={room.endedAt} tournament={tournament ? { name: tournament.tournamentName, href: `/tournament/${encodeURIComponent(tournament.tournamentSlug)}` } : null} chip={`${formatLabel} · ${solo ? "Solo test" : `${seatCount} players`}${room.spectatorCount ? ` · ${room.spectatorCount} watching` : ""}`} adminWatchers={(room.adminWatchers ?? []).map(watcher => watcher.name)} cardOpen={layers.layer === "insp"} logOpen={layers.layer === "log" && drawerTab === "log"} logDot={unread} settingsOpen={layers.layer === "log" && drawerTab === "settings"} onSettings={el => toggleDrawerTab("settings", el)} health={{ q: worstQ, text: healthSummary }} healthOpen={layers.layer === "log" && drawerTab === "info"} onHealth={el => openDrawer("info", el)}
        onCard={el => layers.toggle("insp", el)} onLog={el => toggleDrawerTab("log", el)}
        webcamOnly={webcamOnly} onView={multi ? undefined : setWebcamOnly} />
      <AdminWatchStrip names={(room.adminWatchers ?? []).map(watcher => watcher.name)} />
      <main className={s.stage} id="stage" tabIndex={-1} aria-label="Duel table" ref={stage}>
        {firstPick}
        <LpStrip players={players} turnSeat={turnShown} lp={lpOf} onJump={seat => document.querySelector(`[data-testid="seat-${seat}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })} />
        {room.status === "ended" || (state.ended && !state.match) ? <div className={s.ended} role="status" data-testid="table-ended">
          <b>This table has ended.</b>
          <span>{endedWhy(room, state.winnerSeat !== null && state.winnerSeat !== undefined ? name(state.winnerSeat) : null)}</span>
          <a className={`${s.btn} ${s.go} ${s.sm}`} href="/duels/new?type=remote" data-testid="new-table">New table</a>
        </div> : null}
        {!solo && seatCount > 2 && mySeat >= 0 && live && state.seats[mySeat]?.eliminated ? <div className={s.ended} role="status" data-testid="out-watching">
          <b>You are out of this game.</b>
          <span>You are watching. The others play on.</span>
        </div> : null}
        <EffectControls room={room} act={act} onOpen={id=>{setEffectOrigin(id);layers.open("effect");}} />
        {mySeat >= 0 ? <RecentDepartures room={room} seat={mySeat} onAction={action => void act(action)} /> : null}
        <Banner banner={banner} />
        <ThinkingCallout thinking={thinking} name={name} pointer={seatCount > 2} />
        <OkBanner hold={okHold} name={name} />
        <RollOverlay hold={rollHold} name={name} />
        <svg className={s.arrow} aria-hidden="true">{arrow ? <><defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#f6dc9a" /></marker></defs>
          <path d={arrow.d} fill="none" stroke="rgba(232,185,79,.35)" strokeWidth="9" strokeLinecap="round" />
          <path className={s.flow} d={arrow.d} fill="none" stroke="#f6dc9a" strokeWidth="3" strokeLinecap="round" markerEnd="url(#ah)" /></> : null}</svg>
        <div className={`${s.amath} ${arrow && battle ? s.show : ""}`} aria-hidden="true" style={arrow ? { left: arrow.mx, top: arrow.my } : undefined} data-testid="battle-math">{battle ? <><em>{battle.attackerAtk ?? "?"}</em> vs <em>{battle.direct ? "direct" : battle.targetValue ?? "?"}</em> → <s>{battle.result}</s></> : null}</div>
        {attack && battle && (webcamOnly || boardHidden(attack.attackerSeat) || boardHidden(attack.targetSeat)) ? <div className={s.wcbattle} role="status" aria-live="polite" data-testid="wc-battle"><b>{battle.title}</b> <em>{battle.attackerAtk ?? "?"}</em> vs <em>{battle.direct ? "direct" : battle.targetValue ?? "?"}</em> → <s>{battle.result}</s></div> : null}
        {seatIds.map(seat => {
          const twin = state.seats[seat]?.twin ?? []; const bot = !!room.seats.find(item => item.seat === seat)?.bot;
          const registration=room.seats.find(item=>item.seat===seat),deck=registration?.deck?.deck;
          const plate = !!picking && seat !== picking.seat && !state.seats[seat].eliminated;
          const direct = !solo && mySeat >= 0 && myTurn && live && state.phase === "battle" && !state.attack && seat !== mySeat && !state.seats[seat].eliminated ? { atk: directAtk } : undefined;
          return <SeatPanel key={seat} index={seat} seat={seat} focus={seatFocus(seat)} name={name(seat)} onRescan={seat !== mySeat && mySeat >= 0 && !solo && !isTournamentTable(room) && room.seats.find(item => item.seat === seat)?.userId != null ? () => hub.requestRescan(seat).then(rescanText) : undefined} color={COLORS[seat]} you={seat === mySeat} turn={seat === turnShown} next={seat === nextSeat && seatCount > 2}
            speaking={seat === mySeat && voice.speaking} frozen={hub.health(seat).label === "Frozen"} eliminated={!!state.seats[seat]?.eliminated} lp={lpOf(seat)} startingLp={startingLp}
            health={hub.health(seat)} healthOpen={layers.layer === "log" && drawerTab === "info"} onHealth={el => openDrawer("info", el)}
            marks={marks[seat] ?? []} reticles={reticles[seat] ?? []} onBegin={beginRead} readLive={readLive} onAbort={abortRead} onMiss={noCard} onSearch={searchHere} onPoint={(sd, x, y, point) => void startRead(sd, x, y, { point })} onSelect={(sd, hit) => void startRead(sd, hit.x, hit.y, { hit })}
            holdSelection={(layers.layer === "tray" || layers.layer === "card") && ctx.current?.seat === seat} onAdd={mark => void addToDeck(seat, mark.cardCode)} onReset={resetFeed} onReadBoard={readBoardInto} prereadScope={prereadScope}
            twin={twin} deckRegistered={!!(registration?.deckRegistered??registration?.deck)} deckListSizes={deck?{deck:deck.main.length,extra:deck.extra.length}:undefined} info={info} extraZones={extraZones} facing={facing(seat)} boardSeats={state.seats} owners={state.seats.map(item => ({ seat: item.seat, name: name(item.seat), color: COLORS[item.seat] }))} rv={rv[seat] ?? "m1"} onRv={key => setRv(old => ({ ...old, [seat]: key }))} picking={!!picking && seat !== picking.seat}
            selectedRef={picking?.seat === seat ? picking.ref : selected?.seat === seat ? selected.ref : undefined} targetRef={attack?.targetSeat === seat ? attack.targetCardRef : undefined} freshRef={fresh}
            warnRefs={warnRefs(seat)} twinCounts={twinCounts(seat)} pickPlate={plate} direct={direct} tournamentTable={isTournamentTable(room)} detectionMode={seat !== mySeat ? stateMode(room.state, seat) ?? "unknown" : undefined} viewScope={String(seatCount)} webcamOnly={seatWebcam(seat)} onBoard={!multi ? on => setSeatBoard(seat, on) : undefined} onDock={onSeatDock} boardOff={boardOff(seat) ? {} : undefined}
            onZoneCard={onZoneCard} onCamPick={onCamPick} hoverTip={hoverTip} onHoverEnd={clearCamHover} onCardMenu={onCardMenu}
            tokenSlots={tokens.placing && !state.seats[seat]?.eliminated ? tokens.openSlots(seat) : control.giveSlots(seat)} onActivate={(key, card) => { if (tokens.placeAt(seat, key, card) || control.giveAt(seat, key, card)) return; if (picking && card && seat !== picking.seat && (card.zone === "monster" || card.zone === "extra-monster")) void declare(seat, card.ref); else if (!picking && (solo || seat === mySeat) && !isPile(key)) openZonePicker(seat,key); else if (!picking && !card && (/^m[1-5]$/.test(key) || control.canGive && /^s[1-5]$/.test(key))) openZonePicker(seat,key,undefined,true,false,true); else if (card) openSubject(card); }}
            onAttack={(_key, card) => startAttack(seat, card)} onInspect={card => openSubject(card)} onPile={(zone, opener) => openPile(seat, zone, opener)} onDeck={(solo || seat === mySeat) && surrenderable(seat) ? el => { setDeckAt({ seat, rect: el.getBoundingClientRect() }); layers.toggle("deck", el); } : undefined} live={live} drag={fieldDrag(seat)} onPlate={() => { if (plate) void declare(seat); }}
            onLp={delta => void changeLp(seat, delta)} canLp={live} deckWarning={deckFlag(room, seat)?.message} onDeckFlag={el => { setFlagSeat(seat); layers.toggle("flag", el); }}
            hand={handOf(seat)} thinkingSince={thinking.get(seat)}
            cameraSetup={cameraSetup} onToken={live && mySeat >= 0 ? () => void tokens.create(seat) : undefined}
            track={<PhaseTrack seat={seat} name={name(seat)} turn={seat === turnShown} phase={state.phase} canAct={live && myTurn && !state.attack} onPick={phaseAsk.pick} />} turnIn={turnIn && seat === turnShown}
            emptyFeedAction={seat === mySeat && !hub.cameraOn && !hub.starting ? <button type="button" className={`${s.btn} ${s.sm} ${s.go}`} onClick={event => { event.stopPropagation(); void (hub.manual(seat) ? hub.useWebcam() : hub.enableCamera()); }} data-testid="camera-on-feed">Turn camera on</button> : undefined}
            emptyFeedText={hub.manual(seat) ? `No camera (manual). Use ${voiceRecognition ? "voice, " : ""}typing and your board twin.` : hub.health(seat).label === "Scan mode" ? "Scan mode · follow the board twin and log." : bot ? "Test opponent. No camera." : seat === mySeat ? (hub.starting ? "Starting your camera…" : "Your camera is off.") : `Waiting for ${name(seat)}'s camera.`} />;
        })}
      </main>
      <BottomBar players={players} turnSeat={turnShown} turn={state.turn} phase={state.phase} canAct={live && myTurn && !state.attack && !ownFirstPending} nextSeat={nextSeat} passHot={state.phase === "end"} mine={!solo && mySeat === turnShown} turnIn={turnIn}
        backTo={previousYgoPhase(state)} ask={phaseAsk.ask} onAsk={phaseAsk.setAsk} onAskYes={id => { phaseAsk.setAsk(null); phaseBack(id); }} onAskNo={() => phaseAsk.setAsk(null)} onPass={passTurn} dockRef={dockRef}
        undo={{ spokenUndo: false, recognition: voiceRecognition, label: undoText, enabled: canUndo, reason: newestUndo?.reason, flash, histOpen: layers.layer === "hist", onUndo: () => void doUndo(), onHist: el => layers.toggle("hist", el) }}
        center={<>
          {live && mySeat >= 0 && !multi ? <button type="button" className={`${s.btn} ${s.sm} ${s.q} ${s.myfield}`} onClick={() => { setWebcamOnly(false); document.querySelector(`[data-testid="field-${mySeat}"]`)?.scrollIntoView?.({ block: 'center' }); }}>My field</button> : null}
          {live && (solo || mySeat >= 0) ? <CoinDieControl onRoll={rollNow} /> : null}
          {signalShown ? <div className={s.signals}>
            <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} aria-pressed={thinkOn} onClick={event => { thinkNow(); event.currentTarget.blur(); }} title="Thinking: tell the table you are deciding. Press again to cancel. No time limit." data-testid="think-button">{thinkOn ? "Thinking…" : "Think"} <kbd>T</kbd></button>
            <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={event => { okNow(); event.currentTarget.blur(); }} title="OK: no response" data-testid="ok-button">OK <kbd>Space</kbd></button>
          </div> : null}</>}
        onSurrender={canSurrender ? el => openLeave("game", el) : undefined} onQuit={canQuit ? el => openLeave("match", el) : undefined}
        voice={micSection ? { state: micState, muted, onMute: () => setMuted(v => !v), level: voice.level, recognition: voiceRecognition, proposal: !!chip, onOpenSettings: () => openDrawer("settings"), details:
          <VoxSection recognition={voiceRecognition} transcript={shownTranscript} proposal={chip} samples={voiceRecognition ? [...voiceCommands] : []} onConfirm={() => { chip?.run(); setProposal(null); }} onCancel={cancelChip}
            onSample={text => apply(interpret(text, voiceContext()), text, `sample-${Date.now()}`)} /> } : null} />
    </div>

    {/* Loads the saved feedback choice when the table mounts (the admin capture switch needs it before any drawer opens) and shows the first-time consent as a small card, not in the drawer. */}
    {!solo ? <div className={s.consentCard} data-testid="feedback-consent"><VisionFeedbackSetting promptOnly loadOnly onChange={onFeedbackPref} /></div> : null}
    <IdleBanner closesAt={room.status === "active" && room.idleWarningAt !== null ? room.lastEventAt + REMOTE_IDLE_CLOSE_MS : null} now={serverNow()} onStay={() => void remoteApi(`/${room.slug}/activity`, {}).catch(() => {})} />
    <TableDrawer open={layers.layer === "log"} tab={drawerTab} onTab={setDrawerTab} onClose={() => layers.close("log")} admin={showAdmin}
      log={{ turns: logTurns, voiceFilter: voiceRecognition, color: seat => COLORS[seat] ?? "var(--ink)", onCard: previewLogCard, onAddToDeck: (seat, id) => void addToDeck(seat, id), adding: false,
        undo: { label: undoText, enabled: canUndo, reason: newestUndo?.reason, onUndo: () => void doUndo() } }}
      info={{ format: formatLabel, game: match.bestOf > 1 ? `Game ${match.games.length + 1} of ${match.bestOf}` : "Single game", time: <DuelTimer startedAt={room.startedAt} endedAt={room.endedAt} />, startingLp,
        order: players.map(p => ({ seat: p.seat, name: p.name, color: p.color, turn: p.seat === turnShown, lp: lpOf(p.seat), note: p.seat === turnShown ? "Turn" : p.seat === nextSeat ? "Next" : "" })),
        feeds: healthRows.map(row => ({ ...row, color: row.color, mode: isTournamentTable(room) && row.seat !== mySeat ? stateMode(room.state, row.seat) ?? "unknown" : undefined })), extras,
        declare: declareResult,
        extra: !solo && !adminAccess ? <VisionFeedbackSetting promptOnly onChange={onFeedbackPref} /> : undefined }}
      settings={<SettingsTab room={room}
        voice={voiceRecognition ? { mics: mic.devices, micId: mic.micId, onMic: mic.pickMic, ptt, onPtt: on => { setPtt(on); setHeld(false); }, recognition: voiceRecognition,
          method: <VoiceControls method={voice.method} onMethod={method => { setProposal(null); voice.pickMethod(method); }} logging={room.voiceDiagnosticsEnabled === true && !muted && live} last={diagnostics.last} recentIds={diagnostics.recentIds} onMark={diagnostics.mark} /> } : null} />}
      adminPanel={<AdminTab room={room} isAdmin={adminAccess === true} />} />
    <LogCardPreview card={layers.layer === "log" && drawerTab === "log" ? logCard : null} onClose={() => setLogCard(null)} />
    {zonePicker && layers.layer === 'zone' && live && (solo || zonePicker.seat === mySeat || zonePicker.tokenOnly) ? <ZoneActions key={zonePicker.requestId} tokenOnly={zonePicker.tokenOnly} room={room} seat={zonePicker.seat} zone={zonePicker.key} targetRef={zonePicker.targetRef} initialFaceUp={zonePicker.initialFaceUp} startPicker={zonePicker.startPicker} at={{anchor:zoneRect(zonePicker.seat,zonePicker.key),feed:null}} deck={deckIdsOf(room,zonePicker.seat)} busy={zoneBusy} error={zoneError} onPick={pick => void placeInZone(pick)}
      onAction={action => void saveZoneActions(latest => [zoneCardAction(latest, zonePicker.key, action)], action.type === 'twin.counters')} onSet={() => { const ref = crypto.randomUUID(); void saveZoneActions(latest => [zoneSet(latest, zonePicker.seat, zonePicker.key, ref)]); }}
      onToken={() => tokens.create(zonePicker.seat, /^m[1-5]$/.test(zonePicker.key) && !cellsFor(state.seats[zonePicker.seat].twin, extraZones)[zonePicker.key]?.card ? zonePicker.key : undefined)}
      onGive={zonePicker.tokenOnly && control.canGive ? () => control.giveHere(zonePicker.seat, zonePicker.key) : undefined}
      onDetails={card => openSubject(card)} quick={quickFor(zonePicker.seat, cellsFor(state.seats[zonePicker.seat].twin, extraZones)[zonePicker.key]?.card, true)}
      onWrong={card => { const code = cardCode(card); if (code) wrongCard({ from: "board", cardId: code, seat: zonePicker.seat, ref: card.ref, name: card.name, notInDecklist: null, addErrors: [], via: "field" }, { anchor: zoneRect(zonePicker.seat, zonePicker.key), feed: null }); }}
      onClose={() => layers.close('zone')} /> : null}
    <InspectorDrawer open={layers.layer === "insp"} onClose={() => layers.close("insp")}>
      <InspectorBody subject={subjectDetails} info={subjectInfo} warning={subject ? deckFlag(room, subject.seat)?.message : undefined} actions={shownActions}
        sourceLine={subject ? `Identified by ${subject.via} on ${name(subject.seat)}'s side` : ""} />
    </InspectorDrawer>
    <DeckFlagPopover open={layers.layer === "flag"} flag={deckFlag(room, flagSeat)} instances={room.state.deckChecks?.instances ?? []} canMerge={live && (solo || flagSeat === mySeat)} busy={!live}
      onDismiss={flag => { void act({ type: "deck.flag.dismiss", actorSeat: flagActor, flagId: flag.id, reason: "Player marked this flag as wrong" }); layers.close("flag"); }}
      onMerge={(flag, keep, remove) => { void act({ type: "twin.merge", actorSeat: solo ? flag.seat : mySeat, seat: flag.seat, keepInstanceId: keep, removeInstanceId: remove, reason: "Same physical card; system split the instance" }); layers.close("flag"); }}
      onClose={() => layers.close("flag")} />
    <DeckMenu open={layers.layer === "deck" && !!deckAt && surrenderable(deckAt.seat)} anchor={deckAt?.rect ?? null} deckCards={deckAt ? state.seats[deckAt.seat]?.twin.filter(card => card.zone === "deck").length ?? 0 : 0}
      onView={() => { if (deckAt) openPile(deckAt.seat, "deck", null); }} onSurrender={() => { setSurrenderPick(deckAt?.seat ?? null); layers.open("surrender"); }} />
    <SurrenderConfirm open={layers.layer === "surrender" && (leaveMode === "match" ? canQuit : canSurrender)} mode={leaveMode} game={match.games.length + 1} bestOf={match.bestOf} seatCount={seatCount} solo={solo} endsMatch={surrenderEndsMatch} name={name(surrenderSeat)} busy={matchBusy}
      onConfirm={() => { layers.close(); if (leaveMode === "match") quit(); else surrender(); setSurrenderPick(null); }} onCancel={() => { layers.close(); setSurrenderPick(null); }} />
    <HistoryPopover open={layers.layer === "hist"} items={history} style={{ right: 16, bottom: "calc(var(--dock) + 8px)" }} onUndo={id => { const entry = ownUndo.find(item => item.actionId === id); if (entry) { void doUndo(entry); if (!entry.reason) layers.close("hist"); } }} />
    {pile && state.seats[pile.seat] ? <PileViewer fieldHidden={boardHidden(pile.seat)} seat={pile.seat} name={name(pile.seat)} mine={live && (solo || pile.seat === mySeat)} twin={state.seats[pile.seat].twin} zone={pile.zone}
      onZone={zone => setPile({ seat: pile.seat, zone })} info={info} drag={fieldDrag(pile.seat)} onOpenCard={(card, anchor) => openSubject(card, "pile", anchor)} onClose={() => layers.close()}
      {...(live && (solo || pile.seat === mySeat) ? {
        onOrder: (zone, cardRefs) => act({ type: "pile.order", actorSeat: solo ? pile.seat : mySeat, seat: pile.seat, zone: zone as "graveyard" | "banished", cardRefs }),
        onName: (card, cardId, cardName) => void act({ type: "card.identified", actorSeat: solo ? pile.seat : mySeat, seat: pile.seat, cardId, name: cardName, source: "typed", cardRef: card.ref }),
        onRemove: card => void act({ type: "twin.remove", actorSeat: solo ? pile.seat : mySeat, seat: pile.seat, cardRef: card.ref, cam: playerStamp("popup-remove") }),
      } : {})} /> : null}
    {layers.layer === "card" && subjectDetails ? <CardPopover subject={subjectDetails} info={subjectInfo} at={popAt} warning={deckFlag(room, subjectDetails.seat)?.message} actions={shownActions} onClose={() => layers.close("card")} /> : null}
    {tray ? <RecognitionTray dock={seatDocks[tray.seat] ?? null} key={readCounter.current} tray={tray} aiAllowed={aiAllowed} onClose={closeTray} onRemovePlaced={ref => { void act({ type: "twin.remove", actorSeat: solo ? tray.seat : mySeat, seat: tray.seat, cardRef: ref, cam: playerStamp("popup-remove") }); closeTray(); setSubject(null); }} saying={false}
      inDeck={id => { const flag = flagFor(tray.seat, id); return flag === null ? null : !flag; }} onPick={pick => { if (tray.intent === "hand") { addToHand(tray.seat, { cardId: pick.cardId, name: pick.name }, tray.originId ? tray.source ?? "deck" : "unknown", tray.by, tray.originId); closeTray(); return; } void identify(pick, pick.via === "typed" ? "typed" : pick.via); }} /> : null}
    {layers.layer==="effect" && effectOrigin ? (()=>{
      const origin=state.effectTracking?.origins.find(o=>o.id===effectOrigin);
      if(!origin) return null;
      return <EffectPicker origin={origin} showCardsSetFromDeck={room.showCardsSetFromDeck!==false} at={popAt}
        alternatives={(state.effectTracking?.origins ?? []).filter(o=>o.seat===origin.seat && o.destination===origin.destination && state.seats[o.seat].twin.some(c=>c.ref===o.ref && !c.faceUp)).map(o=>({id:o.id,label:`Set by ${o.source.name} · ${state.seats[o.seat].twin.find(c=>c.ref===o.ref)?.zone} ${state.seats[o.seat].twin.find(c=>c.ref===o.ref)?.slot ?? ""}`}))}
        onOrigin={setEffectOrigin}
        onActivate={origin.destination==="set" && origin.chosenCardId ? ()=>{void act({type:"effect.activated",actorSeat:origin.seat,source:{cardId:origin.chosenCardId,cardRef:origin.ref}}).then(done=>{if(done) layers.close("effect");});} : undefined}
        onClose={()=>layers.close("effect")}
        onPick={id=>{void act({type:"effect.choose",actorSeat:origin.seat,originId:origin.id,cardId:id}).then(done=>{if(done) layers.close("effect");});}}
        onReveal={origin.destination==="set" && origin.chosenCardId ? ()=>{void act({type:"twin.flip",actorSeat:origin.seat,seat:origin.seat,cardRef:origin.ref,faceUp:true});layers.close("effect");} : undefined}
        onRecognize={origin.destination==="set" || room.showCardsSetFromDeck!==false ? ()=>{
          void (async()=>{
            if(origin.destination==="hand" && !R.current.state.seats[origin.seat].twin.some(c=>c.ref===origin.ref)) {
              const done=await act({type:"twin.place",actorSeat:origin.seat,seat:origin.seat,zone:"hand",card:{ref:origin.ref,faceUp:false,position:"attack"}});
              if(!done) return;
            }
            ctx.current={seat:origin.seat,x:ctx.current?.x ?? .5,y:ctx.current?.y ?? .5,at:popAt,id:++readCounter.current,cardRef:origin.ref};
            setTray({seat:origin.seat,ownerName:name(origin.seat),status:"empty",guesses:[],note:"Select the shown card. Its identity will be public.",reader:"",at:popAt});layers.open("tray");
          })();
        } : undefined} />;
    })() : null}
    {live ? <DeclarePending match={match} mySeat={mySeat} seats={seatIds} name={name} /> : null}
    <DeclareConfirm match={match} mySeat={mySeat} name={name} busy={matchBusy} onAnswer={(declarationId, accept) => matchStep({ type: "match.confirm", actorSeat: mySeat, declarationId, accept })} />
    {match.phase === "done" && boardView ? <button type="button" className={matchStyles.reopen} onClick={() => setBoardView(false)} data-testid="match-show-result">Show result</button> : null}
    {(match.phase === "result" && room.status === "active") || (match.phase === "done" && !boardView)
      ? <MatchResultScreen room={room} match={match} mySeat={leftMatch ? -1 : mySeat} name={name} final={match.phase === "done"} busy={matchBusy} error={overlayError}
        tournamentResult={tournament ? <RemoteResultSlot tournamentSlug={tournament.tournamentSlug} tournamentMatchId={tournament.tournamentMatchId} pair={tournament.pair} viewerId={tournament.viewerPlayerId} /> : null}
        undo={canUndo && mySeat >= 0 && !newestUndo?.reason ? { label: undoText, onUndo: () => void doUndo() } : null}
        rematch={mySeat >= 0 && !leftMatch && !solo && !tournament ? { busy: ctl.busy, onAnswer: answer => void ctl.operation("rematch", { answer }) } : null}
        onContinue={() => matchStep({ type: "match.continue", actorSeat: matchSeat })} onLeave={() => router.push(tournament ? `/tournament/${encodeURIComponent(tournament.tournamentSlug)}` : "/duels")} onClose={() => setBoardView(true)} />
      : match.phase === "siding" && match.siding && room.status === "active"
        ? <SidingScreen room={room} match={match} mySeat={leftMatch ? -1 : mySeat} name={name} now={serverNow} act={act} error={overlayError} /> : null}
    {match.phase === "duel" && match.opening && (match.opening.chosenSeat === undefined || match.opening.auto) && !state.ended && room.status === "active"
      ? <OpeningRollScreen opening={match.opening} mySeat={mySeat} name={name} now={serverNow} act={mySeat >= 0 ? act : undefined} out={state.seats.map(seat => !!seat.eliminated)} error={overlayError} onCover={setOpeningCovers} /> : null}
    {room.status === "active" && ((openingShown && openingCovers) || match.phase === "result" || (match.phase === "siding" && match.siding))
      ? <LeaveDock onSurrender={openingShown && openingCovers && canSurrender ? () => { setSurrenderPick(null); setLeaveMode("game"); layers.open("surrender"); } : undefined}
        onQuit={canQuit ? () => { setLeaveMode("match"); layers.open("surrender"); } : undefined} /> : null}
    <Peek peek={peek} />
    {tokens.node}
    {control.node}
    {nextStep.node}
    {/* A drawer or pile covers the stack, so a toast leaves it and stays readable. */}
    <Toasts items={toastItems} dock={layers.layer && layers.layer !== "card" && layers.layer !== "tray" ? null : seatDocks[mySeat] ?? null} top={layers.layer === "pile"} />
    <HandActivation events={room.events} name={name} />
    {activateRow ? <ActivateRow cards={activateRow.cards} info={info} onPick={card => pickFromRow(activateRow.seat, card)} onClose={() => setActivateRow(null)} /> : null}
    <ChainBadges marks={chainMarks} />
    <RemoteFx state={state} webcamOnly={webcamOnly} hiddenSeats={seatIds.filter(boardHidden)} seq={room.lastSeq} last={room.events.find(event => event.seq === room.lastSeq)?.action} chainNo={chain.links.get(room.events.find(event => event.seq === room.lastSeq)?.id ?? "")?.n} />
  </div></FeedCardsProvider>;
}
