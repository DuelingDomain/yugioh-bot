"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useFieldProfile, percentile, PROFILE_SEGMENTS } from "@/lib/remote/field-profile";
import { byAreaDesc, defaultSideFor, fieldGridCells, displayCalibration, projectCell, straddledZones, useZoneGrid, useFieldDebug, useFieldDebugEnabled, useFieldDeveloper } from "@/lib/remote/zone-grid";
import { cameraRates, trafficLine, type CameraRate, type CameraTraffic } from "@/lib/remote/video-stats";
import { FieldOrientationSelect } from "../field-orientation";
import { useVideoHub } from "./video-hub";
import { useRecognitionBackend } from "./recognition-backend";
import { useSendHealth } from "@/lib/remote/send-health-store";
import type { FieldCalibration, FieldTrack } from "@yugidraft/vision";
import s from "./remote-ui.module.css";

interface Box { left: number; top: number; width: number; height: number }
const GLOW_MS = 1400;
const inView = (p: { x: number; y: number }) => p.x > .01 && p.x < .99 && p.y > .01 && p.y < .99;

/**
 * A skeleton playmat over one camera feed: thin outlines and small zone labels, drawn through the saved calibration.
 * It sits on the video's own box, so it follows every resize and every swap of the video with the field.
 * Off by default (`visible`). While auto-detect waits for my zones, my own feed still draws a default grid with the calibrate controls.
 * With the grid off, only the "Move into one zone" hint stays: it helps recognition.
 */
export function ZoneGridOverlay({ seat, box, visible=true, onControlsEnter }: { seat: number; box: Box | null; visible?:boolean; onControlsEnter?:()=>void }) {
  const grid = useZoneGrid();
  const own = grid.ownSeat === seat;
  const hub=useVideoHub();
  const [remoteCalibration,setRemoteCalibration]=useState<FieldCalibration>();
  useEffect(()=>{
    if(own)return;
    const refresh=()=>{const next=hub.trackedCalibration?.(seat);setRemoteCalibration(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);};
    refresh();const timer=setInterval(refresh,500);return()=>clearInterval(timer);
  },[own,seat,hub.trackedCalibration]);
  const calibration = own ? grid.calibration : remoteCalibration;
  // Own feed: the shared rule (zones placed on the mat). Others: any grid the owner shares.
  const calibrated = own ? !!grid.placed : !!calibration;
  const cells = useMemo(() => fieldGridCells(grid.format,calibration?.zoneSpacing,calibration?.zones), [grid.format,calibration?.zoneSpacing,calibration?.zones]);
  // The guess for a seat with no saved side follows its camera: a webcam faces the player (flipped), a phone is held from the player's side.
  // Another seat used to get the phone guess always, so a webcam seat showed its zones turned the wrong way round.
  const defaultSide = own ? grid.defaultSide : defaultSideFor(hub.phones.some(p => p.seat === seat && p.paired) ? "phone" : "webcam");
  const shown = displayCalibration(calibration, defaultSide);
  const projected = useMemo(() => byAreaDesc(cells).map(cell => ({ cell, ...projectCell(cell, shown) })), [cells, shown]);
  const tracks = own ? grid.tracks : [];

  // The zone where a card was just detected glows for a moment.
  const seen = useRef(new Map<string, string>()); const [glow, setGlow] = useState<Record<string, number>>({});
  useEffect(() => {
    const now = Date.now(); const lit: string[] = [];
    for (const track of tracks) { if (seen.current.get(track.id) !== track.zone) lit.push(track.zone); seen.current.set(track.id, track.zone); }
    const ids = new Set(tracks.map(track => track.id)); for (const id of [...seen.current.keys()]) if (!ids.has(id)) seen.current.delete(id);
    if (!lit.length) return;
    setGlow(old => ({ ...old, ...Object.fromEntries(lit.map(zone => [zone, now])) }));
    const timer = setTimeout(() => setGlow(old => Object.fromEntries(Object.entries(old).filter(([, at]) => Date.now() - at < GLOW_MS))), GLOW_MS + 50);
    return () => clearTimeout(timer);
  }, [tracks]);

  const hints = useMemo(() => !calibrated ? [] : tracks.flatMap(track => {
    const pair = straddledZones(track.quad, calibration!, cells); if (!pair) return [];
    const x = track.quad.reduce((sum, p) => sum + p.x, 0) / 4, top = Math.min(...track.quad.map(p => p.y));
    return [{ id: track.id, pair, x, y: top }];
  }).slice(0, 3), [tracks, calibrated, calibration, cells]);

  const needsCalibration = own && !!grid.calibrationNeeded;
  if (!box) return null;
  const frame: CSSProperties = { left: box.left, top: box.top, width: box.width, height: box.height };
  const straddle = hints.map(hint => <span key={hint.id} className={s.zghint} style={{ left: `${Math.min(88, Math.max(12, hint.x * 100))}%`, top: `${Math.max(4, hint.y * 100 - 3)}%` }}
    data-testid="zone-straddle" title={`Across ${hint.pair[0]} and ${hint.pair[1]}`}>Move into one zone</span>);
  if (!visible && !needsCalibration) return hints.length ? <div className={s.zglabels} style={frame} aria-hidden="true">{straddle}</div> : null;
  return <>
    <svg className={s.zgrid} style={frame} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" data-testid="zone-grid" data-calibrated={calibrated} data-seat={seat}>
      {projected.map(({ cell, corners }) => <polygon key={cell.zone} data-zone={cell.zone} data-glow={!!glow[cell.zone]} className={s.zgcell}
        points={corners.map(p => `${p.x},${p.y}`).join(" ")} />)}
    </svg>
    <div className={s.zglabels} style={frame} aria-hidden="true">
      {projected.filter(({ center }) => inView(center)).map(({ cell, center }) =>
        <span key={cell.zone} style={{ left: `${center.x * 100}%`, top: `${center.y * 100}%` }} data-glow={!!glow[cell.zone]}>{cell.label}</span>)}
      {straddle}

    </div>
    {!own&&!calibration?<div className={s.zgcontrols} style={{left:box.left+8,top:box.top+36}}>Default grid · waiting for owner calibration</div>:null}
    {own&&grid.setCalibration?<div className={s.zgcontrols} style={{left:box.left+5,top:box.top+33,padding:3,maxWidth:Math.max(0,box.width-10)}}>
      <FieldOrientationSelect calibration={calibration} defaultSide={defaultSide} onChange={grid.setCalibration} onPointerEnter={onControlsEnter}/>
      {/* Saved zones are not asked for again here. The bar under the feed keeps Recalibrate for a new setup. */}
      {grid.calibrate&&!calibrated?<button type="button" className={s.fzbtn} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();grid.calibrate?.();}}>Default grid · Calibrate</button>:null}
    </div>:null}
  </>;
}

