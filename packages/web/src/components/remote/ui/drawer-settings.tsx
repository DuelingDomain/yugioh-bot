"use client";

import { useRef, useState, type ReactNode } from "react";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import { ThemedSelect } from "@/components/ui/themed-select";
import { VisionFeedbackSetting, type FeedbackPreference } from "@/components/settings/vision-feedback-setting";
import { saveFieldClip, useFieldClipReady } from "@/lib/remote/clip-capture";
import { setFieldDebugEnabled, useFieldDebugEnabled, useFieldDeveloper, useFieldWatcherError, useGridPref, useHoverFreeze, useZoneGrid, writeGridPref, writeHoverFreeze } from "@/lib/remote/zone-grid";
import { FieldOrientationSettings } from "../field-orientation";
import { PhonePairing } from "../phone/pairing";
import { adminWatchHref, useAdminWatchTables } from "./admin-watch-list";
import { CameraLockControl } from "./camera-lock-control";
import { remoteFormatName } from "./create";
import { Icon } from "./icons";
import { hasDeck } from "./model";
import { CardDetectionSetting, RecognitionBadge, RecognitionSetting, RecordingBadge, SetCardSettings, VideoRateSetting } from "./recognition-setting";
import { useVideoHub } from "./video-hub";
import s from "./remote-ui.module.css";
import d from "./table-drawer.module.css";

/** A row with a label (and a small note) on the left and the control on the right. */
function Row({ label, note, children, stack = false, testId }: { label: ReactNode; note?: ReactNode; children?: ReactNode; stack?: boolean; testId?: string }) {
  return <div className={`${d.row} ${stack ? d.stack : ""}`} data-testid={testId}><span>{label}{note ? <small>{note}</small> : null}</span>{children ? <div className={d.ctl}>{children}</div> : null}</div>;
}

function Switch({ on, onChange, label, disabled, testId }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; testId?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={d.tog} disabled={disabled} data-testid={testId} onClick={() => onChange(!on)} />;
}

const Group = ({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) => <section className={d.sec} data-testid={testId}><h3>{title}</h3>{children}</section>;

export type DrawerSettingsProps = {
  room: RemoteRoom;
  /** True when the virtual fields are hidden. The View switch turns them on. */
  webcamOnly: boolean; onView: (webcamOnly: boolean) => void;
  /** 3-way and 4-way tables run on cameras: the board switch is off there. */
  viewLocked: boolean;
  /** Turn my camera off (also remembers the choice). */ onCameraOff: () => void;
  /** The voice rows (mic, push to talk, method). Null when the table has no voice. */ voice: ReactNode;
};

/** Settings tab: Camera, Detection, Voice and View. Every control is an existing setting; only the place changed. */
export function SettingsTab({ room, webcamOnly, onView, viewLocked, onCameraOff, voice }: DrawerSettingsProps) {
  const hub = useVideoHub(), grid = useZoneGrid();
  const ownGrid = useGridPref(true), opponentGrid = useGridPref(false), hoverFreeze = useHoverFreeze();
  const watcherError = useFieldWatcherError();
  const hasCamera = grid.ownSeat !== null && !!hub.sourceFor(grid.ownSeat);
  const phone = hub.phones.some(item => item.seat === room.mySeat);
  const canZones = hasCamera && !!grid.calibrate && grid.ownSeat !== null;
  const calibrate = () => grid.calibrate?.();
  return <>
    <Group title="Camera" testId="drawer-camera">
      <Row label="Camera source" stack testId="camera-source"><PhonePairing room={room} /></Row>
      {hub.cameraOn && hub.devices.length > 1 ? <Row label="Choose camera"><ThemedSelect variant="menu" label="Choose camera" hideLabel placeholder="Choose camera" value={hub.cameraId} testId="camera-choice"
        choices={hub.devices.map(device => ({ value: device.deviceId, label: device.label || "Camera" }))} onChange={id => void hub.selectCamera(id)} /></Row> : null}
      <VideoRateSetting />
      {hub.cameraLock ? <CameraLockControl lock={hub.cameraLock} /> : null}
      {grid.setCalibration && hasCamera ? <FieldOrientationSettings calibration={grid.calibration} defaultSide={grid.defaultSide} onChange={grid.setCalibration} /> : null}
      {hub.sendFailed || hub.cameraOn ? <Row label="Video">
        {hub.sendFailed ? <button type="button" className={`${s.btn} ${s.sm} ${s.go}`} data-testid="retry-video" onClick={() => hub.retryVideo()}>Retry video</button> : null}
        {hub.cameraOn ? <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} data-testid="camera-off" onClick={onCameraOff}><Icon name="camoff" />{phone ? "Leave table video" : "Camera off"}</button> : null}
      </Row> : null}
    </Group>
    <Group title="Detection" testId="drawer-detection">
      <CardDetectionSetting />
      <RecognitionSetting />
      <Row label="Now" note="Where card recognition runs and the last read time."><RecognitionBadge phoneCamera={phone} /></Row>
      {room.mySeat >= 0 && !room.spectator && !hasDeck(room, room.mySeat) ? <p className={d.hint} data-testid="deck-hint">Deck list (optional) — add one in the lobby next time; card detection gets faster and more accurate.</p> : null}
      {watcherError ? <p className={d.hint} role="status">{watcherError}</p> : null}
      <Row label="Freeze while hovering a card" note="Freezes the frame when the pointer rests on a camera."><Switch on={hoverFreeze} onChange={writeHoverFreeze} label="Freeze while hovering a card" testId="hover-freeze" /></Row>
      <Row label="Show zone grid" note="My webcam. Shows where your zones are."><Switch on={ownGrid} onChange={on => writeGridPref(true, on)} label="Show zone grid on my webcam" testId="zone-grid-toggle" /></Row>
      <Row label="Show zone grid on opponent webcams"><Switch on={opponentGrid} onChange={on => writeGridPref(false, on)} label="Show zone grid on opponent webcams" testId="zone-grid-toggle-opponent" /></Row>
      <Row label="Zones" note={canZones ? "Move, resize or turn the zone grid to fit your mat." : "Available once your camera video is showing."}>
        <button type="button" className={`${s.btn} ${s.sm}`} disabled={!canZones} onClick={calibrate} data-testid="zone-grid-fit">Fit to my mat</button>
        <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} disabled={!canZones} onClick={calibrate} data-testid="zone-grid-adjust">Adjust zones</button>
      </Row>
      <details className={d.det}><summary><Icon name="chev" />Set card checks<em>5 checks</em></summary><SetCardSettings /></details>
    </Group>
    {voice ? <Group title="Voice" testId="drawer-voice">{voice}</Group> : null}
    <Group title="View" testId="drawer-view">
      <Row label={<>Virtual board<span className={d.beta}>BETA</span></>} note={viewLocked ? "Only at 1v1 tables. 3-way and 4-way tables run on the cameras." : "Shows the virtual fields next to the cameras (W)."}>
        <Switch on={!webcamOnly && !viewLocked} disabled={viewLocked} onChange={on => onView(!on)} label="Virtual board" testId="drawer-view-board" />
      </Row>
    </Group>
  </>;
}

