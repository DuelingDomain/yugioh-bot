"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Swords } from "lucide-react";
import {
  ACTIVE_GAME_NOTICE, activeGameRedirect, createActiveGameChecker, duelSlugFromPath, type ActiveGameChecker,
} from "@/lib/active-game";
import styles from "./active-game-guard.module.css";

const NOTICE_MS = 6000;

// One checker per tab: its short cache and shared request survive route changes.
let sharedChecker: ActiveGameChecker | null = null;
function checker(): ActiveGameChecker {
  return (sharedChecker ??= createActiveGameChecker());
}

/**
 * Signed-in pages only: while a game is in progress, any page other than that game's room sends the player back to it.
 * Checks on every navigation and when the tab becomes visible again. Failed checks never block a page.
 */
export function ActiveGameGuard({ checkerOverride }: { checkerOverride?: ActiveGameChecker } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const [notice, setNotice] = useState(false);
  const previousPath = useRef<string | null>(null);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    const source = checkerOverride ?? checker();
    // Leaving a duel room is the moment the answer may have changed (the game ended): read it fresh.
    const fresh = previousPath.current != null && duelSlugFromPath(previousPath.current) != null;
    previousPath.current = pathname;
    let cancelled = false;
    void source.get({ fresh }).then((active) => {
      if (cancelled || pathRef.current !== pathname) return;
      const target = activeGameRedirect(pathname, active);
      if (!target) return;
      setNotice(true);
      router.replace(target);
    });
    return () => { cancelled = true; };
  }, [pathname, router, checkerOverride]);

  useEffect(() => {
    const source = checkerOverride ?? checker();
    const recheck = () => {
      if (document.visibilityState === "hidden") return;
      source.invalidate();
      const at = pathRef.current;
      void source.get({ fresh: true }).then((active) => {
        if (pathRef.current !== at) return;
        const target = activeGameRedirect(at, active);
        if (!target) return;
        setNotice(true);
        router.replace(target);
      });
    };
    document.addEventListener("visibilitychange", recheck);
    return () => document.removeEventListener("visibilitychange", recheck);
  }, [router, checkerOverride]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(false), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  return (
    <div className={styles.notice} role="status" aria-live="polite" data-testid="active-game-notice">
      <Swords size={18} strokeWidth={1.6} aria-hidden className={styles.icon} />
      <span>{ACTIVE_GAME_NOTICE}</span>
    </div>
  );
}
