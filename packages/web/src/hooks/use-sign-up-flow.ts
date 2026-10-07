"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useSignIn, useSignUp } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { initialAuthState, reduceAuth, signUpRequirementsEvent, type AuthFlowState } from "../lib/auth-flow";
import { isWaitlistRefusal, mapClerkError } from "../lib/auth-errors";
import { hardNavigate } from "../components/auth/navigate";
import { DEFAULT_RETURN, safeReturnPath } from "../lib/auth-return";

type AccountInput = { username: string; password: string; legalAccepted: boolean };
type Actions = {
  submitAccount(input: AccountInput): Promise<void>;
  continueWithDiscord(input: { username: string; legalAccepted: boolean }): Promise<void>;
  submitCode(code: string): Promise<void>; resendCode(): Promise<void>;
};
type ResumeKind = "sign-in" | "sign-up" | null;
type Resume = { kind?: ResumeKind; returnTo?: unknown; attemptId?: string };

function readResume(): Resume {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem("dd_auth_resume") ?? "null");
    return value && typeof value === "object" ? value as Resume : {};
  } catch { return {}; }
}

// Both entry points use the same signup actions so the callback can fill missing
// username/consent without replacing the invitation attempt or requiring a password.
function useAccountFlow(opts: { ticket: string | null; returnTo: string; callback: boolean }, signUpSignal: ReturnType<typeof useSignUp>, signInSignal?: ReturnType<typeof useSignIn>): {
  state: AuthFlowState; resumeKind: ResumeKind; actions: Actions;
} {
  const router = useRouter();
  const [state, dispatch] = useReducer(reduceAuth, { returnTo: opts.returnTo, step: opts.callback ? "signing" as const : "invite" as const }, initialAuthState);
  const [resumeKind, setResumeKind] = useState<ResumeKind>(null);
  const latest = useRef({ signUpSignal, signInSignal });
  latest.current = { signUpSignal, signInSignal };
  const busy = useRef(false);
  const started = useRef(false);
  const mounted = useRef(true);
  const recovering = useRef(false);
  const lockedEmail = useRef<string | null>(null);
  const destination = useRef(state.returnTo);
  const fetching = signUpSignal.fetchStatus === "fetching" || signInSignal?.fetchStatus === "fetching";
  // Before Clerk loads, these hooks return gated proxies with idle fetchStatus,
  // no attempt IDs and no email. Wait for an authoritative attempt to appear.
  const loading = !signUpSignal.signUp || (opts.callback && (!signInSignal?.signIn ||
    (!signInSignal.signIn.id && !signUpSignal.signUp.id && !signUpSignal.signUp.emailAddress && signInSignal.signIn.status !== "complete" && signUpSignal.signUp.status !== "complete")));
  const pending = state.pending || fetching || loading;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => dispatch({ type: "error", view: mapClerkError({ code: "fetch_timeout" }, "signup") }), 30000);
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (state.step !== "success") return;
    const timer = setTimeout(() => {
      try { sessionStorage.removeItem("dd_auth_resume"); } catch { /* Storage may be disabled. */ }
      if (destination.current.startsWith("/")) router.push(destination.current);
      else window.location.assign(destination.current);
    }, 900);
    return () => clearTimeout(timer);
  }, [state.step, router]);

  const activeErrors = opts.callback && (resumeKind === "sign-in" || signInSignal?.signIn.status === "complete") ? signInSignal?.errors : signUpSignal.errors;
  const errorKey = JSON.stringify(opts.callback ? [signUpSignal.errors, signInSignal?.errors] : activeErrors);
  useEffect(() => {
    if (opts.callback) {
      signalError("sso", "sign-in");
      signalError("sso", "sign-up");
      return;
    }
    signalError(state.step === "code" ? "code" : !opts.callback && !lockedEmail.current ? "ticket" : "signup", activeErrors === signInSignal?.errors ? "sign-in" : "sign-up");
  }, [errorKey]);

  const fail = (error: unknown, context: Parameters<typeof mapClerkError>[1]) => {
    if (context === "sso" && isWaitlistRefusal(error)) { recover(); return; }
    if (mounted.current) dispatch({ type: "error", view: mapClerkError(error, context) });
  };
  const recover = () => {
    if (!recovering.current) { recovering.current = true; hardNavigate("/api/auth/existing-player/start"); }
  };
  const signalError = (context: Parameters<typeof mapClerkError>[1], kind: Exclude<ResumeKind, null> = "sign-up") => {
    const errors = kind === "sign-in" ? latest.current.signInSignal?.errors : latest.current.signUpSignal.errors;
    if (!errors) return false;
    let found = false;
    for (const [name, error] of Object.entries(errors.fields)) {
      if (error) { fail({ ...error, meta: { paramName: name === "legalAccepted" ? "legal_accepted" : name } }, context === "sso" ? "sso" : name === "code" ? "code" : "signup"); found = true; }
    }
    for (const error of [...errors.raw ?? [], ...errors.global ?? []]) { fail(error, context); found = true; }
    return found;
  };
  const call = async (request: () => Promise<{ error: unknown }>, context: Parameters<typeof mapClerkError>[1], kind: Exclude<ResumeKind, null> = "sign-up", progressed = () => true) => {
    const result = await request();
    const error = result?.error;
    if (error) { fail(error, context); return false; }
    if (!mounted.current || signalError(context, kind)) return false;
    // Clerk can swallow an offline fetch and return { result: undefined, error: null }.
    if (!result || !("error" in result) || !progressed()) { fail({ code: "network_error" }, context); return false; }
    return true;
  };
  const run = async (context: Parameters<typeof mapClerkError>[1], work: () => Promise<void>, initialize = false) => {
    if (busy.current || (!initialize && state.pending) || latest.current.signUpSignal.fetchStatus === "fetching" || latest.current.signInSignal?.fetchStatus === "fetching" || !latest.current.signUpSignal.signUp || state.step === "success") return;
    busy.current = true; dispatch({ type: "submit" });
    try { await work(); } catch (error) { fail(error, context); }
    finally { busy.current = false; if (mounted.current) dispatch({ type: "settled" }); }
  };
  const finalize = async (kind: Exclude<ResumeKind, null>) => {
    const resource = kind === "sign-in" ? latest.current.signInSignal?.signIn : latest.current.signUpSignal.signUp;
    if (!resource || resource.status !== "complete") { fail(null, "sso"); return; }
    if (signalError("sso", kind)) return;
    setResumeKind(kind); dispatch({ type: "complete" });
    if (await call(() => resource.finalize({ navigate: ({ decorateUrl }) => { destination.current = decorateUrl(state.returnTo); } }), "sso", kind)) dispatch({ type: "finalized" });
  };
  const advanceSignup = async () => {
    const signUp = latest.current.signUpSignal.signUp!;
    if (!signUp.emailAddress || (lockedEmail.current && lockedEmail.current !== signUp.emailAddress)) {
      dispatch({ type: "error", view: { kind: "step", step: "err-signup" } }); return;
    }
    lockedEmail.current = signUp.emailAddress;
    dispatch({ type: "invite-ready", lockedEmail: signUp.emailAddress });
    const event = signUpRequirementsEvent(signUp);
    if (event.type === "complete") await finalize("sign-up");
    else if (event.type === "code-sent") {
      if (await call(() => signUp.verifications.sendEmailCode(), "code")) dispatch({ ...event, now: Date.now() });
    } else dispatch(event);
  };

  useEffect(() => {
    if (started.current || recovering.current || fetching || loading) return;
    started.current = true;
    void run("signup", async () => {
      const signUp = latest.current.signUpSignal.signUp!;
      if (opts.callback) {
        const signIn = latest.current.signInSignal!.signIn!;
        const resume = readResume();
        if (signIn.status === "complete") { await finalize("sign-in"); return; }
        // A sign-in OAuth transfer is not an invitation. Never start a new signup.
        if (resume.kind === "sign-in" || signIn.isTransferable || (resume.attemptId && resume.attemptId !== signUp.id)) {
          recover(); return;
        }
        setResumeKind("sign-up");
        await advanceSignup();
      } else {
        if (!opts.ticket) { dispatch({ type: "error", view: { kind: "step", step: "err-signup" } }); return; }
        if (!await call(() => signUp.ticket({ ticket: opts.ticket! }), "ticket", "sign-up", () => Boolean(latest.current.signUpSignal.signUp!.emailAddress))) return;
        setResumeKind("sign-up");
        await advanceSignup();
      }
    }, true);
  }, [fetching, loading]);

  const validAccount = (input: { username: string; legalAccepted: boolean }) => {
    if (!input.legalAccepted) { dispatch({ type: "error", view: { kind: "field", field: "legal", message: "Accept the terms and privacy policy to continue." } }); return false; }
    if (!input.username.trim()) { dispatch({ type: "error", view: { kind: "field", field: "username", message: "Enter a username." } }); return false; }
    return true;
  };
  const updateAccount = async (input: { username: string; legalAccepted: boolean }) => {
    const signUp = latest.current.signUpSignal.signUp!;
    if (!lockedEmail.current || signUp.emailAddress !== lockedEmail.current) { dispatch({ type: "error", view: { kind: "step", step: "err-signup" } }); return false; }
    return validAccount(input) && await call(() => signUp.update({ username: input.username, legalAccepted: input.legalAccepted }), "signup");
  };

  return {
    state: { ...state, pending: pending || busy.current }, resumeKind,
    actions: {
      submitAccount: async (input) => {
        if (state.step !== "invite") return;
        await run("signup", async () => {
          if (!await updateAccount(input)) return;
          const signUp = latest.current.signUpSignal.signUp!;
          // OAuth callbacks already have an external account; collect only the
          // outstanding fields. A password is needed only when Clerk asks for it.
          if ((!opts.callback || signUp.missingFields.includes("password")) && !await call(() => signUp.password({ password: input.password }), "signup", "sign-up", () => latest.current.signUpSignal.signUp!.status === "complete" || !latest.current.signUpSignal.signUp!.missingFields.includes("password"))) return;
          await advanceSignup();
        });
      },
      continueWithDiscord: async (input) => {
        if (state.step !== "invite") return;
        await run("sso", async () => {
          if (!await updateAccount(input)) return;
          const signUp = latest.current.signUpSignal.signUp!;
          try { sessionStorage.setItem("dd_auth_resume", JSON.stringify({ kind: "sign-up", returnTo: state.returnTo, attemptId: signUp.id })); } catch { /* Clerk preserves the accepted attempt even without storage. */ }
          await call(() => signUp.sso({ strategy: "oauth_discord", redirectUrl: state.returnTo, redirectCallbackUrl: "/sso-callback" }), "sso");
        });
      },
      submitCode: async (code) => {
        if (state.step !== "code" || state.codePurpose !== "signup") return;
        await run("code", async () => { if (await call(() => latest.current.signUpSignal.signUp!.verifications.verifyEmailCode({ code }), "code", "sign-up", () => latest.current.signUpSignal.signUp!.status === "complete" || !latest.current.signUpSignal.signUp!.unverifiedFields.includes("email_address"))) await advanceSignup(); });
      },
      resendCode: async () => {
        if (state.step !== "code" || state.codePurpose !== "signup" || Date.now() < (state.resendAvailableAt ?? 0)) return;
        await run("code", async () => { if (await call(() => latest.current.signUpSignal.signUp!.verifications.sendEmailCode(), "code")) dispatch({ type: "code-sent", purpose: "signup", now: Date.now() }); });
      },
    },
  };
}

export function useSignUpFlow(opts: { ticket: string | null; returnTo: string }): { state: AuthFlowState; actions: Actions } {
  const signal = useSignUp();
  const { state, actions } = useAccountFlow({ ...opts, callback: false }, signal);
  return { state, actions };
}

export function useSsoCallback(): { state: AuthFlowState; resumeKind: ResumeKind; actions: ReturnType<typeof useSignUpFlow>["actions"] } {
  const signUp = useSignUp();
  const signIn = useSignIn();
  const [returnTo] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_RETURN;
    const query = new URLSearchParams(window.location.search).get("redirect_url");
    return safeReturnPath(query ?? readResume().returnTo);
  });
  return useAccountFlow({ ticket: null, returnTo, callback: true }, signUp, signIn);
}
