"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { REMOTE_FORMATS, REMOTE_HAND_SUGGESTION_EVENT, type RemoteHandSuggestionEvent, matchCardsByName, previousYgoPhase, normalizeRemoteFormat, remoteRecognitionRef, remoteRecognitionRefs, type RemoteActionProposal, type RemoteEvent, type RemoteRoom, type RemoteUndoEntry } from "@yugidraft/shared/remote";
import { cardInfo, isMonsterInfo, loadCards, searchCards, useCardInfo } from "./catalog";
import { EffectControls, EffectPicker } from "./effect-controls";
import { Rail, LpStrip, TopBar, type Player } from "./chrome";
import { CardPopover, InspectorBody, type CardActions, type CardEdit, type Subject } from "./card-view";
import { MicSection, UndoSection, VoxSection, type Proposal } from "./dock";
import { describeEvent, undoLabel, type LogKind } from "./describe";
import { ownUndoEntries, phaseBackAction, shortUndoLabel } from "./undo-ui";
import { DeckFlagPopover } from "./deck-flag";
import { Banner, HealthPopover, IdleBanner, HistoryPopover, InspectorDrawer, LogDrawer, Peek, Toasts, type LogEntry, type PeekState, type ToastItem } from "./drawers";
import type { BoardReading, FeedHit, FeedMark, FeedPoint, FeedReticle, FeedStart } from "./feed";
import type { PopAt, Rect, Tier } from "./popup";
import { interpret, suggestCommands, trySaying, type MoveIntent, type VoiceIntent } from "./grammar";
import type { FieldDrag } from "./holo-field";
import { judgeMove, landingForCell, landingLabel, type Landing } from "./placement";
import { announceManualMove } from "@/lib/remote/manual-moves";
import { COLORS, battleMath, cardCode, cellsFor, isPile, sameObservedCard, cardName, cellKeyOf, deckFlag, deckIdsOf, facingSeat, foundationZone, hasDeck, hasExtraZones, mirrorEmz, PHASES, PHASE_LONG, readCardOf, voiceCardNames, placedTwin, sg, type TwinCard, type ZoneKey } from "./model";
import { findTwinGroups } from "./twins";
import { PileViewer, type PileZone } from "./pile-viewer";
import { NotifyDock } from "./notify-dock";
import { RecognitionTray, type Pick, type TrayState } from "./recognition-tray";
import { VisionFeedbackSetting } from "@/components/settings/vision-feedback-setting";
import { isBestMatch, setFeedbackCapture, type FeedbackSource } from "./recognizer";
import { SeatPanel } from "./seat-panel";
import { RemoteFx } from "./remote-fx";
import { useLayers } from "./use-layers";
import { remoteApi, serverNow } from "./api";
import { useRemoteRoom, type RoomController } from "./use-remote-room";
import { useVoice, type MicState } from "./use-voice";
import { mentionVoiceCard } from '@/lib/remote/recognition-priors';
import type { SttFinal } from "./stt-client";
import { VideoHubProvider, useVideoHub } from "./video-hub";
import { takeCameraReady } from "./camera-choice";
import { RemoteLobbyRoom } from "./lobby";
import { CameraSettingsMore } from './camera-lock-control';
import { duelFontClasses } from "@/components/duel/fonts";
import type { FeedbackPreference } from "@/components/settings/vision-feedback-setting";
import { Icon } from "./icons";
import { DeclareConfirm, DeclarePending, MatchResultScreen, SidingScreen, declareChoices } from "./match-ui";
import { matchOf } from "./match-model";
import { PhonePairing } from "../phone/pairing";
import { PhoneScanReview } from "../phone/scan-review";
import s from "./remote-ui.module.css";
import matchStyles from "./match-ui.module.css";

const WEBCAM_ONLY_KEY = "dd-remote-webcam-only";
import {publicTrackedTwin, trackedRereadTarget} from '@/lib/remote/field-track-cache';
import { AutoFieldWatcher } from "../field-watcher";
import {manualFieldZoneWarning,projectFieldZone,becomesTrapMonster,equipSourceOnField,fieldZoneCheck} from '@/lib/remote/field-legality';
import {fieldZoneAt,fieldZoneLocation,mapFieldZone,onMat,type FieldFormat} from '@yugidraft/vision';
import {useZoneGrid,currentZoneGrid,setFieldDeveloper,runFieldScan} from '@/lib/remote/zone-grid';
import {distinctFieldQuads,fieldReadingPlaceholder,rememberFieldObservation} from '@/lib/remote/field-proposals';
import { useCardMenu } from "./card-menu";
import { handAdd, handCount, handCountOf, handReveal, knownHandOf, openSearch, SEARCH_WINDOW_MS, type HandBy, type HandCandidate, type HandSource, type HandSuggestion, type KnownHandCard } from "./reveal-model";
import type { HandProps } from "./hand-ui";
import { ThemedSelect } from "@/components/ui/themed-select";
import { isTypingTarget } from "@/lib/typing-target";
const REMOTE_IDLE_CLOSE_MS = 10 * 60_000; // the server closes a table after 10 idle minutes (shared services constant)

const MARK_LIFE_MS = 4000; // an outline and its label on the feed fade after this, unless its popup is open
const WAKE_MS = 8000;
const fmtTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const typing = isTypingTarget;

type ReadCtx = { cardRef?: string; seat: number; x: number; y: number; quad?: { x: number; y: number }[]; at: PopAt; id: number; ref?:string; frozenFrame?:HTMLCanvasElement; copyWitnesses?:FeedHit["copyWitnesses"]; capturedAt?:number; tier?: Tier; covered?: boolean; token?: number };
type Pending = Proposal & { requestId?: string; run: () => void };

/** Entry point of /duels/remote/[slug]: the lobby room before the start, the table after it. */
export function RemoteTableScreen({ slug }: { slug: string }) {
  const ctl = useRemoteRoom(slug);
  const room = ctl.room;
  const isDeveloper = room?.isDeveloper === true;
  useEffect(() => { setFieldDeveloper(isDeveloper); return () => setFieldDeveloper(false); }, [isDeveloper]);
  if (!room) return <div className={`${duelFontClasses} ${s.app}`} data-mode="1v1"><div className={s.shell} style={{ display: "grid", placeItems: "center", alignContent: "center", gap: 12 }}>
    <p role="status" style={{ color: "var(--ink2)" }}>{ctl.loadError ? `${ctl.loadError.message}. Join an open seat to enter.` : "Loading table…"}</p>
    {ctl.loadError ? <button type="button" className={`${s.btn} ${s.go}`} disabled={ctl.busy} onClick={() => void ctl.operation("seat")}>Join available seat</button> : null}
    {ctl.error ? <p role="alert" style={{ color: "var(--loss)" }}>{ctl.error}</p> : null}</div></div>;
  return <VideoHubProvider room={room}>{room.status === "lobby" ? <RemoteLobbyRoom ctl={ctl} room={room} /> : <Table ctl={ctl} room={room} />}<PhoneScanReview ctl={ctl} room={room} /></VideoHubProvider>;
}

/** One row under the video: phone pairing, no-camera mode, camera choice and camera off. Icons with labels; the labels drop out when the row is narrow. */
function CameraControl({room}: {room:RemoteRoom}) {
  const hub = useVideoHub();
  const leave = hub.phones.some(p => p.seat===room.mySeat) ? "Leave table video" : "Camera off";
  return <div className={s.camsel} data-testid="camera-row"><PhonePairing room={room} />
    {hub.cameraOn && hub.devices.length > 1 ? <ThemedSelect variant="menu" label="Choose camera" placeholder="Choose camera" value={hub.cameraId} testId="camera-choice"
      choices={hub.devices.map(device => ({ value: device.deviceId, label: device.label || "Camera" }))} onChange={id => void hub.selectCamera(id)} /> : null}
    <CameraSettingsMore lock={hub.cameraLock} />
    {hub.cameraOn ? <button type="button" className={`${s.btn} ${s.sm} ${s.q} ${s.cbtn}`} aria-label={leave} title={leave} onClick={() => void hub.disableCamera()}><Icon name="camoff" /><span data-lbl>{leave}</span></button> : null}
  </div>;
}

/** One plain sentence on why a table ended. */
function endedWhy(room: RemoteRoom, winner: string | null) {
  if (room.endReason === "idle") return "It closed after 10 minutes without activity.";
  if (room.endReason === "creator-left") return "The host left the lobby.";
  return winner ? `${winner} won.` : "The game is over.";
}

