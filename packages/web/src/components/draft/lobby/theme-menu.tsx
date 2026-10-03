"use client";

import * as React from "react";
import { MoreHorizontal, Trash2, Unlink } from "lucide-react";
import styles from "./lobby.module.css";

/** The host's per-theme menu: a disclosure button with Detach and Delete. Escape and outside clicks close it. */
export function ThemeMenu({
  name,
  busy,
  onDetach,
  onDelete,
}: {
  name: string;
  busy: boolean;
  onDetach: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLSpanElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuId = React.useId();

  const items = () => Array.from(wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

  React.useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(at + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(at - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <span ref={wrapRef} className={styles.menuWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn-quiet btn-sm ${styles.ib}`}
        aria-label={`More for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          } else if (e.key === "Escape" && open) {
            close(true);
          }
        }}
      >
        <MoreHorizontal className="ic sm" aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={`Actions for ${name}`} className={styles.menu} onKeyDown={onMenuKey}>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={busy}
            title="Detach from this draft (keeps the cube in your library)"
            onClick={() => {
              close(true);
              onDetach();
            }}
          >
            <Unlink className="ic sm" aria-hidden="true" />Detach
          </button>
          <button
            type="button"
            role="menuitem"
            data-danger=""
            className={styles.menuItem}
            disabled={busy}
            title="Delete cube from your library for good"
            onClick={() => {
              close(true);
              onDelete();
            }}
          >
            <Trash2 className="ic sm" aria-hidden="true" />Delete
          </button>
        </div>
      )}
    </span>
  );
}
