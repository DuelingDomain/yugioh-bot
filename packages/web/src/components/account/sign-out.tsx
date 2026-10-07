"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useClerk } from "@clerk/nextjs";

type SignOut = () => Promise<void>;

const SignOutContext = createContext<SignOut | null>(null);

/** Clerk ends its own session in this browser and then lands on the sign-in page. */
function ClerkSignOutProvider({ children }: { children: ReactNode }) {
  const { signOut } = useClerk();
  const run = useCallback(() => signOut({ redirectUrl: "/sign-in" }), [signOut]);
  return <SignOutContext.Provider value={run}>{children}</SignOutContext.Provider>;
}

/** E2E mode has no Clerk provider: the signed test cookie is cleared by the server, then a full navigation. */
function E2ESignOutProvider({ children }: { children: ReactNode }) {
  const run = useCallback(async () => {
    try {
      await fetch("/api/test-auth/sign-out", { method: "POST" });
    } finally {
      window.location.assign("/sign-in");
    }
  }, []);
  return <SignOutContext.Provider value={run}>{children}</SignOutContext.Provider>;
}

/**
 * The one sign-out implementation, used by the account menu and the account page. `e2e` comes from the
 * server (`isE2EAuthEnabled()`), because there is no `ClerkProvider` in E2E mode and `useClerk` must not run there.
 */
export function SignOutProvider({ e2e, children }: { e2e: boolean; children: ReactNode }) {
  return e2e ? <E2ESignOutProvider>{children}</E2ESignOutProvider> : <ClerkSignOutProvider>{children}</ClerkSignOutProvider>;
}

export function useSignOut(): SignOut {
  const signOut = useContext(SignOutContext);
  return useCallback(async () => {
    if (!signOut) throw new Error("useSignOut needs a SignOutProvider");
    await signOut();
  }, [signOut]);
}
