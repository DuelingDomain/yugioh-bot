"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { REMOTE_FORMATS, normalizeRemoteFormat, type RemoteActionProposal, type RemoteRoom } from "@yugidraft/shared/remote";
import { cardInfo, isMonsterInfo, loadCards, searchCards, useCardInfo } from "./catalog";
import { Rail, LpStrip, TopBar, type Player } from "./chrome";
import { CardPopover, InspectorBody, type CardActions, type Subject } from "./card-view";
import { MicSection, UndoSection, VoxSection, type Proposal } from "./dock";
import { describeEvent, undoLabel, type LogKind } from "./describe";
import { DeckFlagPopover } from "./deck-flag";
import { Banner, HealthPopover, IdleBanner, HistoryPopover, InspectorDrawer, LogDrawer, Peek, Toasts, type LogEntry, type PeekState, type ToastItem } from "./drawers";
import type { BoardReading, FeedHit, FeedMark, FeedPoint, FeedReticle, FeedStart } from "./feed";
import type { PopAt, Tier } from "./popup";
import { interpret, trySaying, type VoiceIntent } from "./grammar";
import { COLORS, battleMath, cardCode, cardName, cellKeyOf, deckFlag, deckIdsOf, foundationZone, hasDeck, PHASES, PHASE_LONG, readCardOf, seenCardIds, sg, type TwinCard, type ZoneKey } from "./model";
import { RecognitionTray, type Pick, type TrayState } from "./recognition-tray";
import { VisionFeedbackSetting } from "@/components/settings/vision-feedback-setting";
import { setFeedbackCapture, type FeedbackSource } from "./recognizer";
import { SeatPanel } from "./seat-panel";
import { useLayers } from "./use-layers";
import { serverNow, useRemoteRoom, type RoomController } from "./use-remote-room";
import { useVoice, type MicState } from "./use-voice";
import type { SttFinal } from "./stt-client";
import { VideoHubProvider, useVideoHub } from "./video-hub";
import { RemoteLobbyRoom } from "./lobby";
import { duelFontClasses } from "@/components/duel/fonts";
import type { FeedbackPreference } from "@/components/settings/vision-feedback-setting";
import s from "./remote-ui.module.css";
import {publicTrackedTwin} from '@/lib/remote/field-track-cache';
import { AutoFieldWatcher } from "../field-watcher";
import {trackedRereadTarget} from '@/lib/remote/field-track-cache';
const REMOTE_IDLE_CLOSE_MS = 10 * 60_000; // the server closes a table after 10 idle minutes (shared services constant)

const UNDO_MS = 5000;
const WAKE_MS = 8000;
const fmtTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const typing = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable=true]");

type ReadCtx = { seat: number; x: number; y: number; quad?: { x: number; y: number }[]; at: PopAt; id: number; ref?:string; frozenFrame?:HTMLCanvasElement; tier?: Tier; covered?: boolean; token?: number };
type Pending = Proposal & { requestId?: string; run: () => void };

/** Entry point of /duels/remote/[slug]: the lobby room before the start, the table after it. */
export function RemoteTableScreen({ slug }: { slug: string }) {
  const ctl = useRemoteRoom(slug);
  const room = ctl.room;
  if (!room) return <div className={`${duelFontClasses} ${s.app}`} data-mode="1v1"><div className={s.shell} style={{ display: "grid", placeItems: "center", alignContent: "center", gap: 12 }}>
    <p role="status" style={{ color: "var(--ink2)" }}>{ctl.loadError ? `${ctl.loadError.message}. Join an open seat to enter.` : "Loading table…"}</p>
    {ctl.loadError ? <button type="button" className={`${s.btn} ${s.go}`} disabled={ctl.busy} onClick={() => void ctl.operation("seat")}>Join available seat</button> : null}
    {ctl.error ? <p role="alert" style={{ color: "var(--loss)" }}>{ctl.error}</p> : null}</div></div>;
  if (room.status === "lobby") return <RemoteLobbyRoom ctl={ctl} room={room} />;
  return <VideoHubProvider room={room}><Table ctl={ctl} room={room} /></VideoHubProvider>;
}

function CameraControl() {
  const hub = useVideoHub();
  // Joining is the button inside the empty feed. This control only appears once the camera is on.
  if (!hub.cameraOn) return null;
  return <div className={s.camsel}>
    {hub.devices.length > 1 ? <select aria-label="Choose camera" value={hub.cameraId} onChange={event => void hub.selectCamera(event.target.value)}>
      {hub.devices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || "Camera"}</option>)}</select> : null}
    <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => void hub.disableCamera()}>Camera off</button>
  </div>;
}

