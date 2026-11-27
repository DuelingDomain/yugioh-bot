"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import { VisionFeedbackSetting, type FeedbackPreference } from "@/components/settings/vision-feedback-setting";
import { saveFieldClip, useFieldClipReady } from "@/lib/remote/clip-capture";
import { setFieldDebugEnabled, useFieldDebugEnabled, useFieldDeveloper, useGridPref, useHoverFreeze, useZoneGrid, writeGridPref, writeHoverFreeze } from "@/lib/remote/zone-grid";
import type { FieldScanState } from "@/lib/remote/zone-grid";
import type { ScanAdvice } from "@/lib/remote/scan-advice";
import { FieldOrientationSettings } from "../field-orientation";
import { feedTool } from "./feed";
import { Icon } from "./icons";
import { RecognitionBadge, RecordingBadge } from "./recognition-setting";
import { useVideoHub } from "./video-hub";
import { Row } from "./zone-actions";
import s from "./remote-ui.module.css";

/** What my own camera menu needs on top of the seat: the room (for my seat and the recording flag), the admin gate and the camera-off action. */
export type CameraMenuSetup = {
  room: RemoteRoom; isAdmin: boolean; /** The admin has the training-set collection on: field diagnostics are being saved. */ collecting: boolean;
  onFeedbackPref: (pref: FeedbackPreference) => void; onCameraOff: () => void;
};

const Group = ({ label, children }: { label: string; children: React.ReactNode }) => <div className={s.toolsGroup} role="group" aria-label={label}><span className={s.toolsLabel} aria-hidden="true">{label}</span>{children}</div>;
const onOff = (on: boolean) => on ? "On" : "Off";

/** My camera: which one, my side of the image, retry and off. Empty (no section) while the camera is off. */
function MyCameraGroup({ setup, close }: { setup: CameraMenuSetup; close: () => void }) {
  const hub = useVideoHub(), grid = useZoneGrid();
  const hasCamera = grid.ownSeat !== null && !!hub.sourceFor(grid.ownSeat);
  const phone = hub.phones.some(item => item.seat === setup.room.mySeat);
  const choose = hub.cameraOn && hub.devices.length > 1, side = !!grid.setCalibration && hasCamera;
  // The Camera section is always there. With the camera off its first row turns the camera on.
  const mine = grid.ownSeat === setup.room.mySeat || setup.room.mySeat >= 0;
  return <Group label="Camera">
    {!hub.cameraOn && mine ? <Row icon="cam" primary disabled={hub.starting} data-testid="camera-on-menu" sub={hub.starting ? "Starting the camera..." : undefined} onClick={() => { close(); void (hub.manual(setup.room.mySeat) ? hub.useWebcam() : hub.enableCamera()); }}>Turn camera on</Row> : null}
    {choose ? <label className={s.toolsField}><span>Which camera</span>
      <select value={hub.cameraId} data-testid="camera-choice" aria-label="Choose camera" onChange={event => void hub.selectCamera(event.target.value)}>
        {hub.devices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || "Camera"}</option>)}</select></label> : null}
    {side && grid.setCalibration ? <div className={s.toolsSide}><FieldOrientationSettings calibration={grid.calibration} defaultSide={grid.defaultSide} onChange={grid.setCalibration} /></div> : null}
    {hub.sendFailed ? <Row icon="refresh" data-testid="retry-video" onClick={() => { hub.retryVideo(); }}>Retry video</Row> : null}
    {hub.cameraOn ? <Row icon="camoff" data-testid="camera-off" onClick={() => { close(); setup.onCameraOff(); }}>{phone ? "Leave table video" : "Camera off"}</Row> : null}
  </Group>;
}

