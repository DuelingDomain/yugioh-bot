"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fieldGridCells, defaultGridCalibration, projectCell, straddledZones, useZoneGrid } from "@/lib/remote/zone-grid";
import s from "./remote-ui.module.css";

interface Box { left: number; top: number; width: number; height: number }
const GLOW_MS = 1400;
const inView = (p: { x: number; y: number }) => p.x > .01 && p.x < .99 && p.y > .01 && p.y < .99;

/**
 * A skeleton playmat over one camera feed: thin outlines and small zone labels, drawn through the saved calibration.
 * It sits on the video's own box, so it follows every resize and every swap of the video with the field.
 * Uncalibrated, the player sees a default grid with a link to calibrate.
 */
export function ZoneGridOverlay({ seat, box }: { seat: number; box: Box | null }) {
  const grid = useZoneGrid();
  const own = grid.ownSeat === seat;
  const calibration = own ? grid.calibration : undefined;
  const calibrated = !!calibration;
  const cells = useMemo(() => fieldGridCells(grid.format), [grid.format]);
  const shown = calibration ?? defaultGridCalibration();
  const projected = useMemo(() => cells.map(cell => ({ cell, ...projectCell(cell, shown) })), [cells, shown]);
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

  if (!box) return null;
  const frame: CSSProperties = { left: box.left, top: box.top, width: box.width, height: box.height };
  return <>
    <svg className={s.zgrid} style={frame} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" data-testid="zone-grid" data-calibrated={calibrated} data-seat={seat}>
      {projected.map(({ cell, corners }) => <polygon key={cell.zone} data-zone={cell.zone} data-glow={!!glow[cell.zone]} className={s.zgcell}
        points={corners.map(p => `${p.x},${p.y}`).join(" ")} />)}
    </svg>
    <div className={s.zglabels} style={frame} aria-hidden="true">
      {projected.filter(({ center }) => inView(center)).map(({ cell, center }) =>
        <span key={cell.zone} style={{ left: `${center.x * 100}%`, top: `${center.y * 100}%` }} data-glow={!!glow[cell.zone]}>{cell.label}</span>)}
      {hints.map(hint => <span key={hint.id} className={s.zghint} style={{ left: `${Math.min(88, Math.max(12, hint.x * 100))}%`, top: `${Math.max(4, hint.y * 100 - 3)}%` }}
        data-testid="zone-straddle" title={`Across ${hint.pair[0]} and ${hint.pair[1]}`}>Move into one zone</span>)}
      {own && !calibrated && grid.calibrate ? <button type="button" className={s.zgcal} data-testid="zone-grid-calibrate"
        onClick={event => { event.stopPropagation(); grid.calibrate?.(); }} onPointerDown={event => event.stopPropagation()}>Default grid · Calibrate</button> : null}
    </div>
  </>;
}
