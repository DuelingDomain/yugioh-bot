"use client";

import { useEffect, useState } from "react";

export interface ShellAccount {
  /** loading until the session answers; error when it could not be read. */
  status: "loading" | "ready" | "error";
  name: string;
  image: string | null;
  /** null until /api/player/me answers, or when this person has no profile. */
  playerId: number | null;
  /** True after a successful lookup or a confirmed 404; false on failure. */
  profileSettled: boolean;
}

const INITIAL: ShellAccount = { status: "loading", name: "", image: null, playerId: null, profileSettled: false };

/** Same two requests the old top bar made, once for the whole shell. */
export function useShellAccount(): ShellAccount {
  const [account, setAccount] = useState<ShellAccount>(INITIAL);

  useEffect(() => {
    let live = true;
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s: { user?: { name?: string | null; image?: string | null } } | null) => {
        if (!live) return;
        setAccount((a) => ({ ...a, status: "ready", name: s?.user?.name ?? "", image: s?.user?.image ?? null }));
      })
      .catch(() => {
        if (live) setAccount((a) => ({ ...a, status: "error" }));
      });
    fetch("/api/player/me")
      .then((r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("Profile lookup failed");
        return r.json();
      })
      .then((d: { playerId?: number } | null) => {
        if (!live) return;
        setAccount((a) => ({ ...a, playerId: d?.playerId ? d.playerId : null, profileSettled: true }));
      })
      .catch(() => {
        // A failed lookup leaves profile availability unknown.
      });
    return () => {
      live = false;
    };
  }, []);

  return account;
}
