"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";

export type RefreshSessionToken = () => Promise<string | null>;
const noSession: RefreshSessionToken = async () => null;
const SessionTokenContext = createContext<RefreshSessionToken>(noSession);
const SessionUserIdContext = createContext<string | null | undefined>(undefined);

function ClerkSessionTokenProvider({ children }: { children: ReactNode }) {
  const { getToken, userId } = useAuth();
  const refresh = useCallback(() => getToken({ skipCache: true }), [getToken]);
  return <SessionUserIdContext.Provider value={userId}><SessionTokenContext.Provider value={refresh}>{children}</SessionTokenContext.Provider></SessionUserIdContext.Provider>;
}

/** Offline E2E auth has no Clerk provider or token endpoint. */
export function SessionTokenProvider({ e2e, e2eUserId = null, children }: { e2e: boolean; e2eUserId?: string | null; children: ReactNode }) {
  return e2e
    ? <SessionUserIdContext.Provider value={e2eUserId}><SessionTokenContext.Provider value={noSession}>{children}</SessionTokenContext.Provider></SessionUserIdContext.Provider>
    : <ClerkSessionTokenProvider>{children}</ClerkSessionTokenProvider>;
}

export function useRefreshSessionToken(): RefreshSessionToken {
  return useContext(SessionTokenContext);
}

/** Undefined while Clerk is loading; null when signed out. */
export function useSessionUserId() {
  return useContext(SessionUserIdContext);
}
