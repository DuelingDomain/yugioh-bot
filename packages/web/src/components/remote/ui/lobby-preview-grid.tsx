"use client";

import type { FieldCalibration, FieldFormat } from "@yugidraft/vision";
import { byAreaDesc, defaultSideFor, displayCalibration, fieldGridCells, projectCell } from "@/lib/remote/zone-grid";
import s from "./lobby-camera-preview.module.css";

/** The zone grid over a camera picture, drawn through the saved calibration. Dashed while it is only a guess. */
export function PreviewGrid({calibration,format,kind,guess=false,large=false,ratio=16/9}:{calibration?:FieldCalibration;format:FieldFormat;kind:"webcam"|"phone";guess?:boolean;large?:boolean;ratio?:number}){
  const grid=displayCalibration(calibration,defaultSideFor(kind));
  return <svg className={s.fieldGrid} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden data-guess={guess||undefined} data-large={large||undefined} data-testid="lobby-cam-grid">
    {byAreaDesc(fieldGridCells(format,grid)).map(cell=>{const {corners,center}=projectCell(cell,grid);return <g key={cell.zone}>
      <polygon data-zone={cell.zone} points={corners.map(p=>`${p.x*1000},${p.y*1000}`).join(' ')}/>
      {/* The picture is stretched to the video's shape; the counter-scale keeps the letters undistorted. */}
      <text transform={`translate(${center.x*1000} ${center.y*1000}) scale(1 ${ratio})`}>{cell.label}</text>
    </g>;})}
  </svg>;
}
