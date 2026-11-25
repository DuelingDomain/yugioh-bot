"use client";

import type { ReactNode } from "react";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import { ThemedSelect } from "@/components/ui/themed-select";
import { useCardDetection, useFieldWatcherError } from "@/lib/remote/zone-grid";
import type { useCameraLock } from "@/lib/remote/use-camera-lock";
import { SET_GUARD_SETTINGS, useSetGuards } from "@/lib/remote/set-card-settings";
import { PhonePairing } from "../phone/pairing";
import { adminWatchHref, useAdminWatchTables } from "./admin-watch-list";
import { remoteFormatName } from "./create";
import { CARD_READERS, RECOGNITION_MODES, setCardReader, setRecognitionMode, useRecognitionBackend } from "./recognition-backend";
import { RecognitionBadge } from "./recognition-setting";
import { useVideoHub } from "./video-hub";
import { Icon } from "./icons";
import d from "./table-drawer.module.css";

/** A row with a label (and a small note) on the left and the control on the right. */
function Row({ label, note, children, stack = false, testId }: { label: ReactNode; note?: ReactNode; children?: ReactNode; stack?: boolean; testId?: string }) {
  return <div className={`${d.row} ${stack ? d.stack : ""}`} data-testid={testId}><span>{label}{note ? <small>{note}</small> : null}</span>{children ? <div className={d.ctl}>{children}</div> : null}</div>;
}

function Switch({ on, onChange, label, disabled, testId }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; testId?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={d.tog} disabled={disabled} data-testid={testId} onClick={() => onChange(!on)} />;
}

