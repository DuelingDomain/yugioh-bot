"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AccountView } from "@/components/auth/auth-views";
import { ClerkInviteSessionNotice, InviteSessionStep } from "@/components/auth/invite-session-notice";
import { SignInShell } from "@/components/auth/sign-in-shell";
import { CheckingInviteStep } from "@/components/auth/steps/checking-invite-step";
import { reloadPage } from "@/components/auth/navigate";
import { useRedirectIfSignedIn } from "@/hooks/use-redirect-if-signed-in";
import { useSignUpFlow } from "@/hooks/use-sign-up-flow";
import { mapClerkError } from "@/lib/auth-errors";

type SignUpCardProps = { ticket: string | null; returnTo: string; marketingUrl: string | null; creatorInvite?: boolean };

export function SignUpCard(props: SignUpCardProps) {
  return props.ticket ? <TicketSignUpCard {...props} /> : <RegularSignUpCard {...props} />;
}

function TicketSignUpCard(props: SignUpCardProps) {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const [session, setSession] = useState<"loading" | "blocked" | "ready">("loading");
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (session !== "loading") return;
    if (isLoaded) { setSession(isSignedIn ? "blocked" : "ready"); return; }
    const timer = setTimeout(() => setTimedOut(true), 30_000);
    return () => clearTimeout(timer);
  }, [isLoaded, isSignedIn, session]);

  // Decide once: a new sign-up keeps its success card after Clerk activates the session.
  // A blocked visit waits for the full sign-out redirect before mounting the ticket flow.
  if (session === "ready") return <SignUpFlowCard {...props} />;
  if (session === "blocked") {
    return <InviteSessionStep marketingUrl={props.marketingUrl} creatorInvite={props.creatorInvite}><ClerkInviteSessionNotice continueInvite /></InviteSessionStep>;
  }
  const error = timedOut ? mapClerkError({ code: "fetch_timeout" }, "signup") : null;
  return <SignInShell marketingUrl={props.marketingUrl ?? undefined}><CheckingInviteStep banner={error?.kind === "banner" ? error.banner : null} onRetry={reloadPage} /></SignInShell>;
}

function SignUpFlowCard({ ticket, returnTo, marketingUrl, creatorInvite = false }: SignUpCardProps) {
  const flow = useSignUpFlow({ ticket, returnTo });
  return <AccountView flow={flow} marketingUrl={marketingUrl} creatorInvite={creatorInvite} />;
}

function RegularSignUpCard({ ticket, returnTo, marketingUrl, creatorInvite = false }: SignUpCardProps) {
  const redirecting = useRedirectIfSignedIn(returnTo);
  const flow = useSignUpFlow({ ticket, returnTo });
  return <AccountView flow={redirecting ? { ...flow, state: { ...flow.state, step: "signing", banner: null, fieldErrors: {} } } : flow} marketingUrl={marketingUrl} creatorInvite={creatorInvite} />;
}
