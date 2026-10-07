"use client";

import { useEffect, useReducer, useRef } from "react";
import { useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { initialAuthState, reduceAuth, signInStatusEvent, type AuthFlowState } from "../lib/auth-flow";
import { mapClerkError } from "../lib/auth-errors";

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
  const mounted = useRef(true);
  const destination = useRef(state.returnTo);
  const pending = state.pending || signal.fetchStatus === "fetching" || !signal.signIn;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => dispatch({ type: "error", view: mapClerkError({ code: "fetch_timeout" }, "password") }), 30000);
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (state.step !== "success") return;
    const timer = setTimeout(() => {
      if (destination.current.startsWith("/")) router.push(destination.current);
      else window.location.assign(destination.current); // Clerk's Safari cookie-refresh decoration.
    }, 900);
    return () => clearTimeout(timer);
  }, [state.step, router]);

  // Signals also expose field/global errors independently of the method result.
  const errorKey = JSON.stringify(signal.errors);
  useEffect(() => {
    const context = state.step === "newpw" ? "newpw" : state.step === "code" ? "code" : state.step === "password" ? "password" : "identifier";
    signalError(context);
  }, [errorKey]);

  const fail = (error: unknown, context: Parameters<typeof mapClerkError>[1]) => {
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
  const call = async (request: () => Promise<{ error: unknown }>, context: Parameters<typeof mapClerkError>[1]) => {
    const { error } = await request();
    if (error) { fail(error, context); return false; }
    return mounted.current && !signalError(context);
  };
  const run = async (context: Parameters<typeof mapClerkError>[1], work: () => Promise<void>) => {
    if (busy.current || state.pending || latest.current.fetchStatus === "fetching" || !latest.current.signIn || state.step === "success") return;
    busy.current = true;
    dispatch({ type: "submit" });
    try { await work(); } catch (error) { fail(error, context); }
    finally { busy.current = false; if (mounted.current) dispatch({ type: "settled" }); }
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
      if (await call(() => signIn.finalize({ navigate: ({ decorateUrl }) => { destination.current = decorateUrl(state.returnTo); } }), "password")) {
        if (latest.current.signIn?.status === "complete") dispatch({ type: "finalized" });
        else fail(null, "password");
      }
    } else dispatch(event);
  };
  const sendCode = async () => {
    const signIn = latest.current.signIn!;
    const purpose = state.codePurpose;
    const send = purpose === "reset" ? () => signIn.resetPasswordEmailCode.sendCode() : () => signIn.mfa.sendEmailCode();
    if (purpose && await call(send, "code")) dispatch({ type: "code-sent", purpose, now: Date.now() });
  };

  return {
    state: { ...state, pending: pending || busy.current },
    actions: {
      submitIdentifier: async (identifier) => {
        if (state.step !== "signin") return;
        await run("identifier", async () => {
          dispatch({ type: "identified", identifier });
          if (await call(() => latest.current.signIn!.create({ identifier }), "identifier")) await advance();
        });
      },
      continueWithDiscord: async () => {
        if (state.step !== "signin") return;
        await run("sso", async () => {
          try { sessionStorage.setItem("dd_auth_resume", JSON.stringify({ kind: "sign-in", returnTo: state.returnTo })); } catch { /* Storage can be unavailable. Clerk still retains the attempt. */ }
          await call(() => latest.current.signIn!.sso({ strategy: "oauth_discord", redirectUrl: state.returnTo, redirectCallbackUrl: "/sso-callback" }), "sso");
        });
      },
      submitPassword: async (password) => {
        if (state.step !== "password") return;
        await run("password", async () => { if (await call(() => latest.current.signIn!.password({ password }), "password")) await advance(); });
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
          if (await call(verify, "code")) await advance();
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
          if (await call(() => latest.current.signIn!.resetPasswordEmailCode.submitPassword({ password }), "newpw")) await advance();
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
