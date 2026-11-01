"use client";

import { useState, type ReactNode } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { SignInBanner } from "./sign-in-error";
import { SignInShell } from "./sign-in-shell";
import { SignInFootLinks, SignInStep } from "./sign-in-step";
import { reloadPage } from "./navigate";
import shell from "./sign-in-shell.module.css";

/** Shared view for the join form, invitation ticket gate and offline design preview. */
export function InviteSessionNotice({ identity, onSignOut, continueInvite = false }: {
  identity: string; onSignOut(): Promise<void>; continueInvite?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try { await onSignOut(); }
    catch { setFailed(true); setPending(false); }
  }

  return (
    <SignInBanner tone="info">
      <span className={shell.sessionNotice}>
        <span>You're signed in as {identity}. To accept this invite with a new account, sign out first.</span>
        <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} disabled={pending} onClick={() => void signOut()}>
          {pending ? "Signing out…" : continueInvite ? "Sign out and continue" : "Sign out"}
        </button>
        {failed && <span role="alert">Couldn’t sign out. Try again.</span>}
      </span>
    </SignInBanner>
  );
}

export function ClerkInviteSessionNotice({ continueInvite = false }: { continueInvite?: boolean }) {
  const { isLoaded, user } = useUser();
  const { signOut } = useClerk();
  // An invite blocked on arrival can outlive its session (expiry or sign-out in another tab).
  // Reload before starting the ticket, just as the sign-out redirect does.
  if (!user) return continueInvite && isLoaded
    ? <button type="button" className={`${shell.btn} ${shell["btn-alt"]}`} onClick={reloadPage}>Continue with invite</button>
    : null;
  // Use the completion callback: Clerk’s redirectUrl can soft-navigate without resetting the ticket gate.
  return <InviteSessionNotice identity={user.username || user.primaryEmailAddress?.emailAddress || "your current account"}
    continueInvite={continueInvite} onSignOut={() => signOut(reloadPage)} />;
}

export function InviteSessionStep({ children, marketingUrl }: { children: ReactNode; marketingUrl: string | null }) {
  return (
    <SignInShell marketingUrl={marketingUrl ?? undefined}>
      <SignInStep eyebrow="Creator invite" title={<>Accept your <em>invite</em></>} screen="invite-signed-in" foot={<SignInFootLinks waitlist={false} />}>
        <div className={shell.form}>{children}</div>
      </SignInStep>
    </SignInShell>
  );
}