function Table({ ctl, room }: { ctl: RoomController; room: RemoteRoom }) {
  const hub = useVideoHub();
  const layers = useLayers();
  const state = room.state; const mySeat = room.mySeat; const solo = room.solo;
  const live = room.status === "active" && !state.ended;
  const seatCount = room.seatCount;
  const seatIds = useMemo(() => room.seats.map(seat => seat.seat), [room.seats]);
  const name = useCallback((seat: number) => room.seats.find(item => item.seat === seat)?.displayName ?? `Seat ${seat + 1}`, [room.seats]);
  const lpOf = (seat: number) => state.seats[seat]?.resources.lp ?? 0;
  const startingLp = room.format?.settings.startingLP ?? 8000;
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
  const info = useCardInfo([...twinCodes, ...deckCodes, subject?.cardId]);
  const nameOfCard = (id: number | undefined) => info(id)?.name;

  // ---- toasts, banner, peek ----
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
  useEffect(() => { if (ctl.error) { toast(ctl.error, 4200); ctl.setError(""); } }, [ctl, ctl.error, toast]);
  useEffect(() => { if (hub.error) toast(hub.error, 4200); }, [hub.error, toast]);

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
      const line = describeEvent(event, name, nameOfCard); return line ? [{ id: event.id, time: fmtTime(event.at), kind: line.kind, text: line.text, fresh: event.seq > firstSeq.current, at: event.at }] : [];
    });
    return [...described, ...voiceLog.map(entry => ({ ...entry, at: Number(entry.id.split(":")[1]) }))].sort((a, b) => b.at - a.at).map(({ at: _at, ...entry }) => entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.events, voiceLog, name, info]);
  const [unread, setUnread] = useState(false); const lastSeq = useRef(room.lastSeq);
  useEffect(() => { if (room.lastSeq !== lastSeq.current) { lastSeq.current = room.lastSeq; if (layers.layer !== "log") setUnread(true); } }, [room.lastSeq, layers.layer]);
  useEffect(() => { if (layers.layer === "log") setUnread(false); }, [layers.layer]);
  const addVoiceLog = useCallback((text: string) => setVoiceLog(list => [...list.slice(-30), { id: `vx:${Date.now()}`, time: fmtTime(Date.now()), kind: "VX" as const, text, fresh: true }]), []);

  // ---- actions ----
  const act = ctl.action;
  const setPhase = (phase: string) => { if (live && myTurn) void act({ type: "phase.set", actorSeat: turnActor, phase }); };
  const passTurn = () => { if (live && myTurn) void act({ type: "turn.end", actorSeat: turnActor }); };
  const changeLp = (seat: number, delta: number, reason = "Manual adjustment") => { if (live && delta) return act({ type: "lp.change", actorSeat: mySeat, seat, delta, reason }); return Promise.resolve(null); };
  const nextSeat = (() => { for (let i = 1; i <= seatCount; i++) { const seat = (state.turnSeat + i) % seatCount; if (!state.seats[seat]?.eliminated) return seat; } return state.turnSeat; })();
  const players: Player[] = seatIds.map(seat => ({ seat, name: name(seat), color: COLORS[seat], eliminated: !!state.seats[seat]?.eliminated }));

  // ---- undo ----
  const undo = state.undo; const [clock, setClock] = useState(0); const [flash, setFlash] = useState(0);
  const idleOn = room.idleWarningAt !== null;
  useEffect(() => { if (!undo && !idleOn) return; const timer = setInterval(() => setClock(n => n + 1), 250); return () => clearInterval(timer); }, [undo, idleOn]);
  void clock;
  // The server decides the window from its own clock (undo.at + 5 s), so count down from that time, not from first sight.
  const left = undo ? Math.ceil((undo.at + UNDO_MS - serverNow()) / 1000) : 0;
  const canUndo = !!undo && left > 0 && (room.status === "active" || room.status === "ended");
  const undoEvent = undo ? room.events.find(event => event.id === undo.actionId) : undefined;
  const undoText = undoEvent ? undoLabel(describeEvent(undoEvent, name, nameOfCard)?.text ?? "last action") : "last action";
  const history = [...room.events].sort((a, b) => b.seq - a.seq).flatMap(event => { const line = describeEvent(event, name, nameOfCard); return line?.undoable ? [{ id: event.id, label: undoLabel(line.text) }] : []; }).slice(0, 5);
  const doUndo = useCallback(async () => {
    const { state: current, room: now } = R.current; const u = current.undo; if (!u) return;
    const event = now.events.find(item => item.id === u.actionId);
    // Any seated player may undo, but the server accepts only the session seat (a solo table may act for its bots).
    const done = await act({ type: "undo", actorSeat: now.solo ? (event?.actorSeat ?? now.mySeat) : now.mySeat, targetActionId: u.actionId });
    if (done) { setFlash(n => n + 1); toast(<>Undid <b>{undoText}</b></>); }
  }, [act, toast, undoText]);

  // ---- feed marks, recognition ----
  const [marks, setMarks] = useState<Record<number, FeedMark[]>>({}); const [reticles, setReticles] = useState<Record<number, FeedReticle[]>>({});
  const [tray, setTray] = useState<TrayState | null>(null); const ctx = useRef<ReadCtx | null>(null); const readCounter = useRef(0);
  const [popAt, setPopAt] = useState<PopAt>({ anchor: null, feed: null }); const beginId = useRef(0); const [adding, setAdding] = useState(false); const [fresh, setFresh] = useState<string | undefined>();
  const [rv, setRv] = useState<Record<number, ZoneKey>>({}); const [selected, setSelected] = useState<{ seat: number; ref: string } | null>(null);
  const [picking, setPicking] = useState<{ seat: number; ref: string } | null>(null);
  const flagFor = (seat: number, id: number) => hasDeck(room, seat) ? !deckIdsOf(room, seat).includes(id) : null;
  const reticle = (seat: number, next: FeedReticle | null, id: string) => setReticles(all => ({ ...all, [seat]: [...(all[seat] ?? []).filter(item => item.id !== id), ...(next ? [next] : [])] }));

  /** Where a new card goes on a field: its row, the first free slot and a fresh ref. */
  const layoutFor = (seat: number, cardId: number, found: ReturnType<typeof cardInfo>, current=R.current.room) => {
    const spellTrap = /spell|trap/i.test(found?.type ?? ""); const fieldSpell = spellTrap && /field/i.test(found?.type ?? "");
    const row = fieldSpell ? "field" : spellTrap ? "spell-trap" : "monster";
    const used = new Set(current.state.seats[seat].twin.filter(card => card.zone === row).map(card => card.slot).filter(Boolean));
    const slot = row === "field" ? undefined : [1, 2, 3, 4, 5].find(n => !used.has(n));
    return { row, slot, ref: `c${seat}-${cardId}-${Date.now().toString(36)}` };
  };
  /** A public copy of this card already on the field. The same physical card must not be put there twice. */
  const copyOnField = (seat: number, cardId: number) =>
    R.current.room.state.seats[seat].twin.find(card => cardCode(card) === cardId && card.faceUp && card.zone !== "hand" && card.zone !== "deck");
  const saveSample = useCallback((token: number | undefined, cardId: number, source: FeedbackSource | undefined) => {
    if (token === undefined || !source) return;
    void hub.recordFeedback(token, cardId, source).then(result => { if (result.ok && R.current.feedbackAdmin) toast("Saved to the training set"); else if (result.note) toast(result.note); });
  }, [hub, toast]);

  const identify = useCallback(async (pick: Pick, source: "click" | "auto" | "voice" | "typed") => {
    const at = ctx.current; if (!at) return;
    const { seat } = at; const current = R.current.room;
    // The popup stays (as a "card found" state) until the card is placed, then the card popup replaces it.
    const bail = () => { layers.close("tray"); setTray(null); };
    await loadCards([pick.cardId]);
    const found = cardInfo(pick.cardId);
    const outcome=await ctl.transaction(async(current,apply)=>{
      const owns = current.solo || seat === current.mySeat;
      const same=owns?current.state.seats[seat].twin.find(c=>at.ref?c.ref===at.ref:cardCode(c)===pick.cardId&&c.faceUp&&!['hand','deck'].includes(c.zone)):undefined;
      const spot=same?{row:same.zone,slot:same.slot,ref:same.ref}:layoutFor(seat,pick.cardId,found,current);
      const {row,slot,ref}=spot;
      let updated:RemoteRoom|null=null;
      if(owns&&!same)updated=await apply({type:'twin.place',actorSeat:current.solo?seat:current.mySeat,seat,zone:row,card:{ref,cardId:pick.cardId,name:pick.name,...(slot?{slot}:{}),faceUp:true,position:'attack'}});
      else updated=await apply({type:'card.identified',actorSeat:current.mySeat,seat,cardId:pick.cardId,name:pick.name,source,...(owns?{cardRef:ref,zone:row,...(slot?{slot}:{})}:{})});
      return {updated,owns,ref};
    });
    const {updated,owns,ref}=outcome;
    if(owns&&updated)setFresh(ref);
    if (!updated) { bail(); return; }
    saveSample(at.token, pick.cardId, pick.feedback);
    setSubject({ cardId: pick.cardId, seat, ...(at.tier ? { tier: at.tier } : {}), ...(at.covered ? { covered: true } : {}), ...(owns ? { ref } : {}), name: pick.name, notInDecklist: updated.state.identified?.notInDecklist ?? flagFor(seat, pick.cardId), addErrors: updated.state.identified?.addErrors ?? [], via: source });
    const not = updated.state.identified?.notInDecklist ?? flagFor(seat, pick.cardId) ?? false;
    const markId = `m${at.id}`;
    setMarks(all => ({ ...all, [seat]: [...(all[seat] ?? []).slice(-7), { id: markId, x: at.x, y: at.y, label: pick.name, notInDecklist: !!not, show: true, cardCode: pick.cardId, quad: at.quad, canAdd: owns && !(updated.state.identified?.addErrors?.length) }] }));
    setTimeout(() => setMarks(all => ({ ...all, [seat]: (all[seat] ?? []).map(mark => mark.id === markId ? { ...mark, show: false } : mark) })), 2600);
    setPopAt(at.at); layers.open("card");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.transaction, layers, hub, saveSample]);

  /** The person says the board holds one more copy of the open card: it goes on the field as a second card. */
  const anotherCopy = async () => {
    const sub = subject; if (!sub || !live || !(solo || sub.seat === mySeat)) return;
    const found = cardInfo(sub.cardId); const { row, slot, ref } = layoutFor(sub.seat, sub.cardId, found);
    const place = await act({ type: "twin.place", actorSeat: solo ? sub.seat : mySeat, seat: sub.seat, zone: row, card: { ref, cardId: sub.cardId, name: sub.name, ...(slot ? { slot } : {}), faceUp: true, position: "attack" } });
    if (!place) return;
    await act({ type: "card.identified", actorSeat: mySeat, seat: sub.seat, cardId: sub.cardId, name: sub.name, source: "click", cardRef: ref, zone: row, ...(slot ? { slot } : {}) });
    setFresh(ref); setSubject({ ...sub, ref }); setSelected({ seat: sub.seat, ref });
    toast(<>Second copy of <b>{sub.name ?? found?.name ?? `Card ${sub.cardId}`}</b> placed</>);
  };

  /** A click landed on a live feed: the popup opens at once with its skeleton, before the card is found. */
  const beginRead = useCallback((seat: number, start: FeedStart) => {
    const id = ++readCounter.current; beginId.current = id;
    const at: PopAt = { anchor: start.anchor, feed: start.feed };
    ctx.current = { seat, x: start.x, y: start.y, at, id };
    setTray({ seat, ownerName: name(seat), status: "reading", guesses: [], note: "", reader: "", at });
    layers.open("tray");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, name]);

  const startRead = useCallback(async (seat: number, x: number, y: number, found?: { hit?: FeedHit; point?: FeedPoint; force?:boolean;ref?:string }) => {
    let hit = found?.hit; const extra = hit ?? found?.point;
    const cached=hit?.cached&&!found?.force?publicTrackedTwin(hit.cached,R.current.room.state.seats[seat].twin):undefined;
    // A stale transport quad must not steer a fresh read or bind its old ref.
    if(hit?.cached&&!cached)hit=undefined;
    // A live click that was closed (Esc, outside press) while the card was being found is dropped.
    if (extra?.live && readCounter.current !== beginId.current) return;
    const id = ++readCounter.current; const owner = name(seat);
    const at: PopAt = { anchor: extra?.anchor ?? ctx.current?.at.anchor ?? null, feed: extra?.feed ?? ctx.current?.at.feed ?? null };
    ctx.current = { seat, x, y, quad: hit?.quad, at, id,ref:found?.ref??hit?.cached?.ref,frozenFrame:hit?.frozenFrame, ...(hit?.covered ? { covered: true } : {}) };
    if(cached){
      setTray(null);setSubject({cardId:cached.cardId,seat,ref:cached.ref,name:cached.name,tier:'sure',notInDecklist:flagFor(seat,cached.cardId),addErrors:[],via:'tracked'});
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
    reticle(seat, { id: rid, x, y, state: result.guesses.length ? "done" : "fail", text: result.guesses.length ? "Which card?" : "No match", quad: hit?.quad }, rid);
    setTimeout(() => reticle(seat, null, rid), 1800);
    setTray(old => old && readCounter.current === id ? { ...old, status: result.guesses.length ? "guesses" : "empty", guesses: result.guesses, note: result.note, reader: result.reader, tier: result.tier, aiToken: result.aiToken, ...(hit?.covered || result.covered ? { covered: true } : {}), ...(result.faceDown ? { faceDown: true } : {}) } : old);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, identify, layers, name]);
  const closeTray = () => { readCounter.current++; setTray(null); layers.close("tray"); };
  useEffect(() => { if (layers.layer !== "tray" && tray) { readCounter.current++; setTray(null); } }, [layers.layer, tray]);

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
    const onField = [...current.seats[seat].twin];
    const fresh = sure.filter(card => { const at = onField.findIndex(item => cardCode(item) === card.cardId); if (at >= 0) { onField.splice(at, 1); return false; } return true; })
      .sort((a, b) => a.quad.reduce((n, p) => n + p.x, 0) - b.quad.reduce((n, p) => n + p.x, 0));
    const taken: Record<string, Set<number | undefined>> = { monster: new Set(), "spell-trap": new Set() };
    for (const item of current.seats[seat].twin) taken[item.zone]?.add(item.slot);
    const placed: { ref: string; card: (typeof fresh)[number]; zone: string; slot?: number }[] = [];
    for (const card of fresh) {
      const type = cardInfo(card.cardId)?.type ?? ""; const spellTrap = /spell|trap/i.test(type);
      const zone = spellTrap && /field/i.test(type) ? "field" : spellTrap ? "spell-trap" : "monster";
      const slot = zone === "field" ? undefined : [1, 2, 3, 4, 5].find(n => !taken[zone].has(n));
      if (slot) taken[zone].add(slot);
      placed.push({ ref: `b${seat}-${card.cardId}-${placed.length}-${Date.now().toString(36)}`, card, zone, slot });
    }
    const done: typeof placed = [];
    if (owns) {
      for (const item of placed) {
        const ok = await act({ type: "twin.place", actorSeat: now.solo ? seat : now.mySeat, seat, zone: item.zone, card: { ref: item.ref, cardId: item.card.cardId, name: item.card.name ?? undefined, ...(item.slot ? { slot: item.slot } : {}), faceUp: true, position: "attack" } });
        if (!ok) break; done.push(item);
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
  }, [act, name]);

  // ---- attacks ----
  const attackBlock = (seat: number, card?: TwinCard): string => {
    if (!live) return "The table is closed."; if (!card) return "No card selected.";
    if (card.zone !== "monster"&&card.zone!=="extra-monster") return "Only monsters in a monster zone can attack.";
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
  const hotwords = useMemo(() => [...new Set([...deckCodes, ...twinCodes, ...seenCardIds(room)].map(id => cardInfo(id)?.name).filter((value): value is string => !!value))].slice(0, 400),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deckCodes.join(","), twinCodes.join(","), info]);

  const propose = (title: string, sub: string, confirmLabel: string, run: () => void, requestId?: string) => setProposal({ id: ++proposalId.current, title, sub, confirmLabel, run, requestId });
  const apply = useCallback((intent: VoiceIntent, text: string, requestId: string) => {
    const { room: now, state: current } = R.current; const me = now.solo ? current.turnSeat : now.mySeat;
    const set = (result: string, ignored = false) => setTranscript(old => ({ ...old, result, ignored }));
    switch (intent.kind) {
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
      case "pick": set("Picked"); document.dispatchEvent(new CustomEvent("remote-tray-pick", { detail: intent.index })); break;
      default: set("Not understood", true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [act, doUndo]);
  const onFinal = useCallback(async (final: SttFinal, gate: MicState) => {
    const { room: now, state: current } = R.current; const me = now.solo ? current.turnSeat : now.mySeat;
    setTranscript({ requestId: final.requestId, text: final.text, result: "", ignored: false });
    const intent = interpret(final.text, { state: current, players: now.seats, me, trayOpen: R.current.layer === "tray" });
    if (gate === "idle") {
      if (intent.kind === "wake") { setWake(Date.now() + WAKE_MS); setTranscript(old => ({ ...old, result: "Wake word · listening 8 s" })); addVoiceLog(`${name(now.mySeat)} said “${final.text}”`); toast(<>Heard <b>“{final.text}”</b>. Listening for 8 seconds.</>); }
      else setTranscript(old => ({ ...old, result: "Idle. Say “chain” first.", ignored: true }));
      return;
    }
    if (intent.kind === "wake") { setTranscript(old => ({ ...old, result: "Chain response noted" })); addVoiceLog(`${name(now.mySeat)} is responding: “${final.text}”`); toast(<><b>{name(now.mySeat)}</b> is responding to the chain.</>); return; }
    if (intent.kind === "name") {
      const hit = final.cardMatches[0]; const top = hit ? undefined : (await searchCards(intent.name))[0];
      const card = hit ? { cardId: hit.passcode, name: hit.name } : top ? { cardId: top.id, name: top.name } : undefined;
      if (card) { setTranscript(old => ({ ...old, result: `Picked ${card.name}` })); void identify({ cardId: card.cardId, name: card.name, via: "voice", feedback: R.current.layer === "tray" ? "voice" : undefined }, "voice"); }
      else setTranscript(old => ({ ...old, result: "No card with that name", ignored: true }));
      return;
    }
    apply(intent, final.text, final.requestId);
    if (intent.kind !== "none") addVoiceLog(`${name(now.mySeat)} said “${final.text}”`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply, identify]);
  const onCorrection = useCallback((final: SttFinal) => {
    setTranscript(old => old.requestId === final.requestId ? { ...old, text: final.text } : old);
    setProposal(old => {
      if (!old || old.requestId !== final.requestId) return old;
      const { room: now, state: current } = R.current;
      const intent = interpret(final.text, { state: current, players: now.seats, me: now.solo ? current.turnSeat : now.mySeat, trayOpen: false });
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
  const latest = useRef({ chip, cancelChip, doUndo, picking, ptt }); latest.current = { chip, cancelChip, doUndo, picking, ptt };
  useEffect(() => {
    function down(event: KeyboardEvent) {
      const L = latest.current;
      if ((event.ctrlKey || event.metaKey) && (event.key === "z" || event.key === "Z") && !typing(event.target)) { event.preventDefault(); void L.doUndo(); return; }
      if (typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.key === "v" || event.key === "V") && L.ptt && !event.repeat) { setHeld(true); return; }
      if (R.current.layer) return;
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

  // ---- card actions ----
  const subjectCard = subject?.ref ? findCard(subject.seat, subject.ref) : undefined;
  const subjectInfo = subject ? info(subject.cardId) : undefined;
  const block = subject ? attackBlock(subject.seat, subjectCard) : "";
  const flagOf = (seat: number) => deckFlag(room, seat);
  const flagActor = solo ? (seatIds.find(seat => !state.seats[seat]?.eliminated) ?? mySeat) : mySeat;
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
    onPin: () => layers.open("insp"),
    ...(subject && flagOf(subject.seat) ? { onFlag: (el: HTMLElement) => { setFlagSeat(subject.seat); layers.open("flag", el); } } : {}),
    ...(subject && subjectCard && live && (solo || subject.seat === mySeat) ? { edit: {
      faceUp: subjectCard.faceUp !== false, zone: subjectCard.zone,
      onMove: (zone: string) => void act({ type: "twin.move", actorSeat: solo ? subject.seat : mySeat, seat: subject.seat, zone, cardRef: subjectCard.ref }),
      onFlip: () => void act({ type: "twin.flip", actorSeat: solo ? subject.seat : mySeat, seat: subject.seat, cardRef: subjectCard.ref, faceUp: subjectCard.faceUp === false }),
      onRemove: () => { void act({ type: "twin.remove", actorSeat: solo ? subject.seat : mySeat, seat: subject.seat, cardRef: subjectCard.ref }); layers.close(); setSubject(null); },
    } } : {}),
  };
  const openSubject = (card: TwinCard, fromField = true) => {
    const id = cardCode(card); if (!id) { toast("This card is not identified yet. Click it on the camera feed."); return; }
    const seat = state.seats.findIndex(item => item.twin.some(c => c.ref === card.ref));
    setSubject({ cardId: id, seat, ref: card.ref, name: card.name, notInDecklist: flagFor(seat, id), addErrors: [], via: "field" });
    setSelected({ seat, ref: card.ref }); if (fromField) layers.open("insp");
  };

  // ---- health ----
  const healthRows = seatIds.map(seat => ({ seat, name: name(seat), color: COLORS[seat], health: hub.health(seat) }));
  const humans = healthRows.filter(row => !room.seats.find(item => item.seat === row.seat)?.bot);
  const worst = humans.some(row => row.health.q === "bad") ? "bad" : humans.some(row => row.health.q === "warn") ? "warn" : humans.every(row => row.health.q === "off") ? "off" : "good";
  const healthText = worst === "good" ? "All feeds ok" : worst === "off" ? "Cameras off" : `${humans.filter(row => row.health.q === "bad" || row.health.q === "warn").length} feed${humans.filter(row => row.health.q === "bad" || row.health.q === "warn").length === 1 ? "" : "s"} weak`;
  const format = room.format ?? state.deckChecks?.format ?? normalizeRemoteFormat();
  const formatLabel = REMOTE_FORMATS.find(item => item.value === format.id)?.label ?? format.id;
  const mode = seatCount === 2 ? "1v1" : String(seatCount);
  const warnRefs = (seat: number) => new Set(state.seats[seat]?.twin.filter(card => { const code = cardCode(card); return code && flagFor(seat, code) === true; }).map(card => card.ref) ?? []);
  const draftPhase = PHASES.length;
  void draftPhase;

  return <div className={`${duelFontClasses} ${s.app}`} data-mode={mode} data-testid="remote-table" data-status={room.status}>
    <AutoFieldWatcher room={room} transaction={ctl.transaction} />
    <a className={s.skip} href="#stage">Skip to the table</a>
    <div className={s.shell}>
      <TopBar crumb={`Table ${room.slug.slice(0, 8)}`} chip={`${formatLabel} · ${solo ? "Solo test" : `${seatCount} players`}`} health={{ q: worst, text: healthText }}
        healthOpen={layers.layer === "health"} cardOpen={layers.layer === "insp"} logOpen={layers.layer === "log"} logDot={unread}
        onHealth={el => layers.toggle("health", el)} onCard={el => layers.toggle("insp", el)} onLog={el => layers.toggle("log", el)} />
      <main className={s.stage} id="stage" tabIndex={-1} aria-label="Duel table" ref={stage}>
        <Rail players={players} turnSeat={state.turnSeat} turn={state.turn} phase={state.phase} canAct={live && myTurn && !state.attack} nextSeat={nextSeat} passHot={state.phase === "end"}
          onPhase={setPhase} onPass={passTurn} turnIn={turnIn} />
        <LpStrip players={players} turnSeat={state.turnSeat} lp={lpOf} onJump={seat => document.querySelector(`[data-testid="seat-${seat}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })} />
        {room.status === "ended" || state.ended ? <div className={s.ended} role="status">The table is closed.{state.winnerSeat !== null && state.winnerSeat !== undefined ? ` ${name(state.winnerSeat)} won.` : ""}</div> : null}
        <Banner banner={banner} />
        <svg className={s.arrow} aria-hidden="true">{arrow ? <><defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#f6dc9a" /></marker></defs>
          <path d={arrow.d} fill="none" stroke="rgba(232,185,79,.35)" strokeWidth="9" strokeLinecap="round" />
          <path className={s.flow} d={arrow.d} fill="none" stroke="#f6dc9a" strokeWidth="3" strokeLinecap="round" markerEnd="url(#ah)" /></> : null}</svg>
        <div className={`${s.amath} ${arrow && battle ? s.show : ""}`} aria-hidden="true" style={arrow ? { left: arrow.mx, top: arrow.my } : undefined} data-testid="battle-math">{battle ? <><em>{battle.attackerAtk ?? "?"}</em> vs <em>{battle.direct ? "direct" : battle.targetValue ?? "?"}</em> → <s>{battle.result}</s></> : null}</div>
        {seatIds.map(seat => {
          const twin = state.seats[seat]?.twin ?? []; const bot = !!room.seats.find(item => item.seat === seat)?.bot;
          const plate = !!picking && seat !== picking.seat && !state.seats[seat].eliminated;
          return <SeatPanel key={seat} index={seat} seat={seat} name={name(seat)} color={COLORS[seat]} you={seat === mySeat} turn={seat === state.turnSeat} next={seat === nextSeat && seatCount > 2}
            speaking={seat === mySeat && voice.speaking} frozen={hub.health(seat).label === "Frozen"} eliminated={!!state.seats[seat]?.eliminated} lp={lpOf(seat)} startingLp={startingLp}
            health={hub.health(seat)} healthOpen={layers.layer === "health"} onHealth={el => layers.toggle("health", el)}
            marks={marks[seat] ?? []} reticles={reticles[seat] ?? []} onBegin={beginRead} onPoint={(sd, x, y, point) => void startRead(sd, x, y, { point })} onSelect={(sd, hit) => void startRead(sd, hit.x, hit.y, { hit })}
            holdSelection={(layers.layer === "tray" || layers.layer === "card") && ctx.current?.seat === seat} onAdd={mark => void addToDeck(seat, mark.cardCode)} onReadBoard={readBoardInto}
            twin={twin} info={info} format={format.id} rv={rv[seat] ?? "m1"} onRv={key => setRv(old => ({ ...old, [seat]: key }))} picking={!!picking && seat !== picking.seat}
            selectedRef={picking?.seat === seat ? picking.ref : selected?.seat === seat ? selected.ref : undefined} targetRef={attack?.targetSeat === seat ? attack.targetCardRef : undefined} freshRef={fresh}
            warnRefs={warnRefs(seat)} pickPlate={plate}
            onActivate={(_key, card) => { if (picking && card && seat !== picking.seat && (card.zone === "monster"||card.zone==='extra-monster')) void declare(seat, card.ref); else if (card) openSubject(card); }}
            onAttack={(_key, card) => startAttack(seat, card)} onInspect={card => openSubject(card)} onPlate={() => { if (plate) void declare(seat); }}
            onLp={delta => void changeLp(seat, delta)} canLp={live} deckWarning={deckFlag(room, seat)?.message} onDeckFlag={el => { setFlagSeat(seat); layers.toggle("flag", el); }}
            cameraControl={seat === mySeat ? <CameraControl /> : undefined} turnIn={turnIn && seat === state.turnSeat}
            emptyFeedAction={seat === mySeat && !hub.cameraOn ? <button type="button" className={`${s.btn} ${s.sm} ${s.go}`} disabled={hub.starting} onClick={event => { event.stopPropagation(); void hub.enableCamera(); }} data-testid="camera-on-feed">{hub.starting ? "Starting…" : hub.solo ? "Turn camera on" : "Join table video"}</button> : undefined}
            emptyFeedText={bot ? "Test opponent. No camera." : seat === mySeat ? "Your camera is off." : `Waiting for ${name(seat)}'s camera.`} />;
        })}
      </main>
      <footer className={s.dock} aria-label="Voice and undo">
        <MicSection state={micState} level={voice.level} speaking={voice.speaking} muted={muted} ptt={ptt} held={held} service={voice.service} error={voice.micError}
          onMute={() => setMuted(v => !v)} onPtt={() => { setPtt(v => !v); setHeld(false); }} offTurn={!myTurn} />
        <VoxSection transcript={shownTranscript} proposal={chip} samples={trySaying(room.seats, mySeat)} onConfirm={() => { chip?.run(); setProposal(null); }} onCancel={cancelChip}
          onSample={text => void onFinal({ requestId: `sample-${Date.now()}`, text, normalizedText: text.toLowerCase(), cardMatches: [] }, "listen")} />
        <UndoSection label={undoText} enabled={canUndo} secondsLeft={left} flash={flash} histOpen={layers.layer === "hist"} onUndo={() => void doUndo()} onHist={el => layers.toggle("hist", el)} />
      </footer>
    </div>

    <IdleBanner closesAt={room.status === "active" && room.idleWarningAt !== null ? room.lastEventAt + REMOTE_IDLE_CLOSE_MS : null} now={serverNow()} onStay={() => void act({ type: "log.note", actorSeat: mySeat, text: "Still playing" })} />
    <LogDrawer open={layers.layer === "log"} entries={entries} onClose={() => layers.close("log")} rules={[`Format: ${formatLabel}`, `Starting LP: ${startingLp}`, "Undo window: 5 seconds, newest action only"]}
      extra={!solo ? <VisionFeedbackSetting promptOnly onChange={onFeedbackPref} /> : undefined}
      onConcede={!solo && mySeat >= 0 ? () => void act({ type: "player.concede", actorSeat: mySeat }) : undefined}
      seats={players.map(p => ({ seat: p.seat, name: p.name, color: p.color, turn: p.seat === state.turnSeat, lp: lpOf(p.seat), note: p.seat === state.turnSeat ? "Turn" : p.seat === nextSeat ? "Next" : "" }))} />
    <InspectorDrawer open={layers.layer === "insp"} onClose={() => layers.close("insp")}>
      <InspectorBody subject={subject} info={subjectInfo} warning={subject ? deckFlag(room, subject.seat)?.message : undefined} actions={actions}
        sourceLine={subject ? `Identified by ${subject.via} on ${name(subject.seat)}'s side` : ""} />
    </InspectorDrawer>
    <DeckFlagPopover open={layers.layer === "flag"} flag={deckFlag(room, flagSeat)} instances={room.state.deckChecks?.instances ?? []} canMerge={live && (solo || flagSeat === mySeat)} busy={!live}
      onDismiss={flag => { void act({ type: "deck.flag.dismiss", actorSeat: flagActor, flagId: flag.id, reason: "Player marked this flag as wrong" }); layers.close("flag"); }}
      onMerge={(flag, keep, remove) => { void act({ type: "twin.merge", actorSeat: solo ? flag.seat : mySeat, seat: flag.seat, keepInstanceId: keep, removeInstanceId: remove, reason: "Same physical card; system split the instance" }); layers.close("flag"); }}
      onClose={() => layers.close("flag")} />
    <HealthPopover open={layers.layer === "health"} rows={healthRows} onClose={() => layers.close("health")} />
    <HistoryPopover open={layers.layer === "hist"} items={history} canUndo={canUndo} style={{ right: 16, bottom: "calc(var(--dock) + 8px)" }} onUndo={() => { void doUndo(); layers.close("hist"); }} />
    {layers.layer === "card" && subject ? <CardPopover subject={subject} info={subjectInfo} at={popAt} warning={deckFlag(room, subject.seat)?.message} actions={actions} onClose={() => layers.close("card")} /> : null}
    {tray ? <RecognitionTray key={readCounter.current} tray={tray} aiAllowed={aiAllowed} onClose={closeTray} saying={micState === "listen"} onSay={() => toast("Say the card name, or “number two”.")}
      inDeck={id => { const flag = flagFor(tray.seat, id); return flag === null ? null : !flag; }} onPick={pick => void identify(pick, pick.via === "typed" ? "typed" : pick.via)} /> : null}
    <Peek peek={peek} />
    <Toasts items={toasts} />
  </div>;
}
