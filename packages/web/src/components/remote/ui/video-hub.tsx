"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import type { PhoneMember, PhoneScan } from "@/lib/remote/phone-protocol";
import { ConnectionState } from "livekit-client";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import { RemoteVideo, type VideoSnapshot } from "@/lib/remote/video";
import { cardInfo, loadCards } from "./catalog";
import { deckIdsOf, seenCardIds } from "./model";
import { makeRecognizeRawFeed, readCard, askAi, recordFeedback, peekCard, readBoard, disposeRecognizer, prewarmRecognizer, type AiAnswer, type BoardAnswer, type FeedbackSource, type PeekAnswer, type ReadCard, type ReadResult } from "./recognizer";

export type Health = { q: "good" | "warn" | "bad" | "off"; label: string; detail: string };
/** Something a <video> element can show. Local previews and LiveKit tracks look the same to the tile. */
export type FeedSource = { attach: (el: HTMLVideoElement) => () => void; local: boolean };

type Hub = {
  solo: boolean;
  phones: PhoneMember[];
  phoneScan: PhoneScan | null;
  clearPhoneScan(note?: string): void;
  manual(seat: number): boolean;
  refreshPhones(): Promise<unknown>;
  receivePhone(): Promise<void>;
  answerPhoneScan(note: string): void;
  connection: ConnectionState | "local" | "off";
  cameraOn: boolean;
  starting: boolean;
  error: string;
  devices: MediaDeviceInfo[];
  cameraId: string;
  micPublished: boolean;
  sourceFor(seat: number): FeedSource | null;
  health(seat: number): Health;
  setFrozen(seat: number, frozen: boolean): void;
  enableCamera(): Promise<void>;
  disableCamera(): Promise<void>;
  selectCamera(id: string): Promise<void>;
  setMic(on: boolean): void;
  /** Reads the card at a normalized point of a seat's feed. */
  read(seat: number, x: number, y: number, card?: ReadCard, frames?: HTMLCanvasElement[]): Promise<ReadResult>;
  /** Optional AI second opinion on a read. Owner only; answers "off" where the server has it disabled. */
  askAi(token: number): Promise<AiAnswer>;
  /** Saves a confirmed card as a training sample (only when this person opted in). Never throws. */
  recordFeedback(token: number, passcode: number, source: FeedbackSource): Promise<{ ok: boolean; note: string }>;
  /** Names one outlined card of a frozen frame. Local only. */
  peek(seat: number, frame: HTMLCanvasElement, card: ReadCard, cards: ReadCard[], signal: AbortSignal): Promise<PeekAnswer>;
  /** Reads all outlined cards of a frozen frame. Local only. */
  readBoard(seat: number, frame: HTMLCanvasElement, cards: ReadCard[], signal: AbortSignal): Promise<BoardAnswer>;
};
const noop = async () => undefined;
const Ctx = createContext<Hub>({ phones: [], phoneScan: null, clearPhoneScan: () => undefined, manual: () => false, refreshPhones: async () => undefined, receivePhone: noop, answerPhoneScan: () => undefined, solo: true, connection: "off", cameraOn: false, starting: false, error: "", devices: [], cameraId: "", micPublished: false,
  sourceFor: () => null, health: () => ({ q: "off", label: "No feed", detail: "" }), setFrozen: () => undefined, enableCamera: noop, disableCamera: noop, selectCamera: noop, setMic: () => undefined,
  read: async () => ({ guesses: [], reader: "none", frames: 0, note: "" }), askAi: async () => ({ status: "off", note: "" }), recordFeedback: async () => ({ ok: false, note: "" }),
  peek: async () => ({ status: "unavailable", note: "" }), readBoard: async () => ({ status: "unavailable", note: "" }) });
export const useVideoHub = () => useContext(Ctx);

const emptySnapshot: VideoSnapshot = { connection: ConnectionState.Disconnected, feeds: [], devices: [], cameraId: "", microphone: false, error: "" };

