"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ChevronsUpDown, LogOut, User } from "lucide-react";
import type { ShellAccount } from "./use-shell-account";
import { isOwnProfile } from "./shell-model";
import styles from "./shell.module.css";

interface AccountMenuProps {
  account: ShellAccount;
  pathname: string;
  /** side: the name row at the foot of the sidebar. phone: the avatar in the top bar. */
  variant: "side" | "phone";
  /** Called when a menu choice navigates, so a surrounding drawer can close. */
  onNavigate?: () => void;
}

function Avatar({ account }: { account: ShellAccount }) {
  const initial = (account.name || "U").trim().charAt(0).toUpperCase() || "U";
  return (
    <span className="ns-av" aria-hidden="true">
      {account.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={account.image} alt="" className={styles.avatarImg} />
      ) : (
        initial
      )}
    </span>
  );
}

export function AccountMenu({ account, pathname, variant, onNavigate }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
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
      <span className="ns-me" aria-busy="true" aria-label="Loading your account">
        <span className="ns-av sk" />
        <span className="ns-who" style={{ width: 110, gap: 7 }}>
          <span className="sk" style={{ width: "72%" }} />
          <span className="sk" style={{ width: "48%", height: 8 }} />
        </span>
      </span>
    ) : (
      <span className="ns-avbtn" aria-busy="true" aria-label="Loading your account">
        <span className="ns-av sk" />
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
        className="ns-me"
        type="button"
        data-on={ownProfile ? "" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu, ${displayName}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <Avatar account={account} />
        <span className="ns-who">
          <span className="nm">{displayName}</span>
          {noProfile ? <span className="sb">No profile yet</span> : null}
        </span>
        <ChevronsUpDown className="ic sm" aria-hidden="true" />
      </button>
    ) : (
      <button
        ref={triggerRef}
        className="ns-avbtn"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu, ${displayName}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <Avatar account={account} />
      </button>
    );

  return (
    <>
      {trigger}
      {open ? (
        <div
          ref={menuRef}
          className={variant === "phone" ? "ns-menu ph" : "ns-menu"}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
        >
          <div className="ns-mh">
            <span className="ns-av lg" aria-hidden="true">
              {(displayName.trim().charAt(0) || "U").toUpperCase()}
            </span>
            <div>
              <p className="nm">{displayName}</p>
              <p className="sb">Signed in with Discord</p>
            </div>
          </div>
          {hasProfile ? (
            <Link
              className="ns-mi"
              role="menuitem"
              href={`/player/${account.playerId}`}
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
            >
              <User className="ic" aria-hidden="true" />
              Your profile
            </Link>
          ) : (
            <>
              <span className="ns-mi" role="menuitem" aria-disabled="true">
                <User className="ic" aria-hidden="true" />
                Your profile
              </span>
              {noProfile ? (
                <p className="ns-mnote">You get a profile after your first match, event or draft on this server.</p>
              ) : null}
            </>
          )}
          <div className="menu-sep" role="separator" />
          <button
            className="ns-mi"
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              void signOut({ redirectTo: "/login" });
            }}
          >
            <LogOut className="ic" aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </>
  );
}
