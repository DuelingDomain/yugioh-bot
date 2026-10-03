"use client";

import { Menu } from "lucide-react";
import { LiveDot } from "@/components/sheet";
import { useShell } from "./shell-context";
import styles from "./shell.module.css";

/**
 * The shell's phone menu button, for a page bar that replaces the shell's own bar (see
 * `OwnsPageBar`). Put it last in `PageBar`'s `actions`. It is hidden above 820px, where the
 * sidebar does the job. It shows the Live dot when something is live.
 */
export function ShellMenuButton() {
  const { openMenu, menuOpen, live } = useShell();
  const anyLive = Boolean(live && (live.yourDuel || live.liveCount > 0));
  return (
    <button
      className={styles.menuButton}
      type="button"
      aria-label={anyLive ? "Open menu, live now" : "Open menu"}
      aria-haspopup="dialog"
      aria-expanded={menuOpen}
      onClick={(e) => openMenu(e.currentTarget)}
    >
      <Menu className={styles.menuIcon} aria-hidden="true" />
      {anyLive ? (
        <span className={styles.menuDot} aria-hidden="true">
          <LiveDot you={Boolean(live?.yourDuel)} />
        </span>
      ) : null}
    </button>
  );
}
