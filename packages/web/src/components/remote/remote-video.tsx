"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ConnectionState } from "livekit-client";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import { RemoteVideo, type VideoSnapshot } from "@/lib/remote/video";
import { watchVideoFrames } from "@/lib/remote/video-protocol";
import { remoteButton } from "./remote-seat-panel";

const empty: VideoSnapshot = { connection: ConnectionState.Disconnected, feeds: [], devices: [], cameraId: "", microphone: false, error: "" };
const VideoContext = createContext<{ controller: RemoteVideo | null; state: VideoSnapshot }>({ controller: null, state: empty });

/** UI workers can reuse this provider, controls and independent per-seat tiles. */
export function RemoteVideoProvider({ room, children }: { room: RemoteRoom; children: ReactNode }) {
  const [controller, setController] = useState<RemoteVideo | null>(null);
  const [state, setState] = useState(empty);
  const members = JSON.stringify(room.seats.map(({ seat, userId }) => ({ seat, userId })));
  useEffect(() => {
    if (room.solo || room.status === "ended") return;
    const video = new RemoteVideo({ slug: room.slug, guildId: room.guildId, seat: room.mySeat, members: JSON.parse(members) });
    setController(video); setState(video.getSnapshot());
    const unsubscribe = video.subscribe(() => setState(video.getSnapshot()));
    return () => { unsubscribe(); video.dispose(); setController(null); setState(empty); };
    // Roster updates must preserve the active camera and room connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.slug, room.guildId, room.mySeat, room.solo, room.status === "ended"]);
  useEffect(() => { controller?.setMembers(JSON.parse(members)); }, [controller, members]);
  return <VideoContext value={{ controller, state }}><RemoteVideoControls />{children}</VideoContext>;
}
function RemoteVideoControls() {
  const { controller, state } = useContext(VideoContext);
  const connected = state.connection === ConnectionState.Connected;
  const waiting = state.connection === ConnectionState.Connecting || state.connection === ConnectionState.Reconnecting;
  const run = (promise: Promise<unknown> | undefined) => { void promise?.catch(error => controller?.fail(error)); };
  return <div className="space-y-2">
    <p data-testid="video-connection" role="status">Video {state.connection}</p>
    <div className="flex flex-wrap items-center gap-2">
      <button className={remoteButton} disabled={!controller || waiting} onClick={() => run(connected ? controller?.stop() : controller?.connect())}>
        {connected ? "Stop table video" : "Enable table video"}
      </button>
      <label className="grid gap-1 text-sm">Field camera<select className={remoteButton} value={state.cameraId} disabled={!controller || waiting} onChange={event => run(controller?.selectCamera(event.target.value))}>
        <option value="">Default camera</option>
        {state.devices.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
      </select></label>
      <button className={remoteButton} disabled={!connected} onClick={() => run(controller?.setMicrophone(!state.microphone))}>{state.microphone ? "Mute microphone" : "Enable microphone"}</button>
      <button className={remoteButton} disabled={!connected} onClick={() => run(controller?.startAudio())}>Enable sound</button>
    </div>
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.result ? <p role="status">Seat {state.result.fromSeat + 1}: {state.result.message.candidates.length ? state.result.message.candidates.map(card => `${card.name} (${Math.round(card.score * 100)}%)`).join(", ") : "no recognition candidates (vision integration pending)."}</p> : null}
  </div>;
}

export function RemoteVideoTile({ seat }: { seat: number }) {
  const { controller, state } = useContext(VideoContext);
  const feed = state.feeds.find(feed => feed.seat === seat);
  const video = useRef<HTMLVideoElement>(null); const audio = useRef<HTMLAudioElement>(null);
  const [frozen, setFrozen] = useState(false);
  useEffect(() => {
    const element = video.current; const track = feed?.video;
    setFrozen(false);
    if (!element || !track) return;
    track.attach(element);
    const cleanup = watchVideoFrames(element, setFrozen);
    return () => { cleanup(); track.detach(element); };
  }, [feed?.video, state.cameraId]);
  useEffect(() => {
    const element = audio.current; const track = feed?.audio;
    if (!element || !track) return;
    track.attach(element); return () => { track.detach(element); };
  }, [feed?.audio]);
  const local = feed?.video?.isLocal ?? false;
  return <div className="space-y-2">
    <div className="flex aspect-video items-center justify-center bg-black text-white">
      {feed?.video ? <video ref={video} data-remote-seat={seat} aria-label={`Seat ${seat + 1} field camera`} autoPlay playsInline muted={local} className="h-full w-full object-contain"
        onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          // object-contain letterboxing must not shift normalized raw-frame coordinates.
          const scale = Math.min(bounds.width / event.currentTarget.videoWidth, bounds.height / event.currentTarget.videoHeight);
          const width = event.currentTarget.videoWidth * scale; const height = event.currentTarget.videoHeight * scale;
          const x = (event.clientX - bounds.left - (bounds.width - width) / 2) / width;
          const y = (event.clientY - bounds.top - (bounds.height - height) / 2) / height;
          if (x >= 0 && x <= 1 && y >= 0 && y <= 1) void controller?.requestRecognition(seat, x, y).catch(error => controller.fail(error));
        }} /> : <p className="text-sm">Seat {seat + 1} camera disconnected</p>}
      <audio ref={audio} autoPlay />
    </div>
    <p className="text-sm" data-testid={`feed-health-${seat}`} role="status">{feed?.video ? frozen ? "Feed frozen (no frames for 3 s)" : feed.muted ? "Camera muted" : "Live" : "Disconnected"}</p>
    {feed ? <p className="text-xs opacity-70">Connection quality: {feed.quality}</p> : null}
    <button className={remoteButton} disabled={!feed?.video || state.connection !== ConnectionState.Connected} onClick={() => { void controller?.requestRecognition(seat).catch(error => controller.fail(error)); }}>Recognize on seat {seat + 1}</button>
  </div>;
}
