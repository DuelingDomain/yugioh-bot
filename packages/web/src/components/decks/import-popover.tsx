"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FileUp } from "lucide-react";
import type { DuelMode } from "@yugidraft/shared/duels";
import { cx, SheetButton } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import styles from "./editor.module.css";

/** A button that opens a small panel under it. Escape and a click outside close it. */
export function Popover({
  label,
  icon,
  open,
  onOpenChange,
  kind = "secondary",
  disabled,
  align = "end",
  children,
}: {
  label: string;
  icon?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind?: "secondary" | "quiet" | "danger";
  disabled?: boolean;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const change = useRef(onOpenChange);
  change.current = onOpenChange;

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) change.current(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") change.current(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={styles.popoverRoot}>
      <SheetButton size="sm" kind={kind} disabled={disabled} aria-expanded={open} aria-controls={id} onClick={() => onOpenChange(!open)}>
        {icon}
        {label}
      </SheetButton>
      {open ? (
        <div id={id} className={styles.popover} data-align={align} role="dialog" aria-label={label}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function DeckImportPopover({
  open,
  onOpenChange,
  disabled,
  mode,
  fileName,
  error,
  onFile,
  onPaste,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  mode: DuelMode;
  fileName: string | null;
  error: string | null;
  onFile: (file: File) => void;
  onPaste: (text: string) => void;
}) {
  const [paste, setPaste] = useState("");
  const [dragging, setDragging] = useState(false);

  return (
    <Popover
      label="Import"
      icon={<FileUp size={15} strokeWidth={1.6} aria-hidden />}
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
    >
      <div className={styles.importBody}>
        <p className={styles.popoverTitle}>Import a deck</p>
        <p className={ui.hint}>This replaces the cards in the editor. Press Ctrl+Z to undo it.</p>
        <label
          className={styles.drop}
          data-dragging={dragging ? "true" : undefined}
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.types).includes("Files")) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) onFile(file);
          }}
        >
          <input
            type="file"
            accept=".ydk,text/plain"
            className={ui.srOnly}
            aria-label="YDK file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              event.target.value = "";
            }}
          />
          <FileUp size={20} strokeWidth={1.4} aria-hidden />
          <span className={styles.dropTitle}>{fileName ?? "Drop a .ydk file"}</span>
          <span className={styles.dropHint}>{fileName ? "Choose another file to replace it" : "or click to choose one"}</span>
        </label>
        <label>
          <span className={ui.label}>Or paste YDK text or a ydke:// link</span>
          <textarea
            value={paste}
            rows={5}
            spellCheck={false}
            className={cx(ui.input, ui.textarea, styles.pasteBox)}
            placeholder={"#main\n46986414\n#extra\n!side"}
            onChange={(event) => setPaste(event.target.value)}
          />
        </label>
        <div className={styles.popoverActions}>
          <SheetButton size="sm" kind="primary" disabled={!paste.trim()} onClick={() => onPaste(paste)}>Load paste</SheetButton>
        </div>
        {mode === "domain" ? (
          <p className={ui.hint}>Domain: when the file has no #deckmaster and only one Side card, that card becomes the Deck Master.</p>
        ) : null}
        {error ? <p role="alert" className={ui.alert}>{error}</p> : null}
      </div>
    </Popover>
  );
}
