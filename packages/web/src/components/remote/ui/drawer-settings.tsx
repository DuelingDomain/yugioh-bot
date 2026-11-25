"use client";

import type { ReactNode } from "react";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import { ThemedSelect } from "@/components/ui/themed-select";
import { useFieldWatcherError } from "@/lib/remote/zone-grid";
import { SET_GUARD_SETTINGS, useSetGuards } from "@/lib/remote/set-card-settings";
import { PhonePairing } from "../phone/pairing";
import { adminWatchHref, useAdminWatchTables } from "./admin-watch-list";
import { CameraLockControl } from "./camera-lock-control";
import { remoteFormatName } from "./create";
import { hasDeck } from "./model";
import { CardDetectionSetting, RecognitionBadge, RecognitionSetting, VideoRateSetting } from "./recognition-setting";
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

const SET_CHECK_NOTES: Record<string, string> = {
  positiveBack: "A face-down card needs a clear look at its back.", prompt: "Ask you when a Set card is not sure.",
  ignore: "Do not ask again about something you marked Not a card.", startup: "Skip objects on the mat when the duel starts.", handRelease: "Wait until a hand lets go of a card.",
};

/** The five Set card checks as switches (they were check boxes inside a second, doubled header). */
function SetChecks() {
  const { guards, set } = useSetGuards();
  return <>{SET_GUARD_SETTINGS.map(({ key, label }) => <Row key={key} label={label} note={SET_CHECK_NOTES[key]}><Switch on={guards[key]} onChange={on => set(key, on)} label={label} testId={`set-check-${key}`} /></Row>)}</>;
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
      <VideoRateSetting />
      {hub.cameraLock ? <CameraLockControl lock={hub.cameraLock} /> : null}
      <p className={d.hint}>Camera choice, zones and the camera off switch are in the <b>...</b> menu on your webcam.</p>
    </Group>
    <Group title="Detection" testId="drawer-detection">
      <CardDetectionSetting />
      <RecognitionSetting />
      <Row label="Now" note="Where card recognition runs and the last read time."><RecognitionBadge phoneCamera={phone} /></Row>
      {room.mySeat >= 0 && !room.spectator && !hasDeck(room, room.mySeat) ? <p className={d.hint} data-testid="deck-hint">Deck list (optional) — add one in the lobby next time; card detection gets faster and more accurate.</p> : null}
      {watcherError ? <p className={d.hint} role="status">{watcherError}</p> : null}
    </Group>
    <Group title="Set card checks" testId="drawer-set-checks"><SetChecks /></Group>
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
      : <p className={d.hint}>{tables ? "No other live tables." : "Loading tables…"}</p>}
  </Group>;
}
