"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FileUp } from "lucide-react";
import type { DuelMode } from "@yugidraft/shared/duels";
import { SheetPortal } from "@/components/sheet";
import { cn } from "@/lib/utils";
import { DeckButton } from "./controls";
import styles from "./editor.module.css";

/** Anchored to its trigger, but portalled outside the editor's size container. */
export function Popover({ label, icon, open, onOpenChange, kind = "secondary", disabled, align = "end", children, iconOnly = false, role = "dialog", dialogLabel, focusKey, className }: {
  label: string;
  icon?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind?: "secondary" | "quiet" | "danger";
  disabled?: boolean;
  align?: "start" | "end";
  children: ReactNode;
  iconOnly?: boolean;
  role?: "dialog" | "menu";
  dialogLabel?: string;
  focusKey?: string;
  className?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const change = useRef(onOpenChange);
  change.current = onOpenChange;
  const [position, setPosition] = useState({ top: 64, left: 12 });

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    function place() {
      const anchor = trigger.current?.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 24);
      const desired = anchor && anchor.width > 0 ? (align === "start" ? anchor.left : anchor.right - width) : window.innerWidth - width - 12;
      const height = panel.current?.offsetHeight ?? 300;
      setPosition({ top: Math.max(12, Math.min((anchor?.bottom || 54) + 8, window.innerHeight - height - 12)), left: Math.max(12, Math.min(desired, window.innerWidth - width - 12)) });
    }
    const frame = requestAnimationFrame(() => {
      place();
      panel.current?.querySelector<HTMLElement>('[data-autofocus], button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')?.focus();
    });
    function onPointer(event: PointerEvent) {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) change.current(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); change.current(false); return; }
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]') ?? []);
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (role === "menu" && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      } else if (event.key === "Tab" && items.length > 0) {
        if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0]?.focus(); }
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      if (returnTo?.isConnected && returnTo !== document.body) returnTo.focus();
      else trigger.current?.focus();
    };
  }, [open, align, role, focusKey]);

  return (
    <div className={cn(styles.popoverRoot, className)}>
      <button ref={trigger} type="button" className={iconOnly ? styles["de-ib"] : cn("btn btn-sm", `btn-${kind}`)} disabled={disabled} aria-label={iconOnly ? label : undefined} aria-expanded={open} aria-haspopup={role} aria-controls={open ? id : undefined} onClick={() => onOpenChange(!open)}>
        {icon}{iconOnly ? null : label}
      </button>
      {open ? (
        <SheetPortal>
          <div
            ref={panel}
            id={id}
            className={styles["de-pop"]}
            style={{ ...position, maxHeight: `calc(100dvh - ${position.top + 12}px)` }}
            role={role}
            aria-label={dialogLabel ?? label}
          >
            {children}
          </div>
        </SheetPortal>
      ) : null}
    </div>
  );
}

export function DeckImportPopover({ open, onOpenChange, disabled, mode, fileName, error, onFile, onPaste, className }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  mode: DuelMode;
  fileName: string | null;
  error: string | null;
  onFile: (file: File) => void;
  onPaste: (text: string) => void;
  className?: string;
}) {
  const [paste, setPaste] = useState("");
  const [dragging, setDragging] = useState(false);
  return (
    <Popover label="Import" dialogLabel="Import a deck" icon={<FileUp className="ic sm" aria-hidden />} open={open} onOpenChange={onOpenChange} disabled={disabled} className={className}>
      <p className={styles["de-pop-h"]}>Import a deck</p>
      <p className="small">This replaces the cards in the editor. Press Ctrl+Z to undo it.</p>
      <label className={styles.drop} data-dragging={dragging || undefined}
        onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) onFile(file); }}>
        <input type="file" accept=".ydk,text/plain" className="sr" aria-label="YDK file" onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = ""; }} />
        <FileUp className="ic" aria-hidden />
        <span>{fileName ?? "Drop a .ydk file here"}</span>
        <small>{fileName ? "Choose another file to replace it" : "or click to choose one"}</small>
      </label>
      <label><span className="label">Or paste YDK text or a ydke:// link</span><textarea value={paste} rows={3} spellCheck={false} className={cn("input", styles["de-paste"])} placeholder="#main" onChange={(event) => setPaste(event.target.value)} /></label>
      <div className={styles["de-pop-a"]}><DeckButton kind="primary" disabled={!paste.trim()} onClick={() => onPaste(paste)}>Load paste</DeckButton></div>
      {mode === "domain" ? <p className="small">Domain: when the file has no #deckmaster and only one Side card, that card becomes the Deck Master.</p> : null}
      {error ? <p role="alert" className={styles.errorText}>{error}</p> : null}
    </Popover>
  );
}
