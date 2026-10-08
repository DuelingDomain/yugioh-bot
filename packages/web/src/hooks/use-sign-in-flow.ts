"use client";

import { useEffect, useReducer, useRef } from "react";
import { useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { afterPaint, initialAuthState, reduceAuth, signInStatusEvent, successHoldMs, type AuthFlowState } from "../lib/auth-flow";
import { isWaitlistRefusal, mapClerkError } from "../lib/auth-errors";
import { hardNavigate } from "../components/auth/navigate";
import { useRecoveryReload } from "./use-recovery-reload";

export function useSignInFlow(opts: { returnTo: string; marketingUrl: string | null }): {
  state: AuthFlowState;
  actions: {
    submitIdentifier(identifier: string): Promise<void>; continueWithDiscord(): Promise<void>;
    submitPassword(password: string): Promise<void>; forgotPassword(): Promise<void>;
    submitCode(code: string): Promise<void>; resendCode(): Promise<void>;
    submitNewPassword(password: string, confirm: string): Promise<void>; back(): void;
  };
} {
  const signal = useSignIn();
  const router = useRouter();
  const [state, dispatch] = useReducer(reduceAuth, { returnTo: opts.returnTo }, initialAuthState);
  const latest = useRef(signal);
  latest.current = signal;
  const busy = useRef(false);
  const startedTicket = useRef(false);
  const recovering = useRef(false);
  const ssoAttempt = useRef(false);
  const mounted = useRef(true);
  const destination = useRef(state.returnTo);
  const pending = state.pending || signal.fetchStatus === "fetching" || !signal.signIn;
  useRecoveryReload(state.step);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("error")) return;
    const error = url.searchParams.get("error");
    if (error === "discord_recovery_support") {
      dispatch({ type: "error", view: { kind: "banner", banner: { tone: "bad", body: "Your account needs help linking. Contact support@duelingdomain.com." } } });
    } else if (error === "discord_recovery_cancelled") {
      dispatch({ type: "error", view: { kind: "banner", banner: { tone: "info", body: "Discord sign-in was cancelled. You can try again when you're ready." } } });
    } else if (error === "discord_recovery_busy") {
      dispatch({ type: "error", view: { kind: "banner", banner: { tone: "bad", body: "Too many attempts. Try again in a few minutes." } } });
    } else if (error === "discord_recovery_unavailable") {
      dispatch({ type: "error", view: { kind: "banner", banner: { tone: "bad", body: "Sign-in is having trouble. Try again in a moment." } } });
    } else if (error === "discord_recovery_expired") {
      dispatch({ type: "error", view: { kind: "banner", banner: { tone: "bad", body: "Discord sign-in expired. Try again when you're ready." } } });
    }
    url.searchParams.delete("error");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => dispatch({ type: "error", view: mapClerkError({ code: "fetch_timeout" }, "password") }), 30000);
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (state.step !== "success") return;
    // Warm the destination while the pack opens so the switch after the hold is instant.
    if (destination.current.startsWith("/")) router.prefetch(destination.current);
    const timer = setTimeout(() => {
      if (destination.current.startsWith("/")) router.push(destination.current);
      else window.location.assign(destination.current); // Clerk's Safari cookie-refresh decoration.
    }, successHoldMs());
    return () => clearTimeout(timer);
  }, [state.step, router]);

  // Signals also expose field/global errors independently of the method result.
  const errorKey = JSON.stringify(signal.errors);
  useEffect(() => {
    const context = ssoAttempt.current ? "sso" : startedTicket.current ? "ticket" : state.step === "newpw" ? "newpw" : state.step === "code" ? "code" : state.step === "password" ? "password" : "identifier";
    signalError(context);
  }, [errorKey]);

  const fail = (error: unknown, context: Parameters<typeof mapClerkError>[1]) => {
    if (context === "sso" && isWaitlistRefusal(error)) {
      if (!recovering.current) {
        recovering.current = true;
        // Explain the second Discord trip before it starts; leave once the card has painted.
        if (mounted.current) dispatch({ type: "recovering" });
        afterPaint(() => hardNavigate("/api/auth/existing-player/start"));
      }
      return;
    }
    if (mounted.current) dispatch({ type: "error", view: mapClerkError(error, context) });
  };
  const signalError = (context: Parameters<typeof mapClerkError>[1]) => {
    const errors = latest.current.errors;
    let found = false;
    for (const [name, error] of Object.entries(errors.fields)) {
      if (error) { fail({ ...error, meta: { paramName: name } }, context); found = true; }
    }
    for (const error of [...errors.raw ?? [], ...errors.global ?? []]) { fail(error, context); found = true; }
    return found;
  };
  const call = async (request: () => Promise<{ error: unknown }>, context: Parameters<typeof mapClerkError>[1], progressed = () => true) => {
    const result = await request();
    const error = result?.error;
    if (error) { fail(error, context); return false; }
    if (!mounted.current || signalError(context)) return false;
    // Clerk can swallow an offline fetch and return { result: undefined, error: null }.
    if (!result || !("error" in result) || !progressed()) { fail({ code: "network_error" }, context); return false; }
    return true;
  };
  const waitForFreshSignIn = async (previous: NonNullable<typeof signal.signIn>) => {
    const deadline = Date.now() + 2000;
    while (mounted.current && Date.now() < deadline) {
      const signIn = latest.current.signIn;
      if (signIn && signIn !== previous && !signIn.id) return signIn;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return null;
  };
  const run = async (context: Parameters<typeof mapClerkError>[1], work: () => Promise<void>) => {
    if (busy.current || state.pending || latest.current.fetchStatus === "fetching" || !latest.current.signIn || state.step === "success") return;
    busy.current = true;
    dispatch({ type: "submit" });
    try { await work(); } catch (error) { fail(error, context); }
    finally { ssoAttempt.current = false; busy.current = false; if (mounted.current) dispatch({ type: "settled" }); }
  };
  const advance = async () => {
    const signIn = latest.current.signIn!;
    const event = signInStatusEvent(signIn.status);
    if (event.type === "code-sent") {
      if (signIn.status === "needs_second_factor" && !signIn.supportedSecondFactors.some(factor => factor.strategy === "email_code")) {
        fail(null, "code"); return;
      }
      if (await call(() => signIn.mfa.sendEmailCode(), "code")) dispatch({ ...event, now: Date.now() });
    } else if (event.type === "complete") {
      dispatch(event);
      // Clerk invokes navigate during activation. Capture its decorated destination;
      // navigation itself waits for the finalize result and the success frame.
      if (await call(() => signIn.finalize({ navigate: ({ decorateUrl }) => { destination.current = decorateUrl(state.returnTo); } }), "password")) dispatch({ type: "finalized" });
    } else dispatch(event);
  };
  const sendCode = async () => {
    const signIn = latest.current.signIn!;
    const purpose = state.codePurpose;
    const send = purpose === "reset" ? () => signIn.resetPasswordEmailCode.sendCode() : () => signIn.mfa.sendEmailCode();
    if (purpose && await call(send, "code")) dispatch({ type: "code-sent", purpose, now: Date.now() });
  };

  useEffect(() => {
    if (startedTicket.current || signal.fetchStatus === "fetching" || !signal.signIn || new URLSearchParams(window.location.search).get("existing_player") !== "1") return;
    startedTicket.current = true;
    // Replace the marker before consuming the single-use ticket. No token ever
    // enters browser history, a redirect URL, or a Referer header.
    const url = new URL(window.location.href); url.searchParams.delete("existing_player");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    void run("ticket", async () => {
      const response = await fetch("/api/auth/existing-player/ticket", { method: "POST", credentials: "same-origin", cache: "no-store" });
      const body: unknown = await response.json();
      const ticket = body && typeof body === "object" && "ticket" in body ? body.ticket : null;
      if (!response.ok || typeof ticket !== "string" || !ticket) { fail({ code: "ticket_expired" }, "ticket"); return; }
      if (await call(() => latest.current.signIn!.create({ strategy: "ticket", ticket }), "ticket", () => latest.current.signIn!.status !== "needs_identifier")) await advance();
    });
  }, [signal.fetchStatus, Boolean(signal.signIn)]);

  return {
    state: { ...state, pending: pending || busy.current },
    actions: {
      submitIdentifier: async (identifier) => {
        if (state.step !== "signin") return;
        await run("identifier", async () => {
          dispatch({ type: "identified", identifier });
          if (await call(() => latest.current.signIn!.create({ identifier }), "identifier", () => latest.current.signIn!.status !== "needs_identifier")) await advance();
        });
      },
      continueWithDiscord: async () => {
        if (state.step !== "signin") return;
        await run("sso", async () => {
          ssoAttempt.current = true;
          try { sessionStorage.setItem("dd_auth_resume", JSON.stringify({ kind: "sign-in", returnTo: state.returnTo })); } catch { /* Storage can be unavailable. Clerk still retains the attempt. */ }
          let signIn = latest.current.signIn!;
          if (signIn.id) {
            if (!await call(() => signIn.reset(), "sso")) return;
            // Reset publishes a new signal object; the old wrapper keeps its ID.
            const fresh = await waitForFreshSignIn(signIn);
            if (!fresh) { fail({ code: "network_error" }, "sso"); return; }
            signIn = fresh;
          }
          await call(() => signIn.sso({ strategy: "oauth_discord", redirectUrl: state.returnTo, redirectCallbackUrl: "/sso-callback" }), "sso");
        });
      },
      submitPassword: async (password) => {
        if (state.step !== "password") return;
        await run("password", async () => { if (await call(() => latest.current.signIn!.password({ password }), "password", () => latest.current.signIn!.status !== "needs_first_factor")) await advance(); });
      },
      forgotPassword: async () => {
        if (state.step !== "password") return;
        await run("code", async () => {
          if (await call(() => latest.current.signIn!.resetPasswordEmailCode.sendCode(), "code")) dispatch({ type: "code-sent", purpose: "reset", now: Date.now() });
        });
      },
      submitCode: async (code) => {
        if (state.step !== "code" || !state.codePurpose) return;
        await run("code", async () => {
          const signIn = latest.current.signIn!;
          const verify = state.codePurpose === "reset" ? () => signIn.resetPasswordEmailCode.verifyCode({ code }) : () => signIn.mfa.verifyEmailCode({ code });
          if (await call(verify, "code", () => ["complete", "needs_new_password"].includes(latest.current.signIn!.status))) await advance();
        });
      },
      resendCode: async () => {
        if (state.step !== "code" || !state.codePurpose || Date.now() < (state.resendAvailableAt ?? 0)) return;
        await run("code", sendCode);
      },
      submitNewPassword: async (password, confirm) => {
        if (state.step !== "newpw") return;
        await run("newpw", async () => {
          if (password !== confirm) { dispatch({ type: "error", view: { kind: "field", field: "confirm", message: "Passwords don't match." } }); return; }
          if (await call(() => latest.current.signIn!.resetPasswordEmailCode.submitPassword({ password }), "newpw", () => latest.current.signIn!.status !== "needs_new_password")) await advance();
        });
      },
      back: () => {
        if (!["password", "code", "newpw", "err-invite"].includes(state.step)) return;
        void run("identifier", async () => {
          if (await call(() => latest.current.signIn!.reset(), "identifier")) {
            dispatch({ type: "settled" });
            dispatch({ type: "back" });
          }
        });
      },
    },
  };
}