/** Tools for admins and developers. Each tool keeps the gate it had before: developer list, admin, recording users. */
function AdminRows({ setup }: { setup: CameraMenuSetup }) {
  const { room, isAdmin } = setup;
  const you = room.mySeat >= 0 && !room.spectator;
  // Debug and the clip need my own seat (`you`) as well as the developer flag.
  const developer = useFieldDeveloper() && you, debugOn = useFieldDebugEnabled(), clipReady = useFieldClipReady();
  const [clip, setClip] = useState<{ text: string; saved: boolean; detail: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const saveClip = () => {
    const result = saveFieldClip(); if (timer.current) clearTimeout(timer.current);
    setClip({
      saved: !!result?.saved,
      text: !result ? "No clip yet: the card reader is not running." : result.saved ? "Saved to your computer. Contains your camera view of the mat." : "Nothing recorded yet: the card reader has not read the camera since it last started.",
      detail: result?.saved ? `${result.stats.frames} frames, ${(result.stats.bytes / 1e6).toFixed(1)} MB, ${result.stats.events} events` : "",
    });
    timer.current = setTimeout(() => setClip(null), 6000);
  };
  const recording = room.recordingEnabled && you;
  if (!developer && !recording && !isAdmin) return null;
  return <Group label="Admin">
    {developer ? <Row icon="eye" role="menuitemcheckbox" aria-checked={debugOn} pill={onOff(debugOn)} sub="Shows what the field watcher sees: boxes, scores, tracks and reasons." data-testid="field-debug-toggle" onClick={() => setFieldDebugEnabled(!debugOn)}>Debug overlay</Row> : null}
    {developer ? <div className={s.toolsKv}><span>Detector</span><RecognitionBadge /></div> : null}
    {developer && clipReady ? <Row icon="hist" sub="The last 30 s of your mat camera and watcher events, saved on this computer. Nothing is uploaded." data-testid="field-clip-save" onClick={saveClip}>Save last 30 s</Row> : null}
    {clip ? <p className={s.toolsNote} role="status" data-testid="field-clip-note" title={clip.detail}>{clip.text}{clip.detail ? ` ${clip.detail}` : ""}</p> : null}
    {recording ? <div className={s.toolsKv}><span>Test recording<small>Your table camera is saved for recognition tests (video only, no sound).</small></span><RecordingBadge /></div> : null}
    {isAdmin ? <div className={s.toolsFeedback}><VisionFeedbackSetting onChange={setup.onFeedbackPref} /></div> : null}
    {isAdmin ? <div className={s.toolsKv}><span>Field diagnostics</span><b data-testid="field-diagnostics">{setup.collecting ? "collecting" : "off"}</b></div> : null}
  </Group>;
}

/**
 * The one "..." button on a webcam: everything about that camera, one click away, in four small sections.
 * Cards: Scan field now, Token, Freeze, Read board, Hover freeze (an opponent's menu: Token, Ask them to scan again, Freeze).
 * Zones: Show zone grid, Fit to my mat, Adjust zones. Camera: which camera, my side of the image, Retry video, Camera off.
 * Admin: debug and training tools, only for the people who had them before.
 * Rows are one line each; the longer notes are tooltips. The drawer Settings tab keeps the table-wide settings (detection, voice, view).
 */
export function CameraToolsMenu({ seat, name, you, scan, advice, warn, onToken, onRescan, setup, board }: {
  seat: number; name: string; you: boolean; /** 1v1: the virtual board under this webcam, on or off. */ board?: { on: boolean; onChange: (on: boolean) => void; /** Tap mode: the board is off for everyone and cannot be turned on here. */ locked?: boolean }; scan: FieldScanState | null; advice: ScanAdvice; /** A bad or lost feed: the button shows a warning dot. */ warn: boolean;
  onToken?: () => void; onRescan?: () => Promise<string>;
  /** My own seat only: the camera, side and admin rows. */ setup?: CameraMenuSetup;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const grid = useZoneGrid(), hub = useVideoHub();
  const zonesOn = useGridPref(you), opponentsOn = useGridPref(false), hoverFreeze = useHoverFreeze();
  useEffect(() => { if (!note) return; const timer = setTimeout(() => setNote(""), 4000); return () => clearTimeout(timer); }, [note]);
  // The menu hangs from the button's right edge and scrolls inside when the page is short.
  const place = useCallback(() => {
    const box = trigger.current?.getBoundingClientRect(), node = panel.current;
    if (!box || !node) return;
    // The menu stays above the bottom bar (also on a phone) and scrolls inside when it is taller.
    const floor = Math.min(window.innerHeight, document.querySelector('[data-testid="rail"]')?.getBoundingClientRect().top ?? window.innerHeight) - 8;
    node.style.maxHeight = `${Math.max(160, floor - box.bottom - 6)}px`;
    node.style.left = `${Math.max(8, Math.min(window.innerWidth - node.offsetWidth - 8, box.right - node.offsetWidth))}px`;
    node.style.top = `${Math.max(8, Math.min(floor - node.offsetHeight, box.bottom + 6))}px`;
  }, []);
  useEffect(() => {
    if (!open) return;
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    // The rows under a section (side buttons, admin switches) change the height after the first paint.
    const frame = requestAnimationFrame(place);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, place]);
  const close = () => panel.current?.hidePopover?.();
  const need = scan && scan.ready && !scan.scanning ? advice.reason : null;
  const who = you ? "my" : `${name}'s`;
  const hasCamera = grid.ownSeat !== null && !!hub.sourceFor(grid.ownSeat);
  const seatLive = !!hub.sourceFor(seat);
  const canZones = hasCamera && !!grid.calibrate && grid.ownSeat !== null;
  const calibrate = () => { close(); grid.calibrate?.(); };
  return <>
    <button type="button" ref={trigger} className={s.toolsBtn} popoverTarget={id} aria-haspopup="menu" aria-expanded={open} aria-label={`Camera tools for ${name}`} data-testid={`camera-tools-${seat}`} data-warn={warn || need ? "" : undefined}>
      <Icon name="cam" /><span className={s.toolsLbl}>Camera</span></button>
    <div id={id} ref={panel} popover="auto" role="menu" aria-label={`Camera tools for ${name}`} className={s.toolsMenu} onToggle={event => { setOpen(event.newState === "open"); if (event.newState === "open") place(); }}>
      {setup ? <MyCameraGroup setup={setup} close={close} /> : null}
      {board ? <Group label="View">
        <Row icon="eye" role="menuitemcheckbox" aria-checked={board.on} pill={onOff(board.on)} disabled={board.locked} sub={board.locked ? "This seat uses Tap mode, so its board is off for everyone." : "Hides or shows the virtual board under this webcam. The board keeps running."} data-testid={`camera-board-${seat}`}
          onClick={() => { close(); board.onChange(!board.on); }}>{`Virtual board under ${you ? "my" : `${name}'s`} webcam`}</Row>
      </Group> : null}
      <Group label="Zones">
        <Row icon="grid" role="menuitemcheckbox" aria-checked={zonesOn} pill={onOff(zonesOn)} hint={you ? "G" : undefined} aria-keyshortcuts={you ? "G" : undefined} data-testid={you ? "zone-grid-toggle" : `zone-grid-toggle-opponent-${seat}`}
          sub={you ? (zonesOn ? "Recommended: shows where your zones are." : "Zones are hidden on my webcam.") : "An opponent who uses Tap to identify has no zone grid, so none shows on that camera."}
          onClick={() => writeGridPref(you, !zonesOn)}>{you ? "Show zone grid" : "Show zone grid on opponent webcams"}</Row>
        {you ? <>
          <Row icon="grid" role="menuitemcheckbox" aria-checked={opponentsOn} pill={onOff(opponentsOn)} data-testid="zone-grid-toggle-opponent" sub="An opponent who uses Tap to identify has no zone grid, so none shows on that camera." onClick={() => writeGridPref(false, !opponentsOn)}>Show zone grid on opponent webcams</Row>
          <Row icon="scan" disabled={!canZones} data-testid="zone-grid-fit" sub={canZones ? "Fit the zone grid to your mat." : "Available once your camera video is showing."} onClick={calibrate}>Fit to my mat</Row>
          <Row icon="sliders" disabled={!canZones} data-testid="zone-grid-adjust" sub="Move, resize or turn the zone grid, and drag the sideways Banished zone." onClick={calibrate}>Adjust zones</Row></> : null}
      </Group>
      <Group label="Cards">
        {scan ? <Row icon="scan" hint={scan.ready ? "S" : undefined} aria-disabled={scan.scanning || !scan.ready} aria-keyshortcuts="S" data-testid="field-scan" data-need={need ? "" : undefined} data-scan-ms={advice.last?.totalMs} data-scan-sweep-ms={advice.last?.sweepMs}
          sub={scan.scanning ? "Scanning…" : scan.ready ? (need ?? "Use when a card is not read.") : "Turn the camera on to scan the field."}
          onClick={() => { if (scan.ready && !scan.scanning) { scan.scan?.(); close(); } }}>{scan.scanning ? "Scanning field…" : "Scan field now"}</Row> : null}
        {you ? <Row icon="card" hint="R" aria-keyshortcuts="R" disabled={!seatLive} data-testid={`camera-read-${seat}`} sub={seatLive ? "Freezes the picture, then reads every card" : "Turn the camera on to read the board."} onClick={() => { close(); feedTool(seat, "read"); }}>Read board</Row> : null}
        <Row icon="snow" hint="F" aria-keyshortcuts="F" disabled={!seatLive} data-testid={`camera-freeze-${seat}`} sub={seatLive ? undefined : "Turn the camera on to freeze the picture."} onClick={() => { close(); feedTool(seat, "freeze"); }}>Freeze picture</Row>
        <Row icon="hand" role="menuitemcheckbox" aria-checked={hoverFreeze} pill={onOff(hoverFreeze)} sub="Freezes the frame when the pointer rests on a camera." data-testid={you ? "hover-freeze" : `hover-freeze-${seat}`} onClick={() => writeHoverFreeze(!hoverFreeze)}>Freeze while hovering a card</Row>
        {onToken ? <Row icon="coin" data-testid={`camera-token-${seat}`} onClick={() => { close(); onToken(); }}>{`Token on ${who} field`}</Row> : null}
        {!you && onRescan ? <Row icon="refresh" data-testid={`field-rescan-${seat}`} data-sent={note || undefined} sub={note || undefined} onClick={() => { if (!note) void onRescan().then(setNote); }}>{`Ask ${name} to scan again`}</Row> : null}
      </Group>
      {setup && open ? <AdminRows setup={setup} /> : null}
    </div>
  </>;
}
