"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { FieldScanState } from "@/lib/remote/zone-grid";
import type { ScanAdvice } from "@/lib/remote/scan-advice";
import { feedTool } from "./feed";
import { Icon } from "./icons";
import { Row } from "./zone-actions";
import s from "./remote-ui.module.css";

/**
 * The one "..." button on a webcam. It replaces the old camera tool row and the Rescan button.
 * Mine: Scan field now, Token, Freeze, Read board, and the camera and detection settings.
 * An opponent's: Token on their field, Ask them to scan again, Freeze, and the settings.
 * Scan field is the fix for a card that is not read, so it is not a main button.
 */
export function CameraToolsMenu({ seat, name, you, scan, advice, warn, onToken, onRescan, settings }: {
  seat: number; name: string; you: boolean; scan: FieldScanState | null; advice: ScanAdvice; /** A bad or lost feed: the button shows a warning dot. */ warn: boolean;
  onToken?: () => void; onRescan?: () => Promise<string>; /** The camera and detection settings row. Absent when the person has no camera settings here. */ settings?: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => { if (!note) return; const timer = setTimeout(() => setNote(""), 4000); return () => clearTimeout(timer); }, [note]);
  const place = useCallback(() => {
    const box = trigger.current?.getBoundingClientRect(), node = panel.current;
    if (!box || !node) return;
    node.style.left = `${Math.max(8, Math.min(window.innerWidth - node.offsetWidth - 8, box.right - node.offsetWidth))}px`;
    node.style.top = `${Math.max(8, Math.min(window.innerHeight - node.offsetHeight - 8, box.bottom + 6))}px`;
  }, []);
  useEffect(() => {
    if (!open) return;
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, place]);
  const close = () => panel.current?.hidePopover?.();
  const need = scan && scan.ready && !scan.scanning ? advice.reason : null;
  const who = you ? "my" : `${name}'s`;
  return <>
    <button type="button" ref={trigger} className={s.toolsBtn} popoverTarget={id} aria-haspopup="menu" aria-expanded={open} aria-label={`Camera tools for ${name}`} data-testid={`camera-tools-${seat}`} data-warn={warn || need ? "" : undefined}>
      <Icon name="dots" /></button>
    <div id={id} ref={panel} popover="auto" role="menu" aria-label={`Camera tools for ${name}`} className={s.toolsMenu} onToggle={event => { setOpen(event.newState === "open"); if (event.newState === "open") place(); }}>
      {scan ? <>
        <Row icon="scan" hint={scan.ready ? "S" : undefined} aria-disabled={scan.scanning || !scan.ready} aria-keyshortcuts="S" data-testid="field-scan" data-need={need ? "" : undefined} data-scan-ms={advice.last?.totalMs} data-scan-sweep-ms={advice.last?.sweepMs}
          sub={scan.scanning ? "Scanning…" : scan.ready ? (need ?? "Use when a card is not read.") : "Turn the camera on to scan the field."}
          onClick={() => { if (scan.ready && !scan.scanning) { scan.scan?.(); close(); } }}>{scan.scanning ? "Scanning field…" : "Scan field now"}</Row>
        <div className={s.toolsSep} />
      </> : null}
      {onToken ? <Row icon="coin" data-testid={`camera-token-${seat}`} onClick={() => { close(); onToken(); }}>{`Token on ${who} field`}</Row> : null}
      {!you && onRescan ? <Row icon="refresh" data-testid={`field-rescan-${seat}`} data-sent={note || undefined} sub={note || undefined} onClick={() => { if (!note) void onRescan().then(setNote); }}>{`Ask ${name} to scan again`}</Row> : null}
      <Row icon="snow" hint="F" aria-keyshortcuts="F" data-testid={`camera-freeze-${seat}`} onClick={() => { close(); feedTool(seat, "freeze"); }}>Freeze picture</Row>
      {you ? <Row icon="eye" hint="R" aria-keyshortcuts="R" data-testid={`camera-read-${seat}`} sub="Freezes the picture, then reads every card" onClick={() => { close(); feedTool(seat, "read"); }}>Read board</Row> : null}
      {settings ? <><div className={s.toolsSep} />{settings}</> : null}
    </div>
  </>;
}
