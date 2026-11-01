"use client";

import { AccountView, SignInView } from "@/components/auth/auth-views";
import { InviteSessionNotice, InviteSessionStep } from "@/components/auth/invite-session-notice";
import { JoinCardView } from "@/components/auth/join-card";
import type { AuthFlowState } from "@/lib/auth-flow";

const noop = async () => {};
const MARKETING = "https://duelingdomain.com";

const state = (extra: Partial<AuthFlowState> = {}): AuthFlowState => ({
  step: "signin", identifier: null, lockedEmail: null, codePurpose: null, fieldErrors: {}, banner: null,
  pending: false, resendAvailableAt: null, returnTo: "/dashboard", ...extra,
});

const signInActions = {
  submitIdentifier: noop, continueWithDiscord: noop, submitPassword: noop, forgotPassword: noop,
  submitCode: noop, resendCode: noop, submitNewPassword: noop, back: () => {},
};
const accountActions = { submitAccount: noop, continueWithDiscord: noop, submitCode: noop, resendCode: noop };

export type PreviewView = "sign-in" | "sign-up" | "sso-callback" | "signing-stuck" | "invite-stuck" | "join-signed-in" | "sign-up-signed-in";

/**
 * The real `/sign-in`, `/sign-up?__clerk_ticket=x` and `/sso-callback` views (shell, captcha mount, tone and pack
 * wiring) fed static flow state, because the live pages need Clerk. Handlers are no-ops.
 */
export function ViewPreview({ view }: { view: PreviewView }) {
  const notice = <InviteSessionNotice identity="cardshark" onSignOut={noop} continueInvite={view === "sign-up-signed-in"} />;
  if (view === "join-signed-in") return <JoinCardView code="PreviewCode1" state="open" creatorName="Kaiba Plays" spotsLeft={1} waitlistSource="creator:PreviewCode1" marketingUrl={MARKETING} notice={notice} />;
  if (view === "sign-up-signed-in") return <InviteSessionStep marketingUrl={MARKETING}>{notice}</InviteSessionStep>;
  if (view === "sign-in") return <SignInView flow={{ state: state(), actions: signInActions }} marketingUrl={MARKETING} />;
  const stuck = { tone: "bad" as const, body: "Sign-in is having trouble. Try again in a moment.", code: "fetch_timeout" };
  if (view === "signing-stuck") return <AccountView callback flow={{ state: state({ step: "signing", banner: stuck }), actions: accountActions }} marketingUrl={MARKETING} />;
  if (view === "invite-stuck") return <AccountView flow={{ state: state({ step: "invite", banner: stuck }), actions: accountActions }} marketingUrl={MARKETING} />;
  if (view === "sign-up") {
    return <AccountView flow={{ state: state({ step: "invite", lockedEmail: "sam@example.com", identifier: "sam@example.com" }), actions: accountActions }} marketingUrl={MARKETING} />;
  }
  return <AccountView callback flow={{ state: state({ step: "invite", lockedEmail: "sam@example.com", identifier: "sam@example.com" }), actions: accountActions }} marketingUrl={MARKETING} />;
}
