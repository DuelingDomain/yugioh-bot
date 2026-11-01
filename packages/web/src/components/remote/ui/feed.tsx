"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { watchVideoFrames } from "@/lib/remote/video-protocol";
import { Icon } from "./icons";
import { useVideoHub, type Health } from "./video-hub";
import s from "./remote-ui.module.css";

/** A card the table has identified on a feed. Normalized to the video frame (0..1). */
export type FeedMark = { id: string; x: number; y: number; label: string; notInDecklist: boolean; show: boolean; cardCode?: number };
/** A reticle for a read in progress, finished or failed. */
export type FeedReticle = { id: string; x: number; y: number; state: "reading" | "done" | "fail"; text: string };
type Box = { left: number; top: number; width: number; height: number };

const CARD_H = 0.34; // card height as a share of the frame height
const CARD_ASPECT = 0.686;

export function Feed({ seat, name, you, health, marks, reticles, onPoint, onAdd, extra, emptyText }: {
  seat: number; name: string; you: boolean; health: Health; marks: FeedMark[]; reticles: FeedReticle[];
  onPoint: (seat: number, x: number, y: number) => void; onAdd: (mark: FeedMark) => void; extra?: ReactNode; emptyText: string;
}) {
  const hub = useVideoHub();
  const source = hub.sourceFor(seat);
  const video = useRef<HTMLVideoElement>(null); const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const setFrozen = hub.setFrozen;

  useEffect(() => {
    const element = video.current; if (!element || !source) return;
    const detach = source.attach(element);
    const stopWatching = watchVideoFrames(element, frozen => setFrozen(seat, frozen));
    return () => { stopWatching(); detach(); setFrozen(seat, false); };
  }, [source, seat, setFrozen]);

  useEffect(() => {
    const element = video.current; const holder = wrap.current; if (!element || !holder) return;
    const measure = () => {
      const w = holder.clientWidth; const h = holder.clientHeight; const vw = element.videoWidth; const vh = element.videoHeight;
      if (!w || !h || !vw || !vh) { setBox(null); return; }
      const scale = Math.min(w / vw, h / vh); const width = vw * scale; const height = vh * scale;
      setBox({ left: (w - width) / 2, top: (h - height) / 2, width, height });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(holder);
    element.addEventListener("loadedmetadata", measure); element.addEventListener("resize", measure);
    return () => { observer.disconnect(); element.removeEventListener("loadedmetadata", measure); element.removeEventListener("resize", measure); };
  }, [source]);

  function click(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    if (!video.current || !box || !wrap.current) return;
    const bounds = wrap.current.getBoundingClientRect();
    const x = (event.clientX - bounds.left - box.left) / box.width; const y = (event.clientY - bounds.top - box.top) / box.height;
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onPoint(seat, x, y);
  }
  const rect = (x: number, y: number) => {
    if (!box) return { display: "none" } as const;
    const h = box.height * CARD_H; const w = h * CARD_ASPECT;
    const left = box.left + x * box.width - w / 2; const top = box.top + y * box.height - h / 2;
    return { left, top, width: w, height: h };
  };

  return <div className={s.cams} ref={wrap}>
    <div className={s.fcam} onClick={click} data-testid={`feed-${seat}`} data-remote-seat={seat} style={{ cursor: source ? "crosshair" : "default" }}>
      {source ? <video ref={video} autoPlay playsInline muted aria-label={`${name}'s field camera. Click a card to identify it.`} /> : <div className={s.nofeed}>
        <Icon name="cam" /><span>{emptyText}</span>
      </div>}
      <div className={s.grain} />
      {marks.map(mark => {
        const r = rect(mark.x, mark.y); const flip = box ? box.top + mark.y * box.height + (box.height * CARD_H) / 2 + (mark.notInDecklist ? 62 : 30) > (wrap.current?.clientHeight ?? 0) : false;
        return <div key={mark.id} className={`${s.lk} ${mark.notInDecklist ? s.nid : ""} ${mark.show ? s.show : ""}`} style={r} data-testid="lock">
          <span className={s.lb} style={flip ? { top: "auto", bottom: "calc(100% + 8px)" } : undefined}>{mark.label}</span>
          {mark.notInDecklist ? <span className={s.nidc} style={flip ? { top: "auto", bottom: "calc(100% + 32px)" } : undefined}>
            <Icon name="warn" />Not in decklist<button type="button" onClick={() => onAdd(mark)}>Add to decklist</button>
          </span> : null}
        </div>;
      })}
      {reticles.map(r => <div key={r.id} className={`${s.ret} ${r.state === "done" ? s.done : r.state === "fail" ? s.fail : ""}`} style={rect(r.x, r.y)} data-testid="reticle"><i /><b>{r.text}</b></div>)}
    </div>
    <span className={s.ctag}><i />{you ? "YOUR FIELD CAM" : "FIELD CAM"}</span>
    {extra}
  </div>;
}