export function VideoHubProvider({ room, children }: { room: RemoteRoom; children: ReactNode }) {
  const solo = room.solo;
  const roster = useSWR<{phones: PhoneMember[];modes:{seat:number;mode:string}[]}>(`remote-phones:${room.slug}`, async () => {
    const response = await fetch(`/api/remote/${room.slug}/phone`, {cache:"no-store"});
    if (!response.ok) return {phones:[],modes:[]};
    return response.json();
  }, {refreshInterval:1500});
  const phones = roster.data?.phones ?? [];
  const phoneWanted = phones.some(p => p.seat === room.mySeat);
  const localOnly = solo && !phoneWanted;
  const [phoneScan,setPhoneScan] = useState<PhoneScan|null>(null);
  const manual = useCallback((seat:number) => roster.data?.modes.some(m => m.seat===seat && m.mode==="manual") ?? false,[roster.data]);
  const roomRef = useRef(room); roomRef.current = room;
  const [controller, setController] = useState<RemoteVideo | null>(null);
  const [snap, setSnap] = useState<VideoSnapshot>(emptySnapshot);
  const [frozen, setFrozenState] = useState<Record<number, boolean>>({});
  // Stable: the feed restarts its frame watch when this changes, and a restart would hide a stall for 3 s each time.
  const setFrozen = useCallback((seat: number, value: boolean) => setFrozenState(old => old[seat] === value ? old : { ...old, [seat]: value }), []);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [localError, setLocalError] = useState("");
  const [localDevices, setLocalDevices] = useState<MediaDeviceInfo[]>([]);
  const [localCamera, setLocalCamera] = useState("");
  const [micOn, setMicOn] = useState(false);
  const localRef = useRef<MediaStream | null>(null);
  const members = JSON.stringify(room.seats.map(({ seat, userId }) => ({ seat, userId })));
  const mySeat = room.mySeat;

  useEffect(() => { if(room.status==="ended")disposeRecognizer();else void prewarmRecognizer(); }, [room.slug, room.status === "ended", localOnly, phoneWanted]);

  useEffect(() => {
    if (localOnly || room.status === "ended") return;
    const video = new RemoteVideo({
      slug: room.slug, guildId: room.guildId, seat: mySeat, members: JSON.parse(members),
      onPhoneScan: setPhoneScan, onPhonePresence: () => { void roster.mutate(); },
      readPhone: (canvas,point,signal) => readCard(null,point,{decklist:[],seen:[]},signal,undefined,[canvas]),
      recognize: makeRecognizeRawFeed(
        async ids => { await loadCards(ids); return new Map(ids.flatMap(id => { const info = cardInfo(id); return info ? [[id, info.name] as const] : []; })); }),
    });
    setController(video); setSnap(video.getSnapshot());
    const off = video.subscribe(() => setSnap(video.getSnapshot()));
    return () => { off(); video.dispose(); setController(null); setSnap(emptySnapshot); };
    // The roster changes must keep the camera and the room connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.slug, room.guildId, mySeat, localOnly, room.status === "ended"]);
  useEffect(() => { controller?.setMembers(JSON.parse(members)); }, [controller, members]);
  const rosterKey = JSON.stringify(phones);
  useEffect(() => { controller?.phone.setRoster(JSON.parse(rosterKey),JSON.parse(members)); },[controller,rosterKey,members]);
  useEffect(() => {
    if(controller && (phoneWanted || phones.some(p=>p.paired)) && controller.getSnapshot().connection===ConnectionState.Disconnected)
      void controller.connect("",false);
  },[controller,phoneWanted,rosterKey]);
  useEffect(() => { if(phoneScan && !phones.some(p=>p.id===phoneScan.pairId))setPhoneScan(null); },[rosterKey,phoneScan]);
  useEffect(() => () => { localRef.current?.getTracks().forEach(t => t.stop()); disposeRecognizer(); }, []);

  const stopLocal = useCallback(() => { localRef.current?.getTracks().forEach(t => t.stop()); localRef.current = null; setLocal(null); }, []);
  useEffect(() => { if (phoneWanted) { stopLocal(); void controller?.suspendCamera().catch(e => controller.fail(e)); } },[phoneWanted,controller,stopLocal]);
  const startLocal = useCallback(async (deviceId: string) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("The camera needs HTTPS or localhost and browser permission.");
    stopLocal();
    const media = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 16 / 9 } } : { width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 16 / 9 } }, audio: false });
    localRef.current = media; setLocal(media); setLocalCamera(media.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId);
    setLocalDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput"));
  }, [stopLocal]);

  const connected = snap.connection === ConnectionState.Connected;
  const guard = useCallback(async (work: () => Promise<unknown>) => {
    setStarting(true); setLocalError("");
    try { await work(); } catch (e) { const message = e instanceof Error ? e.message : "Camera unavailable"; setLocalError(message); controller?.fail(e); }
    finally { setStarting(false); }
  }, [controller]);

  const enableCamera = useCallback(() => guard(async () => {
    if(phoneWanted){await controller?.connect("",false);return;}
    const response=await fetch(`/api/remote/${roomRef.current.slug}/phone`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({mode:"webcam"})});
    if(!response.ok)throw new Error("Could not select webcam mode");
    await roster.mutate();
    if(localOnly)await startLocal(localCamera);else await controller?.connect();
  }), [guard, localOnly, phoneWanted, startLocal, localCamera, controller,roster.mutate]);
  const disableCamera = useCallback(() => guard(async () => { if (localOnly) stopLocal(); else await controller?.stop(); }), [guard, localOnly, stopLocal, controller]);
  const selectCamera = useCallback((id: string) => guard(() => localOnly ? startLocal(id) : controller ? controller.selectCamera(id) : Promise.resolve()), [guard, localOnly, startLocal, controller]);
  const setMic = useCallback((on: boolean) => { setMicOn(on); if (controller && connected) void controller.setMicrophone(on).catch(e => controller.fail(e)); }, [controller, connected]);

  // The same source object must come back while the stream is the same. A new object on every render would re-attach the <video> and reset it.
  const sources = useRef(new Map<number, { key: unknown; source: FeedSource }>());
  const sourceFor = useCallback((seat: number): FeedSource | null => {
    const cached = (key: unknown, make: () => FeedSource): FeedSource => {
      const old = sources.current.get(seat); if (old && old.key === key) return old.source;
      const source = make(); sources.current.set(seat, { key, source }); return source;
    };
    if (localOnly) {
      if (seat !== mySeat || !local) { sources.current.delete(seat); return null; }
      return cached(local, () => ({ local: true, attach: el => { el.srcObject = local; void el.play().catch(() => undefined); return () => { if (el.srcObject === local) el.srcObject = null; }; } }));
    }
    const track = snap.feeds.find(f => f.seat === seat)?.video;
    if (!track) { sources.current.delete(seat); return null; }
    return cached(track, () => ({ local: track.isLocal, attach: el => { track.attach(el); return () => { track.detach(el); }; } }));
  }, [localOnly, mySeat, local, snap.feeds]);

  const health = useCallback((seat: number): Health => {
    if (room.seats.find(s => s.seat === seat)?.bot) return { q: "off", label: "No camera", detail: "Test opponent" };
    if (manual(seat)) return { q: "off", label: "No camera (manual)", detail: "Voice, typing and board twin" };
    if (localOnly) return local ? { q: "good", label: "Live", detail: "Local preview" } : { q: "off", label: "Camera off", detail: "Turn the camera on" };
    if (snap.connection === ConnectionState.Reconnecting || (snap.signalLost && snap.connection !== ConnectionState.Disconnected)) return { q: "warn", label: "Reconnecting", detail: "Your connection to table video dropped" };
    const feed = snap.feeds.find(f => f.seat === seat);
    if (feed?.video && frozen[seat]) return {q:"bad",label:"Frozen",detail:"No phone frames for 3 s"};
    if (feed?.phone) return {q:"good",label:feed.mode === "scan" ? "Scan mode" : "Phone camera · connected",detail:feed.mode === "scan" ? "Use the board twin and log" : "Live phone field camera"};
    if (!feed?.video) return { q: "bad", label: "No feed", detail: connected ? "Disconnected" : "Table video is off" };
    if (frozen[seat]) return { q: "bad", label: "Frozen", detail: "No frames for 3 s" };
    if (feed.muted) return { q: "warn", label: "Camera muted", detail: "" };
    const q = String(feed.quality);
    if (/poor/i.test(q)) return { q: "warn", label: "Weak", detail: "Poor connection" };
    if (/lost/i.test(q)) return { q: "bad", label: "Lost", detail: "Connection lost" };
    return { q: "good", label: "Good", detail: q === "unknown" ? "Live" : q };
  }, [room.seats, localOnly, local, snap.feeds, snap.connection, snap.signalLost, connected, frozen, manual]);

  const wait = useRef(new Map<string, (r: ReadResult) => void>());
  useEffect(() => {
    const result = snap.result; if (!result) return;
    const done = wait.current.get(result.message.requestId); if (!done) return;
    wait.current.delete(result.message.requestId);
    const { candidates, tier, faceDown, covered } = result.message;
    done({ guesses: candidates.map(c => ({ cardId: c.cardId, name: c.name, score: c.score })), reader: "vision", frames: 0, note: faceDown ? "This card is face down." : `Read on seat ${result.fromSeat + 1}'s device`, tier, faceDown, covered });
  }, [snap.result]);

  const snapRef = useRef(snap); snapRef.current = snap;
  const read = useCallback(async (seat: number, x: number, y: number, card?: ReadCard, frames?: HTMLCanvasElement[]): Promise<ReadResult> => {
    const current = roomRef.current;
    const priors = { decklist: deckIdsOf(current, seat), seen: seenCardIds(current) };
    // Own webcam reads retain the worker's queue-aware timeout and native frame ring.
    if (seat === mySeat && !controller?.phone.forSeat(mySeat)) {
      const track = localOnly ? localRef.current?.getVideoTracks()[0] : controller?.rawLocalTrack;
      return readCard(track ?? null, { x, y }, priors, new AbortController().signal, card, frames, true);
    }
    const noSignal = new AbortController().signal;
    const feed = snapRef.current.feeds.find(f => f.seat === seat)?.video;
    if (!controller || (!feed && !controller.phone.forSeat(seat))) return readCard(null, { x, y }, priors, noSignal);
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), controller.phone.forSeat(seat) ? 60_000 : 10_000);
    let requestId = "";
    try {
      if (seat === mySeat && controller.phone.forSeat(mySeat)) return await controller.phone.read(x, y, abort.signal);
      const early = new Promise<ReadResult>(resolve => {
        controller.requestRecognition(seat, x, y).then(id => { requestId = id; if (abort.signal.aborted) wait.current.delete(id); else wait.current.set(id, resolve); })
          .catch(e => { controller.fail(e); resolve({ guesses: [], reader: "none", frames: 0, note: e instanceof Error ? e.message : "Request failed" }); });
        abort.signal.addEventListener("abort", () => resolve({ guesses: [], reader: "none", frames: 0, note: "No answer from the feed owner" }), { once: true });
      });
      const answer = await early;
      if (answer.guesses.length || answer.faceDown) return answer;
      const fallback = await readCard(null, { x, y }, priors, noSignal);
      return { ...fallback, note: answer.note || "The feed owner's reader found no card. Showing cards from the decklist." };
    } finally { clearTimeout(timer); if (requestId) wait.current.delete(requestId); }
  }, [mySeat, localOnly, controller]);

  const priorsOf = useCallback((seat: number) => ({ decklist: deckIdsOf(roomRef.current, seat), seen: seenCardIds(roomRef.current) }), []);
  const peek = useCallback((seat: number, frame: HTMLCanvasElement, card: ReadCard, cards: ReadCard[], signal: AbortSignal) => peekCard(frame, card, cards, priorsOf(seat), signal), [priorsOf]);
  const board = useCallback((seat: number, frame: HTMLCanvasElement, cards: ReadCard[], signal: AbortSignal) => readBoard(frame, cards, priorsOf(seat), signal), [priorsOf]);

  const value = useMemo<Hub>(() => ({
    solo, phones, phoneScan, manual, refreshPhones: roster.mutate,
    receivePhone: async () => { stopLocal(); await controller?.connect("",false); },
    answerPhoneScan: note => {if(phoneScan)controller?.phone.answer(phoneScan.id,note);},
    clearPhoneScan: note => {if(phoneScan)controller?.phone.answer(phoneScan.id,note ?? "Scan cancelled. Try again when ready.");setPhoneScan(null);},
    connection: localOnly ? (local ? "local" : "off") : snap.connection, cameraOn: localOnly ? !!local : connected, starting: starting || snap.connection === ConnectionState.Connecting || snap.connection === ConnectionState.Reconnecting,
    error: localError || snap.error, devices: localOnly ? localDevices : snap.devices, cameraId: localOnly ? localCamera : snap.cameraId, micPublished: micOn && connected,
    sourceFor, health, setFrozen,
    enableCamera, disableCamera, selectCamera, setMic, read, askAi, recordFeedback, peek, readBoard: board,
  }), [solo, localOnly, phones, phoneScan, manual, roster.mutate, stopLocal, controller, local, snap, connected, starting, localError, localDevices, localCamera, micOn, sourceFor, health, enableCamera, disableCamera, selectCamera, setMic, setFrozen, read, peek, board]);
  return <Ctx value={value}>{children}</Ctx>;
}
