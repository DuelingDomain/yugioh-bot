"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UserProfile } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { StatusLine } from "@/components/sheet";
import { CONFLICT_MESSAGES, REFRESH_FAILED_MESSAGE, type AccountConflict } from "@/components/account/account-messages";
import { clerkAppearance } from "@/components/account/clerk-appearance";
import styles from "@/components/account/account-page.module.css";

/** Window focus fires in bursts (tab switch, OAuth return). One refresh per window is enough. */
const FOCUS_REFRESH_GAP_MS = 2000;

type Refresh = { kind: "ok"; conflict: AccountConflict | null } | { kind: "failed" };

async function requestRefresh(): Promise<Refresh> {
  try {
    const res = await fetch("/api/account/refresh", { method: "POST", cache: "no-store" });
    if (!res.ok) return { kind: "failed" };
    const body = (await res.json()) as { conflict?: AccountConflict | null };
    return { kind: "ok", conflict: body.conflict && body.conflict in CONFLICT_MESSAGES ? body.conflict : null };
  } catch {
    return { kind: "failed" };
  }
}

/**
 * The account area. With Clerk it is the themed `<UserProfile/>` for connected accounts and sign-in. The server
 * resyncs the profile on mount, on window focus and after `?refresh=1`, so a Discord link made there is picked up;
 * the page never sends Discord or email values. In E2E mode there is no Clerk provider, so it shows the
 * offline controls instead and has nothing to refresh.
 */
export function AccountPanel({ e2e, displayName, email }: { e2e: boolean; displayName: string; email: string | null }) {
  const router = useRouter();
  const refreshParam = useSearchParams().get("refresh");
  const [result, setResult] = useState<Refresh | null>(null);
  const inFlight = useRef(false);
  const lastRun = useRef(0);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastRun.current = Date.now();
    const next = await requestRefresh();
    inFlight.current = false;
    setResult(next);
  }, []);

  // On mount.
  useEffect(() => {
    if (e2e) return;
    void refresh();
  }, [e2e, refresh]);

  // After ?refresh=1 (the page was reached again from a linking flow): the param is then dropped from the address.
  useEffect(() => {
    if (e2e || refreshParam !== "1") return;
    void refresh();
    const next = new URLSearchParams(window.location.search);
    next.delete("refresh");
    const query = next.toString();
    router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [e2e, refresh, refreshParam, router]);

  useEffect(() => {
    if (e2e) return;
    const onFocus = () => {
      if (Date.now() - lastRun.current >= FOCUS_REFRESH_GAP_MS) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [e2e, refresh]);

  const message = result?.kind === "failed" ? REFRESH_FAILED_MESSAGE : result?.conflict ? CONFLICT_MESSAGES[result.conflict] : null;

  return (
    <div className={styles.panel}>
      {message ? (
        <div role="alert" className={styles.notice}>
          <StatusLine tone={result?.kind === "ok" ? "block" : "warn"}>{message}</StatusLine>
        </div>
      ) : null}
      {e2e ? (
        <dl className={styles.offline} data-testid="offline-account">
          <div>
            <dt>Display name</dt>
            <dd>{displayName}</dd>
          </div>
          {email ? (
            <div>
              <dt>Email</dt>
              <dd>{email}</dd>
            </div>
          ) : null}
          <p className={styles.offlineNote}>Offline test mode. Connected accounts and password come from Clerk, which is not loaded here.</p>
        </dl>
      ) : (
        <UserProfile path="/settings/account" routing="path" appearance={clerkAppearance} />
      )}
    </div>
  );
}