export type DrawerAdminProps = {
  room: RemoteRoom; isAdmin: boolean;
  /** The admin has the training-set collection on: field diagnostics are being saved. */ collecting: boolean;
  onFeedbackPref: (pref: FeedbackPreference) => void;
};

/** Admin tab. Each tool keeps the gate it had before: developer list, admin, recording users. */
export function AdminTab({ room, isAdmin, collecting, onFeedbackPref }: DrawerAdminProps) {
  const developer = useFieldDeveloper(), debugOn = useFieldDebugEnabled(), clipReady = useFieldClipReady();
  const tables = useAdminWatchTables();
  const [clip, setClip] = useState<{ text: string; saved: boolean; detail: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveClip = () => {
    const result = saveFieldClip(); if (timer.current) clearTimeout(timer.current);
    setClip({
      saved: !!result?.saved,
      text: !result ? "No clip yet: the card reader is not running." : result.saved ? "Saved to your computer. Contains your camera view of the mat." : "Nothing recorded yet: the card reader has not read the camera since it last started.",
      detail: result?.saved ? `${result.stats.frames} frames, ${(result.stats.bytes / 1e6).toFixed(1)} MB, ${result.stats.events} events` : "",
    });
    timer.current = setTimeout(() => setClip(null), 6000);
  };
  const others = (tables ?? []).filter(table => table.slug !== room.slug && table.status !== "ended");
  return <>
    {developer ? <Group title="Vision debug" testId="drawer-vision-debug">
      <Row label="Debug overlay" note="Shows what the field watcher sees: detector boxes, scores, tracks and reasons."><Switch on={debugOn} onChange={setFieldDebugEnabled} label="Debug overlay" testId="field-debug-toggle" /></Row>
      <Row label="Detector"><RecognitionBadge /></Row>
    </Group> : null}
    {developer || room.recordingEnabled || isAdmin ? <Group title="Capture" testId="drawer-capture">
      {developer && clipReady ? <Row label="Save last 30 s" note="The last 30 s of your mat camera and watcher events, saved to a file on this computer. Nothing is uploaded.">
        <button type="button" className={`${s.btn} ${s.sm}`} onClick={saveClip} data-testid="field-clip-save">Save</button></Row> : null}
      {clip ? <p className={d.hint} role="status" data-testid="field-clip-note" title={clip.detail}>{clip.text}{clip.detail ? ` ${clip.detail}` : ""}</p> : null}
      {room.recordingEnabled ? <Row label="Test recording" note="Your table camera is saved for recognition tests (video only, no sound)."><RecordingBadge /></Row> : null}
      {isAdmin ? <VisionFeedbackSetting onChange={onFeedbackPref} /> : null}
      {isAdmin ? <Row label="Field diagnostics"><span className={d.ro} data-testid="field-diagnostics">{collecting ? "collecting" : "off"}</span></Row> : null}
    </Group> : null}
    {isAdmin ? <Group title="Tables" testId="drawer-tables">
      {others.length ? <div className={d.links}>{others.map(table => <a key={table.slug} href={adminWatchHref(table.slug)} data-testid={`admin-watch-${table.slug}`}>Watch · {remoteFormatName(table.format?.id)} · {table.seats.length}/{table.seatCount} seats{table.visibility === "private" ? " · private" : ""}</a>)}</div>
        : <p className={d.hint}>{tables ? "No other live tables." : "Loading tables…"}</p>}
    </Group> : null}
  </>;
}