const Group = ({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) => <section className={d.sec} data-testid={testId}><h3>{title}</h3>{children}</section>;

const SET_CHECK_NOTES: Record<string, string> = {
  positiveBack: "A face-down card needs a clear look at its back.", prompt: "Ask you when a Set card is not sure.",
  ignore: "Do not ask again about something you marked Not a card.", startup: "Skip objects on the mat when the duel starts.", handRelease: "Wait until a hand lets go of a card.",
};

/** The five Set card checks as switches, folded away by default: the header says how many are on. */
function SetChecks() {
  const { guards, set } = useSetGuards();
  const on = SET_GUARD_SETTINGS.filter(({ key }) => guards[key]).length;
  return <section className={d.sec} data-testid="drawer-set-checks">
    <details className={`${d.det} ${d.first}`}>
      <summary><Icon name="chev" />Set card checks<em>{on} on</em></summary>
      {SET_GUARD_SETTINGS.map(({ key, label }) => <Row key={key} label={label} note={SET_CHECK_NOTES[key]}><Switch on={guards[key]} onChange={on => set(key, on)} label={label} testId={`set-check-${key}`} /></Row>)}
    </details>
  </section>;
}

/** Card detection, recognition and the reader as rows: the label on the left, the control on the right. */
function DetectionRows({ phone }: { phone: boolean }) {
  const detection = useCardDetection();
  const { mode, reader, hybridEnabled } = useRecognitionBackend();
  const readers = hybridEnabled ? CARD_READERS : CARD_READERS.filter(item => item.value === "current");
  const hint = RECOGNITION_MODES.find(item => item.value === mode)?.hint;
  return <>
    {detection ? <Row label="Card detection" note={detection.autoDetect ? "Watches the field and keeps the board up to date." : "Click a card in any camera to read it."}>
      <ThemedSelect variant="menu" label="Card detection" hideLabel testId="card-detection" value={detection.autoDetect ? "auto" : "tap"}
        choices={[{ value: "auto", label: "Auto-detect" }, { value: "tap", label: "Tap to identify" }]} onChange={value => detection.set(value === "auto")} />
    </Row> : null}
    <Row label="Card recognition" note={hint}>
      <ThemedSelect variant="menu" label="Card recognition" hideLabel testId="recognition-mode" value={mode}
        choices={RECOGNITION_MODES.map(item => ({ value: item.value, label: item.label, description: item.hint }))} onChange={setRecognitionMode} />
    </Row>
    <Row label="Reading model"><ThemedSelect variant="menu" label="Reading model" hideLabel testId="card-reader" value={reader} choices={readers} onChange={setCardReader} /></Row>
    <Row label="Reading on" note="Where cards are read, and the last read time."><RecognitionBadge phoneCamera={phone} bare /></Row>
  </>;
}

/** Video to the table: 30 or 15 frames per second. It applies to the running camera at once. */
function VideoRateRow() {
  const hub = useVideoHub();
  if (!hub.videoRateAvailable) return null;
  return <Row label="Video to the table" note={hub.videoRate === 30 ? "Opponents see up to 30 frames per second." : "Uses less of this computer and network. Up to 15 frames per second."}>
    <ThemedSelect variant="menu" label="Video to the table" hideLabel testId="video-rate" value={String(hub.videoRate)}
      choices={[{ value: "30", label: "Smooth (30 fps)" }, { value: "15", label: "Lighter (15 fps)" }]} onChange={value => hub.setVideoRate(value === "15" ? 15 : 30)} />
  </Row>;
}

/** Camera lock as a switch row (brightness, colour and focus stay fixed), with Re-lock next to it. */
function CameraLockRow({ lock }: { lock: ReturnType<typeof useCameraLock> }) {
  const status = !lock.available ? "Camera lock works only with a webcam on this computer." : lock.note || (!lock.supported ? "Not supported by this browser or camera" : lock.enabled ? "" : "Camera lock is off.");
  return <div data-testid="camera-lock">
    <Row label="Camera lock" note="Keeps brightness, colour and focus fixed so card reading stays steady.">
      {lock.supported ? <button type="button" className={d.mini} disabled={!lock.available || !lock.enabled || lock.busy} onClick={() => void lock.relock()}>Re-lock</button> : null}
      <Switch on={lock.enabled} disabled={!lock.available || lock.busy} onChange={on => void lock.setEnabled(on)} label="Camera lock" testId="camera-lock-switch" />
    </Row>
    {status ? <p className={d.hint} role="status">{status}</p> : null}
  </div>;
}

/** The voice settings. The live meter, Mute and the Heard chip stay in the bottom bar. */
export type DrawerVoice = {
  /** The microphones this computer has. Labels are empty until the browser gave mic permission. */ mics: MediaDeviceInfo[];
  /** The chosen microphone. Empty is the system default. */ micId: string; onMic: (id: string) => void;
  ptt: boolean; onPtt: (on: boolean) => void;
  /** Voice commands are on: show push-to-talk, the voice method and the example commands. */ recognition: boolean;
  /** The voice method dropdown (and the voice test tools). */ method: ReactNode;
};

export type DrawerSettingsProps = {
  room: RemoteRoom;
  /** True when the virtual fields are hidden. The View switch turns them on. */
  webcamOnly: boolean; onView: (webcamOnly: boolean) => void;
  /** 3-way and 4-way tables run on cameras: the board switch is off there. */
  viewLocked: boolean;
  /** Null when the table has no voice. */ voice: DrawerVoice | null;
};

/**
 * Settings tab: the global settings. Camera setup, Detection, Voice and View.
 * The per-camera tools (camera choice, zones, side, hover freeze, camera off) live in the webcam "..." menu.
 */
export function SettingsTab({ room, webcamOnly, onView, viewLocked, voice }: DrawerSettingsProps) {
  const hub = useVideoHub();
  const watcherError = useFieldWatcherError();
  const phone = hub.phones.some(item => item.seat === room.mySeat);
  return <>
    <Group title="Camera setup" testId="drawer-camera">
      <Row label="Camera source" stack testId="camera-source"><PhonePairing room={room} /></Row>
      <VideoRateRow />
      {hub.cameraLock ? <CameraLockRow lock={hub.cameraLock} /> : null}
      <p className={d.hint}>Camera choice, zones and the camera off switch are in the <b>...</b> menu on your webcam.</p>
    </Group>
    <Group title="Detection" testId="drawer-detection">
      <DetectionRows phone={phone} />
      {watcherError ? <p className={d.hint} role="status">{watcherError}</p> : null}
    </Group>
    <SetChecks />
    {voice ? <Group title="Voice" testId="drawer-voice">
      <Row label="Microphone" note={voice.mics.length ? undefined : "No microphone found yet. Allow the microphone to see your devices."}>
        <ThemedSelect variant="menu" label="Microphone" hideLabel placeholder="System default" value={voice.micId} testId="mic-choice"
          choices={[{ value: "", label: "System default" }, ...voice.mics.filter(mic => mic.deviceId && mic.deviceId !== "default").map((mic, index) => ({ value: mic.deviceId, label: mic.label || `Microphone ${index + 1}` }))]} onChange={voice.onMic} /></Row>
      {voice.recognition ? <>
        <Row label="Push to talk" note="Hold V to speak a command. Off by default."><Switch on={voice.ptt} onChange={voice.onPtt} label="Push to talk" testId="ptt-toggle" /></Row>
        <Row label="Voice method" stack>{voice.method}</Row>
        <p className={d.hint}>Say &quot;undo&quot;, &quot;pass turn&quot;, &quot;attack directly with Ash&quot;.</p></> : null}
    </Group> : null}
    <Group title="View" testId="drawer-view">
      <Row label={<>Virtual board<span className={d.beta}>BETA</span></>} note={viewLocked ? "Only at 1v1 tables. 3-way and 4-way tables run on the cameras." : "Shows the virtual fields next to the cameras (W)."}>
        <Switch on={!webcamOnly && !viewLocked} disabled={viewLocked} onChange={on => onView(!on)} label="Virtual board" testId="drawer-view-board" />
      </Row>
    </Group>
  </>;
}

/** Admin tab: only the table-wide tools. The camera and vision tools are in the webcam "..." menu. */
export function AdminTab({ room, isAdmin }: { room: RemoteRoom; isAdmin: boolean }) {
  const tables = useAdminWatchTables();
  const others = (tables ?? []).filter(table => table.slug !== room.slug && table.status !== "ended");
  if (!isAdmin) return null;
  return <Group title="Tables" testId="drawer-tables">
    {others.length ? <div className={d.links}>{others.map(table => <a key={table.slug} href={adminWatchHref(table.slug)} data-testid={`admin-watch-${table.slug}`}>Watch · {remoteFormatName(table.format?.id)} · {table.seats.length}/{table.seatCount} seats{table.visibility === "private" ? " · private" : ""}</a>)}</div>
      : tables ? <p className={d.hint} role="status" data-testid="admin-tables-empty">No other live tables right now. A table that opens shows up here, and you can watch it.</p>
        : <div className={d.skel} role="status" aria-label="Loading tables" data-testid="admin-tables-loading"><i /><i /><i /></div>}
  </Group>;
}
