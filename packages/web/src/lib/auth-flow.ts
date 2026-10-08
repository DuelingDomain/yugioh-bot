import { mapClerkError, type AuthErrorView } from "./auth-errors";
import { safeReturnPath } from "./auth-return";

export type AuthStep = "signin" | "password" | "code" | "newpw" | "invite" | "signing" | "recovering" | "success" | "err-invite" | "err-signup" | "err-banned";
export type CodePurpose = "signup" | "reset" | "client-trust";
export type FieldName = "identifier" | "password" | "code" | "newPassword" | "confirm" | "username" | "legal";
export interface AuthBanner { tone: "bad" | "info"; body: string; code?: string }
export interface AuthFlowState {
  step: AuthStep;
  identifier: string | null;
  lockedEmail: string | null;
  codePurpose: CodePurpose | null;
  fieldErrors: Partial<Record<FieldName, string>>;
  banner: AuthBanner | null;
  pending: boolean;
  resendAvailableAt: number | null;
  returnTo: string;
}
export type AuthEvent =
  | { type: "submit" } | { type: "settled" }
  | { type: "identified"; identifier: string } | { type: "needs-password" }
  | { type: "code-sent"; purpose: CodePurpose; now: number } | { type: "needs-new-password" }
  | { type: "invite-ready"; lockedEmail: string } | { type: "complete" } | { type: "finalized" } | { type: "recovering" }
  | { type: "error"; view: AuthErrorView } | { type: "back" };

/**
 * How long the success card stays up before the page navigates. The open pack (sign-in-shell.module.css) runs tear .8s,
 * burst .9s and rays 1s, and the mark finishes last: `mkgem` starts 260 + 1020 ms in and lasts 340 ms, so ~1620 ms. The
 * extra 80 ms is a settle so the finished mark is seen before the page switches.
 */
export const SUCCESS_HOLD_MS = 1700;
/** With reduced motion nothing animates (the shell stops every animation), so only a brief read of "You're in" is needed. */
export const SUCCESS_HOLD_REDUCED_MS = 600;

export function successHoldMs(): number {
  const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduced ? SUCCESS_HOLD_REDUCED_MS : SUCCESS_HOLD_MS;
}

/** The recovering card needs one painted frame before the page leaves. The timer covers a background tab, where frames never run. */
export const RECOVERY_PAINT_FALLBACK_MS = 250;

export function afterPaint(run: () => void): void {
  let done = false;
  const once = () => { if (!done) { done = true; run(); } };
  requestAnimationFrame(() => requestAnimationFrame(once));
  setTimeout(once, RECOVERY_PAINT_FALLBACK_MS);
}

export function initialAuthState(input: { returnTo: string; step?: AuthStep }): AuthFlowState {
  return { step: input.step ?? "signin", identifier: null, lockedEmail: null, codePurpose: null, fieldErrors: {}, banner: null, pending: false, resendAvailableAt: null, returnTo: safeReturnPath(input.returnTo) };
}

export function reduceAuth(state: AuthFlowState, event: AuthEvent): AuthFlowState {
  // The page is already leaving for Discord: hold the card, except for a stalled hand-off (banner error) handled below.
  if (state.step === "recovering" && !(event.type === "error" && event.view.kind === "banner")) return state;
  switch (event.type) {
    case "submit": return { ...state, pending: true, fieldErrors: {}, banner: null };
    case "settled": return { ...state, pending: false };
    case "identified": return { ...state, identifier: event.identifier };
    case "needs-password": return { ...state, step: "password", codePurpose: null, fieldErrors: {}, banner: null };
    case "code-sent": return { ...state, step: "code", codePurpose: event.purpose, resendAvailableAt: event.now + 30000, fieldErrors: {}, banner: null };
    case "needs-new-password": return { ...state, step: "newpw", codePurpose: null, fieldErrors: {}, banner: null };
    case "invite-ready": {
      const lockedEmail = state.lockedEmail ?? event.lockedEmail;
      return { ...state, step: "invite", lockedEmail, identifier: lockedEmail, codePurpose: null, fieldErrors: {}, banner: null };
    }
    case "complete": return { ...state, step: "signing", pending: true, fieldErrors: {}, banner: null };
    case "finalized": return state.step === "signing" ? { ...state, step: "success", pending: false } : state;
    case "recovering": return { ...state, step: "recovering", pending: false, fieldErrors: {}, banner: null };
    case "error": {
      const view = event.view;
      // The recovering card has no banner or buttons; if the hand-off stalls, fall back to the signing card's retry.
      if (state.step === "recovering" && view.kind === "banner") return { ...state, step: "signing", pending: false, fieldErrors: {}, banner: view.banner };
      if (view.kind === "step") return { ...state, step: view.step, pending: false, fieldErrors: {}, banner: null };
      if (view.kind === "field") return { ...state, pending: false, fieldErrors: { ...state.fieldErrors, [view.field]: view.message }, banner: null };
      return { ...state, pending: false, banner: view.banner };
    }
    case "back": return state.lockedEmail || state.pending || state.step === "success" || state.step === "signing" || state.step === "recovering" ? state : initialAuthState({ returnTo: state.returnTo });
  }
}

export function signInStatusEvent(status: string): AuthEvent {
  switch (status) {
    case "needs_identifier": return { type: "back" };
    case "needs_first_factor": return { type: "needs-password" };
    case "needs_client_trust": case "needs_second_factor": return { type: "code-sent", purpose: "client-trust", now: Date.now() };
    case "needs_new_password": return { type: "needs-new-password" };
    case "complete": return { type: "complete" };
    default: return { type: "error", view: mapClerkError(null, "password") };
  }
}

export function signUpRequirementsEvent(input: { status: string; missingFields: string[]; unverifiedFields: string[]; emailAddress: string | null }): AuthEvent {
  if (input.status === "complete") return { type: "complete" };
  if (input.status === "missing_requirements" && input.emailAddress) {
    if (input.missingFields.length > 0) return { type: "invite-ready", lockedEmail: input.emailAddress };
    if (input.unverifiedFields.includes("email_address")) return { type: "code-sent", purpose: "signup", now: Date.now() };
    return { type: "error", view: mapClerkError(null, "signup") };
  }
  return { type: "error", view: { kind: "step", step: "err-signup" } };
}