const pts = (quad: readonly { x: number; y: number }[]) => quad.map(p => `${p.x},${p.y}`).join(" ");
const top = (quad: readonly { x: number; y: number }[]) => ({ x: Math.min(...quad.map(p => p.x)), y: Math.min(...quad.map(p => p.y)), b: Math.max(...quad.map(p => p.y)) });
/**
 * Owner debug view on the own feed: raw detector boxes with score and use (cyan = used, red = not used),
 * the motion crop, and every track with its id, state and last decision. Local only.
 */
export function FieldDebugOverlay({ box }: { box: Box | null }) {
  const view = useFieldDebug(), allowed = useFieldDeveloper(), enabled = useFieldDebugEnabled();
  const hub = useVideoHub(), camera = hub.cameraLock?.debug;
  const traffic = useVideoTraffic(hub.trafficStats, allowed && enabled);
  const reader = useRecognitionBackend(), sendHealth = useSendHealth();
  if (!allowed || !enabled || !box || (!view && !camera && !traffic.length)) return null;
  const frame: CSSProperties = { left: box.left, top: box.top, width: box.width, height: box.height };
  const debug = view?.debug, live = view?.tracks.filter(t => !t.removed) ?? [];
  return <>
    <svg className={s.zgrid} style={{ ...frame, zIndex: 4 }} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" data-testid="field-debug">
      {debug?.region ? <rect x={debug.region.x} y={debug.region.y} width={debug.region.w} height={debug.region.h} fill="none" stroke="#ffd166" strokeWidth={.002} strokeDasharray=".01 .006" /> : null}
      {debug?.detections.map((d, i) => <polygon key={`d${i}`} points={pts(d.quad)} fill="none" stroke={d.use.startsWith("track") ? "#3fd0ff" : "#ff5a5a"} strokeWidth={.003} />)}
      {live.map(t => <polygon key={t.id} points={pts(t.card.quad)} fill="none" stroke={t.visible ? "#7dff9b" : "#c58bff"} strokeWidth={.002} strokeDasharray=".008 .005" />)}
    </svg>
    <div className={s.zglabels} style={{ ...frame, zIndex: 5 }} aria-hidden="true">
      {debug?.detections.map((d, i) => { const p = top(d.quad), bad = !d.use.startsWith("track"); return <span key={`d${i}`} className={`${s.zgdbg} ${s.zgraw}`} data-bad={bad} data-wide={bad || d.gap ? "true" : undefined} style={{ left: `${p.x * 100}%`, top: `${p.b * 100}%` }} title={`${d.kind === "face-down" ? "back" : "front"} ${d.confidence.toFixed(2)} · ${d.zone}${d.gap ? " · gap (between cells)" : ""} · ${d.use}`}>
        {d.kind === "face-down" ? "back" : "front"} {d.confidence.toFixed(2).replace(/^0/, "")} {d.zone}{d.gap ? " · gap" : ""}{bad ? ` · ${d.use}` : ""}</span>; })}
      {live.map(t => <TrackLabel key={t.id} t={t} reason={debug?.reasons[t.id]} face={view?.faces?.[t.id]} />)}
      <span style={{ left: 8, top: "auto", bottom: 8, position: "absolute", background: "rgb(0 0 0/.8)", color: "#fff", fontSize: 11, padding: "3px 6px", whiteSpace: "normal", maxWidth: "calc(100% - 16px)" }} data-testid="field-debug-status">
        {view ? <>{view.status} · last tick: {debug?.path ?? "—"} · detector {Math.round(view.detectorMs)} ms · every {Math.round(view.intervalMs)} ms · duty {view.dutyPercent.toFixed(0)}% · {debug?.detections.length ?? 0} boxes · {live.length} tracks{view.backend ? ` · ${view.backend}` : ""}{view.error ? ` · error: ${view.error}` : ""}{view.writeError ? ` · last write error: ${view.writeError}` : ""}{debug?.pileScores ? <><br />{`piles: ${Object.entries(debug.pileScores).map(([zone, score]) => `${zone} ${score == null ? "none" : score.toFixed(2)}`).join(" · ")}`}</> : null}{view.gate ? <><br />{`auto-placement: ${view.gate.live ? "live" : `held (${[!view.gate.enabled && "detection off", view.gate.syncHold && "sync hold", view.gate.calibrationNeeded && "calibration needed"].filter(Boolean).join(", ") || "room not active"})`} · placed events held ${view.gate.deferred} · dropped ${view.gate.dropped}`}</> : null}{view.gridShift && (view.gridShift.gap || view.gridShift.outside) ? <><br />{`grid: ${view.gridShift.gap} in a gap · ${view.gridShift.outside} outside${view.gridShift.suspect ? " · shift hint" : ""}`}</> : null}{view.shadow && view.shadow.share >= .01 ? <><br />{`shadow: ${Math.round(view.shadow.share * 100)}%${view.shadow.hold ? " · hold" : ""}`}</> : null}{view.blur && (view.blur.hold || view.blur.ratio < .8 || (view.blur.limit ?? 12) < 12) ? <><br />{`blur: ${view.blur.ratio.toFixed(2)}${view.blur.hold ? " · hold" : ""} · read limit ${(view.blur.limit ?? 12).toFixed(1)}`}</> : null}</> : null}
        {camera ? <>{view ? <br /> : null}{camera}</> : null}</span>
      <FieldProfilePanel />
      {traffic.length ? <span style={{ right: 8, top: 8, position: "absolute", background: "rgb(0 0 0/.82)", color: "#e8f6ff", fontSize: 10, lineHeight: 1.35, padding: "4px 6px", whiteSpace: "pre", fontFamily: "ui-monospace,monospace" }} title="Real WebRTC traffic per camera: RTP payload kbps over the last 2 s, without transport overhead" data-testid="field-debug-traffic">
        {traffic.map(trafficLine).join("\n")}
        {`\nvision ${reader.backend ?? "–"}${reader.ms === null ? "" : ` · ${reader.ms} ms per frame`}${sendHealth.visionSlowed ? "\nVision slowed to keep video smooth" : ""}`}
      </span> : null}
    </div>
  </>;
}

