"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { handleSignOut } from "@/lib/actions";
import { Bug, LogOut, User } from "lucide-react";
import { Mono, TierName } from "@/components/sheet";
import { DURATION, usePresence } from "@/lib/motion";
import type { ShellAccount } from "./use-shell-account";
import { isOwnProfile } from "./shell-model";
import styles from "./shell.module.css";

interface AccountMenuProps {
  account: ShellAccount;
  pathname: string;
  /** side: the seat at the foot of the sidebar. phone: the ring in the top bar. */
  variant: "side" | "phone";
  /** Collapsed rail: the ring alone, no name. Only for the side variant. */
  rail?: boolean;
  /** Called when a menu choice navigates, so a surrounding drawer can close. */
  onNavigate?: () => void;
  /** Opens the Report bug dialog, which the shell owns so it outlives this menu and a surrounding drawer. */
  onReportBug?: () => void;
}

/** You, as a seat: a violet ring with your initials. */
function Ring({ account, size }: { account: ShellAccount; size: "sm" | "md" }) {
  return <Mono name={account.name || "You"} you size={size} />;
}

export function AccountMenu({ account, pathname, variant, rail = false, onNavigate, onReportBug }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  // The menu stays mounted for its 100ms exit; a closing menu is inert, and focus has already moved.
  const { mounted, state } = usePresence(open, DURATION.popOut);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const displayName = account.name || "Account";

  const items = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []),
    [],
  );

  // Focus lands on the first item when the menu opens.
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open, items]);

  // A press outside closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const closeToTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeToTrigger();
    } else if (e.key === "Tab") {
      // Tab closes the menu and carries on from the trigger.
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" && !open) {
      e.preventDefault();
      setOpen(true);
    }
  };

  if (account.status === "loading") {
    return variant === "side" ? (
      <span className={styles.seatBtn} data-rail={rail ? "true" : undefined} aria-busy="true" aria-label="Loading your account">
        <span className={styles.seatSkRing} />
        {rail ? null : (
          <span className={styles.seatText} style={{ width: 110, gap: 7 }}>
            <span className={styles.seatSk} style={{ width: "72%" }} />
            <span className={styles.seatSk} style={{ width: "48%", height: 8 }} />
          </span>
        )}
      </span>
    ) : (
      <span className={styles.ringBtn} aria-busy="true" aria-label="Loading your account">
        <span className={styles.seatSkRing} />
      </span>
    );
  }

  const ownProfile = isOwnProfile(pathname, account.playerId);
  const hasProfile = account.playerId !== null;
  const noProfile = account.profileSettled && !hasProfile;

  const trigger =
    variant === "side" ? (
      <button
        ref={triggerRef}
        className={styles.seatBtn}
        data-rail={rail ? "true" : undefined}
        type="button"
        data-on={ownProfile ? "" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu, ${displayName}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <Ring account={account} size="md" />
        {rail ? null : (
          <span className={styles.seatText}>
            <span className={styles.seatName}>{displayName}</span>
            {noProfile ? (
              <span className={styles.seatLine}>No profile yet</span>
            ) : account.tier !== null || account.elo !== null ? (
              <span className={styles.seatLine}>
                {account.tier !== null ? <TierName tier={account.tier} /> : null}
                {account.elo !== null ? <em className={styles.seatElo}>{account.elo}</em> : null}
              </span>
            ) : null}
          </span>
        )}
      </button>
    ) : (
      <button
        ref={triggerRef}
        className={styles.ringBtn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu, ${displayName}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <Ring account={account} size="sm" />
      </button>
    );

  return (
    <>
      {trigger}
      {mounted ? (
        <div
          ref={menuRef}
          className={styles.menu}
          data-mo="pop"
          data-state={state}
          inert={!open}
          data-variant={variant}
          data-rail={rail ? "true" : undefined}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
        >
          <div className={styles.menuHead}>
            <Ring account={account} size="md" />
            <div>
              <p className={styles.menuName}>{displayName}</p>
              <p className={styles.menuSub}>Signed in with Discord</p>
            </div>
          </div>
          {hasProfile ? (
            <Link
              className={styles.menuItem}
              role="menuitem"
              href={`/player/${account.playerId}`}
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
            >
              <User className={styles.menuIcon} aria-hidden="true" />
              Your profile
            </Link>
          ) : (
            <>
              <span className={styles.menuItem} role="menuitem" aria-disabled="true">
                <User className={styles.menuIcon} aria-hidden="true" />
                Your profile
              </span>
              {noProfile ? (
                <p className={styles.menuNote}>You get a profile after your first match, event or draft on this server.</p>
              ) : null}
            </>
          )}
          <div className={styles.menuSep} role="separator" />
          {onReportBug ? (
            <button
              className={styles.menuItem}
              role="menuitem"
              type="button"
              onClick={() => {
                // Focus goes back to the trigger first, so the dialog gives it back there when it closes.
                closeToTrigger();
                onReportBug();
                onNavigate?.();
              }}
            >
              <Bug className={styles.menuIcon} aria-hidden="true" />
              Report bug
            </button>
          ) : null}
          <button
            className={styles.menuItem}
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              void handleSignOut();
            }}
          >
            <LogOut className={styles.menuIcon} aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </>
  );
}
