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
  /** Tier name and Elo, from the profile. null until it answers, and when it cannot be read. */
  tier: string | null;
  elo: number | null;
  /** Guild admin (Manage Server or owner). false until /api/admin/access answers, and when it cannot be read. */
  isAdmin: boolean;
}

const ADMIN_HINT_KEY = "dd:admin-hint";
const ADMIN_HINT_TTL_MS = 5 * 60_000;

/** The last answer of /api/admin/access, kept for five minutes so a full page load does not ask Discord again. */
function readAdminHint(now = Date.now()): boolean | null {
  try {
    const raw = window.sessionStorage.getItem(ADMIN_HINT_KEY);
    if (!raw) return null;
    const hint = JSON.parse(raw) as { admin?: unknown; at?: unknown };
    if (typeof hint.admin !== "boolean" || typeof hint.at !== "number" || now - hint.at > ADMIN_HINT_TTL_MS || hint.at > now) return null;
    return hint.admin;
  } catch {
    return null;
  }
}

function writeAdminHint(admin: boolean): void {
  try {
    window.sessionStorage.setItem(ADMIN_HINT_KEY, JSON.stringify({ admin, at: Date.now() }));
  } catch {
    // Storage can be blocked. The hint is only a convenience.
  }
}

const INITIAL: ShellAccount = { status: "loading", name: "", image: null, playerId: null, profileSettled: false, tier: null, elo: null, isAdmin: false };

/** The two requests the old top bar made, plus the profile for the tier and Elo line, once for the whole shell. */
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
        const playerId = d?.playerId ? d.playerId : null;
        setAccount((a) => ({ ...a, playerId, profileSettled: true }));
        if (playerId === null) return;
        // The seat's second line. Quiet on failure: the seat then shows the name alone.
        fetch(`/api/player/${playerId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((p: { rating?: unknown; rank?: { name?: unknown } } | null) => {
            if (!live || !p) return;
            const elo = typeof p.rating === "number" && Number.isFinite(p.rating) ? Math.round(p.rating) : null;
            const tier = typeof p.rank?.name === "string" ? p.rank.name : null;
            setAccount((a) => ({ ...a, tier, elo }));
          })
          .catch(() => {});
      })
      .catch(() => {
        // A failed lookup leaves profile availability unknown.
      });
    // Only decides whether admin links show. Every admin route still checks access itself.
    const hint = readAdminHint();
    if (hint !== null) {
      if (hint) setAccount((a) => ({ ...a, isAdmin: true }));
    } else {
      fetch("/api/admin/access")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { admin?: unknown } | null) => {
          if (typeof d?.admin !== "boolean") return;
          writeAdminHint(d.admin);
          if (live && d.admin) setAccount((a) => ({ ...a, isAdmin: true }));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, []);

  return account;
}