function Table({ ctl, room }: { ctl: RoomController; room: RemoteRoom }) {
  const hub = useVideoHub();
  const layers = useLayers();
  const state = room.state; const mySeat = room.mySeat; const solo = room.solo;
  const match = matchOf(room); const inMatchBreak = match.phase !== "duel";
  const live = room.status === "active" && !state.ended && !inMatchBreak;
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
  const twinCodes = state.seats.flatMap(item => item.twin.map(cardCode));
  const deckCodes = seatIds.flatMap(seat => deckIdsOf(room, seat));
  const [subject, setSubject] = useState<Subject | null>(null);
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
  // A webcam player whose lobby preview worked gets the table camera without another click.
  const handoff = useRef(false);
  useEffect(() => {
    if (handoff.current || !live || !hub.rosterReady) return;
    handoff.current = true;
    if (!takeCameraReady(room.slug) || hub.manual(mySeat) || hub.phones.some(item => item.seat === mySeat) || hub.cameraOn) return;
    void hub.enableCamera();
  }, [live, hub, room.slug, mySeat]);

  const seen = useRef<{ phase: string; turn: number; seat: number } | null>(null);
  const [turnIn, setTurnIn] = useState(false);
  useEffect(() => {
    const before = seen.current; seen.current = { phase: state.phase, turn: state.turn, seat: state.turnSeat };
    if (!before || !live) return;
    if (before.turn !== state.turn || before.seat !== state.turnSeat) {
      setBanner({ id: Date.now(), small: `Turn ${state.turn} · ${PHASE_LONG[state.phase] ?? state.phase}`, big: `${name(state.turnSeat)}'s turn` });
      showPeek("PH", <>Turn passed to <b>{name(state.turnSeat)}</b></>);
      setTurnIn(true); const timer = setTimeout(() => setTurnIn(false), 1400); return () => clearTimeout(timer);
    } else if (before.phase !== state.phase) {
      setBanner({ id: Date.now(), small: `${name(state.turnSeat)} · Turn ${state.turn}`, big: PHASE_LONG[state.phase] ?? state.phase });
      showPeek("PH", <><b>{name(state.turnSeat)}</b> to <b>{PHASE_LONG[state.phase] ?? state.phase}</b></>);
    }
  }, [state.phase, state.turn, state.turnSeat, live, name, showPeek]);

  // ---- log ----
  const [voiceLog, setVoiceLog] = useState<LogEntry[]>([]);
  const firstSeq = useRef(room.lastSeq);
  const entries = useMemo<LogEntry[]>(() => {
    const described = [...room.events].sort((a, b) => b.seq - a.seq).flatMap(event => {
      const line = describeEvent(event, name, nameOfCard, refNameOf); return line ? [{ id: event.id, time: fmtTime(event.at), kind: line.kind, text: line.text, fresh: event.seq > firstSeq.current, at: event.at }] : [];
    });
    return [...described, ...voiceLog.map(entry => ({ ...entry, at: Number(entry.id.split(":")[1]) }))].sort((a, b) => b.at - a.at).map(({ at: _at, ...entry }) => entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.events, voiceLog, name, info]);
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
  const act = useCallback(async(input:RemoteActionProposal)=>{
    let warning:string|undefined,proposal=input;
    if(input.type==='twin.move'){
      const card=R.current.room.state.seats[input.seat]?.twin.find(item=>item.ref===input.cardRef),code=card?cardCode(card):undefined;
      const twins=R.current.room.state.seats[input.seat]?.twin??[];
      if(input.source!=='auto')warning=manualFieldZoneWarning(cardInfo(code),input.zone,input.slot,{faceDown:input.faceUp===false||input.faceUp===undefined&&card?.faceUp===false,equipSource:equipSourceOnField(twins,c=>cardInfo(cardCode(c)))});
      // A Trap moved from S/T to a Monster Zone is a Trap Monster: it keeps its S/T zone (docs/remote-duels/zone-rules.md).
      if(input.trapMonster===undefined&&becomesTrapMonster(card,cardInfo(code),input.zone))proposal={...input,trapMonster:true};
    }
    const quiet=proposal.type==='side.timeout';
    if(quiet)quietError.current=true;else setOverlayError(null);
    const updated=await ctl.action(proposal);
    if(quiet)setTimeout(()=>{quietError.current=false;},150);
    if(updated&&warning)toast(warning,5000);
    return updated;
  },[ctl.action,toast]);
  const setPhase = (phase: string) => { if (live && myTurn) void act({ type: "phase.set", actorSeat: turnActor, phase }); };
  const phaseBack = (phase: string) => { if (live && myTurn) void act(phaseBackAction(turnActor, phase)); };
  const passTurn = () => { if (live && myTurn) void act({ type: "turn.end", actorSeat: turnActor }); };
  // ---- match: result, declare, side decking ----
  const router = useRouter();
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
  const changeLp = (seat: number, delta: number, reason = "Manual adjustment") => { if (live && delta) return act({ type: "lp.change", actorSeat: mySeat, seat, delta, reason }); return Promise.resolve(null); };
  const nextSeat = (() => { for (let i = 1; i <= seatCount; i++) { const seat = (state.turnSeat + i) % seatCount; if (!state.seats[seat]?.eliminated) return seat; } return state.turnSeat; })();
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
  // Webcam only: the virtual fields are hidden and the camera feeds get the space. Remembered in this browser only.
  const [webcamOnly, setWebcamOnlyState] = useState(false);
  useLayoutEffect(() => { try { setWebcamOnlyState(localStorage.getItem(WEBCAM_ONLY_KEY) === "1"); } catch { /* storage blocked: both views */ } }, []);
  const setWebcamOnly = useCallback((next: boolean) => {
    setWebcamOnlyState(next);
    try { if (next) localStorage.setItem(WEBCAM_ONLY_KEY, "1"); else localStorage.removeItem(WEBCAM_ONLY_KEY); } catch { /* storage blocked: not remembered */ }
  }, []);
  const flagFor = (seat: number, id: number) => hasDeck(room, seat) ? !deckIdsOf(room, seat).includes(id) : null;
  const reticle = (seat: number, next: FeedReticle | null, id: string) => setReticles(all => ({ ...all, [seat]: [...(all[seat] ?? []).filter(item => item.id !== id), ...(next ? [next] : [])] }));

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

  const identify = useCallback(async (pick: Pick, source: "click" | "auto" | "voice" | "typed") => {
    const at = ctx.current; if (!at) return;
    const { seat } = at;
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
      const physical=at.quad?.length===4&&zoneGrid.ownSeat===seat&&zoneGrid.calibration?.orientation?
        mapFieldZone({quad:at.quad,kind:'face-up',confidence:1,partial:false},zoneGrid.calibration,[],zoneGrid.format).zone:undefined;
      if(owns&&!same&&physical){const location=fieldZoneLocation(physical);same=current.state.seats[seat].twin.find(c=>c.zone===location.zone&&c.slot===location.slot&&sameObservedCard(c,{cardId:pick.cardId,name:pick.name}));}
      const reading=owns&&!same&&physical?fieldReadingPlaceholder(current.state.seats[seat].twin,physical):undefined;
      same??=reading;
      const projected=physical?projectFieldZone({zone:physical,facts:found,twins:current.state.seats[seat].twin,ref:same?.ref,format:current.state.deckChecks.format.id}):undefined;
      const mapped=projected?.zone?fieldZoneLocation(projected.zone):undefined;
      const spot=owns?(reading&&mapped?{row:mapped.zone,slot:mapped.slot,ref:reading.ref}:same?{row:same.zone,slot:same.slot,ref:same.ref}:mapped?{row:mapped.zone,slot:mapped.slot,ref:crypto.randomUUID()}:layoutFor(seat,pick.cardId,found,current)):undefined;
      if(owns&&!spot){toast('Card type or a free legal zone is unavailable. Check the card before placing it.',5000);return {updated:null,owns,ref:undefined,row:undefined,slot:undefined};}
      let updated:RemoteRoom|null=null;
      const witnesses=verifiedWitnesses?.filter(w=>sameObservedCard(w,{cardId:pick.cardId,name:pick.name})&&current.state.seats[seat].twin.some(c=>c.ref===w.ref&&['monster','spell-trap','extra-monster','field','pendulum'].includes(c.zone)))??[];
      const copyProof=witnesses.length?{simultaneousQuads:witnesses.length+1,at:Math.floor(serverNow()-999-Math.max(0,performance.now()-(at.capturedAt??performance.now())))}:undefined;
      if(owns&&spot&&!same)updated=await apply({type:'twin.place',source:'auto',actorSeat:current.solo?seat:current.mySeat,seat,zone:spot.row,...(copyProof?{copyProof}:{}),card:{ref:spot.ref,cardId:pick.cardId,name:pick.name,...(spot.slot?{slot:spot.slot}:{}),faceUp:true,position:'attack'}});
      else updated=await apply({type:'card.identified',actorSeat:current.mySeat,seat,cardId:pick.cardId,name:pick.name,source,...(spot?{cardRef:spot.ref,zone:spot.row,...(spot.slot?{slot:spot.slot}:{})}:{})});
      if(updated&&reading&&spot&&(reading.zone!==spot.row||reading.slot!==spot.slot))updated=await apply({type:'twin.move',actorSeat:current.solo?seat:current.mySeat,seat,cardRef:reading.ref,zone:spot.row,...(spot.slot?{slot:spot.slot}:{})});
      const ref=updated&&owns&&spot ? placedTwin(updated.state.seats[seat].twin,{...spot,zone:spot.row,cardId:pick.cardId})?.ref : spot?.ref;
      if(updated&&owns&&ref&&physical)rememberFieldObservation(current.slug,seat,ref,physical);
      return {updated,owns,ref,row:spot?.row,slot:spot?.slot,requestRef:spot?.ref};
    });
    const {updated,owns,ref}=outcome;
    if (!updated) { bail(); return; }
    if(owns)setFresh(ref);
    saveSample(at.token, pick.cardId, pick.feedback);
    const identified=updated.state.identified?.seat===seat&&(updated.state.identified.cardId??updated.state.identified.passcode)===pick.cardId?updated.state.identified:undefined;
    setSubject({ cardId: pick.cardId, seat, ...(at.tier ? { tier: at.tier } : {}), ...(at.covered ? { covered: true } : {}), ...(owns ? { ref } : {}), name: pick.name, notInDecklist: identified?.notInDecklist ?? flagFor(seat, pick.cardId), addErrors: identified?.addErrors ?? [], via: source });
    const not = identified?.notInDecklist ?? flagFor(seat, pick.cardId) ?? false;
    const markId = `m${at.id}`;
    // One outline per card, and one active selection at a time: a new read replaces the older outlines on this feed.
    setMarks(all => ({ ...all, [seat]: [{ id: markId, x: at.x, y: at.y, label: pick.name, notInDecklist: !!not, show: true, cardCode: pick.cardId, quad: at.quad, canAdd: owns && !(identified?.addErrors?.length) }] }));
    setTimeout(() => setMarks(all => ({ ...all, [seat]: (all[seat] ?? []).map(mark => mark.id === markId ? { ...mark, show: false } : mark) })), 2600);
    // The outline expires after a few seconds, unless the popup for this card is still open.
    const expire = () => { if (popupHeld.current === seat) { setTimeout(expire, 2000); return; } setMarks(all => (all[seat] ?? []).some(mark => mark.id === markId) ? { ...all, [seat]: (all[seat] ?? []).filter(mark => mark.id !== markId) } : all); };
    setTimeout(expire, MARK_LIFE_MS);
    setPopAt(at.at); layers.open("card");
    if(ctx.current) delete ctx.current.cardRef;
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

  /** A click landed on a live feed: the popup opens at once with its skeleton, before the card is found. */
  const beginRead = useCallback((seat: number, start: FeedStart) => {
    // On a closed table no card can be placed, so a read would end with a popup that closes by itself. Say it at once.
    const now = R.current.room;
    if (now.status !== "active" || now.state.ended) { readCounter.current++; toast("The table is closed. Cards cannot be read here.", 4200); return; }
    const id = ++readCounter.current; beginId.current = id;
    const at: PopAt = { anchor: start.anchor, feed: start.feed };
    ctx.current = { seat, x: start.x, y: start.y, at, id, ...(ctx.current?.seat===seat && ctx.current.cardRef ? {cardRef:ctx.current.cardRef} : {}) };
    setTray({ seat, ownerName: name(seat), status: "reading", guesses: [], note: "", reader: "", at });
    layers.open("tray");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, name, toast]);

  /** A click found no card. Drop the popup that opened at once; the feed shows a small "No card here" note. */
  const noCard = useCallback((seat: number) => {
    if (ctx.current?.seat === seat) delete ctx.current.cardRef;
    readCounter.current++; setTray(null); layers.close("tray");
  }, [layers]);
  /** "Search card" on that note: the popup with only the search box, at the click. */
  const searchHere = useCallback((seat: number, start: FeedStart) => {
    const id = ++readCounter.current; beginId.current = id;
    const at: PopAt = { anchor: start.anchor, feed: start.feed };
    ctx.current = { seat, x: start.x, y: start.y, at, id };
    setTray({ seat, ownerName: name(seat), status: "empty", guesses: [], note: "Search for the card or say its name.", reader: "none", at });
    layers.open("tray");
  }, [layers, name]);

  const startRead = useCallback(async (seat: number, x: number, y: number, found?: { hit?: FeedHit; point?: FeedPoint; force?:boolean;ref?:string }) => {
    let hit = found?.hit; const extra = hit ?? found?.point;
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
      toast(origins.length ? origins.map(o=>"Face-down · Set by "+o.source.name).join("; ") : "Face-down card"); layers.close(); return;
    }
    // A live click that was closed (Esc, outside press) while the card was being found is dropped.
    if (extra?.live && readCounter.current !== beginId.current) return;
    const id = ++readCounter.current; const owner = name(seat);
    const at: PopAt = { anchor: extra?.anchor ?? ctx.current?.at.anchor ?? null, feed: extra?.feed ?? ctx.current?.at.feed ?? null };
    ctx.current = { seat, x, y, quad: hit?.quad, copyWitnesses:hit?.copyWitnesses,capturedAt:hit?.capturedAt,at, id,...(ctx.current?.seat===seat && ctx.current.cardRef ? {cardRef:ctx.current.cardRef} : {}),ref:found?.ref??hit?.cached?.ref,frozenFrame:hit?.frozenFrame, ...(hit?.covered ? { covered: true } : {}) };
    if(cached){
      setTray(null);setSubject({cardId:cached.cardId,seat,ref:cached.ref,name:cached.name,bestMatch:state.seats[seat].twin.find(c=>c.ref===cached.ref)?.bestMatch,tier:state.seats[seat].twin.find(c=>c.ref===cached.ref)?.bestMatch?'not sure':'sure',notInDecklist:flagFor(seat,cached.cardId),addErrors:[],via:'tracked'});
      setSelected({seat,ref:cached.ref});setPopAt(at);layers.open('card');return;
    }
    if (extra?.live) beginId.current = id;
    if (hit?.covered) toast("This card is partly covered by another card. The read may be wrong. Check the guess.", 4200);
    const rid = `r${id}`; reticle(seat, { id: rid, x, y, state: "reading", text: "Reading…", quad: hit?.quad }, rid);
    setTray({ seat, ownerName: owner, status: "reading", guesses: [], note: "", reader: "", at });
    layers.open("tray");
    let result: Awaited<ReturnType<typeof hub.read>>;
    try { result = await hub.read(seat, x, y, hit ? readCardOf(hit) : undefined, (found?.hit?.cached&&!cached?undefined:extra?.frames),found?.force); }
    catch {
      // The read failed or was cut off. Never leave the popup on "Reading…".
      if (readCounter.current !== id) return;
      reticle(seat, { id: rid, x, y, state: "fail", text: "No match", quad: hit?.quad }, rid);
      setTimeout(() => reticle(seat, null, rid), 1800);
      setTray(old => old && readCounter.current === id ? { ...old, status: "empty", guesses: [], note: "The read did not finish. Search for the card or say its name.", reader: "none" } : old);
      return;
    }
    if (readCounter.current !== id) return;
    const top = result.guesses[0];
    if (ctx.current && ctx.current.id === id) { if (result.tier) ctx.current.tier = result.tier; ctx.current.token = result.aiToken; }
    if (result.tier === "sure" && top && result.reader === "vision" && !hit?.covered && !result.covered) {
      await loadCards([top.cardId]);
      if (readCounter.current !== id) return;
      reticle(seat, { id: rid, x, y, state: "done", text: top.name || cardInfo(top.cardId)?.name || "Card", quad: hit?.quad }, rid);
      setTimeout(() => reticle(seat, null, rid), 1500);
      setTray(old => old && readCounter.current === id ? { ...old, status: "sure", guesses: [top], note: result.note, reader: result.reader, tier: result.tier } : old);
      void identify({ cardId: top.cardId, name: top.name || cardInfo(top.cardId)?.name || `Card ${top.cardId}`, via: "click" }, "auto");
      return;
    }
    // Not sure, but the frame is sharp and the top guess clearly leads: show it as the answer. Others still see "not sure".
    const best = isBestMatch(result) && !hit?.covered;
    if (best) await loadCards([top.cardId]);
    if (readCounter.current !== id) return;
    reticle(seat, { id: rid, x, y, state: result.guesses.length ? "done" : "fail", text: best ? "Best match" : result.guesses.length ? "Which card?" : "No match", quad: hit?.quad }, rid);
    setTimeout(() => reticle(seat, null, rid), 1800);
    setTray(old => old && readCounter.current === id ? { ...old, status: result.guesses.length ? "guesses" : "empty", guesses: result.guesses, note: result.note, reader: result.reader, tier: result.tier, aiToken: result.aiToken, ...(best ? { best: true } : {}), ...(hit?.covered || result.covered ? { covered: true } : {}), ...(result.faceDown ? { faceDown: true } : {}) } : old);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, identify, layers, name, toast]);
  const closeTray = () => { if(ctx.current) delete ctx.current.cardRef; readCounter.current++; setTray(null); layers.close("tray"); };
  useEffect(() => { if (layers.layer !== "tray" && tray) { if(ctx.current) delete ctx.current.cardRef; readCounter.current++; setTray(null); } }, [layers.layer, tray]);

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
    const { room: now, state: current } = R.current; const owns = now.solo || seat === now.mySeat;
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
    const placed: { ref: string; card: (typeof fresh)[number]; zone: string; slot?: number;copyProof?:{simultaneousQuads:number;at:number} }[] = [];
    for (const card of fresh) {
      const observed=locationOf(card);
      const existing=observed?current.seats[seat].twin.find(c=>c.zone===observed.zone&&c.slot===observed.slot&&sameObservedCard(c,card)):undefined;
      const physical=calibration?.orientation?mapFieldZone({quad:card.quad,kind:'face-up',confidence:1,partial:false},calibration,[],current.deckChecks.format.id).zone:'M1';
      const projected=projectFieldZone({zone:physical,facts:cardInfo(card.cardId),twins:planned,ref:existing?.ref,format:now.format?.id??current.deckChecks.format.id});
      if(!projected.zone)continue;
      const {zone,slot}=fieldZoneLocation(projected.zone),ref=existing?.ref??`b${seat}-${card.cardId}-${placed.length}-${Date.now().toString(36)}`;
      const witnesses=sure.filter(other=>{
        if(other===card||!sameObservedCard(other,card)||!distinctFieldQuads(other.quad,card.quad))return false;
        const at=locationOf(other);
        return !!at&&onField.some(c=>sameObservedCard(c,other)&&c.zone===at.zone&&c.slot===at.slot);
      });
      const copyProof=witnesses.length?{simultaneousQuads:witnesses.length+1,at:Math.floor(serverNow()-999)}:undefined;
      if(!existing)planned.push({ref,zone,slot,cardId:card.cardId,faceUp:true,position:'attack'});
      placed.push({ref,card,zone,slot,copyProof});
    }
    const done: typeof placed = [...reveals];
    if (owns) {
      for (const item of placed) {
        const acceptedWitnesses=done.filter(previous=>previous.card!==item.card&&sameObservedCard(previous.card,item.card)&&distinctFieldQuads(previous.card.quad,item.card.quad)&&['monster','spell-trap','extra-monster','field','pendulum'].includes(previous.zone));
        const copies=Math.max(item.copyProof?.simultaneousQuads??1,acceptedWitnesses.length+1);
        const copyProof=copies>=2?{simultaneousQuads:copies,at:Math.floor(serverNow()-999)}:undefined;
        const ok = await act({ type: "twin.place", source: "auto", actorSeat: now.solo ? seat : now.mySeat, seat, zone: item.zone, ...(copyProof?{copyProof}:{}), card: { ref: item.ref, cardId: item.card.cardId, name: item.card.name ?? undefined, ...(item.slot ? { slot: item.slot } : {}), faceUp: true, position: "attack" } });
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
      await act({ type: "cards.identified", actorSeat: now.mySeat, seat, source: "auto", cards: chunk.map((item, n) => ({ observationId: `${item.ref}-${i + n}`, cardId: item.card.cardId, name: item.card.name ?? undefined, zone: item.zone, ...(item.slot ? { slot: item.slot } : {}), ...(owns ? { cardRef: item.ref } : {}) })) });
    }
    if (done.length) setFresh(done[done.length - 1].ref);
    const bits = [owns ? `${done.length} placed on ${name(seat)}'s field` : `${seenNow.length} identified. Only the field owner places cards`];
    if (onField.length !== current.seats[seat].twin.length && fresh.length < sure.length) bits.push(`${sure.length - fresh.length} already there`);
    if (unsure > 0) bits.push(`${unsure} unsure or covered, click to confirm`);
    if (hidden) bits.push(`${hidden} face-down`);
    bits.push(`${(reading.ms / 1000).toFixed(1)} s`);
    return bits.join(" · ");
  }, [act, name, hub]);

  // ---- attacks ----
  const attackBlock = (seat: number, card?: TwinCard): string => {
    if (!live) return "The table is closed."; if (!card) return "No card selected.";
    if (card.zone !== "monster" && card.zone !== "extra-monster") return "Only monsters in a monster zone can attack.";
    if (seat !== state.turnSeat) return `Only ${name(state.turnSeat)}'s monsters can attack this turn.`;
    if (!myTurn) return "Wait for your turn.";
    if (state.phase !== "battle") return "Move to the Battle Phase first.";
    if (state.attack) return "Finish the current attack first."; return "";
  };
  const startAttack = (seat: number, card: TwinCard) => {
    const block = attackBlock(seat, card); if (block) { toast(block); return; }
    layers.close(); setPicking({ seat, ref: card.ref });
    toast(<>Pick a target for <b>{cardName(card, info(cardCode(card)))}</b>. Click a monster or a name plate. <kbd>Esc</kbd> cancels.</>, 4200);
  };
  const declare = async (targetSeat: number, targetRef?: string) => {
    if (!picking) return; const at = picking; setPicking(null);
    await act({ type: "attack.declare", actorSeat: turnActor, attackerSeat: at.seat, attackerCardRef: at.ref, targetSeat, ...(targetRef ? { targetCardRef: targetRef } : { direct: true }) });
  };
  const findCard = (seat: number | undefined, ref: string | undefined) => seat === undefined || !ref ? undefined : state.seats[seat]?.twin.find(card => card.ref === ref);
  const attack = state.attack;
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
  const appRef = useRef<HTMLDivElement>(null); const dockRef = useRef<HTMLElement>(null);
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
        return (key && root.querySelector<HTMLElement>(`[data-seat="${seat}"][data-zone="${key}"]`)) || root.querySelector<HTMLElement>(`[data-plate="${seat}"]`);
      };
      const a = place(attack.attackerSeat, attack.attackerCardRef); const b = place(attack.targetSeat, attack.direct ? undefined : attack.targetCardRef);
      if (!a || !b) { setArrow(null); return; }
      const st = root.getBoundingClientRect(); const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
      const x1 = ra.left + ra.width / 2 - st.left; const y1 = ra.top + ra.height / 2 - st.top; const x2 = rb.left + rb.width / 2 - st.left; const y2 = rb.top + rb.height / 2 - st.top;
      const mx = (x1 + x2) / 2; const my = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.12 - 20;
      setArrow({ d: `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`, mx: Math.max(8, Math.min(st.width - 170, mx - 60)), my: Math.max(8, my * 0.5 + Math.min(y1, y2) * 0.5 - 14) });
    };
    draw(); window.addEventListener("resize", draw); return () => window.removeEventListener("resize", draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attack, state.seats]);

  // ---- moving cards by hand: drag, keyboard, voice ----
  /** One twin.move, one Undo. The auto-detect watcher is told first so the camera keeps the new place. */
  const moveCard = useCallback((seat: number, card: TwinCard, land: Landing, extra: { faceUp?: boolean; position?: "attack" | "defense" } = {}) => {
    const { room: now } = R.current;
    announceManualMove({ slug: now.slug, seat, ref: card.ref });
    const label = card.faceUp ? card.name ?? cardInfo(cardCode(card))?.name : undefined;
    return act({ type: "twin.move", actorSeat: now.solo ? seat : now.mySeat, seat, zone: land.zone, cardRef: card.ref, ...(land.slot ? { slot: land.slot } : {}),
      ...(extra.position ? { position: extra.position } : {}), ...(extra.faceUp !== undefined ? { faceUp: extra.faceUp } : {}), ...(label ? { name: label } : {}) });
  }, [act]);
  const judgeFor = (seat: number, card: TwinCard, land: Landing) => {
    const { state: cur, room: now } = R.current; const other = facingSeat(seat, now.seatCount);
    return judgeMove({ card, info: cardInfo(cardCode(card)), land, twin: cur.seats[seat]?.twin ?? [], extraZones: hasExtraZones(now.format?.id),
      facing: other === null || !cur.seats[other] ? null : { name: name(other), twin: cur.seats[other].twin } });
  };
  /** Drag, keyboard and voice share this: refuse says why, confirm asks once on the dock chip, ok moves with Undo. */
  const tryMove = (seat: number, card: TwinCard, land: Landing, extra: { faceUp?: boolean; position?: "attack" | "defense" } = {}, requestId?: string, direct = false): { done: boolean; text: string } => {
    const verdict = direct ? { kind: "ok" as const } : judgeFor(seat, card, land);
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
    judge: (card, key) => judgeFor(seat, card, landOf(card, key)),
    drop: (card, key) => { tryMove(seat, card, landOf(card, key)); },
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
  const spokenMove = (move: MoveIntent, requestId: string): { text: string; ignored?: boolean } => {
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
    const dest = move.dest;
    const emz = dest?.zone === "extra-monster" && !dest.slot ? freeEmzSlot(seat, cur.seats) : dest?.slot;
    const land: Landing = dest ? { zone: dest.zone, ...(dest.zone === "extra-monster" ? (emz ? { slot: emz } : {}) : dest.slot ? { slot: dest.slot } : {}) } : { zone: card.zone, ...(card.slot ? { slot: card.slot } : {}) };
    if (dest?.zone === "extra-monster" && !land.slot) return { text: "Both Extra Monster Zones are taken.", ignored: true };
    // A card set to a Monster Zone goes in defense, face down. A move by voice never needs the card to be face up.
    const faceUp = move.faceUp;
    const position = move.position ?? (faceUp === false && land.zone === "monster" ? "defense" : undefined);
    const result = tryMove(seat, card, land, { ...(faceUp !== undefined ? { faceUp } : {}), ...(position ? { position } : {}) }, requestId, !dest);
    return { text: result.text, ignored: !result.done };
  };

  // ---- voice ----
  const [muted, setMuted] = useState(false); const [ptt, setPtt] = useState(false); const [held, setHeld] = useState(false);
  const [wake, setWake] = useState(0); const [, setWakeTick] = useState(0);
  const [transcript, setTranscript] = useState({ requestId: "", text: "", result: "", ignored: false });
  const [proposal, setProposal] = useState<Pending | null>(null); const proposalId = useRef(0);
  const wakeOpen = wake > Date.now();
  const micState: MicState = muted ? "muted" : myTurn || wakeOpen ? "listen" : "idle";
  useEffect(() => { if (!wake) return; const timer = setTimeout(() => setWakeTick(n => n + 1), Math.max(0, wake - Date.now()) + 50); return () => clearTimeout(timer); }, [wake]);
  const setMic = hub.setMic; const micPublished = hub.micPublished;
  useEffect(() => { if (!solo && micPublished === muted) setMic(!muted); }, [muted, solo, setMic, micPublished]);
  const hotwords = useMemo(() => voiceCardNames(room, cardInfo), [room, info]);

  const propose = (title: string, sub: string, confirmLabel: string, run: () => void, requestId?: string) => setProposal({ id: ++proposalId.current, title, sub, confirmLabel, run, requestId });
  const apply = useCallback((intent: VoiceIntent, text: string, requestId: string) => {
    const { room: now, state: current } = R.current; const me = now.solo ? current.turnSeat : now.mySeat;
    const set = (result: string, ignored = false) => setTranscript(old => ({ ...old, result, ignored }));
    switch (intent.kind) {
      case "effect": set("Effect activated"); void act(intent.proposal); break;
      case "undo": set("Undone"); void doUndo(); break;
      case "phase":
        if (!now.solo && now.mySeat !== current.turnSeat) { set(`Only ${name(current.turnSeat)} can change phase`, true); break; }
        set(`Phase: ${PHASE_LONG[intent.phase] ?? intent.phase}`); void act({ type: "phase.set", actorSeat: me, phase: intent.phase }); break;
      case "turn": set("Needs a confirm"); propose("Pass the turn", `${name(current.turnSeat)} to ${name(nextSeat)}`, "Pass turn", () => passTurn(), requestId); break;
      case "lp": set("Needs a confirm"); propose(`${name(intent.seat)} ${sg(intent.delta)} LP`, `${lpOf(intent.seat)} to ${Math.max(0, lpOf(intent.seat) + intent.delta)}`, "Apply", () => void changeLp(intent.seat, intent.delta, "Voice adjustment"), requestId); break;
      case "attack": {
        const best = intent.resolution.candidates[0]; if (!best) { set("No attacker found", true); break; }
        set(intent.resolution.status === "unique" ? "Needs a confirm" : "Best of several matches");
        propose(`${best.attacker.name ?? "Monster"} attacks ${best.target?.name ?? name(best.proposal.targetSeat)}`, intent.resolution.status === "unique" ? `Said: “${text}”` : `${intent.resolution.candidates.length} matches. Best guess shown.`, "Declare", () => void act(best.proposal), requestId);
        break;
      }
      case "move": { const result = spokenMove(intent.move, requestId); set(result.text, result.ignored); break; }
      case "pick": set("Picked"); document.dispatchEvent(new CustomEvent("remote-tray-pick", { detail: intent.index })); break;
      default: set("Not understood", true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [act, doUndo, moveCard]);
  const onFinal = useCallback(async (final: SttFinal, gate: MicState) => {
    const heardAt = Date.now();
    const { room: now, state: current } = R.current; const me = now.solo ? current.turnSeat : now.mySeat;
    setTranscript({ requestId: final.requestId, text: final.text, result: "", ignored: false });
    const intent = interpret(final.text, { state: current, players: now.seats, me, trayOpen: R.current.layer === "tray", cardNames: voiceCardNames(now, cardInfo) });
    if (gate === "idle") {
      if (intent.kind === "wake") { setWake(Date.now() + WAKE_MS); setTranscript(old => ({ ...old, result: "Wake word · listening 8 s" })); addVoiceLog(`${name(now.mySeat)} said “${final.text}”`); toast(<>Heard <b>“{final.text}”</b>. Listening for 8 seconds.</>); }
      else setTranscript(old => ({ ...old, result: "Idle. Say “chain” first.", ignored: true }));
      return;
    }
    if (intent.kind === "wake") { setTranscript(old => ({ ...old, result: "Chain response noted" })); addVoiceLog(`${name(now.mySeat)} is responding: “${final.text}”`); toast(<><b>{name(now.mySeat)}</b> is responding to the chain.</>); return; }
    if ((intent.kind === 'move' && intent.move.query) || intent.kind === 'effect') {
      const query = intent.kind === 'move' ? intent.move.query : intent.proposal.type === 'effect.activated' ? intent.proposal.source.name : undefined;
      const hit = final.cardMatches[0];
      const sourceId = intent.kind === 'effect' && intent.proposal.type === 'effect.activated' ? intent.proposal.source.cardId : undefined;
      if (hit || sourceId) mentionVoiceCard(now, me, hit?.passcode ?? sourceId!, heardAt);
      else if (query) void searchCards(query).then(cards => { if (cards[0]) mentionVoiceCard(now, me, cards[0].id, heardAt); }).catch(() => undefined);
    }
    if (intent.kind === "name") {
      const hit = final.cardMatches[0]; const top = hit ? undefined : (await searchCards(intent.name))[0];
      const card = hit ? { cardId: hit.passcode, name: hit.name } : top ? { cardId: top.id, name: top.name } : undefined;
      if (card) { mentionVoiceCard(now, me, card.cardId, heardAt); setTranscript(old => ({ ...old, result: `Picked ${card.name}` })); void identify({ cardId: card.cardId, name: card.name, via: "voice", feedback: R.current.layer === "tray" ? "voice" : undefined }, "voice"); }
      else setTranscript(old => ({ ...old, result: "No card with that name", ignored: true }));
      return;
    }
    if (intent.kind === "none") setProposal(null);
    apply(intent, final.text, final.requestId);
    if (intent.kind !== "none") addVoiceLog(`${name(now.mySeat)} said “${final.text}”`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply, identify]);
  const onCorrection = useCallback((final: SttFinal) => {
    setTranscript(old => old.requestId === final.requestId ? { ...old, text: final.text } : old);
    setProposal(old => {
      if (!old || old.requestId !== final.requestId) return old;
      const { room: now, state: current } = R.current;
      const intent = interpret(final.text, { state: current, players: now.seats, me: now.solo ? current.turnSeat : now.mySeat, trayOpen: false, cardNames: voiceCardNames(now, cardInfo) });
      if (intent.kind === "lp") return { ...old, title: `${name(intent.seat)} ${sg(intent.delta)} LP`, sub: `${lpOf(intent.seat)} to ${Math.max(0, lpOf(intent.seat) + intent.delta)}`, run: () => void changeLp(intent.seat, intent.delta, "Voice adjustment") };
      return old;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const voice = useVoice({ enabled: live, state: micState, ptt, held, hotwords, onFinal, onCorrection });
  const shownTranscript = voice.partial ? { text: voice.partial, live: true, result: "", ignored: false } : { text: transcript.text, live: false, result: transcript.result, ignored: transcript.ignored };

  // ---- attack proposal (shared) and the voice proposal share the dock chip ----
  const attackChip: Pending | null = attack && battle && mayResolve ? { id: -1, title: battle.title, sub: battle.sub, confirmLabel: battle.result === "Resolve by hand" ? "Mark resolved" : `Confirm · ${battle.result}`, run: () => void confirmAttack() } : null;
  const chip = proposal ?? attackChip;
  const cancelChip = () => { if (proposal) setProposal(null); else cancelAttack(); };

  // ---- keyboard ----
  const toggleView = () => setWebcamOnly(!webcamOnly);
  const latest = useRef({ chip, cancelChip, doUndo, picking, ptt, toggleView }); latest.current = { chip, cancelChip, doUndo, picking, ptt, toggleView };
  useEffect(() => {
    function down(event: KeyboardEvent) {
      const L = latest.current;
      if ((event.ctrlKey || event.metaKey) && (event.key === "z" || event.key === "Z") && !typing(event.target)) { event.preventDefault(); void L.doUndo(); return; }
      if (typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.key === "v" || event.key === "V") && L.ptt && !event.repeat) { setHeld(true); return; }
      if (R.current.layer) return;
      // S scans the field like the button beside the board. A confirm prompt or a modal dialog keeps the key (open popups set the layer above).
      if ((event.key === "s" || event.key === "S") && !event.repeat && !event.shiftKey && !event.defaultPrevented && !document.querySelector('[role="alertdialog"],[role="dialog"][aria-modal="true"]')) { if (runFieldScan()) event.preventDefault(); return; }
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
    setSubject({ cardId: card.cardId, seat, name: card.name, notInDecklist: null, addErrors: [], via: "field" });
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
  const chipSeat = layers.layer ? undefined : state.seats.map(item => item.seat).find(seat => live && (solo || seat === mySeat) && openSearch(state, seat, dismissedSearch, searchFresh));
  const suggestSeat = !layers.layer && chipSeat === undefined && suggestion && !dismissedSearch.has(suggestion.id) && live && (solo || suggestion.actorSeat === mySeat) &&
    !state.seats[suggestion.actorSeat]?.knownHand?.some(card => card.cardId === suggestion.cardId) ? suggestion.actorSeat : undefined;
  const handOf = (seat: number): HandProps | undefined => {
    const own = live && (solo || seat === mySeat);
    const search = own && seat === chipSeat ? openSearch(state, seat, dismissedSearch, searchFresh) : undefined;
    return {
      cards: knownHandOf(state, seat), count: handCountOf(state, seat), onInspect: card => openKnown(seat, card),
      ...(own ? { onCount: (delta: number) => void act(handCount(solo ? seat : mySeat, delta)) } : {}),
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
        toast(card.source === "field" ? `${name(seat)} returned ${card.name} to hand` : card.source === "unknown" ? `${name(seat)} revealed ${card.name} in hand` : `${name(seat)} added ${card.name} to hand`, 4200);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.seats]);

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
  const actions: CardActions = {
    canAdd: !!subject && live && (solo || subject.seat === mySeat) && !subject.addErrors.length, adding, onAdd: () => subject && void addToDeck(subject.seat, subject.cardId),
    canAttack: !!subjectCard && !block, attackHint: block || "Pick this monster as the attacker", onAttack: () => subjectCard && subject && startAttack(subject.seat, subjectCard),
    onWrong: () => { if (!subject) return;
      if(subject.via==='tracked'&&ctx.current&&ctx.current.ref&&ctx.current.ref===subject.ref){
        const at=ctx.current,frozen=(solo||subject.seat===mySeat)&&at.frozenFrame?{x:at.x,y:at.y,frame:at.frozenFrame}:undefined;
        const target=trackedRereadTarget(at.ref!,hub.trackedCards(subject.seat),frozen);
        if(target){void startRead(subject.seat,target.x,target.y,{point:{anchor:at.at.anchor!,feed:at.at.feed!,frames:target.frames},force:true,ref:subject.ref});return;}
      }
      layers.close(); setTray({ seat: subject.seat, ownerName: name(subject.seat), status: "empty", guesses: [], note: "Search for the right card or say its name.", reader: "", at: popAt }); layers.open("tray"); },
    onActivate: subject && subject.cardId && live && (solo || subject.seat===mySeat) ? () => void act({type:"effect.activated",actorSeat:subject.seat,source:{cardId:subject.cardId,...(subject.ref ? {cardRef:subject.ref} : {})}}).then(done=>{if(done) layers.close();}) : undefined,
    onReveal: subject && subjectCard && !subjectCard.faceUp && (solo || subject.seat===mySeat) ? () => void act({type:"twin.flip",actorSeat:subject.seat,seat:subject.seat,cardRef:subjectCard.ref,faceUp:true}) : undefined,
    onPin: () => layers.open("insp"),
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
      const reason = fieldZoneCheck(info(cardCode(subjectCard)), subjectCard.zone, subjectCard.slot, { faceDown: !subjectCard.faceUp, equipSource: equipSourceOnField(twins, c => info(cardCode(c))) });
      return reason ? { zoneCheck: reason } : {};
    })() : {}),
    ...(subject && flagOf(subject.seat) ? { onFlag: (el: HTMLElement) => { setFlagSeat(subject.seat); layers.open("flag", el); } } : {}),
    ...(subject && subjectCard && live && (solo || subject.seat === mySeat) ? { edit: {
      faceUp: subjectCard.faceUp !== false, zone: subjectCard.zone, extraZones,
      onMove: (zone: string) => {
        // A move into the Extra Monster Zones picks a slot the facing seat has not taken. Pendulum Zones use the outer Spell/Trap cells.
        const slot = zone === "extra-monster" ? freeEmzSlot(subject.seat, state.seats) : zone === "pendulum" ? [1, 2].find(n => !state.seats[subject.seat].twin.some(c => c.zone === "pendulum" && c.slot === n)) : undefined;
        if (zone === "extra-monster" && !slot) { toast("Both Extra Monster Zones are taken."); return; }
        announceManualMove({ slug: room.slug, seat: subject.seat, ref: subjectCard.ref });
        void act({ type: "twin.move", actorSeat: solo ? subject.seat : mySeat, seat: subject.seat, zone, cardRef: subjectCard.ref, ...(slot ? { slot } : {}) });
      },
      onFlip: () => void act({ type: "twin.flip", actorSeat: solo ? subject.seat : mySeat, seat: subject.seat, cardRef: subjectCard.ref, faceUp: subjectCard.faceUp === false }),
      onRemove: () => { void act({ type: "twin.remove", actorSeat: solo ? subject.seat : mySeat, seat: subject.seat, cardRef: subjectCard.ref }); layers.close(); setSubject(null); },
      ...(subjectCard.faceUp !== false && subjectCard.zone === "spell-trap" ? { equip: equipChoice(subject.seat, subjectCard) } : {}),
    } } : {}),
  };
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
  const openSubject = (card: TwinCard, fromField = true, anchor?: Rect) => {
    const seat = state.seats.findIndex(item => item.twin.some(c => c.ref === card.ref));
    const origin=state.effectTracking?.origins.find(o=>o.seat===seat && o.ref===card.ref);
    if(!card.faceUp && origin && (solo || seat===mySeat)) {setEffectOrigin(origin.id); layers.open("effect"); return;}
    const id = cardCode(card);
    // Your own card with no name still gets its actions (move, flip, Graveyard, Wrong card?). cardId 0 = not identified.
    if (!id && !((solo || seat === mySeat) && fromField && !anchor)) { toast(card.setBy ? "Face-down · Set by "+card.setBy.name : card.faceUp?"This card is not identified yet. Click it on the camera feed.":"Face-down card"); return; }
    setSubject({ cardId: id ?? 0, seat, ref: card.ref, name: id ? card.name : card.faceUp ? "Unidentified card" : "Face-down card", bestMatch:card.bestMatch, notInDecklist: id ? flagFor(seat, id) : null, addErrors: [], via: "field" });
    setSelected({ seat, ref: card.ref });
    // From a pile tile the popup points at the tile, so it opens over the viewer and the viewer stays.
    if (anchor) { setPopAt({ anchor, feed: null }); layers.open("card"); } else if (fromField) layers.open("insp");
  };
  // ---- Graveyard and Banished piles ----
  const [pile, setPile] = useState<{ seat: number; zone: PileZone } | null>(null);
  const openPile = (seat: number, zone: PileZone, opener: HTMLElement | null) => {
    if (pile && pile.seat === seat && pile.zone === zone && layers.layer === "pile") { layers.close("pile"); return; }
    setPile({ seat, zone }); layers.open("pile", opener);
  };
  // The viewer stays while its card popup is open. Any other layer, Esc or a press outside closes it.
  useEffect(() => { if (pile && layers.layer !== "pile" && layers.layer !== "card") setPile(null); }, [pile, layers.layer]);

  // ---- health ----
  const healthRows = seatIds.map(seat => ({ seat, name: name(seat), color: COLORS[seat], health: hub.health(seat) }));
  const humans = healthRows.filter(row => !room.seats.find(item => item.seat === row.seat)?.bot);
  const worst = humans.some(row => row.health.q === "bad") ? "bad" : humans.some(row => row.health.q === "warn") ? "warn" : humans.every(row => row.health.q === "off") ? "off" : "good";
  const healthText = worst === "good" ? "All feeds ok" : worst === "off" ? "Cameras off" : `${humans.filter(row => row.health.q === "bad" || row.health.q === "warn").length} feed${humans.filter(row => row.health.q === "bad" || row.health.q === "warn").length === 1 ? "" : "s"} weak`;
  const format = room.format ?? state.deckChecks?.format ?? normalizeRemoteFormat();
  const formatLabel = REMOTE_FORMATS.find(item => item.value === format.id)?.label ?? format.id;
  const mode = seatCount === 2 ? "1v1" : String(seatCount);
  const facing = (seat: number) => { const other = facingSeat(seat, seatCount); return other === null || !state.seats[other] ? null : { name: name(other), twin: state.seats[other].twin }; };
  const warnRefs = (seat: number) => new Set(state.seats[seat]?.twin.filter(card => { const code = cardCode(card); return code && flagFor(seat, code) === true; }).map(card => card.ref) ?? []);
  const twinCounts = (seat: number) => new Map(findTwinGroups(state.seats[seat]?.twin ?? []).flatMap(group => group.cards.map(card => [card.ref, group.cards.length] as const)));
  const draftPhase = PHASES.length;
  void draftPhase;

  // ---- camera card info and card actions ----
  const zoneGrid = useZoneGrid();
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
  const hoverTip = (seat: number, x: number, y: number) => {
    const tracked = hub.trackedAt(seat, x, y);
    if (tracked) return { label: tracked.name ?? info(tracked.cardId)?.name ?? "Card", detail: statLine(tracked.cardId) };
    const card = twinAtPoint(seat, x, y);
    if (!card) { const pile = pileAt(zoneAtPoint(seat, x, y)); return pile ? { label: pile === "graveyard" ? "Graveyard" : "Banished", detail: `${pileCount(seat, pile)} cards` } : null; }
    const id = cardCode(card);
    if (id) return { label: cardName(card, info(id)), detail: card.faceUp ? statLine(id) : "Set" };
    return card.faceUp ? null : { label: "Set card" };
  };
  /** Webcam only: a click where no card is outlined. A card the table knows there opens its info. A hidden card says "Set card". The Graveyard and Banished open their pile. */
  const onZoneCard = (seat: number, at: { x: number; y: number; anchor: Rect; feed: Rect }) => {
    const card = twinAtPoint(seat, at.x, at.y);
    if (!card) { const pile = pileAt(zoneAtPoint(seat, at.x, at.y)); if (!pile) return false; openPile(seat, pile, null); return true; }
    if (cardCode(card)) { openSubject(card, false, at.anchor); return true; }
    if (card.faceUp) return false;
    toast("Set card"); layers.close(); return true;
  };
  /** Webcam only, while a target is picked for an attack: a click on a monster of another seat declares it. */
  const onCamPick = (seat: number, x: number, y: number) => {
    if (!picking || seat === picking.seat) return false;
    const card = cardAtPoint(seat, x, y);
    if (!card || (card.zone !== "monster" && card.zone !== "extra-monster")) return false;
    void declare(seat, card.ref); return true;
  };
  /** Right click or long press on a card: its actions in the card drawer (move, flip, position, Graveyard, Wrong card?, Undo). True when something opened. */
  const openCardActions = (card: TwinCard): boolean => {
    const seat = state.seats.findIndex(item => item.twin.some(c => c.ref === card.ref));
    if (!cardCode(card) && !card.faceUp && !(solo || seat === mySeat)) { toast("Set card"); return true; }
    openSubject(card, true); return true;
  };
  /** The feed handler runs first and the table handler after it, in the same event. This tells the table handler what the feed did. */
  const feedMenu = useRef(false);
  const onCardMenu = (seat: number, at: { x: number; y: number }) => {
    const card = cardAtPoint(seat, at.x, at.y);
    if (card) { feedMenu.current = openCardActions(card); return; }
    const pile = pileAt(zoneAtPoint(seat, at.x, at.y)); if (pile) { openPile(seat, pile, null); feedMenu.current = true; }
  };
  const cardMenu = useCardMenu(target => {
    if (target.closest("[data-remote-seat]")) { const done = feedMenu.current; feedMenu.current = false; return done; }
    const cell = target.closest<HTMLElement>("[data-zone][data-seat]"); if (!cell) return false;
    const key = cell.dataset.zone as ZoneKey; const seat = Number(cell.dataset.seat);
    if (key === "gy") { openPile(seat, "graveyard", cell); return true; }
    if (isPile(key)) return false;
    const card = cellsFor(state.seats[seat]?.twin ?? [], extraZones)[key]?.card; return card ? openCardActions(card) : false;
  });
  return <div ref={appRef} className={`${duelFontClasses} ${s.app}`} data-mode={mode} data-wc={webcamOnly ? "1" : undefined} data-testid="remote-table" data-status={room.status} {...cardMenu}>
    <AutoFieldWatcher dock={seatDocks[mySeat] ?? null} room={room} transaction={ctl.transaction} diagnosticsAllowed={feedbackPref?.isAdmin===true} />
    <a className={s.skip} href="#stage">Skip to the table</a>
    <div className={s.shell}>
      <TopBar crumb={`Table ${room.slug.slice(0, 8)}`} chip={`${formatLabel} · ${solo ? "Solo test" : `${seatCount} players`}`} health={{ q: worst, text: healthText }}
        healthOpen={layers.layer === "health"} cardOpen={layers.layer === "insp"} logOpen={layers.layer === "log"} logDot={unread}
        onHealth={el => layers.toggle("health", el)} onCard={el => layers.toggle("insp", el)} onLog={el => layers.toggle("log", el)}
        webcamOnly={webcamOnly} onView={setWebcamOnly} />
      <main className={s.stage} id="stage" tabIndex={-1} aria-label="Duel table" ref={stage}>
        <LpStrip players={players} turnSeat={state.turnSeat} lp={lpOf} onJump={seat => document.querySelector(`[data-testid="seat-${seat}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })} />
        {room.status === "ended" || (state.ended && !state.match) ? <div className={s.ended} role="status" data-testid="table-ended">
          <b>This table has ended.</b>
          <span>{endedWhy(room, state.winnerSeat !== null && state.winnerSeat !== undefined ? name(state.winnerSeat) : null)}</span>
          <a className={`${s.btn} ${s.go} ${s.sm}`} href="/duels/remote" data-testid="new-table">New table</a>
        </div> : null}
        <EffectControls room={room} act={act} onOpen={id=>{setEffectOrigin(id);layers.open("effect");}} />
        <Banner banner={banner} />
        <svg className={s.arrow} aria-hidden="true">{arrow ? <><defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#f6dc9a" /></marker></defs>
          <path d={arrow.d} fill="none" stroke="rgba(232,185,79,.35)" strokeWidth="9" strokeLinecap="round" />
          <path className={s.flow} d={arrow.d} fill="none" stroke="#f6dc9a" strokeWidth="3" strokeLinecap="round" markerEnd="url(#ah)" /></> : null}</svg>
        <div className={`${s.amath} ${arrow && battle ? s.show : ""}`} aria-hidden="true" style={arrow ? { left: arrow.mx, top: arrow.my } : undefined} data-testid="battle-math">{battle ? <><em>{battle.attackerAtk ?? "?"}</em> vs <em>{battle.direct ? "direct" : battle.targetValue ?? "?"}</em> → <s>{battle.result}</s></> : null}</div>
        {webcamOnly && attack && battle ? <div className={s.wcbattle} role="status" aria-live="polite" data-testid="wc-battle"><b>{battle.title}</b> <em>{battle.attackerAtk ?? "?"}</em> vs <em>{battle.direct ? "direct" : battle.targetValue ?? "?"}</em> → <s>{battle.result}</s></div> : null}
        {seatIds.map(seat => {
          const twin = state.seats[seat]?.twin ?? []; const bot = !!room.seats.find(item => item.seat === seat)?.bot;
          const registration=room.seats.find(item=>item.seat===seat),deck=registration?.deck?.deck;
          const plate = !!picking && seat !== picking.seat && !state.seats[seat].eliminated;
          return <SeatPanel key={seat} index={seat} seat={seat} name={name(seat)} color={COLORS[seat]} you={seat === mySeat} turn={seat === state.turnSeat} next={seat === nextSeat && seatCount > 2}
            speaking={seat === mySeat && voice.speaking} frozen={hub.health(seat).label === "Frozen"} eliminated={!!state.seats[seat]?.eliminated} lp={lpOf(seat)} startingLp={startingLp}
            health={hub.health(seat)} healthOpen={layers.layer === "health"} onHealth={el => layers.toggle("health", el)}
            marks={marks[seat] ?? []} reticles={reticles[seat] ?? []} onBegin={beginRead} onMiss={noCard} onSearch={searchHere} onPoint={(sd, x, y, point) => void startRead(sd, x, y, { point })} onSelect={(sd, hit) => void startRead(sd, hit.x, hit.y, { hit })}
            holdSelection={(layers.layer === "tray" || layers.layer === "card") && ctx.current?.seat === seat} onAdd={mark => void addToDeck(seat, mark.cardCode)} onReset={resetFeed} onReadBoard={readBoardInto}
            twin={twin} deckRegistered={!!(registration?.deckRegistered??registration?.deck)} deckListSizes={deck?{deck:deck.main.length,extra:deck.extra.length}:undefined} info={info} extraZones={extraZones} facing={facing(seat)} boardSeats={state.seats} rv={rv[seat] ?? "m1"} onRv={key => setRv(old => ({ ...old, [seat]: key }))} picking={!!picking && seat !== picking.seat}
            selectedRef={picking?.seat === seat ? picking.ref : selected?.seat === seat ? selected.ref : undefined} targetRef={attack?.targetSeat === seat ? attack.targetCardRef : undefined} freshRef={fresh}
            warnRefs={warnRefs(seat)} twinCounts={twinCounts(seat)} pickPlate={plate} viewScope={String(seatCount)} webcamOnly={webcamOnly} onDock={onSeatDock} onToggleView={() => setWebcamOnly(!webcamOnly)}
            onZoneCard={onZoneCard} onCamPick={onCamPick} hoverTip={hoverTip} onCardMenu={onCardMenu}
            onActivate={(_key, card) => { if (picking && card && seat !== picking.seat && (card.zone === "monster" || card.zone === "extra-monster")) void declare(seat, card.ref); else if (card) openSubject(card); }}
            onAttack={(_key, card) => startAttack(seat, card)} onInspect={card => openSubject(card)} onPile={(zone, opener) => openPile(seat, zone, opener)} drag={fieldDrag(seat)} onPlate={() => { if (plate) void declare(seat); }}
            onLp={delta => void changeLp(seat, delta)} canLp={live} deckWarning={deckFlag(room, seat)?.message} onDeckFlag={el => { setFlagSeat(seat); layers.toggle("flag", el); }}
            hand={handOf(seat)}
            cameraControl={seat === mySeat ? <CameraControl room={room} /> : undefined}
            undo={seat === mySeat ? { label: undoShort, enabled: canUndo, reason: newestUndo?.reason, onUndo: () => void doUndo() } : undefined} turnIn={turnIn && seat === state.turnSeat}
            emptyFeedAction={seat === mySeat && !hub.cameraOn ? <button type="button" className={`${s.btn} ${s.sm} ${s.go}`} disabled={hub.starting} onClick={event => { event.stopPropagation(); void (hub.manual(seat) ? hub.useWebcam() : hub.enableCamera()); }} data-testid="camera-on-feed">{hub.starting ? "Starting…" : hub.solo ? "Turn camera on" : "Join table video"}</button> : undefined}
            emptyFeedText={hub.manual(seat) ? "No camera (manual). Use voice, typing and your board twin." : hub.health(seat).label === "Scan mode" ? "Scan mode · follow the board twin and log." : bot ? "Test opponent. No camera." : seat === mySeat ? "Your camera is off." : `Waiting for ${name(seat)}'s camera.`} />;
        })}
      </main>
      <Rail players={players} turnSeat={state.turnSeat} turn={state.turn} phase={state.phase} canAct={live && myTurn && !state.attack} nextSeat={nextSeat} passHot={state.phase === "end"} mine={!solo && mySeat === state.turnSeat}
        onPhase={setPhase} onPhaseBack={phaseBack} onPass={passTurn} turnIn={turnIn} backTo={previousYgoPhase(state)} />
      <footer ref={dockRef} className={s.dock} aria-label="Voice and undo">
        <MicSection state={micState} level={voice.level} speaking={voice.speaking} muted={muted} ptt={ptt} held={held} service={voice.service} error={voice.micError}
          onMute={() => setMuted(v => !v)} onPtt={() => { setPtt(v => !v); setHeld(false); }} offTurn={!myTurn} />
        <VoxSection transcript={shownTranscript} proposal={chip} samples={shownTranscript.ignored && shownTranscript.result === "Not understood" ? suggestCommands(shownTranscript.text, { state, players: room.seats, me: solo ? state.turnSeat : mySeat, trayOpen: false, cardNames: hotwords }) : trySaying(room.seats, mySeat, hotwords)} onConfirm={() => { chip?.run(); setProposal(null); }} onCancel={cancelChip}
          onSample={text => void onFinal({ requestId: `sample-${Date.now()}`, text, normalizedText: text.toLowerCase(), cardMatches: [] }, "listen")} />
        <UndoSection label={undoText} enabled={canUndo} reason={newestUndo?.reason} flash={flash} histOpen={layers.layer === "hist"} onUndo={() => void doUndo()} onHist={el => layers.toggle("hist", el)} />
      </footer>
    </div>

    <IdleBanner closesAt={room.status === "active" && room.idleWarningAt !== null ? room.lastEventAt + REMOTE_IDLE_CLOSE_MS : null} now={serverNow()} onStay={() => void remoteApi(`/${room.slug}/activity`, {}).catch(() => {})} />
    <LogDrawer open={layers.layer === "log"} entries={entries} onClose={() => layers.close("log")} rules={[`Format: ${formatLabel}`, `Starting LP: ${startingLp}`, "Undo: your last 20 actions, this turn and the one before"]}
      extra={!solo ? <VisionFeedbackSetting promptOnly onChange={onFeedbackPref} /> : undefined}
      onConcede={!solo && mySeat >= 0 && live ? () => void act({ type: "player.concede", actorSeat: mySeat }) : undefined} declare={declareResult}
      seats={players.map(p => ({ seat: p.seat, name: p.name, color: p.color, turn: p.seat === state.turnSeat, lp: lpOf(p.seat), note: p.seat === state.turnSeat ? "Turn" : p.seat === nextSeat ? "Next" : "" }))} />
    <InspectorDrawer open={layers.layer === "insp"} onClose={() => layers.close("insp")}>
      <InspectorBody subject={subjectDetails} info={subjectInfo} warning={subject ? deckFlag(room, subject.seat)?.message : undefined} actions={actions}
        sourceLine={subject ? `Identified by ${subject.via} on ${name(subject.seat)}'s side` : ""} />
    </InspectorDrawer>
    <DeckFlagPopover open={layers.layer === "flag"} flag={deckFlag(room, flagSeat)} instances={room.state.deckChecks?.instances ?? []} canMerge={live && (solo || flagSeat === mySeat)} busy={!live}
      onDismiss={flag => { void act({ type: "deck.flag.dismiss", actorSeat: flagActor, flagId: flag.id, reason: "Player marked this flag as wrong" }); layers.close("flag"); }}
      onMerge={(flag, keep, remove) => { void act({ type: "twin.merge", actorSeat: solo ? flag.seat : mySeat, seat: flag.seat, keepInstanceId: keep, removeInstanceId: remove, reason: "Same physical card; system split the instance" }); layers.close("flag"); }}
      onClose={() => layers.close("flag")} />
    <HealthPopover open={layers.layer === "health"} rows={healthRows} onClose={() => layers.close("health")} />
    <HistoryPopover open={layers.layer === "hist"} items={history} style={{ right: 16, bottom: "calc(var(--dock) + 8px)" }} onUndo={id => { const entry = ownUndo.find(item => item.actionId === id); if (entry) { void doUndo(entry); if (!entry.reason) layers.close("hist"); } }} />
    {pile && state.seats[pile.seat] ? <PileViewer seat={pile.seat} name={name(pile.seat)} mine={live && (solo || pile.seat === mySeat)} twin={state.seats[pile.seat].twin} zone={pile.zone}
      onZone={zone => setPile({ seat: pile.seat, zone })} info={info} drag={fieldDrag(pile.seat)} onOpenCard={(card, anchor) => openSubject(card, false, anchor)} onClose={() => layers.close()}
      {...(live && (solo || pile.seat === mySeat) ? {
        onOrder: (zone, cardRefs) => act({ type: "pile.order", actorSeat: solo ? pile.seat : mySeat, seat: pile.seat, zone, cardRefs }),
        onName: (card, cardId, cardName) => void act({ type: "card.identified", actorSeat: solo ? pile.seat : mySeat, seat: pile.seat, cardId, name: cardName, source: "typed", cardRef: card.ref }),
        onRemove: card => void act({ type: "twin.remove", actorSeat: solo ? pile.seat : mySeat, seat: pile.seat, cardRef: card.ref }),
      } : {})} /> : null}
    {layers.layer === "card" && subjectDetails ? <CardPopover subject={subjectDetails} info={subjectInfo} at={popAt} warning={deckFlag(room, subjectDetails.seat)?.message} actions={actions} onClose={() => layers.close("card")} /> : null}
    {tray ? <RecognitionTray dock={seatDocks[tray.seat] ?? null} key={readCounter.current} tray={tray} aiAllowed={aiAllowed} onClose={closeTray} saying={micState === "listen"} onSay={() => toast("Say the card name, or “number two”.")}
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
    {match.phase === "result" || (match.phase === "done" && !boardView)
      ? <MatchResultScreen room={room} match={match} mySeat={mySeat} name={name} final={match.phase === "done"} busy={matchBusy} error={overlayError}
        undo={canUndo && mySeat >= 0 && !newestUndo?.reason ? { label: undoText, onUndo: () => void doUndo() } : null}
        onContinue={() => matchStep({ type: "match.continue", actorSeat: matchSeat })} onLeave={() => router.push("/duels/remote")} onClose={() => setBoardView(true)} />
      : match.phase === "siding" && match.siding
        ? <SidingScreen room={room} match={match} mySeat={mySeat} name={name} now={serverNow} act={act} error={overlayError} /> : null}
    <Peek peek={peek} />
    <Toasts items={toasts} dock={seatDocks[mySeat] ?? null} />
    <RemoteFx state={state} webcamOnly={webcamOnly} seq={room.lastSeq} lastType={room.events.find(event => event.seq === room.lastSeq)?.action.type} />
  </div>;
}