/** Samples the WebRTC counters of every camera every 2 s while the owner Debug view is on. */
function useVideoTraffic(read: () => Promise<CameraTraffic[]>, on: boolean): CameraRate[] {
  const [rates, setRates] = useState<CameraRate[]>([]);
  const latest = useRef(read); latest.current = read;
  useEffect(() => {
    if (!on) { setRates([]); return; }
    const before = new Map<string, CameraTraffic>();
    let stopped = false;
    const sample = async () => { try { const next = await latest.current(); if (!stopped) setRates(cameraRates(before, next)); } catch { /* No stats this tick. */ } };
    void sample(); const timer = setInterval(() => void sample(), 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [on]);
  return rates;
}

const STATE_SHORT: Record<FieldTrack["state"], string> = { candidate: "cand", identified: "id", prompt: "ask", dismissed: "off" };
/** One short line above the track box: `#c-74 M3 · id · up`. The reason is in the tooltip and shows when the label is clicked open. */
function TrackLabel({ t, reason, face }: { t: FieldTrack; reason?: string; face?: string }) {
  const [open, setOpen] = useState(false);
  const p = top(t.card.quad), line = `#${t.id.slice(-4)} ${t.zone} · ${STATE_SHORT[t.state]} · ${t.faceDown ? "down" : "up"}${t.under ? " · under" : t.visible === false ? " · hid" : ""}${face ? ` · ${face}` : ""}`;
  return <span className={s.zgdbg} data-hidden={t.visible === false} data-open={open} data-wide={t.state === "candidate" && reason ? "true" : undefined} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} title={`${line}${t.cardId ? ` · card ${t.cardId}` : ""}${reason ? ` — ${reason}` : ""}`}
    onClick={() => setOpen(v => !v)}>{line}{open ? `${t.cardId ? ` · card ${t.cardId}` : ""} — ${reason || "…"}` : t.state === "candidate" && reason ? ` — ${reason}` : ""}</span>;
}

const ms = (v: number | undefined) => v === undefined || !Number.isFinite(v) ? "–" : String(Math.round(v));
/** Placement profile (owner debug): last event per stage plus rolling p50/p90 over the last 50 placements. */
function FieldProfilePanel() {
  const { last, rows } = useFieldProfile();
  if (!last) return null;
  const d = last.detail, stat = (pick: (r: (typeof rows)[number]) => number | undefined) => { const v = rows.map(pick).filter((x): x is number => x !== undefined && Number.isFinite(x)); return `${ms(percentile(v, .5))}/${ms(percentile(v, .9))}`; };
  const detail: [string, string][] = [
    ["frame grab", "capture"], ["read clone", "readClone"], ["det preprocess", "detector.preprocess"], ["det inference", "detector.run"], ["det decode", "detector.decode"], ["det post", "detector.post"], ["det pixels", "detector.pixels"], ["det queue", "detector.queue"], ["det transfer", "detector.transfer"],
    ["read queue", "queue"], ["read pixels", "pixels"], ["warp", "warp"], ["emb preprocess", "embedPreprocess"], ["emb inference", "embedRun"], ["search", "search"], ["encode", "encode"], ["read transfer", "transfer"],
  ];
  return <span style={{ left: 8, top: 8, position: "absolute", background: "rgb(0 0 0/.82)", color: "#e8f6ff", fontSize: 10, lineHeight: 1.3, padding: "4px 6px", whiteSpace: "pre", fontFamily: "ui-monospace,monospace" }} data-testid="field-debug-profile">
    {`last ${last.type} ${ms(last.totalMs)} ms   (p50/p90 of ${rows.length})\n`}
    {PROFILE_SEGMENTS.map(k => `${k.padEnd(7)}${ms(last.segments[k]).padStart(6)}  ${stat(r => r.segments[k]).padStart(11)}`).join("\n")}
    {`\n${"total".padEnd(7)}${ms(last.totalMs).padStart(6)}  ${stat(r => r.totalMs).padStart(11)}\n`}
    {detail.map(([name, key]) => `${name.padEnd(15)}${ms(d[key]).padStart(5)}  ${stat(r => r.detail[key]).padStart(9)}`).join("\n")}
    {`\npreclean: on, cast=${d.precleanGainR === undefined ? "–" : [d.precleanGainR, d.precleanGainG, d.precleanGainB].map(v => (v ?? 1).toFixed(2)).join(",")}, glare=${d.precleanGlare === undefined ? "–" : d.precleanGlare.toFixed(1)}%, shadow=${d.precleanShadow === undefined ? "–" : d.precleanShadow.toFixed(0)}%, used=${d.precleanUsed === undefined ? "–" : d.precleanUsed ? "clean" : "raw"}${d.precleanMs === undefined ? "" : ` (${d.precleanMs.toFixed(1)} ms)`}`}
    {`\nreads ${d["n.reads"] ?? 0} · dropped ${d["n.readsDropped"] ?? 0} · embeds ${d.embedCount ?? 0} · det passes ${d["n.detects"] ?? 0} · face resets ${d["n.faceResets"] ?? 0}`}
  </span>;
}
