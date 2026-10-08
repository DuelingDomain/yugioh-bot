// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { flushSync } from "react-dom";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSignInFlow } from "../../src/hooks/use-sign-in-flow";

import { RECOVERY_PAINT_FALLBACK_MS, SUCCESS_HOLD_MS, SUCCESS_HOLD_REDUCED_MS } from "../../src/lib/auth-flow";
const mock = vi.hoisted(() => ({ signal: {} as any, push: vi.fn(), prefetch: vi.fn(), hardNavigate: vi.fn() }));
vi.mock("@/components/auth/navigate", () => ({ hardNavigate: mock.hardNavigate }));
vi.mock("@clerk/nextjs", () => ({ useSignIn: () => mock.signal }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push, prefetch: mock.prefetch }) }));
const ok = () => Promise.resolve({ error: null });
const setup = () => renderHook(() => useSignInFlow({ returnTo: "/drafts?join=1#seat", marketingUrl: "https://duelingdomain.com" }));
const error = (code: string) => ({ error: { errors: [{ code }] } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  mock.push.mockReset(); mock.prefetch.mockReset();
  mock.hardNavigate.mockReset();
  window.history.replaceState(null, "", "/sign-in");
  sessionStorage.clear();
  mock.signal = { fetchStatus: "idle", errors: { fields: {}, raw: null, global: null }, signIn: {
    status: "needs_identifier", supportedSecondFactors: [{ strategy: "email_code" }], isTransferable: false,
    create: vi.fn(async () => { mock.signal.signIn.status = "needs_first_factor"; return { error: null }; }),
    password: vi.fn(ok), sso: vi.fn(ok), reset: vi.fn(ok), ticket: vi.fn(ok), finalize: vi.fn(ok),
    mfa: { sendEmailCode: vi.fn(ok), verifyEmailCode: vi.fn(ok) },
    resetPasswordEmailCode: { sendCode: vi.fn(ok), verifyCode: vi.fn(ok), submitPassword: vi.fn(ok) },
  } };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("sign-in flow", () => {
  it("shows a support message for a refused recovery account", () => {
    window.history.replaceState(null, "", "/sign-in?error=discord_recovery_support");
    const { result } = setup();
    expect(result.current.state.banner?.body).toContain("support@duelingdomain.com");
    expect(result.current.state.step).toBe("signin");
  });
  it("shows a friendly cancellation message after Discord denial", () => {
    window.history.replaceState(null, "", "/sign-in?error=discord_recovery_cancelled");
    const { result } = setup();
    expect(result.current.state.banner).toMatchObject({ tone: "info", body: expect.stringMatching(/cancelled.*try again/i) });
    expect(mock.hardNavigate).not.toHaveBeenCalled();
  });
  it("keeps later password signal errors on the password field after a failed SSO attempt", async () => {
    mock.signal.signIn.sso.mockResolvedValue(error("network_error"));
    const { result } = setup();
    await act(() => result.current.actions.continueWithDiscord());
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    mock.signal.signIn.password.mockImplementation(async () => {
      mock.signal.errors.fields.password = { code: "form_password_incorrect" }; return error("form_password_incorrect");
    });
    await act(() => result.current.actions.submitPassword("wrong"));
    expect(result.current.state.fieldErrors.password).toBe("That password doesn't match. Try again or reset it.");
    expect(result.current.state.banner).toBeNull(); expect(mock.hardNavigate).not.toHaveBeenCalled();
  });
  it.each(["sign_up_restricted_waitlist", "not_allowed_access", "sign_up_mode_restricted"])("recovers Discord refusal %s", async code => {
    mock.signal.signIn.sso.mockResolvedValue(error(code));
    const { result } = setup();
    await act(() => result.current.actions.continueWithDiscord());
    // The card explaining the second Discord trip shows first, then the page leaves once it has painted.
    expect(result.current.state).toMatchObject({ step: "recovering", banner: null, fieldErrors: {} });
    expect(mock.hardNavigate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(RECOVERY_PAINT_FALLBACK_MS));
    expect(mock.hardNavigate).toHaveBeenCalledTimes(1);
    expect(mock.hardNavigate).toHaveBeenCalledWith("/api/auth/existing-player/start");
    act(() => vi.advanceTimersByTime(1000));
    expect(mock.hardNavigate).toHaveBeenCalledTimes(1);
    expect(result.current.state.step).toBe("recovering");
  });
  it("consumes the recovery ticket via a same-origin POST and finalizes once", async () => {
    window.history.replaceState(null, "", "/sign-in?existing_player=1");
    const fetcher = vi.fn(async () => Response.json({ ticket: "test-ticket" }));
    vi.stubGlobal("fetch", fetcher);
    mock.signal.signIn.create.mockImplementation(async () => { mock.signal.signIn.status = "complete"; return { error: null }; });
    const { result, rerender } = setup();
    await act(async () => {});
    expect(fetcher).toHaveBeenCalledWith("/api/auth/existing-player/ticket", expect.objectContaining({ method: "POST" }));
    expect(mock.signal.signIn.create).toHaveBeenCalledWith({ strategy: "ticket", ticket: "test-ticket" });
    expect(result.current.state.step).toBe("success");
    rerender(); await act(async () => {});
    expect(mock.signal.signIn.create).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
  it("maps rejected recovery tickets and does not activate a session", async () => {
    window.history.replaceState(null, "", "/sign-in?existing_player=1");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ticket: "expired-ticket" })));
    mock.signal.signIn.create.mockResolvedValue(error("ticket_expired"));
    const { result } = setup(); await act(async () => {});
    expect(result.current.state.step).toBe("err-signup");
    expect(mock.signal.signIn.finalize).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("consumes a recovery ticket once in StrictMode and waits for SDK fetching", async () => {
    window.history.replaceState(null, "", "/sign-in?existing_player=1");
    const fetcher = vi.fn(async () => Response.json({ ticket: "test-ticket" })); vi.stubGlobal("fetch", fetcher);
    mock.signal.fetchStatus = "fetching";
    mock.signal.signIn.create.mockImplementation(async () => { mock.signal.signIn.status = "complete"; return { error: null }; });
    const { result, rerender } = renderHook(() => useSignInFlow({ returnTo: "/dashboard", marketingUrl: null }), { wrapper: StrictMode });
    await act(async () => {}); expect(fetcher).not.toHaveBeenCalled();
    mock.signal.fetchStatus = "idle"; rerender(); await act(async () => {});
    expect(fetcher).toHaveBeenCalledTimes(1); expect(mock.signal.signIn.finalize).toHaveBeenCalledTimes(1); expect(result.current.state.step).toBe("success");
  });
  it.each([undefined, {}, { result: undefined, error: null }])("shows service trouble when identifying makes no progress (%j)", async (response) => {
    mock.signal.signIn.create.mockResolvedValue(response);
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    expect(result.current.state).toMatchObject({ step: "signin", identifier: "a@test.dev", pending: false, banner: { tone: "bad", code: "network_error" } });
  });
  it("shows service trouble when Clerk swallows an offline password failure", async () => {
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    mock.signal.signIn.password.mockResolvedValue({ result: undefined, error: null });
    await act(() => result.current.actions.submitPassword("secret"));
    expect(result.current.state).toMatchObject({ step: "password", pending: false, banner: { tone: "bad", code: "network_error" } });
  });
  it.each(["client-trust", "reset"])("shows service trouble when %s code verification makes no progress", async (purpose) => {
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    if (purpose === "reset") await act(() => result.current.actions.forgotPassword());
    else {
      mock.signal.signIn.password.mockImplementation(async () => { mock.signal.signIn.status = "needs_second_factor"; return { error: null }; });
      await act(() => result.current.actions.submitPassword("secret"));
    }
    await act(() => result.current.actions.submitCode("123456"));
    expect(result.current.state).toMatchObject({ step: "code", pending: false, banner: { tone: "bad", code: "network_error" }, resendAvailableAt: 31000 });
  });
  it("shows service trouble when the new password makes no progress", async () => {
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    await act(() => result.current.actions.forgotPassword());
    mock.signal.signIn.resetPasswordEmailCode.verifyCode.mockImplementation(async () => { mock.signal.signIn.status = "needs_new_password"; return { error: null }; });
    await act(() => result.current.actions.submitCode("123456"));
    await act(() => result.current.actions.submitNewPassword("secret", "secret"));
    expect(result.current.state).toMatchObject({ step: "newpw", pending: false, banner: { tone: "bad", code: "network_error" } });
  });
  it.each(["result", "global"])("shows service trouble for Clerk's network Error in %s", async (source) => {
    const network = Object.assign(new Error('Clerk: Network error at "https://example.clerk.accounts.dev/v1/client/sign_ins" - TypeError: Failed to fetch. Please try again.'), { isClerkAPIResponseError: () => false, isClerkRuntimeError: () => false });
    const { result, rerender } = setup();
    if (source === "result") {
      mock.signal.signIn.create.mockResolvedValue({ error: network });
      await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    } else {
      mock.signal.errors = { fields: { identifier: null, password: null, code: null }, raw: [network], global: [network] };
      rerender();
    }
    expect(result.current.state).toMatchObject({ step: "signin", pending: false, banner: { tone: "bad", body: "Sign-in is having trouble. Try again in a moment." } });
  });
  it("identifies the email then requests the password", async () => {
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    expect(mock.signal.signIn.create).toHaveBeenCalledWith({ identifier: "a@test.dev" });
    expect(result.current.state).toMatchObject({ step: "password", identifier: "a@test.dev", pending: false });
  });
  it("retains a missing identifier on the invitation error step", async () => {
    mock.signal.signIn.create.mockResolvedValue(error("form_identifier_not_found"));
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    expect(result.current.state).toMatchObject({ step: "err-invite", identifier: "a@test.dev" });
  });
  it("preserves the return path for Discord and uses the custom callback", async () => {
    mock.signal.signIn.id = "";
    const { result } = setup();
    await act(() => result.current.actions.continueWithDiscord());
    expect(mock.signal.signIn.reset).not.toHaveBeenCalled();
    expect(mock.signal.signIn.sso).toHaveBeenCalledWith({ strategy: "oauth_discord", redirectUrl: "/drafts?join=1#seat", redirectCallbackUrl: "/sso-callback" });
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("resets a stale Discord attempt and waits for a fresh signal object before SSO", async () => {
    const stale = mock.signal.signIn;
    stale.id = "sia_stale";
    stale.firstFactorVerification = { status: "verified", error: { code: "sign_up_restricted_waitlist" } };
    const fresh = { ...stale, id: "", firstFactorVerification: { status: "unverified", error: null }, sso: vi.fn(ok), reset: vi.fn(ok) };
    const { result, rerender } = setup();
    let request!: Promise<void>;
    act(() => { request = result.current.actions.continueWithDiscord(); });
    await act(async () => { await Promise.resolve(); });
    expect(stale.reset).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(stale.sso).not.toHaveBeenCalled();
    expect(fresh.sso).not.toHaveBeenCalled();
    expect(result.current.state.pending).toBe(true);
    mock.signal = { ...mock.signal, signIn: fresh };
    rerender();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); await request; });
    expect(stale.id).toBe("sia_stale");
    expect(stale.sso).not.toHaveBeenCalled();
    expect(fresh.reset).not.toHaveBeenCalled();
    expect(fresh.sso).toHaveBeenCalledExactlyOnceWith({ strategy: "oauth_discord", redirectUrl: "/drafts?join=1#seat", redirectCallbackUrl: "/sso-callback" });
    expect(JSON.parse(sessionStorage.getItem("dd_auth_resume")!)).toEqual({ kind: "sign-in", returnTo: "/drafts?join=1#seat" });
    expect(result.current.state.pending).toBe(false);
    expect(mock.hardNavigate).not.toHaveBeenCalled();
  });
  it("shows service trouble when reset never publishes a fresh sign-in object", async () => {
    mock.signal.signIn.id = "sia_stale";
    const stale = mock.signal.signIn;
    const { result } = setup();
    let request!: Promise<void>;
    act(() => { request = result.current.actions.continueWithDiscord(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); await request; });
    expect(stale.reset).toHaveBeenCalledTimes(1);
    expect(stale.sso).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ step: "signin", pending: false, banner: { tone: "bad", code: "network_error" } });
    expect(mock.hardNavigate).not.toHaveBeenCalled();
  });
  it("keeps wrong password errors on the password field", async () => {
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    mock.signal.signIn.password.mockResolvedValue(error("form_password_incorrect"));
    await act(() => result.current.actions.submitPassword("wrong"));
    expect(result.current.state).toMatchObject({ step: "password", fieldErrors: { password: "That password doesn't match. Try again or reset it." } });
  });
  it("blocks duplicates and shows success after finalize clears the sign-in, then navigates", async () => {
    let finish!: (value: { error: null }) => void;
    mock.signal.signIn.password.mockImplementation(async () => { mock.signal.signIn.status = "complete"; return { error: null }; });
    mock.signal.signIn.finalize.mockImplementation(async ({ navigate }: any) => {
      await navigate({ decorateUrl: (path: string) => path });
      await new Promise(resolve => { finish = resolve; });
      mock.signal.signIn.status = null;
      return { error: null };
    });
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    let request!: Promise<void>;
    act(() => { request = result.current.actions.submitPassword("secret"); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.state).toMatchObject({ step: "signing", pending: true });
    await act(() => result.current.actions.submitPassword("secret"));
    expect(mock.signal.signIn.password).toHaveBeenCalledTimes(1);
    expect(mock.push).not.toHaveBeenCalled();
    await act(async () => { finish({ error: null }); await request; });
    expect(result.current.state).toMatchObject({ step: "success", banner: null });
    expect(result.current.state.fieldErrors).toEqual({});
    // The destination is warmed as the success card appears, so the switch itself is instant.
    expect(mock.prefetch).toHaveBeenCalledWith("/drafts?join=1#seat");
    act(() => vi.advanceTimersByTime(SUCCESS_HOLD_MS - 1));
    expect(mock.push).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mock.push).toHaveBeenCalledWith("/drafts?join=1#seat");
  });
  it("holds only briefly under reduced motion, since nothing animates", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query }));
    try {
      mock.signal.signIn.password.mockImplementation(async () => { mock.signal.signIn.status = "complete"; return { error: null }; });
      mock.signal.signIn.finalize.mockImplementation(async () => { mock.signal.signIn.status = null; return { error: null }; });
      const { result } = setup();
      await act(() => result.current.actions.submitIdentifier("a@test.dev"));
      await act(() => result.current.actions.submitPassword("secret"));
      expect(result.current.state.step).toBe("success");
      act(() => vi.advanceTimersByTime(SUCCESS_HOLD_REDUCED_MS - 1));
      expect(mock.push).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(mock.push).toHaveBeenCalledWith("/drafts?join=1#seat");
    } finally { vi.unstubAllGlobals(); }
  });
  it("outlasts the pack animation before navigating", () => {
    // mkgem starts at 260 + 1020 ms and lasts 340 ms (sign-in-shell.module.css); the hold must cover it.
    expect(SUCCESS_HOLD_MS).toBeGreaterThanOrEqual(260 + 1020 + 340);
  });
  it("shows a service banner when finalize fails and never navigates", async () => {
    mock.signal.signIn.password.mockImplementation(async () => { mock.signal.signIn.status = "complete"; return { error: null }; });
    mock.signal.signIn.finalize.mockResolvedValue(error("service_unavailable"));
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    await act(() => result.current.actions.submitPassword("secret"));
    expect(result.current.state).toMatchObject({ step: "signing", pending: false, banner: { tone: "bad", code: "service_unavailable", body: "Sign-in is having trouble. Try again in a moment." } });
    act(() => vi.advanceTimersByTime(2000));
    expect(mock.push).not.toHaveBeenCalled();
  });
  it.each(["needs_client_trust", "needs_second_factor"])("sends and verifies the email factor for %s", async (status) => {
    mock.signal.signIn.password.mockImplementation(async () => { mock.signal.signIn.status = status; return { error: null }; });
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    await act(() => result.current.actions.submitPassword("secret"));
    expect(result.current.state).toMatchObject({ step: "code", codePurpose: "client-trust", resendAvailableAt: 31000 });
    expect(mock.signal.signIn.mfa.sendEmailCode).toHaveBeenCalledTimes(1);
    mock.signal.signIn.mfa.verifyEmailCode.mockResolvedValue(error("form_code_incorrect"));
    await act(() => result.current.actions.submitCode("123456"));
    expect(result.current.state.fieldErrors.code).toBe("That code isn't right.");
    expect(mock.signal.signIn.mfa.verifyEmailCode).toHaveBeenCalledWith({ code: "123456" });
    await act(() => result.current.actions.resendCode());
    expect(mock.signal.signIn.mfa.sendEmailCode).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(30000));
    await act(() => result.current.actions.resendCode());
    expect(mock.signal.signIn.mfa.sendEmailCode).toHaveBeenCalledTimes(2);
    expect(result.current.state.resendAvailableAt).toBe(61000);
  });
  it("does not attempt unsupported second factors", async () => {
    mock.signal.signIn.supportedSecondFactors = [{ strategy: "totp" }];
    mock.signal.signIn.password.mockImplementation(async () => { mock.signal.signIn.status = "needs_second_factor"; return { error: null }; });
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    await act(() => result.current.actions.submitPassword("secret"));
    expect(mock.signal.signIn.mfa.sendEmailCode).not.toHaveBeenCalled();
    expect(result.current.state.banner?.tone).toBe("bad");
  });
  it("resets by code, rejects confirmation mismatch locally, then shows success after finalize clears the sign-in", async () => {
    mock.signal.signIn.finalize.mockImplementation(async () => { mock.signal.signIn.status = null; return { error: null }; });
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    await act(() => result.current.actions.forgotPassword());
    expect(result.current.state).toMatchObject({ step: "code", codePurpose: "reset" });
    await act(() => result.current.actions.resendCode());
    expect(mock.signal.signIn.resetPasswordEmailCode.sendCode).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(30000));
    await act(() => result.current.actions.resendCode());
    expect(mock.signal.signIn.resetPasswordEmailCode.sendCode).toHaveBeenCalledTimes(2);
    mock.signal.signIn.resetPasswordEmailCode.verifyCode.mockImplementation(async () => { mock.signal.signIn.status = "needs_new_password"; return { error: null }; });
    await act(() => result.current.actions.submitCode("123456"));
    expect(mock.signal.signIn.resetPasswordEmailCode.verifyCode).toHaveBeenCalledWith({ code: "123456" });
    expect(result.current.state.step).toBe("newpw");
    await act(() => result.current.actions.submitNewPassword("secret", "other"));
    expect(result.current.state.fieldErrors.confirm).toBeTruthy();
    expect(mock.signal.signIn.resetPasswordEmailCode.submitPassword).not.toHaveBeenCalled();
    mock.signal.signIn.resetPasswordEmailCode.submitPassword.mockImplementation(async () => { mock.signal.signIn.status = "complete"; return { error: null }; });
    await act(() => result.current.actions.submitNewPassword("secret", "secret"));
    expect(mock.signal.signIn.resetPasswordEmailCode.submitPassword).toHaveBeenCalledWith({ password: "secret" });
    expect(result.current.state).toMatchObject({ step: "success", banner: null });
    expect(result.current.state.fieldErrors).toEqual({});
  });
  it("resets the Clerk attempt on back and disallows requests from the wrong step", async () => {
    const { result } = setup();
    await act(() => result.current.actions.submitPassword("secret"));
    expect(mock.signal.signIn.password).not.toHaveBeenCalled();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    await act(async () => result.current.actions.back());
    expect(result.current.state).toMatchObject({ step: "signin", identifier: null });
    expect(mock.signal.signIn.reset).toHaveBeenCalledTimes(1);
  });
  it("honors fetchStatus and reports a stuck fetch", async () => {
    mock.signal.fetchStatus = "fetching";
    const { result } = setup();
    expect(result.current.state.pending).toBe(true);
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    expect(mock.signal.signIn.create).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(30000));
    expect(result.current.state.banner?.tone).toBe("bad");
  });
  it("maps signal field errors and catches rejected network calls", async () => {
    const { result, rerender } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    mock.signal.errors.fields.password = { code: "form_password_incorrect", message: "Wrong" };
    rerender();
    expect(result.current.state.fieldErrors.password).toBeTruthy();
    mock.signal.errors = { fields: {}, raw: null, global: null };
    mock.signal.signIn.password.mockRejectedValue(new Error("offline"));
    await act(() => result.current.actions.submitPassword("secret"));
    expect(result.current.state).toMatchObject({ step: "password", pending: false, banner: { tone: "bad" } });
  });
  it("cancels delayed navigation when unmounted", async () => {
    mock.signal.signIn.password.mockImplementation(async () => { mock.signal.signIn.status = "complete"; return { error: null }; });
    const { result, unmount } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    await act(() => result.current.actions.submitPassword("secret"));
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("handles global signal errors even when raw errors is an empty array", () => {
    mock.signal.errors = { fields: {}, raw: [], global: [{ code: "user_banned" }] };
    const { result } = setup();
    expect(result.current.state.step).toBe("err-banned");
  });
  it("reports a changed signal snapshot after a request, rather than advancing from stale status", async () => {
    const view = setup();
    const create = mock.signal.signIn.create;
    create.mockImplementation(async () => {
      mock.signal = { ...mock.signal, signIn: { ...mock.signal.signIn, status: "needs_first_factor" } };
      // Commit the signal notification before resolving the SDK method.
      flushSync(() => view.rerender());
      return { error: null };
    });
    await act(() => view.result.current.actions.submitIdentifier("a@test.dev"));
    expect(view.result.current.state.step).toBe("password");
  });
  it("does not finalize when the signal still reports a request error", async () => {
    const { result } = setup();
    await act(() => result.current.actions.submitIdentifier("a@test.dev"));
    mock.signal.signIn.password.mockImplementation(async () => {
      mock.signal.signIn.status = "complete";
      mock.signal.errors.fields.password = { code: "form_password_incorrect", message: "Wrong" };
      return { error: null };
    });
    await act(() => result.current.actions.submitPassword("secret"));
    expect(result.current.state).toMatchObject({ step: "password", fieldErrors: { password: "That password doesn't match. Try again or reset it." } });
    expect(mock.signal.signIn.finalize).not.toHaveBeenCalled();
    expect(mock.push).not.toHaveBeenCalled();
  });
});
